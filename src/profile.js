/* ==========================================================================
   profile.js — one overlaid elevation profile (SVG), both routes.
   x = distance along the surface, y = DEM elevation of the path cells.
   Lines are thinned to about 400 points for display only; statistics use
   every cell.
   ========================================================================== */

const W = 340;
const H = 150;
const M = { l: 42, r: 10, t: 12, b: 34 };
const AMBER = '#f59e0b';
const BLUE = '#38bdf8';
const FONT = `font-family="JetBrains Mono, monospace" font-size="7.5" fill="#94a3b8"`;

function distLabel(d) {
  return d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : `${Math.round(d)} m`;
}

export function clearProfile(svg, emptyEl) {
  svg.innerHTML = '';
  emptyEl.style.display = 'flex';
}

export function renderProfile(svg, emptyEl, sStats, tStats) {
  const maxD = Math.max(sStats.surfaceM, tStats.surfaceM);
  let eMin = Infinity;
  let eMax = -Infinity;
  [sStats, tStats].forEach((st) => {
    for (let i = 0; i < st.elev.length; i++) {
      if (st.elev[i] < eMin) eMin = st.elev[i];
      if (st.elev[i] > eMax) eMax = st.elev[i];
    }
  });
  const pad = Math.max(5, (eMax - eMin) * 0.06);
  eMin -= pad;
  eMax += pad;

  const xOf = (d) => M.l + (d / maxD) * (W - M.l - M.r);
  const yOf = (e) => M.t + (1 - (e - eMin) / (eMax - eMin)) * (H - M.t - M.b);

  const line = (st, colour, width) => {
    const n = st.distAlong.length;
    const step = Math.max(1, Math.ceil(n / 400));
    const pts = [];
    for (let i = 0; i < n; i += step) pts.push(`${xOf(st.distAlong[i]).toFixed(1)},${yOf(st.elev[i]).toFixed(1)}`);
    if ((n - 1) % step !== 0) pts.push(`${xOf(st.distAlong[n - 1]).toFixed(1)},${yOf(st.elev[n - 1]).toFixed(1)}`);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
  };

  let out = '';
  [eMin, (eMin + eMax) / 2, eMax].forEach((e) => {
    const y = yOf(e);
    out += `<line x1="${M.l}" x2="${W - M.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-width="0.6"/>`;
    out += `<text x="${M.l - 4}" y="${(y + 2.5).toFixed(1)}" text-anchor="end" ${FONT}>${Math.round(e)} m</text>`;
  });
  const yBase = H - M.b;
  out += `<line x1="${M.l}" x2="${W - M.r}" y1="${yBase}" y2="${yBase}" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>`;
  [[0, 'start'], [maxD / 2, 'middle'], [maxD, 'end']].forEach(([d, anchor]) => {
    out += `<text x="${xOf(d).toFixed(1)}" y="${yBase + 11}" text-anchor="${anchor}" ${FONT}>${distLabel(d)}</text>`;
  });

  out += line(sStats, AMBER, 2.4);
  out += line(tStats, BLUE, 1.6);

  const ly = H - 6;
  out += `<line x1="${M.l}" x2="${M.l + 16}" y1="${ly - 2.5}" y2="${ly - 2.5}" stroke="${AMBER}" stroke-width="2.4"/>`;
  out += `<text x="${M.l + 20}" y="${ly}" ${FONT}>Shortest</text>`;
  out += `<line x1="${M.l + 78}" x2="${M.l + 94}" y1="${ly - 2.5}" y2="${ly - 2.5}" stroke="${BLUE}" stroke-width="1.6"/>`;
  out += `<text x="${M.l + 98}" y="${ly}" ${FONT}>Terrain-aware</text>`;

  svg.innerHTML = out;
  emptyEl.style.display = 'none';
}