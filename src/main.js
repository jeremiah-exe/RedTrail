import 'ol/ol.css';
import './style.css';
import {
  initMap, zoomBy, setOrthoVisible, setOrthoOpacity, marsXYToLatLon,
  parseCoordinateInput, showSearchMarker, flyToXY,
  initOverlays, isMeasureActive, setMeasureActive, undoLastMeasurePoint, clearMeasurement,
  initPoints, setPointMarker, removePointMarker,
  initRoutes, setRoutes, clearRoutes, setRouteOverlaysVisible, fitToCoordinates,
} from './map.js';
import { computeRoutes, verifyRoute, ROUTING_CONFIG } from './routing.js';
import { loadTerrain, sampleAt, getCell, findValidCell } from './terrain.js';
import { analyzeRoute, explainRoutes, fmtDist, fmtTime, fmtCost, verifyStats, SPEED_CONFIG } from './analysis.js';
import { renderProfile, clearProfile } from './profile.js';

/* ==========================================================================
   main.js — application entry point
   Stage 1: UI shell only. No map, terrain or routing logic yet.
   ========================================================================== */

/* ---------- Small helpers ---------- */

// Shorthand for document.getElementById
const $ = (id) => document.getElementById(id);

// Shows a temporary message pill at the top of the screen
function showToast(message, durationMs = 3000) {
  const container = $('toast-container');
  const pill = document.createElement('div');
  pill.className = 'toast-pill';
  pill.textContent = message;
  container.appendChild(pill);

  setTimeout(() => {
    pill.style.transition = 'all 0.22s ease';
    pill.style.opacity = '0';
    pill.style.transform = 'translateY(-6px)';
    setTimeout(() => pill.remove(), 240);
  }, durationMs);
}

/* ---------- Left drawer: collapse / reopen ---------- */

function initDrawer() {
  const drawer = $('left-drawer');
  const reopenTab = $('drawer-reopen-tab');

  $('btn-collapse-drawer').addEventListener('click', () => {
    drawer.classList.add('collapsed');
    reopenTab.classList.add('visible');
  });

  reopenTab.addEventListener('click', () => {
    drawer.classList.remove('collapsed');
    reopenTab.classList.remove('visible');
  });
}

/* ---------- Layers widget: popover + opacity sliders ---------- */

function initLayersWidget() {
  const widget = $('layers-widget');

  // Toggle on click (the original opened on hover, which fails on touch screens)
  $('btn-layers').addEventListener('click', (e) => {
    e.stopPropagation();
    widget.classList.toggle('expanded');
  });

  // Close when clicking anywhere outside the widget
  document.addEventListener('click', (e) => {
    if (!widget.contains(e.target)) {
      widget.classList.remove('expanded');
    }
  });

  // Layer checkboxes and sliders. In Stage 2/7 these will control real
  // OpenLayers layers; for now we just report the change.
  const layerIds = ['ortho', 'slope', 'slope-classes', 'routes'];
  layerIds.forEach((name) => {
    const checkbox = $(`layer-${name}`);
    checkbox.addEventListener('change', () => {
      console.log(`[layers] ${name} visible =`, checkbox.checked);
    });

    const slider = $(`opacity-${name}`); // 'routes' has no slider, so this is null
    if (slider) {
      slider.addEventListener('input', () => {
        console.log(`[layers] ${name} opacity =`, Number(slider.value) / 100);
      });
    }
  });
}

/* ---------- Placeholder buttons (features arrive in later stages) ---------- */

function initPlaceholderButtons() {
  const later = {
  };

  Object.entries(later).forEach(([id, message]) => {
    $(id).addEventListener('click', () => showToast(message));
  });

  // Pressing Enter in the search box behaves like clicking the Go button
  $('coord-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-coord-search').click();
  });
}

/* ---------- Terrain readout (live, from real DEM + slope) ---------- */

function updateTerrainReadout([x, y]) {
  const s = sampleAt(x, y);
  let elev, slope;
  if (s.status === 'loading') {
    elev = 'ELEV loading…';
    slope = 'SLOPE loading…';
  } else if (s.status === 'outside') {
    elev = 'ELEV outside data';
    slope = 'SLOPE outside data';
  } else {
    elev = s.elevation === null ? 'ELEV no data' : `ELEV ${s.elevation.toFixed(1)} m`;
    slope = s.slope === null ? 'SLOPE no data' : `SLOPE ${s.slope.toFixed(1)}°`;
  }
  $('cursor-elev').textContent = elev;
  $('cursor-slope').textContent = slope;
}

