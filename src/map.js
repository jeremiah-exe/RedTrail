import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import WebGLTileLayer from 'ol/layer/WebGLTile.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js';
import { get as getProjection } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import { buffer as bufferExtent, getCenter, containsCoordinate } from 'ol/extent.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style.js';
import Translate from 'ol/interaction/Translate.js';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js';
import proj4 from 'proj4';

/* ==========================================================================
   map.js — OpenLayers map + custom Mars projection
   ========================================================================== */

/* ---------- Projection (verified against gdalinfo of the DEM and ortho) ----------
   Equidistant Cylindrical on a Mars sphere:
     radius            3,396,190 m
     standard parallel 18.4663 deg   (+lat_ts)
     central meridian  0 deg
     false easting/northing 0
   MARS_CRS = projected map metres (x, y) — what the rasters use.
   MARS_GEO = plain Mars longitude/latitude in degrees, for display only. */
const MARS_CRS = 'MARS_JEZERO_EQC';
const MARS_GEO = 'MARS_GEO';

proj4.defs(
  MARS_CRS,
  '+proj=eqc +lat_ts=18.4663 +lon_0=0 +x_0=0 +y_0=0 +a=3396190 +b=3396190 +units=m +no_defs'
);
proj4.defs(MARS_GEO, '+proj=longlat +a=3396190 +b=3396190 +no_defs');
register(proj4); // lets OpenLayers use the definitions above

/* ---------- Extents in map metres [minX, minY, maxX, maxY] (from gdalinfo) ---------- */
export const ORTHO_EXTENT = [4329192.108, 1042131.635, 4418058.789, 1143347.424];
export const DEM_EXTENT = [4328999.999, 1042080.0, 4418119.999, 1143420.0];

const ORTHO_URL = '/data/jezero_ortho_5m_cog.tif';

const marsProj = getProjection(MARS_CRS);
marsProj.setExtent(DEM_EXTENT);
// IMPORTANT: by default OpenLayers estimates scale by converting to Earth
// lat/lon and using EARTH's radius, which would make our scale bar wrong.
// Our units are already metres, so 1 map unit = 1 metre.
marsProj.setGetPointResolution((resolution) => resolution);

/* ---------- Coordinate helpers (map metres <-> Mars lat/lon) ---------- */
export function marsXYToLatLon(x, y) {
  const [lon, lat] = proj4(MARS_CRS, MARS_GEO, [x, y]);
  return { lat, lon };
}

export function latLonToMarsXY(lat, lon) {
  const [x, y] = proj4(MARS_GEO, MARS_CRS, [lon, lat]);
  return { x, y };
}

/* ---------- Map state ---------- */
let map = null;
let orthoLayer = null;

export function getMap() {
  return map;
}

/**
 * Creates the map inside `target`.
 * onPointerMove(coordinate)  -> called with [x, y] map metres as the mouse moves
 * onError(message)           -> called if the imagery fails to load
 */
export function initMap({ target, onPointerMove, onError }) {
  target.replaceChildren(); // removes the Stage 1 placeholder box

  const orthoSource = new GeoTIFF({
    sources: [{ url: ORTHO_URL }],
    projection: marsProj, // our COG has a custom CRS, so we state it explicitly
    attributions: 'Imagery: USGS Astrogeology / NASA Mars 2020 CTX orthomosaic (5 m)',
  });
  orthoSource.on('error', (e) => {
    console.error('[map] orthomosaic failed to load', e);
    if (onError) onError('Could not load the orthomosaic. Check the browser console.');
  });

  // Single 8-bit grey band -> show as grey (R = G = B = band 1)
  orthoLayer = new WebGLTileLayer({
    source: orthoSource,
    style: { color: ['array', ['band', 1], ['band', 1], ['band', 1], 1] },
  });

  const view = new View({
    projection: marsProj,
    center: getCenter(ORTHO_EXTENT),
    resolution: 60,
    minResolution: 1.25, // 4x past the 5 m native resolution (imagery gets blurry beyond this)
    maxResolution: 120,
    extent: bufferExtent(DEM_EXTENT, 8000), // limit panning to the study area + margin
    constrainOnlyCenter: true,
  });

  map = new OlMap({
    target,
    layers: [orthoLayer],
    view,
    controls: defaultControls({ zoom: false, rotate: false, attribution: false }).extend([
      new ScaleLine({
        target: document.getElementById('scale-line-container'),
        units: 'metric',
        minWidth: 60,
      }),
    ]),
    interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }),
  });

  // Fit the whole orthomosaic, leaving room for the left drawer
  view.fit(ORTHO_EXTENT, { padding: [90, 20, 80, 430] });

  if (onPointerMove) {
    map.on('pointermove', (evt) => onPointerMove(evt.coordinate));
  }

  // Sanity check: should match gdalinfo's centre of 77d47'28.19"E, 18d26'6.64"N
  // = 77.79116 E, 18.43518 N
  const [cx, cy] = getCenter(ORTHO_EXTENT);
  const c = marsXYToLatLon(cx, cy);
  console.log(
    `[map] ortho centre -> lat ${c.lat.toFixed(5)}, lon ${c.lon.toFixed(5)} (gdalinfo: 18.43518, 77.79116)`
  );

  return map;
}

