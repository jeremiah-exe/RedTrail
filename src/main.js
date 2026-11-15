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

/* ---------- Route calculation (Stage 5) ---------- */

let routesCurrent = null;

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function readMaxSlope() {
  const input = $('max-slope-input');
  let v = parseFloat(input.value);
  if (!Number.isFinite(v)) v = ROUTING_CONFIG.maxSlopeDeg;
  v = Math.max(10, Math.min(90, v));
  input.value = v;
  return v;
}

function clearRouteResults() {
  routesCurrent = null;
  clearRoutes();
  $('sh-dist').textContent = '—';
  $('tr-dist').textContent = '—';
  $('direct-dist').textContent = '—';
  $('route-explanation').textContent = 'Route trade-offs will be explained here after calculation.';
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
      $('route-explanation').textContent = result.message;
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

    $('sh-dist').textContent = fmtDist(result.shortest.surfaceM);
    $('tr-dist').textContent = fmtDist(result.terrain.surfaceM);
    $('direct-dist').textContent = `${fmtDist(result.direct.horizontalM)} (horizontal)`;

    if (result.identical) {
      $('route-explanation').textContent =
        `Both searches found the same path (${fmtDist(result.shortest.surfaceM)} along the surface) under the ${result.maxSlopeDeg}° slope limit.`;
    } else {
      const pct = ((result.terrain.surfaceM - result.shortest.surfaceM) / result.shortest.surfaceM) * 100;
      $('route-explanation').textContent =
        `Shortest traversable: ${fmtDist(result.shortest.surfaceM)}. Terrain-aware: ${fmtDist(result.terrain.surfaceM)} ` +
        `(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%). Distances are along the surface; slope limit ${result.maxSlopeDeg}°. Full comparison arrives in Stage 6.`;
    }
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
  };

  console.log('[app] Stage 5: routing ready.');
}

init();