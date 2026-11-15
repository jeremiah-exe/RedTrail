import 'ol/ol.css';
import './style.css';
import {
  initMap, zoomBy, setOrthoVisible, setOrthoOpacity, marsXYToLatLon,
  parseCoordinateInput, showSearchMarker, flyToXY,
  initOverlays, isMeasureActive, setMeasureActive, undoLastMeasurePoint, clearMeasurement,
} from './map.js';

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
    'btn-pick-start': 'Point selection arrives in Stage 4.',
    'btn-pick-dest': 'Point selection arrives in Stage 4.',
    'btn-swap': 'Point selection arrives in Stage 4.',
    'btn-reset': 'Point selection arrives in Stage 4.',
  };

  Object.entries(later).forEach(([id, message]) => {
    $(id).addEventListener('click', () => showToast(message));
  });

  // Pressing Enter in the search box behaves like clicking the Go button
  $('coord-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-coord-search').click();
  });
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
    },
    onError: (msg) => showToast(msg, 6000),
  });
  initOverlays({ onMeasureChange: renderMeasure });
  initMapControls();

  console.log('[app] Stage 2: map, search and measure ready.');
}

init();