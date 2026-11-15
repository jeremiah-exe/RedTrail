import './style.css';

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
    'btn-coord-search': 'Coordinate search arrives in Stage 2 (needs the map projection).',
    'btn-pick-start': 'Point selection arrives in Stage 4.',
    'btn-pick-dest': 'Point selection arrives in Stage 4.',
    'btn-swap': 'Point selection arrives in Stage 4.',
    'btn-reset': 'Point selection arrives in Stage 4.',
    'btn-measure': 'Measure tool arrives in Stage 2 (needs the map).',
    'btn-measure-clear': 'Measure tool arrives in Stage 2 (needs the map).',
    'btn-zoom-in': 'Zoom controls arrive in Stage 2 (needs the map).',
    'btn-zoom-out': 'Zoom controls arrive in Stage 2 (needs the map).',
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

function init() {
  initDrawer();
  initLayersWidget();
  initPlaceholderButtons();
  console.log('[app] Stage 1 UI shell ready.');
}

init();