/* ---------- Controls used by the UI ---------- */
export function zoomBy(delta) {
  if (!map) return;
  const view = map.getView();
  view.animate({ zoom: view.getZoom() + delta, duration: 250 });
}

export function setOrthoVisible(visible) {
  if (orthoLayer) orthoLayer.setVisible(visible);
}

export function setOrthoOpacity(opacity) {
  if (orthoLayer) orthoLayer.setOpacity(opacity);
}

/* ==========================================================================
   Coordinate parsing, search marker and measure tool
   ========================================================================== */

const MARS_RADIUS_M = 3396190;

/**
 * Great-circle distance in metres between two map coordinates [x, y].
 * Measured along the Mars sphere, NOT as flat map distance, and NOT along
 * the terrain surface (elevation changes are ignored).
 */
export function sphereDistanceM(a, b) {
  const p1 = marsXYToLatLon(a[0], a[1]);
  const p2 = marsXYToLatLon(b[0], b[1]);
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lon - p1.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Reads text typed in the search box. Accepts:
 *   "18.4351, 77.7912"          -> latitude, longitude (degrees)
 *   "18.44N 77.45E"             -> with hemisphere letters
 *   "4373625, 1092739"          -> map metres x, y
 * Returns { ok: true, x, y, kind } or { ok: false, error }.
 */
export function parseCoordinateInput(text) {
  const re = /(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?/g;
  const found = [...text.matchAll(re)];
  if (found.length !== 2) {
    return { ok: false, error: 'Enter two numbers, e.g. "18.4351, 77.7912" or "4373625, 1092739".' };
  }

  const vals = found.map((m) => {
    let v = parseFloat(m[1]);
    const hemi = (m[2] || '').toUpperCase();
    if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
    return { v, hemi };
  });
  // Written as "lon, lat" with hemisphere letters? Swap into lat, lon order.
  if ((vals[0].hemi === 'E' || vals[0].hemi === 'W') && (vals[1].hemi === 'N' || vals[1].hemi === 'S')) {
    vals.reverse();
  }

  const a = vals[0].v;
  const b = vals[1].v;
  let x, y, kind;

  if (Math.abs(a) > 1000 && Math.abs(b) > 1000) {
    x = a;
    y = b;
    kind = 'map metres';
  } else if (Math.abs(a) <= 90 && Math.abs(b) <= 360) {
    ({ x, y } = latLonToMarsXY(a, b));
    kind = 'latitude, longitude';
  } else {
    return { ok: false, error: 'Could not tell if that is lat/lon (degrees) or x/y (metres).' };
  }

  if (!containsCoordinate(DEM_EXTENT, [x, y])) {
    return { ok: false, error: 'That location is outside the Jezero study area covered by our data.' };
  }
  return { ok: true, x, y, kind };
}

/* ---------- Overlay layers (search marker + measurement) ---------- */
let searchSource = null;
let measureSource = null;
let markerTimer = null;
let measurePoints = [];
let measureActive = false;
let measureCallback = null;

const searchMarkerStyle = [
  new Style({
    image: new CircleStyle({
      radius: 13,
      fill: new Fill({ color: 'rgba(56, 189, 248, 0.22)' }),
      stroke: new Stroke({ color: 'rgba(56, 189, 248, 0.9)', width: 1.5 }),
    }),
  }),
  new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: '#38bdf8' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  }),
];

function measureStyle(feature) {
  if (feature.getGeometry().getType() === 'LineString') {
    return [
      new Style({ stroke: new Stroke({ color: 'rgba(7, 10, 18, 0.85)', width: 6 }) }),
      new Style({ stroke: new Stroke({ color: '#38bdf8', width: 3, lineDash: [8, 6] }) }),
    ];
  }
  return new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#0284c7', width: 2.5 }),
    }),
  });
}

/**
 * Call once, after initMap().
 * onMeasureChange({ active, count, totalM, lastM }) fires whenever the measurement changes.
 */
export function initOverlays({ onMeasureChange }) {
  measureCallback = onMeasureChange;
  searchSource = new VectorSource();
  measureSource = new VectorSource();

  map.addLayer(new VectorLayer({ source: measureSource, style: measureStyle, zIndex: 20 }));
  map.addLayer(new VectorLayer({ source: searchSource, style: searchMarkerStyle, zIndex: 30 }));

  // Each click adds a vertex while the measure tool is active
  map.on('click', (evt) => {
    if (!measureActive) return;
    measurePoints.push(evt.coordinate);
    redrawMeasure();
  });
}

