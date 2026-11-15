import * as GeoTIFF from 'geotiff';

/* ==========================================================================
   terrain.js — real DEM + slope rasters, held in memory on the 20 m grid
   Data: CTX DEM (metres) and slope in degrees derived from it (QGIS/GDAL, Horn).
   Rules: NoData is kept as NoData (never 0), nothing is resampled, and the
   two rasters are verified to share one identical grid before use.
   ========================================================================== */

const DEM_URL = '/data/jezero_dem_20m_cog.tif';
const SLOPE_URL = '/data/jezero_slope_deg_cog.tif';

// Expected grid, from gdalinfo. The loader checks the files against these.
const EXPECTED = { width: 4456, height: 5067, originX: 4328999.999999998, originY: 1143420.000000003, cell: 20 };

let terrain = null; // filled by loadTerrain()
let loadPromise = null;

/* ---------- Loading ---------- */

async function readRaster(url) {
  const tiff = await GeoTIFF.fromUrl(url);
  const image = await tiff.getImage();

  const info = {
    url,
    width: image.getWidth(),
    height: image.getHeight(),
    originX: image.getOrigin()[0],
    originY: image.getOrigin()[1],
    resX: image.getResolution()[0],
    resY: image.getResolution()[1],
    noData: image.getGDALNoData(),
  };

  const options = { samples: [0], interleave: false };
  let rasters;
  try {
    // Decode on web workers so the map does not freeze while loading
    options.pool = GeoTIFF.Pool ? new GeoTIFF.Pool() : undefined;
    rasters = await image.readRasters(options);
  } catch (err) {
    console.warn('[terrain] worker decode failed, retrying on main thread', err);
    delete options.pool;
    rasters = await image.readRasters(options);
  }

  info.data = rasters[0]; // Float32Array, one value per cell, row by row from the top-left
  return info;
}

function checkGrid(r) {
  const close = (a, b) => Math.abs(a - b) < 1e-3;
  const ok =
    r.width === EXPECTED.width &&
    r.height === EXPECTED.height &&
    close(r.originX, EXPECTED.originX) &&
    close(r.originY, EXPECTED.originY) &&
    close(r.resX, EXPECTED.cell) &&
    close(Math.abs(r.resY), EXPECTED.cell);
  if (!ok) {
    throw new Error(`Raster grid mismatch in ${r.url}. Refusing to mix grids.`);
  }
  if (r.noData === null || r.noData === undefined) {
    throw new Error(`No NoData value found in ${r.url}.`);
  }
  if (r.data.length !== EXPECTED.width * EXPECTED.height) {
    throw new Error(`Unexpected array size in ${r.url}.`);
  }
}

function countNoData(data, noData) {
  const nd = Math.fround(noData); // values are Float32, so compare at Float32 precision
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== v || v === nd) n++; // v !== v catches NaN
  }
  return n;
}

export function loadTerrain() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const t0 = performance.now();
      const [dem, slope] = await Promise.all([readRaster(DEM_URL), readRaster(SLOPE_URL)]);
      checkGrid(dem);
      checkGrid(slope);

      const demNoDataCount = countNoData(dem.data, dem.noData);
      const slopeNoDataCount = countNoData(slope.data, slope.noData);

      terrain = {
        width: EXPECTED.width,
        height: EXPECTED.height,
        originX: dem.originX,
        originY: dem.originY,
        cell: EXPECTED.cell,
        dem: dem.data,
        slope: slope.data,
        demNoData: Math.fround(dem.noData),
        slopeNoData: Math.fround(slope.noData),
      };

      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(
        `[terrain] loaded in ${seconds}s · grid ${terrain.width}x${terrain.height} @ ${terrain.cell} m\n` +
          `  DEM   NoData cells: ${demNoDataCount.toLocaleString()}\n` +
          `  Slope NoData cells: ${slopeNoDataCount.toLocaleString()}  (QGIS unique-values report: 33,013)`
      );
      return { seconds, demNoDataCount, slopeNoDataCount };
    })();
    // If loading fails, allow a retry later
    loadPromise.catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

export function isTerrainReady() {
  return terrain !== null;
}

/** Raw access for the router (Stage 5). Do not modify these arrays. */
export function getTerrainGrid() {
  return terrain;
}

/* ---------- Coordinate <-> pixel ---------- */

/** Map metres (x, y) -> { col, row } of the DEM cell containing the point, or null if outside. */
export function pixelOf(x, y) {
  if (!terrain) return null;
  const col = Math.floor((x - terrain.originX) / terrain.cell);
  const row = Math.floor((terrain.originY - y) / terrain.cell);
  if (col < 0 || row < 0 || col >= terrain.width || row >= terrain.height) return null;
  return { col, row };
}

/** Map metres of the CENTRE of a cell. */
export function cellCenter(col, row) {
  return {
    x: terrain.originX + (col + 0.5) * terrain.cell,
    y: terrain.originY - (row + 0.5) * terrain.cell,
  };
}

/* ---------- Sampling ---------- */

/** Values of one cell. elevation / slope are null when the cell is NoData. */
export function getCell(col, row) {
  if (!terrain) return { status: 'loading' };
  if (col < 0 || row < 0 || col >= terrain.width || row >= terrain.height) {
    return { status: 'outside' };
  }
  const i = row * terrain.width + col;
  const e = terrain.dem[i];
  const s = terrain.slope[i];
  const elevValid = e === e && e !== terrain.demNoData;
  const slopeValid = s === s && s !== terrain.slopeNoData;
  return {
    status: 'ok',
    col,
    row,
    elevation: elevValid ? e : null,
    slope: slopeValid ? s : null,
  };
}

/**
 * Nearest-cell sample at map metres (x, y): the value of the 20 m cell that
 * contains the point. No interpolation, which matches QGIS "Identify".
 * status: 'loading' | 'outside' | 'ok'
 */
export function sampleAt(x, y) {
  if (!terrain) return { status: 'loading' };
  const p = pixelOf(x, y);
  if (!p) return { status: 'outside' };
  return getCell(p.col, p.row);
}