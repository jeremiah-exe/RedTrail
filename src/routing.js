import { getTerrainGrid, cellCenter } from './terrain.js';

/* ==========================================================================
   routing.js — A* over the real 20 m DEM grid
   Two routes:
     'shortest' : minimises along-surface distance      sqrt(horizontal^2 + dz^2)
     'terrain'  : minimises along-surface distance x slope penalty
   Both: 8-direction moves, NoData blocked, cells steeper than the max slope
   blocked, no diagonal corner-cutting past blocked cells.
   The slope of a move = average of the two cells' slopes.
   ALL penalty values and the slope limit are EXPERIMENTAL assumptions,
   not validated astronaut mobility limits.
   ========================================================================== */

export const ROUTING_CONFIG = {
  maxSlopeDeg: 35, // cells steeper than this are blocked for both routes (90 = no limit)
  // First rule whose `below` is greater than the slope applies.
  penalties: [
    { below: 5, factor: 1.0 }, //  0-5 deg
    { below: 15, factor: 1.5 }, //  5-15 deg
    { below: 30, factor: 3.0 }, // 15-30 deg
    { below: Infinity, factor: 8.0 }, // 30+ deg
  ],
};

const SQRT2 = Math.SQRT2;
// Directions: E, SE, S, SW, W, NW, N, NE  (odd indices are diagonals)
const DC = [1, 1, 0, -1, -1, -1, 0, 1];
const DR = [0, 1, 1, 1, 0, -1, -1, -1];
const LUT_SIZE = 1000; // penalty lookup in 0.1 degree steps

/* ---------- Reusable search buffers (allocated once, ~110 MB) ---------- */
let gBuf = null; // best known cost to reach each cell
let dirBuf = null; // direction of the move that reached each cell

function ensureBuffers(n) {
  if (!gBuf || gBuf.length !== n) {
    gBuf = new Float32Array(n);
    dirBuf = new Uint8Array(n);
  }
}

/* ---------- Binary min-heap (typed arrays) ---------- */
class MinHeap {
  constructor(cap = 1 << 16) {
    this.n = 0;
    this.f = new Float64Array(cap);
    this.node = new Int32Array(cap);
    this.g = new Float32Array(cap);
    this.popNode = 0;
    this.popG = 0;
  }
  grow() {
    const cap = this.f.length * 2;
    const f = new Float64Array(cap); f.set(this.f); this.f = f;
    const node = new Int32Array(cap); node.set(this.node); this.node = node;
    const g = new Float32Array(cap); g.set(this.g); this.g = g;
  }
  push(fv, nodeIdx, gv) {
    if (this.n === this.f.length) this.grow();
    const { f, node, g } = this;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[p] <= fv) break;
      f[i] = f[p]; node[i] = node[p]; g[i] = g[p];
      i = p;
    }
    f[i] = fv; node[i] = nodeIdx; g[i] = gv;
  }
  pop() {
    const { f, node, g } = this;
    this.popNode = node[0];
    this.popG = g[0];
    const n = --this.n;
    if (n > 0) {
      const lf = f[n], ln = node[n], lg = g[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && f[c + 1] < f[c]) c++;
        if (f[c] >= lf) break;
        f[i] = f[c]; node[i] = node[c]; g[i] = g[c];
        i = c;
      }
      f[i] = lf; node[i] = ln; g[i] = lg;
    }
  }
}

/* ---------- Helpers ---------- */

/** A cell can be used only if DEM and slope are real values and slope <= limit. */
function makePassable(t, maxSlope) {
  const { dem, slope, demNoData: dNo, slopeNoData: sNo } = t;
  return (i) => {
    const e = dem[i];
    const s = slope[i];
    return e === e && e !== dNo && s === s && s !== sNo && s <= maxSlope;
  };
}

function buildPenaltyLut(penalties) {
  const lut = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const s = i / 10;
    const rule = penalties.find((p) => s < p.below) || penalties[penalties.length - 1];
    lut[i] = rule.factor;
  }
  return lut;
}