/* ---------- Search marker ---------- */
export function showSearchMarker(x, y) {
  if (!searchSource) return;
  searchSource.clear();
  searchSource.addFeature(new Feature(new Point([x, y])));
  clearTimeout(markerTimer);
  markerTimer = setTimeout(() => searchSource.clear(), 10000); // temporary: 10 s
}

export function flyToXY(x, y) {
  const view = map.getView();
  view.animate({
    center: [x, y],
    resolution: Math.min(view.getResolution(), 10), // zoom in to ~10 m/px, never zoom out
    duration: 800,
  });
}

/* ---------- Measure tool ---------- */
function redrawMeasure() {
  measureSource.clear();

  let totalM = 0;
  let lastM = 0;
  for (let i = 1; i < measurePoints.length; i++) {
    lastM = sphereDistanceM(measurePoints[i - 1], measurePoints[i]);
    totalM += lastM;
  }

  if (measurePoints.length >= 2) {
    measureSource.addFeature(new Feature(new LineString(measurePoints)));
  }
  measurePoints.forEach((p) => measureSource.addFeature(new Feature(new Point(p))));

  if (measureCallback) {
    measureCallback({ active: measureActive, count: measurePoints.length, totalM, lastM });
  }
}

export function isMeasureActive() {
  return measureActive;
}

/** Turning the tool off keeps the drawn path visible; clearMeasurement() erases it. */
export function setMeasureActive(active) {
  measureActive = active;
  // Double-click-to-zoom would fight with rapid vertex clicks, so pause it
  map.getInteractions().forEach((i) => {
    if (i instanceof DoubleClickZoom) i.setActive(!active);
  });
  map.getTargetElement().style.cursor = active ? 'crosshair' : '';
  if (translateInteraction) translateInteraction.setActive(!active); // no marker dragging while measuring
  redrawMeasure();
}

export function undoLastMeasurePoint() {
  if (measurePoints.length === 0) return;
  measurePoints.pop();
  redrawMeasure();
}

export function clearMeasurement() {
  measurePoints = [];
  setMeasureActive(false);
}

/* ==========================================================================
   Start (A) / destination (B) markers
   ========================================================================== */

let pointSource = null;
let pointLayer = null;
let translateInteraction = null;
const pointFeatures = { start: null, dest: null };

const POINT_STYLE = {
  start: { solid: '#38bdf8', halo: 'rgba(56, 189, 248, 0.25)', letter: 'A' },
  dest: { solid: '#f97316', halo: 'rgba(249, 115, 22, 0.25)', letter: 'B' },
};

function pointStyle(feature) {
  const s = POINT_STYLE[feature.get('which')];
  return [
    new Style({ image: new CircleStyle({ radius: 16, fill: new Fill({ color: s.halo }) }) }),
    new Style({
      image: new CircleStyle({
        radius: 10,
        fill: new Fill({ color: s.solid }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      text: new Text({
        text: s.letter,
        font: '700 11px "JetBrains Mono", monospace',
        fill: new Fill({ color: '#090a0f' }),
      }),
    }),
  ];
}

/**
 * Call once, after initMap().
 * onMapClick(coordinate)           -> a plain click on the map (not on a marker)
 * onPointDragEnd(which, coordinate)-> a marker was dropped; which = 'start' | 'dest'
 */
export function initPoints({ onMapClick, onPointDragEnd }) {
  pointSource = new VectorSource();
  pointLayer = new VectorLayer({ source: pointSource, style: pointStyle, zIndex: 40 });
  map.addLayer(pointLayer);

  const onMarker = (pixel) =>
    map.hasFeatureAtPixel(pixel, { layerFilter: (layer) => layer === pointLayer });

  // Marker dragging
  translateInteraction = new Translate({ layers: [pointLayer] });
  translateInteraction.on('translateend', (evt) => {
    const f = evt.features.item(0);
    onPointDragEnd(f.get('which'), f.getGeometry().getCoordinates());
  });
  map.addInteraction(translateInteraction);

  // 'singleclick' ignores double-clicks, so double-click-to-zoom doesn't place points
  map.on('singleclick', (evt) => {
    if (measureActive) return; // measuring takes over map clicks
    if (onMarker(evt.pixel)) return; // clicking a marker must not place a new point
    onMapClick(evt.coordinate);
  });

  // Show a grab cursor over markers
  map.on('pointermove', (evt) => {
    if (evt.dragging || measureActive) return;
    map.getTargetElement().style.cursor = onMarker(evt.pixel) ? 'grab' : '';
  });
}

/** Creates the marker, or moves it if it already exists. which = 'start' | 'dest' */
export function setPointMarker(which, x, y) {
  let f = pointFeatures[which];
  if (!f) {
    f = new Feature(new Point([x, y]));
    f.set('which', which);
    pointFeatures[which] = f;
    pointSource.addFeature(f);
  } else {
    f.getGeometry().setCoordinates([x, y]);
  }
}

export function removePointMarker(which) {
  const f = pointFeatures[which];
  if (f) {
    pointSource.removeFeature(f);
    pointFeatures[which] = null;
  }
}