function startTerrainLoading() {
  $('cursor-elev').textContent = 'ELEV loading…';
  $('cursor-slope').textContent = 'SLOPE loading…';
  showToast('Loading elevation and slope data (first load takes a few seconds)…', 5000);

  loadTerrain()
    .then((info) => showToast(`Terrain data ready (${info.seconds} s)`))
    .catch((err) => {
      console.error('[terrain] load failed', err);
      $('cursor-elev').textContent = 'ELEV unavailable';
      $('cursor-slope').textContent = 'SLOPE unavailable';
      showToast(`Terrain data failed to load: ${err.message}`, 9000);
    });
}

/* ---------- Start / destination selection (Stage 4) ---------- */

// Each point: { x, y (cell centre, map metres), col, row, elevation, slope }
const selection = { start: null, dest: null };
// null = auto-sequence; 'start' or 'dest' = one-shot override set by the Pick buttons
let pickTarget = null;

const LABEL = { start: 'Start (A)', dest: 'Destination (B)' };

function formatLatLon(x, y) {
  const { lat, lon } = marsXYToLatLon(x, y);
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${lon.toFixed(4)}°E`;
}

function renderSelection() {
  const { start, dest } = selection;

  $('start-coords').textContent = start ? formatLatLon(start.x, start.y) : 'Click the map to set';
  $('dest-coords').textContent = dest ? formatLatLon(dest.x, dest.y) : 'Click the map to set';

  const rows = [['A', start], ['B', dest]].filter(([, p]) => p);
  $('tele-elev').innerHTML = rows.length
    ? rows.map(([n, p]) => `<div>${n} ${p.elevation.toFixed(1)} m</div>`).join('')
    : '—';
  $('tele-slope').innerHTML = rows.length
    ? rows.map(([n, p]) => `<div>${n} ${p.slope.toFixed(1)}°</div>`).join('')
    : '—';

  $('btn-pick-start').classList.toggle('active', pickTarget === 'start');
  $('btn-pick-dest').classList.toggle('active', pickTarget === 'dest');

  let msg;
  if (pickTarget) msg = `Click the map to place ${LABEL[pickTarget]}.`;
  else if (!start) msg = 'Click the map to set the start (A).';
  else if (!dest) msg = 'Start set. Click the map to set the destination (B).';
  else msg = 'Both points set. Click the map to move B, or drag A or B.';
  $('selection-status').textContent = msg;

  $('btn-calc-routes').disabled = !(start && dest);
}

function setPickTarget(target) {
  pickTarget = target;
  if (target && isMeasureActive()) setMeasureActive(false); // measuring and picking can't share clicks
  renderSelection();
}

/** Validates, snaps and places a point. Returns true on success. */
function placePoint(which, [x, y]) {
  const r = findValidCell(x, y);

  if (r.status === 'loading') {
    showToast('Terrain data is still loading. Try again in a moment.');
    return false;
  }
  if (r.status === 'outside') {
    showToast('That location is outside the elevation data.');
    return false;
  }
  if (r.status === 'none') {
    showToast(`No valid terrain within ${r.searchM} m of that spot (missing data). Pick another location.`, 5000);
    return false;
  }

  selection[which] = { x: r.x, y: r.y, col: r.col, row: r.row, elevation: r.elevation, slope: r.slope };
  setPointMarker(which, r.x, r.y);
  clearRouteResults();
  if (r.moved) {
    showToast(
      `${LABEL[which]} moved ${Math.round(r.movedM)} m to the nearest cell with valid elevation and slope data.`,
      5000
    );
  }
  renderSelection();
  return true;
}

function onMapSelectClick(coord) {
  let which;
  if (pickTarget) which = pickTarget;
  else if (!selection.start) which = 'start';
  else which = 'dest'; // 2nd click sets B; later clicks move B

  if (placePoint(which, coord)) setPickTarget(null);
}

function onPointDragEnd(which, coord) {
  if (!placePoint(which, coord)) {
    // Invalid drop: put the marker back where it was
    const prev = selection[which];
    if (prev) setPointMarker(which, prev.x, prev.y);
  }
}

function swapPoints() {
  if (!selection.start && !selection.dest) return;
  [selection.start, selection.dest] = [selection.dest, selection.start];
  clearRouteResults();
  ['start', 'dest'].forEach((w) => {
    const p = selection[w];
    if (p) setPointMarker(w, p.x, p.y);
    else removePointMarker(w);
  });
  renderSelection();
}

function resetPoints() {
  selection.start = null;
  selection.dest = null;
  clearRouteResults();
  removePointMarker('start');
  removePointMarker('dest');
  setPickTarget(null);
}

function initSelectionControls() {
  $('btn-pick-start').addEventListener('click', () => setPickTarget(pickTarget === 'start' ? null : 'start'));
  $('btn-pick-dest').addEventListener('click', () => setPickTarget(pickTarget === 'dest' ? null : 'dest'));
  $('btn-swap').addEventListener('click', swapPoints);
  $('btn-reset').addEventListener('click', resetPoints);
  renderSelection();
}

/* ---------- Route calculation and comparison (Stages 5 + 6) ---------- */

let routesCurrent = null; // result of computeRoutes()
let statsCurrent = null; // { shortest, terrain, flatSpeedKmh }

function readMaxSlope() {
  const input = $('max-slope-input');
  let v = parseFloat(input.value);
  if (!Number.isFinite(v)) v = ROUTING_CONFIG.maxSlopeDeg;
  v = Math.max(10, Math.min(90, v));
  input.value = v;
  return v;
}

function readFlatSpeed() {
  const input = $('flat-speed-input');
  let v = parseFloat(input.value);
  if (!Number.isFinite(v)) v = SPEED_CONFIG.defaultKmh;
  v = Math.max(SPEED_CONFIG.minKmh, Math.min(SPEED_CONFIG.maxKmh, v));
  input.value = v.toFixed(1);
  return v;
}

function setExplanation(paragraphs) {
  $('route-explanation').replaceChildren(
    ...paragraphs.map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    })
  );
}

function exposureHtml(st) {
  const n = st.exposure.length;
  const shade = (i) => (0.25 + (0.75 * i) / Math.max(1, n - 1)).toFixed(2);
  const pctText = (f) => (f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`);
  const bar = st.exposure
    .map((f, i) => `<span style="width:${(f * 100).toFixed(2)}%;background:rgba(167,139,250,${shade(i)})"></span>`)
    .join('');
  const legend = st.exposure
    .map((f, i) => `<span><i style="background:rgba(167,139,250,${shade(i)})"></i>${st.classLabels[i]} ${pctText(f)}</span>`)
    .join('');
  return `<div class="exposure-title">DISTANCE BY SLOPE CLASS</div><div class="exposure-bar">${bar}</div><div class="exposure-legend">${legend}</div>`;
}