/* ---------- The A* search ---------- */
function runAstar(t, passable, sIdx, gIdx, mode, lut, hScale) {
  const W = t.width;
  const H = t.height;
  const cell = t.cell;
  const dem = t.dem;
  const slope = t.slope;
  const usePenalty = mode === 'terrain';
  const lutMax = LUT_SIZE - 1;

  ensureBuffers(W * H);
  gBuf.fill(Infinity);

  const gc = gIdx % W;
  const gr = (gIdx / W) | 0;
  // Octile distance in metres: the exact shortest HORIZONTAL path on an 8-direction
  // grid. Real cost is never lower (surface >= horizontal, penalty >= 1), so it is admissible.
  const h = (c, r) => {
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return hScale * cell * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
  };

  const heap = new MinHeap();
  gBuf[sIdx] = 0;
  heap.push(h(sIdx % W, (sIdx / W) | 0), sIdx, 0);

  let expanded = 0;
  let closestM = Infinity; // closest approach to the goal (for failure messages)

  while (heap.n > 0) {
    heap.pop();
    const cur = heap.popNode;
    const g = heap.popG;
    if (g > gBuf[cur]) continue; // stale heap entry
    expanded++;
    if (cur === gIdx) return { found: true, expanded, closestM: 0 };

    const cr = (cur / W) | 0;
    const cc = cur - cr * W;
    const hc = h(cc, cr);
    if (hc < closestM) closestM = hc;
    const e1 = dem[cur];
    const s1 = slope[cur];

    for (let k = 0; k < 8; k++) {
      const nc = cc + DC[k];
      const nr = cr + DR[k];
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const ni = nr * W + nc;
      if (!passable(ni)) continue;

      const diagonal = (k & 1) === 1;
      // No corner-cutting: both cells we squeeze between must be usable
      if (diagonal && (!passable(cr * W + nc) || !passable(nr * W + cc))) continue;

      const horiz = diagonal ? cell * SQRT2 : cell;
      const dz = dem[ni] - e1;
      let cost = Math.sqrt(horiz * horiz + dz * dz);
      if (usePenalty) cost *= lut[Math.min(lutMax, ((s1 + slope[ni]) * 5) | 0)]; // avg slope x10

      const ng = Math.fround(g + cost);
      if (ng < gBuf[ni]) {
        gBuf[ni] = ng;
        dirBuf[ni] = k;
        heap.push(ng + h(nc, nr), ni, ng);
      }
    }
  }
  return { found: false, expanded, closestM: closestM * 1 };
}

function reconstructPath(t, sIdx, gIdx) {
  const W = t.width;
  const rev = [];
  let idx = gIdx;
  rev.push(idx);
  while (idx !== sIdx) {
    const k = dirBuf[idx];
    idx -= DR[k] * W + DC[k];
    rev.push(idx);
  }
  const path = new Int32Array(rev.length);
  for (let i = 0; i < rev.length; i++) path[i] = rev[rev.length - 1 - i];
  return path;
}

/** Recomputes distances from the finished path in full double precision. */
function measurePath(t, path, lut) {
  const W = t.width;
  let surfaceM = 0;
  let horizontalM = 0;
  let terrainCost = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const diagonal = a % W !== b % W && ((a / W) | 0) !== ((b / W) | 0);
    const horiz = diagonal ? t.cell * SQRT2 : t.cell;
    const dz = t.dem[b] - t.dem[a];
    const surf = Math.sqrt(horiz * horiz + dz * dz);
    surfaceM += surf;
    horizontalM += horiz;
    terrainCost += surf * lut[Math.min(LUT_SIZE - 1, ((t.slope[a] + t.slope[b]) * 5) | 0)];
  }
  return { surfaceM, horizontalM, terrainCost };
}

function buildRoute(t, run, sIdx, gIdx, mode, lut, ms) {
  const pathIdx = reconstructPath(t, sIdx, gIdx);
  const m = measurePath(t, pathIdx, lut);
  const coords = Array.from(pathIdx, (i) => {
    const c = cellCenter(i % t.width, (i / t.width) | 0);
    return [c.x, c.y];
  });
  return {
    mode,
    pathIdx,
    coords,
    cells: pathIdx.length,
    surfaceM: m.surfaceM, // along-surface distance (reported distance)
    horizontalM: m.horizontalM, // grid distance ignoring elevation
    terrainCost: m.terrainCost, // surface distance x slope penalty (same model for both routes)
    expanded: run.expanded,
    ms,
  };
}

function error(code, message, extra = {}) {
  return { status: 'error', code, message, ...extra };
}

/* ==========================================================================
   Public API
   start / dest: { col, row }.  options: { maxSlopeDeg, penalties }
   ========================================================================== */
