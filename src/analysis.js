import { getTerrainGrid, getCell } from './terrain.js';
import { ROUTING_CONFIG } from './routing.js';

/* ==========================================================================
   analysis.js — statistics, time estimate and plain-language explanation
   MEASURED/DERIVED from rasters: distance, slope, gain, exposure.
   ASSUMED: walking pace (Tobler's function is an Earth-hiker model).
   ========================================================================== */

export const SPEED_CONFIG = { defaultKmh: 3.0, minKmh: 0.5, maxKmh: 6.0 };
const SQRT2 = Math.SQRT2;

/* ---------- Formatting ---------- */
export function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}
export function fmtTime(hours) {
  const totalMin = Math.round(hours * 60);
  if (totalMin < 1) return '< 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  return `${Math.floor(totalMin / 60)} h ${totalMin % 60} min`;
}
export function fmtCost(m) {
  return m < 1000 ? `${Math.round(m)} m-eq` : `${(m / 1000).toFixed(2)} km-eq`;
}
function pct(f) {
  return f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`;
}

/* ---------- Tobler's hiking function, scaled so level ground = 1 ----------
   Tobler: v = 6 * exp(-3.5 * |g + 0.05|) km/h, g = rise / horizontal run.
   Dividing by its value at g = 0 gives a speed multiplier. */
export function toblerFactor(gradient) {
  return Math.exp(-3.5 * (Math.abs(gradient + 0.05) - 0.05));
}

/* ---------- Slope classes (same boundaries as the penalty table) ---------- */
export function slopeClasses() {
  const bounds = ROUTING_CONFIG.penalties.map((r) => r.below);
  return bounds.map((hi, i) => {
    const lo = i === 0 ? 0 : bounds[i - 1];
    return { lo, hi, label: hi === Infinity ? `${lo}°+` : `${lo}–${hi}°` };
  });
}

/* ==========================================================================
   Statistics for one route (path of DEM cell indices from routing.js)
   ========================================================================== */
export function analyzeRoute(route, { flatSpeedKmh }) {
  const t = getTerrainGrid();
  const W = t.width;
  const p = route.pathIdx;
  const classes = slopeClasses();
  const classDist = new Array(classes.length).fill(0);
  const distAlong = new Float64Array(p.length);
  const elev = new Float32Array(p.length);
  const flatMh = flatSpeedKmh * 1000; // metres per hour on level ground

  let surfaceM = 0;
  let horizontalM = 0;
  let slopeXDist = 0;
  let gain = 0;
  let loss = 0;
  let timeH = 0;
  let maxSlope = t.slope[p[0]];
  elev[0] = t.dem[p[0]];

  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const diagonal = a % W !== b % W && ((a / W) | 0) !== ((b / W) | 0);
    const horiz = diagonal ? t.cell * SQRT2 : t.cell;
    const dz = t.dem[b] - t.dem[a];
    const surf = Math.sqrt(horiz * horiz + dz * dz);
    const avgS = (t.slope[a] + t.slope[b]) / 2;

    surfaceM += surf;
    horizontalM += horiz;
    slopeXDist += avgS * surf;
    if (t.slope[b] > maxSlope) maxSlope = t.slope[b];
    if (dz > 0) gain += dz;
    else loss -= dz;
    timeH += surf / (flatMh * toblerFactor(dz / horiz));
    classDist[classes.findIndex((c) => avgS < c.hi)] += surf;

    distAlong[i] = surfaceM;
    elev[i] = t.dem[b];
  }

  return {
    surfaceM,
    horizontalM,
    avgSlopeDeg: slopeXDist / surfaceM,
    maxSlopeDeg: maxSlope,
    gainM: gain,
    lossM: loss,
    timeH,
    terrainCost: route.terrainCost,
    classLabels: classes.map((c) => c.label),
    exposure: classDist.map((d) => d / surfaceM), // fractions of surface distance
    distAlong,
    elev,
  };
}

/* ==========================================================================
   Plain-language explanation (every sentence comes from computed numbers)
   Returns an array of paragraphs.
   ========================================================================== */
export function explainRoutes(result, s, t, flatSpeedKmh) {
  const classes = slopeClasses();
  const steep = (st) => st.exposure.reduce((sum, f, i) => (classes[i].lo >= 15 ? sum + f : sum), 0);
  const pace = `${flatSpeedKmh.toFixed(1)} km/h flat-ground pace`;
  const paras = [];

  if (result.identical) {
    paras.push(
      `Both searches returned the same path: ${fmtDist(s.surfaceM)} along the surface (${fmtDist(s.horizontalM)} horizontal), ` +
        `about ${fmtTime(s.timeH)} at the assumed ${pace}.`
    );
    paras.push(
      `The slope penalties did not change the result for this pair, so there is no distance-versus-slope trade-off here. ` +
        `Average slope ${s.avgSlopeDeg.toFixed(1)}°, steepest cell ${s.maxSlopeDeg.toFixed(1)}°, ` +
        `${pct(steep(s))} of the distance on slopes of 15° or more.`
    );
  } else {
    const dD = t.surfaceM - s.surfaceM;
    const dPct = (dD / s.surfaceM) * 100;
    if (Math.abs(dD) < 1) {
      paras.push(`The two routes are the same length (${fmtDist(s.surfaceM)}) but follow different paths.`);
    } else {
      paras.push(
        `The terrain-aware route is ${fmtDist(Math.abs(dD))} (${dD > 0 ? '+' : '−'}${Math.abs(dPct).toFixed(1)}%) ` +
          `${dD > 0 ? 'longer' : 'shorter'} than the shortest traversable route (${fmtDist(t.surfaceM)} vs ${fmtDist(s.surfaceM)}). ` +
          `Estimated time: ${fmtTime(t.timeH)} vs ${fmtTime(s.timeH)} at the assumed ${pace}.`
      );
    }
    paras.push(
      `Where they differ: ${pct(steep(t))} of the terrain-aware distance is on slopes of 15° or more, versus ${pct(steep(s))} for the shortest route. ` +
        `Steepest cell: ${t.maxSlopeDeg.toFixed(1)}° vs ${s.maxSlopeDeg.toFixed(1)}°. ` +
        `Average slope: ${t.avgSlopeDeg.toFixed(1)}° vs ${s.avgSlopeDeg.toFixed(1)}°. ` +
        `Cumulative climb: ${Math.round(t.gainM)} m vs ${Math.round(s.gainM)} m.`
    );
    paras.push(
      `Terrain cost (surface distance × experimental slope penalty): ${fmtCost(t.terrainCost)} for the terrain-aware route vs ${fmtCost(s.terrainCost)} ` +
        `for the shortest. The terrain-aware search minimises this value by construction.`
    );
  }

  paras.push(
    `Choosing between them is a judgement call: the shortest route minimises distance, while the terrain-aware route minimises the penalty-weighted cost. ` +
      `Neither is verified as safe. The slope penalties, the Tobler pace model and the ${result.maxSlopeDeg}° slope limit are experimental assumptions.`
  );
  return paras;
}

/* ==========================================================================
   Checkpoint helper: recomputes every statistic a second way, reading cells
   through terrain.js's public getCell(), and compares with what is displayed.
   ========================================================================== */
export function verifyStats(route, st, flatSpeedKmh) {
  const W = getTerrainGrid().width;
  const cellSize = getTerrainGrid().cell;
  const cells = Array.from(route.pathIdx, (i) => getCell(i % W, Math.floor(i / W)));
  const classes = slopeClasses();
  const classDist = new Array(classes.length).fill(0);

  let surf = 0, slopeXDist = 0, gain = 0, loss = 0, timeH = 0;
  let maxSlope = cells[0].slope;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const horiz = a.col !== b.col && a.row !== b.row ? cellSize * SQRT2 : cellSize;
    const dz = b.elevation - a.elevation;
    const step = Math.hypot(horiz, dz);
    const avgS = (a.slope + b.slope) / 2;
    surf += step;
    slopeXDist += avgS * step;
    maxSlope = Math.max(maxSlope, b.slope);
    if (dz > 0) gain += dz; else loss -= dz;
    timeH += step / (flatSpeedKmh * 1000 * toblerFactor(dz / horiz));
    classDist[classes.findIndex((c) => avgS < c.hi)] += step;
  }

  const exposureDiff = classDist.reduce((sum, d, i) => sum + Math.abs(d / surf - st.exposure[i]), 0);
  const rows = [
    ['surface distance (m)', st.surfaceM, surf],
    ['distance vs routing.js (m)', st.surfaceM, route.surfaceM],
    ['average slope (°)', st.avgSlopeDeg, slopeXDist / surf],
    ['max slope (°)', st.maxSlopeDeg, maxSlope],
    ['elevation gain (m)', st.gainM, gain],
    ['elevation loss (m)', st.lossM, loss],
    ['time (h)', st.timeH, timeH],
    ['exposure fractions (sum of differences)', exposureDiff, 0],
  ];
  const checks = rows.map(([name, shown, recomputed]) => ({
    name,
    shown,
    recomputed,
    ok: Math.abs(shown - recomputed) <= 1e-6 * Math.max(1, Math.abs(recomputed)),
  }));
  return { ok: checks.every((c) => c.ok), checks };
}