function fillRouteCard(prefix, st) {
  $(`${prefix}-dist`).textContent = fmtDist(st.surfaceM);
  $(`${prefix}-avg`).textContent = `${st.avgSlopeDeg.toFixed(1)}°`;
  $(`${prefix}-max`).textContent = `${st.maxSlopeDeg.toFixed(1)}°`;
  $(`${prefix}-gain`).textContent = `+${Math.round(st.gainM)} m`;
  $(`${prefix}-time`).textContent = fmtTime(st.timeH);
  $(`${prefix}-cost`).textContent = fmtCost(st.terrainCost);
  $(`${prefix}-exposure`).innerHTML = exposureHtml(st);
}

function clearRouteCard(prefix) {
  ['dist', 'avg', 'max', 'gain', 'time', 'cost'].forEach((f) => ($(`${prefix}-${f}`).textContent = '—'));
  $(`${prefix}-exposure`).innerHTML = '';
}

function clearRouteResults() {
  routesCurrent = null;
  statsCurrent = null;
  clearRoutes();
  clearRouteCard('sh');
  clearRouteCard('tr');
  $('direct-dist').textContent = '—';
  setExplanation(['Route trade-offs will be explained here after calculation.']);
  clearProfile($('elevation-profile-svg'), $('profile-empty'));
}

/** Recomputes all statistics and redraws the cards, explanation and chart. Cheap: does not re-run A*. */
function renderComparison() {
  if (!routesCurrent) return;
  const speed = readFlatSpeed();
  const s = analyzeRoute(routesCurrent.shortest, { flatSpeedKmh: speed });
  const t = analyzeRoute(routesCurrent.terrain, { flatSpeedKmh: speed });
  statsCurrent = { shortest: s, terrain: t, flatSpeedKmh: speed };

  fillRouteCard('sh', s);
  fillRouteCard('tr', t);
  $('direct-dist').textContent = `${fmtDist(routesCurrent.direct.horizontalM)} (horizontal)`;
  setExplanation(explainRoutes(routesCurrent, s, t, speed));
  renderProfile($('elevation-profile-svg'), $('profile-empty'), s, t);
}

async function calculateRoutes() {
  if (!selection.start || !selection.dest) return;
  const btn = $('btn-calc-routes');
  btn.disabled = true;
  btn.textContent = 'Calculating…';
  await new Promise((r) => setTimeout(r, 50)); // let the browser repaint before the heavy work

  try {
    const result = computeRoutes(selection.start, selection.dest, { maxSlopeDeg: readMaxSlope() });

    if (result.status === 'error') {
      clearRouteResults();
      setExplanation([result.message]);
      showToast(result.message, 9000);
      return;
    }

    routesCurrent = result;
    setRoutes({
      direct: result.direct.coords,
      shortest: result.shortest.coords,
      terrain: result.terrain.coords,
    });
    fitToCoordinates(result.shortest.coords.concat(result.terrain.coords));
    renderComparison();
  } catch (err) {
    console.error('[routing] failed', err);
    showToast(`Routing error: ${err.message}`, 8000);
  } finally {
    btn.textContent = 'Calculate routes';
    renderSelection(); // restores the button's enabled state
  }
}