export function computeRoutes(start, dest, options = {}) {
  const t = getTerrainGrid();
  if (!t) return error('not_ready', 'Terrain data is not loaded yet.');

  const maxSlope = options.maxSlopeDeg ?? ROUTING_CONFIG.maxSlopeDeg;
  const penalties = options.penalties ?? ROUTING_CONFIG.penalties;
  const passable = makePassable(t, maxSlope);
  const W = t.width;
  const sIdx = start.row * W + start.col;
  const gIdx = dest.row * W + dest.col;

  if (sIdx === gIdx) return error('same_cell', 'Start and destination are in the same 20 m cell.');
  if (!passable(sIdx)) {
    return error('start_blocked', `Start (A) is on ${t.slope[sIdx].toFixed(1)}° terrain, above the ${maxSlope}° slope limit. Move it or raise the limit.`);
  }
  if (!passable(gIdx)) {
    return error('dest_blocked', `Destination (B) is on ${t.slope[gIdx].toFixed(1)}° terrain, above the ${maxSlope}° slope limit. Move it or raise the limit.`);
  }

  const lut = buildPenaltyLut(penalties);
  const minFactor = Math.min(...lut);
  if (minFactor < 1) console.warn('[routing] a penalty below 1.0 weakens the heuristic; scaling it down to stay admissible');
  const hScale = Math.min(1, minFactor);

  // Straight line: horizontal reference distance between the two cell centres
  const a = cellCenter(start.col, start.row);
  const b = cellCenter(dest.col, dest.row);
  const direct = { coords: [[a.x, a.y], [b.x, b.y]], horizontalM: Math.hypot(b.x - a.x, b.y - a.y) };

  // ---- Shortest traversable route ----
  let t0 = performance.now();
  const runS = runAstar(t, passable, sIdx, gIdx, 'shortest', lut, hScale);
  const msS = performance.now() - t0;

  if (!runS.found) {
    // Explain WHY there is no route
    let limitIsCause = false;
    if (maxSlope < 90) {
      const relaxed = runAstar(t, makePassable(t, 90), sIdx, gIdx, 'shortest', lut, hScale);
      limitIsCause = relaxed.found;
    }
    const message = limitIsCause
      ? `No route exists under the ${maxSlope}° slope limit. A route does exist if steeper terrain is allowed (raise the limit; 90 = no limit).`
      : `No route exists: B is cut off from A by missing data (NoData) or the dataset edge. ` +
        `${runS.expanded.toLocaleString()} cells were reachable from A; the closest approach to B was about ${Math.round(runS.closestM)} m.`;
    return error(limitIsCause ? 'blocked_by_limit' : 'no_path', message, { expanded: runS.expanded });
  }
  const shortest = buildRoute(t, runS, sIdx, gIdx, 'shortest', lut, msS);

  // ---- Terrain-aware route ----
  t0 = performance.now();
  const runT = runAstar(t, passable, sIdx, gIdx, 'terrain', lut, hScale);
  const msT = performance.now() - t0;
  const terrain = buildRoute(t, runT, sIdx, gIdx, 'terrain', lut, msT);

  const identical =
    shortest.pathIdx.length === terrain.pathIdx.length &&
    shortest.pathIdx.every((v, i) => v === terrain.pathIdx[i]);

  console.log(
    `[routing] shortest: ${shortest.cells} cells, ${shortest.surfaceM.toFixed(0)} m surface, ${shortest.expanded.toLocaleString()} expanded, ${msS.toFixed(0)} ms\n` +
      `[routing] terrain : ${terrain.cells} cells, ${terrain.surfaceM.toFixed(0)} m surface, ${terrain.expanded.toLocaleString()} expanded, ${msT.toFixed(0)} ms`
  );

  return { status: 'ok', maxSlopeDeg: maxSlope, direct, shortest, terrain, identical };
}

/* ==========================================================================
   Checkpoint helper: independently re-checks a finished route.
   Verifies every cell is valid, every step is a legal 8-direction move,
   no diagonal cuts a blocked corner, and recomputes the surface distance.
   ========================================================================== */
export function verifyRoute(route, maxSlopeDeg = ROUTING_CONFIG.maxSlopeDeg) {
  const t = getTerrainGrid();
  const passable = makePassable(t, maxSlopeDeg);
  const W = t.width;
  const problems = [];
  const p = route.pathIdx;

  for (let i = 0; i < p.length; i++) {
    if (!passable(p[i])) problems.push(`cell #${i} (col ${p[i] % W}, row ${(p[i] / W) | 0}) is NoData or above the slope limit`);
    if (i === 0) continue;
    const ac = p[i - 1] % W, ar = (p[i - 1] / W) | 0;
    const bc = p[i] % W, br = (p[i] / W) | 0;
    const dc = bc - ac, dr = br - ar;
    if (Math.abs(dc) > 1 || Math.abs(dr) > 1 || (dc === 0 && dr === 0)) {
      problems.push(`step #${i} is not a legal 8-direction move`);
    } else if (dc !== 0 && dr !== 0 && (!passable(ar * W + bc) || !passable(br * W + ac))) {
      problems.push(`step #${i} cuts a blocked corner`);
    }
  }

  let surfaceM = 0;
  for (let i = 1; i < p.length; i++) {
    const diagonal = p[i - 1] % W !== p[i] % W && ((p[i - 1] / W) | 0) !== ((p[i] / W) | 0);
    const horiz = diagonal ? t.cell * SQRT2 : t.cell;
    const dz = t.dem[p[i]] - t.dem[p[i - 1]];
    surfaceM += Math.sqrt(horiz * horiz + dz * dz);
  }

  return { ok: problems.length === 0, cells: p.length, problems: problems.slice(0, 10), recomputedSurfaceM: surfaceM };
}