function initRouteControls() {
  $('btn-calc-routes').addEventListener('click', calculateRoutes);
  $('max-slope-input').addEventListener('change', () => {
    readMaxSlope();
    clearRouteResults(); // old routes were computed under a different limit
  });
  $('flat-speed-input').addEventListener('change', () => {
    readFlatSpeed();
    renderComparison(); // only the time estimate changes
  });
  $('layer-routes').addEventListener('change', (e) => setRouteOverlaysVisible(e.target.checked));
}

/* ---------- Start-up ---------- */

/* ---------- Map wiring ---------- */

function formatCursor([x, y]) {
  const { lat, lon } = marsXYToLatLon(x, y);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const ns = lat >= 0 ? 'N' : 'S';
  return `x ${fmt(x)} m · y ${fmt(y)} m · ${Math.abs(lat).toFixed(4)}°${ns} ${lon.toFixed(4)}°E`;
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function renderMeasure({ active, count, totalM, lastM }) {
  $('btn-measure').classList.toggle('active', active);
  $('measure-pill').classList.toggle('visible', active || count > 0);

  let text;
  if (count === 0) text = 'Click map points to measure';
  else if (count === 1) text = 'Click a second point';
  else text = `${formatDistance(totalM)} total · last leg ${formatDistance(lastM)} · ${count} points`;
  $('measure-readout').textContent = text;
}

function runCoordinateSearch() {
  const result = parseCoordinateInput($('coord-search-input').value);
  if (!result.ok) {
    showToast(result.error, 5000);
    return;
  }
  showSearchMarker(result.x, result.y);
  flyToXY(result.x, result.y);
  const { lat, lon } = marsXYToLatLon(result.x, result.y);
  showToast(`Went to ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E (read as ${result.kind})`);
}

function initMapControls() {
  $('btn-zoom-in').addEventListener('click', () => zoomBy(1));
  $('btn-zoom-out').addEventListener('click', () => zoomBy(-1));

  $('layer-ortho').addEventListener('change', (e) => setOrthoVisible(e.target.checked));
  $('opacity-ortho').addEventListener('input', (e) => setOrthoOpacity(Number(e.target.value) / 100));

  // Coordinate search
  $('btn-coord-search').addEventListener('click', runCoordinateSearch);

  // Measure tool
  $('btn-measure').addEventListener('click', () => setMeasureActive(!isMeasureActive()));
  $('btn-measure-clear').addEventListener('click', clearMeasurement);
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return; // don't hijack typing
    if (e.key === 'Escape' && isMeasureActive()) setMeasureActive(false);
    if (e.key === 'Backspace' && isMeasureActive()) undoLastMeasurePoint();
  });
}

/* ---------- Start-up ---------- */

function init() {
  initDrawer();
  initLayersWidget();
  initPlaceholderButtons();

  initMap({
    target: $('map'),
    onPointerMove: (coord) => {
      $('cursor-coords').textContent = formatCursor(coord);
      updateTerrainReadout(coord);
    },
    onError: (msg) => showToast(msg, 6000),
  });
  initOverlays({ onMeasureChange: renderMeasure });
  initRoutes();
  initPoints({ onMapClick: onMapSelectClick, onPointDragEnd });
  initMapControls();
  initSelectionControls();
  initRouteControls();
  startTerrainLoading();

  // For checking values against QGIS and verifying routes in the browser console
  window.terrainDebug = {
    sampleAt, getCell, findValidCell, selection,
    verifyLast: () =>
      routesCurrent && {
        shortest: verifyRoute(routesCurrent.shortest, routesCurrent.maxSlopeDeg),
        terrain: verifyRoute(routesCurrent.terrain, routesCurrent.maxSlopeDeg),
      },
    verifyStatsLast: () =>
      statsCurrent && {
        shortest: verifyStats(routesCurrent.shortest, statsCurrent.shortest, statsCurrent.flatSpeedKmh),
        terrain: verifyStats(routesCurrent.terrain, statsCurrent.terrain, statsCurrent.flatSpeedKmh),
      },
    // elevation and slope of every cell on a route: pathCells('shortest') or pathCells('terrain')
    pathCells: (which) =>
      routesCurrent &&
      Array.from(routesCurrent[which].pathIdx, (i) => {
        const c = getCell(i % 4456, Math.floor(i / 4456)); // grid width is 4456 cells
        return { col: c.col, row: c.row, elev: c.elevation, slope: c.slope };
      }),
  };

  console.log('[app] Stage 6: route comparison ready.');
}

init();