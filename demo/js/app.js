/* =========================================================
   juxtacrop · Application (UI, map, data flow)
   Map-first layout: field area + ranked crops (left), farmer
   input + weather what-if sliders (right), rotation bar with
   simulation, season popover and plan modal (bottom), time slider.
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TODAY = new Date();

/* Plain-language goals shown to the farmer (map to engine priorities) */
const GOALS = {
  soil: { icon: '🪱', label: 'Healthier soil', short: 'Soil health' },
  erosion: { icon: '⛰️', label: 'Stop soil washing away', short: 'Erosion' },
  water: { icon: '💧', label: 'Save water', short: 'Save water' },
  nitrogen: { icon: '🌱', label: 'Use less fertilizer', short: 'Less fertilizer' },
  pests: { icon: '🐛', label: 'Fewer pests & diseases', short: 'Fewer pests' },
  income: { icon: '💵', label: 'Extra income or forage', short: 'Income' },
};
const S = {
  lat: null, lon: null, place: '',
  field: null, fieldLayer: null,
  parcels: [], selectedId: null, nextId: 1, drawMode: null,
  goals: new Set(['soil', 'erosion']), want: new Set(),
  farm: { irrigation: 'none', equipment: 'standard', livestock: false },
  wx: { rain: Array(12).fill(1), dT: Array(12).fill(0) }, wxPeriod: null, wxDragging: false, cond0: null,
  raw: {}, status: {}, cond: null, loadToken: 0,
  terrain: null,
  custom: {}, heroKey: null, plan: null, sel: null,
  simMonth: null, playing: false, simTimer: null, simSeen: false,
  historyFor: null,
};
const weights = () => Object.fromEntries(Object.keys(GOALS).map(k => [k, S.goals.size ? (S.goals.has(k) ? 3 : 0.5) : 1]));

/* ================= MAP ================= */
// One world only: tiles never repeat sideways, panning stops at the edges of the world, and the
// minimum zoom keeps the world at least as wide as the screen (no copies, no grey margins).
const WORLD = L.latLngBounds([[-85.05, -180], [85.05, 180]]);
L.TileLayer.mergeOptions({ noWrap: true, bounds: WORLD });
const map = L.map('map', { zoomControl: false, maxBounds: WORLD, maxBoundsViscosity: 1, worldCopyJump: false });
const fitMinZoom = () => {
  const { x, y } = map.getSize();
  map.setMinZoom(Math.max(2, Math.ceil(Math.log2(Math.max(x, y * 0.6) / 256))));
};
fitMinZoom();
map.setView([20, -40], Math.max(3, map.getMinZoom()));
window.addEventListener('resize', fitMinZoom);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.8 }).addTo(map);
const OVERLAYS = {};
const LEGENDS = {
  smap: { title: 'Soil moisture in the root zone (NASA SMAP)', img: 'https://gibs.earthdata.nasa.gov/legends/SMAP_Analyzed_Soil_Moisture_H.svg' },
  imerg: { title: 'Rain falling now (NASA GPM IMERG)', img: 'https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg' },
  ndvi: { title: 'Plant greenness (NASA MODIS NDVI)', img: 'https://gibs.earthdata.nasa.gov/legends/MODIS_L3_NDVI_H.svg' },
  slope: { title: 'Slope of your field (Copernicus DEM)', html: '<div class="slope-legend"><span style="--c:#4F8A3C">flat</span><span style="--c:#C7C23B">gentle</span><span style="--c:#E08A2B">moderate</span><span style="--c:#B5523B">steep</span><span>💧 low spot</span></div>' },
};
const gibsUrl = (layer, date, set, ext = 'png') => `${Sources.GIBS}/${layer}/default/${date}/${set}/{z}/{y}/{x}.${ext}`;
const pad = n => String(n).padStart(2, '0');
const isoMonthsAgo = (n, day = 15) => { const d = new Date(); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`; };

function overlayFor(key) {
  const last = arr => (arr && arr.length ? arr[arr.length - 1] : null);
  if (key === 'smap') { const s = last(S.raw.smap); const date = s ? `${s.y}-${pad(s.m)}-15` : isoMonthsAgo(3);
    return L.tileLayer(gibsUrl('SMAP_L4_Analyzed_Root_Zone_Soil_Moisture', date, 'GoogleMapsCompatible_Level6'), { maxNativeZoom: 6, maxZoom: 19, opacity: 0.6, attribution: `NASA SMAP L4 via GIBS (${date})` }); }
  if (key === 'imerg') { const date = isoMonthsAgo(0, 1);
    return L.tileLayer(gibsUrl('IMERG_Precipitation_Rate', date, 'GoogleMapsCompatible_Level6'), { maxNativeZoom: 6, maxZoom: 19, opacity: 0.65, attribution: `NASA GPM IMERG via GIBS (${date})` }); }
  if (key === 'ndvi') { const s = last(S.raw.ndvi); const date = s ? `${s.y}-${pad(s.m)}-01` : isoMonthsAgo(3, 1);
    return L.tileLayer(gibsUrl('MODIS_Terra_L3_NDVI_Monthly', date, 'GoogleMapsCompatible_Level7'), { maxNativeZoom: 7, maxZoom: 19, opacity: 0.6, attribution: `NASA MODIS NDVI via GIBS (${date})` }); }
  if (key === 'slope') return slopeLayer();
  return null;
}
function setOverlay(key, on) {
  if (OVERLAYS[key]) { map.removeLayer(OVERLAYS[key]); OVERLAYS[key] = null; }
  if (on) {
    if (key === 'slope' && !S.terrain) { toast(S.field ? 'Slope data is still loading (or unavailable).' : 'Outline your field first to see its slope.'); $(`[data-ov="slope"]`).checked = false; return; }
    OVERLAYS[key] = overlayFor(key);
    if (OVERLAYS[key]) OVERLAYS[key].addTo(map);
  }
  renderLegend();
}
function renderLegend() {
  const on = Object.keys(OVERLAYS).filter(k => OVERLAYS[k]);
  $('#legend').innerHTML = on.map(k => `<div class="lg"><b>${LEGENDS[k].title}</b>${LEGENDS[k].img ? `<img src="${LEGENDS[k].img}" alt="" />` : LEGENDS[k].html}</div>`).join('');
}

/* ================= DRAWING TOOL =================
   Click to add corners. Finish by clicking the first point, double-clicking,
   pressing Enter or the Finish button. Backspace undoes, Esc cancels. */
const Draw = { pts: [], shape: null, guide: null, vertices: null };

function startDraw(mode) {
  if (!S.lat) return toast('Choose your field location first.');
  if (mode === 'parcel' && !S.field) return toast('Outline the field boundary first.');
  if (S.drawMode === mode) return cancelDraw();
  cancelDraw(true);
  S.drawMode = mode;
  Draw.pts = [];
  const color = mode === 'field' ? '#F7F8F4' : '#C5E68F';
  Draw.shape = L.polygon([], { color, weight: 3, dashArray: mode === 'field' ? '8 6' : null, fillColor: color, fillOpacity: 0.15, interactive: false }).addTo(map);
  Draw.guide = L.polyline([], { color, weight: 2, dashArray: '4 6', opacity: 0.9, interactive: false }).addTo(map);
  Draw.vertices = L.layerGroup().addTo(map);
  map.doubleClickZoom.disable();
  map.getContainer().classList.add('drawing');
  map.on('click', onDrawClick).on('mousemove', onDrawMove).on('dblclick', onDrawDblClick);
  setToolActive(mode === 'field' ? 'drawFieldBtn' : 'drawParcelBtn');
  hint(mode === 'field'
    ? '<b>Outline your field:</b> click each corner, in any order. Close it by clicking the first point, double-clicking, or pressing <b>Finish</b>.'
    : '<b>Draw a plot</b>: click its corners, in any order. Close it by clicking the first point, double-clicking, or pressing <b>Finish</b>.');
  renderDrawBar();
}
/* Corners may be clicked in any order. Draw.pts keeps the click order; the outline shown and saved is
   that order when it closes without crossing, otherwise the same corners re-threaded so no edges
   cross (each corner inserted where it adds the shortest detour). So a concave shape clicked in order
   stays as drawn, and corners clicked "out of order" never produce a bow-tie. Computed in pixels. */
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function isSimpleRing(px) {
  const n = px.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
    if (segmentsCross(px[i], px[(i + 1) % n], px[j], px[(j + 1) % n])) return false;
  }
  return true;
}
/** The corners as a non-crossing outline: click order if it closes cleanly, else re-threaded. The first corner stays first. */
function outline(pts = Draw.pts) {
  if (pts.length < 4) return pts.slice();
  const px = new Map(pts.map(p => [p, map.latLngToContainerPoint(p)]));
  const toPx = ring => ring.map(p => px.get(p));
  if (isSimpleRing(toPx(pts))) return pts.slice();
  const ring = pts.slice(0, 3);
  for (const p of pts.slice(3)) {
    const c = px.get(p), n = ring.length;
    let best = null;
    for (let i = 0; i < n; i++) {
      const cand = [...ring.slice(0, i + 1), p, ...ring.slice(i + 1)];
      if (!isSimpleRing(toPx(cand))) continue;
      const a = px.get(ring[i]), b = px.get(ring[(i + 1) % n]);
      const cost = a.distanceTo(c) + c.distanceTo(b) - a.distanceTo(b);
      if (!best || cost < best.cost) best = { k: i + 1, cost };
    }
    ring.splice(best ? best.k : n, 0, p);
  }
  return ring;
}
function onDrawClick(e) {
  const pts = Draw.pts;
  const px = map.latLngToContainerPoint(e.latlng);
  if (pts.length >= 3 && px.distanceTo(map.latLngToContainerPoint(pts[0])) < 14) return finishDraw();
  if (pts.some(p => px.distanceTo(map.latLngToContainerPoint(p)) < 6)) return;
  pts.push(e.latlng);
  redrawDraft(e.latlng);
}
function onDrawMove(e) { if (Draw.pts.length) updateGuide(e.latlng); }
function onDrawDblClick(e) { L.DomEvent.stop(e); finishDraw(); }
function updateGuide(cursor) {
  const pts = Draw.pts, n = pts.length;
  if (!n || !cursor) { Draw.guide.setLatLngs([]); return; }
  if (n === 1) { Draw.guide.setLatLngs([pts[0], cursor]); return; }
  // Preview where the corner would land in the outline: from its neighbour before, through the cursor, to the one after.
  const ring = outline([...pts, cursor]), k = ring.indexOf(cursor);
  Draw.guide.setLatLngs([ring[(k - 1 + ring.length) % ring.length], cursor, ring[(k + 1) % ring.length]]);
}
function redrawDraft(cursor) {
  const pts = Draw.pts;
  Draw.shape.setLatLngs(outline());
  Draw.vertices.clearLayers();
  pts.forEach((p, i) => L.circleMarker(p, { radius: i === 0 ? 7 : 4, color: '#fff', weight: 2, interactive: false,
    fillColor: i === 0 && pts.length >= 3 ? '#7BA568' : '#2E4A2B', fillOpacity: 1 }).addTo(Draw.vertices));
  updateGuide(cursor);
  renderDrawBar();
}
function undoDraw() { if (Draw.pts.length) { Draw.pts.pop(); redrawDraft(null); } }
function finishDraw() {
  if (!S.drawMode) return;
  if (Draw.pts.length < 3) return toast('Add at least 3 points to close the shape.');
  const ring = outline().map(p => [p.lng, p.lat]); ring.push(ring[0]);
  const gj = turf.polygon([ring]);
  if (turf.kinks(gj).features.length) return toast('The edges cross each other. Undo a point and try again.');
  const mode = S.drawMode;
  cancelDraw(true);
  if (mode === 'field') setField(gj);
  else {
    const p = addParcel(gj);
    if (!p) return toast('The plot must be inside the field.');
    const changed = carveOverlaps(p);
    selectParcel(p.id); assignTerrain();
    if (changed) toast(`${esc(p.name)} drawn · ${changed} overlapping plot${changed === 1 ? '' : 's'} trimmed to make room.`);
  }
}
/** A new plot takes its area out of any plot it overlaps, so plots never stack. Returns how many changed. */
function carveOverlaps(p) {
  let changed = 0;
  S.parcels.filter(q => q !== p).forEach(q => {
    let overlap = null;
    try { overlap = turf.intersect(q.geo, p.geo); } catch (e) { overlap = null; }
    if (!overlap || turf.area(overlap) < 1) return;
    let rest = null;
    try { rest = turf.difference(q.geo, p.geo); } catch (e) { rest = null; }
    changed++;
    if (!rest || turf.area(rest) < 200) { deleteParcel(q.id, true); return; }
    setParcelGeo(q, rest);
  });
  return changed;
}
function plotCenter(feat) {
  // A plot split in pieces (e.g. across a road) is labelled on its largest piece.
  if (feat.geometry.type === 'MultiPolygon') feat = feat.geometry.coordinates.map(c => turf.polygon(c)).sort((a, b) => turf.area(b) - turf.area(a))[0];
  const mid = turf.centroid(feat);
  return (turf.booleanPointInPolygon(mid, feat) ? mid : turf.pointOnFeature(feat)).geometry.coordinates;
}
function setParcelGeo(q, feat) {
  q.geo = feat; q.areaHa = turf.area(feat) / 10000; q.center = plotCenter(feat); q.terrain = null;
  q.layer.clearLayers(); q.layer.addData(feat);
  q.label.setLatLng([q.center[1], q.center[0]]);
  delete S.custom[q.id];
  refreshParcel(q);
}
function cancelDraw(silent = false) {
  if (!S.drawMode) return;
  [Draw.shape, Draw.guide, Draw.vertices].forEach(l => l && map.removeLayer(l));
  Draw.pts = []; Draw.shape = Draw.guide = Draw.vertices = null;
  map.off('click', onDrawClick).off('mousemove', onDrawMove).off('dblclick', onDrawDblClick);
  map.doubleClickZoom.enable();
  map.getContainer().classList.remove('drawing');
  S.drawMode = null;
  setToolActive(null);
  renderDrawBar();
  if (!silent) updateUI();
}
function renderDrawBar() {
  const el = $('#drawBar');
  if (!S.drawMode) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const n = Draw.pts.length;
  el.innerHTML = `
    <span class="db-title"><i></i>Drawing ${S.drawMode === 'field' ? 'field boundary' : 'plot'} · ${n} point${n === 1 ? '' : 's'}</span>
    <button class="btn ghost sm" id="dbUndo" ${n ? '' : 'disabled'} title="Backspace">↶ Undo</button>
    <button class="btn ghost sm" id="dbCancel" title="Esc">✕ Cancel</button>
    <button class="btn primary sm" id="dbFinish" ${n >= 3 ? '' : 'disabled'} title="Enter">✓ Finish</button>`;
  el.classList.add('show');
  $('#dbUndo').onclick = undoDraw;
  $('#dbCancel').onclick = () => cancelDraw();
  $('#dbFinish').onclick = finishDraw;
}
function setToolActive(id) { $$('#mapTools .tool').forEach(b => b.classList.toggle('active', b.id === id)); }

/* ================= FIELD & PLOTS ================= */
/** Map padding that keeps the field in the free space between the side columns and the rotation bar. */
function fieldPadding() {
  const r = map.getContainer().getBoundingClientRect();
  // The panels are position:fixed, so offsetParent is always null: check the rendered box instead.
  const side = sel => { const el = $(sel); const b = el?.getBoundingClientRect(); return b && b.width > 0 && getComputedStyle(el).display !== 'none' ? b : null; };
  const L = side('.col.left'), R = side('.col.right'), B = side('#rotBar');
  if (r.width < 900 || !L || !R) return { padding: [40, 40] };
  return { paddingTopLeft: [L.right - r.left + 30, 70], paddingBottomRight: [r.right - R.left + 30, B ? r.bottom - B.top + 30 : 60] };
}
function setField(gj) {
  clearAll(false);
  S.field = gj;
  S.fieldLayer = L.geoJSON(gj, { style: { color: '#F7F8F4', weight: 3, dashArray: '8 6', fill: true, fillOpacity: 0.04, interactive: false } }).addTo(map);
  map.fitBounds(S.fieldLayer.getBounds(), fieldPadding());
  toast(`Field outlined: ${fmt(turf.area(gj) / 10000, 1)} ha. Now split it into plots.`);
  loadTerrain();
  updateUI();
}
function addParcel(gj, opts = {}) {
  let feat = gj;
  if (S.field) {
    let inter = null;
    try { inter = turf.intersect(S.field, gj); } catch (e) { inter = null; }
    if (!inter || turf.area(inter) < 200) return null;
    feat = inter;
  }
  const id = S.nextId++;
  const center = plotCenter(feat);
  const p = {
    id, name: opts.name || `Plot ${id}`, geo: feat, areaHa: turf.area(feat) / 10000,
    history: opts.history || Array(Engine.SLOTS).fill(''), drainage: opts.drainage || 'unknown',
    terrain: null, center,
  };
  p.layer = L.geoJSON(feat, { style: () => parcelStyle(p) }).addTo(map);
  // While drawing, plots ignore the pointer (CSS on .drawing), so every click places a corner.
  p.layer.on('click', ev => { if (S.drawMode) return; L.DomEvent.stopPropagation(ev); selectParcel(p.id); });
  p.label = L.marker([center[1], center[0]], { icon: labelIcon(p), interactive: false }).addTo(map);
  S.parcels.push(p);
  return p;
}
function lastCrop(p) { for (let i = p.history.length - 1; i >= 0; i--) { const c = CROP_BY_ID[p.history[i]]; if (c && !c.isCover) return c; } return null; }
/** Crop on the plot at the simulated month (null = bare), or undefined when not simulating. */
function simCrop(p) {
  if (S.simMonth == null || typeof occFor !== 'function') return undefined;
  const occ = occFor(p); if (!occ) return undefined;
  return CROP_BY_ID[occ[S.simMonth]] || null;
}
function parcelStyle(p) {
  const sel = p.id === S.selectedId, sc = simCrop(p);
  if (sc !== undefined) return { color: sel ? '#E9F5C9' : '#FFFFFF', weight: sel ? 4 : 2, opacity: 0.95, fillColor: sc ? sc.color : '#8B6B4A', fillOpacity: sc ? 0.6 : 0.55 };
  const c = lastCrop(p);
  return { color: sel ? '#E9F5C9' : '#FFFFFF', weight: sel ? 4 : 2, opacity: 0.95, fillColor: c ? c.color : '#FFFFFF', fillOpacity: c ? 0.35 : 0.12 };
}
function labelIcon(p) {
  const sc = simCrop(p);
  const c = sc !== undefined ? (sc || { emoji: '🟫' }) : lastCrop(p);
  return L.divIcon({ className: 'parcel-label', iconSize: null,
    html: `<div class="pl ${p.id === S.selectedId ? 'sel' : ''}"><span class="pl-emoji">${c ? c.emoji : '◻️'}</span><span><b>${esc(p.name)}</b><small>${fmt(p.areaHa, 1)} ha</small></span></div>` });
}
function refreshParcel(p) { p.layer.setStyle(parcelStyle(p)); p.label.setIcon(labelIcon(p)); }

function autoSplit(n) {
  if (!S.field) return toast('Outline the field boundary first.');
  S.parcels.forEach(removeParcelLayers); S.parcels = []; S.nextId = 1; S.selectedId = null;
  const [minX, minY, maxX, maxY] = turf.bbox(S.field);
  const vertical = (maxX - minX) * Math.cos((minY + maxY) / 2 * Math.PI / 180) >= (maxY - minY);
  const pad_ = 0.001;
  for (let i = 0; i < n; i++) {
    const box = vertical
      ? [minX + (maxX - minX) * i / n, minY - pad_, minX + (maxX - minX) * (i + 1) / n, maxY + pad_]
      : [minX - pad_, minY + (maxY - minY) * i / n, maxX + pad_, minY + (maxY - minY) * (i + 1) / n];
    addParcel(turf.bboxPolygon(box));
  }
  assignTerrain();
  toast(`Field split into ${S.parcels.length} plots. Pick one and tell us what you planted.`);
  updateUI();
}
function removeParcelLayers(p) { map.removeLayer(p.layer); map.removeLayer(p.label); }
function deleteParcel(id, silent = false) {
  const p = S.parcels.find(x => x.id === id); if (!p) return;
  removeParcelLayers(p);
  S.parcels = S.parcels.filter(x => x.id !== id);
  delete S.custom[id];
  if (S.selectedId === id) S.selectedId = null;
  S.sel = null; if (!silent) updateUI();
}
function clearAll(full = true) {
  S.parcels.forEach(removeParcelLayers);
  S.parcels = []; S.selectedId = null; S.nextId = 1; S.custom = {};
  if (S.fieldLayer) map.removeLayer(S.fieldLayer);
  S.field = null; S.fieldLayer = null; S.terrain = null;
  setOverlay('slope', false); const sl = $('[data-ov="slope"]'); if (sl) sl.checked = false;
  if (S.playing) stopSim(); S.simMonth = null; S.sel = null; S.heroKey = null;
  if (full) updateUI();
}
function selectParcel(id) {
  S.selectedId = id;
  S.heroKey = null; S.sel = null;
  updateUI();
}
map.on('zoomend', () => map.getContainer().classList.toggle('z-low', map.getZoom() < 14));

/* ================= TERRAIN (elevation model) ================= */
async function loadTerrain() {
  if (!S.field) return;
  const field = S.field;
  S.status.srtm = 'loading'; renderStatus();
  const [minX, minY, maxX, maxY] = turf.bbox(field);
  const N = 10, pts = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) pts.push([minY + (maxY - minY) * (r + 0.5) / N, minX + (maxX - minX) * (c + 0.5) / N]);
  try {
    const elev = await Sources.srtmElevations(pts);
    if (S.field !== field) return;
    const dy = (maxY - minY) / N * 110540, dx = (maxX - minX) / N * 111320 * Math.cos((minY + maxY) / 2 * Math.PI / 180);
    const E = (r, c) => elev[Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))];
    const cells = pts.map((pt, i) => {
      const r = Math.floor(i / N), c = i % N;
      const gx = (E(r, c + 1) - E(r, c - 1)) / (dx * ((c > 0 && c < N - 1) ? 2 : 1));
      const gy = (E(r + 1, c) - E(r - 1, c)) / (dy * ((r > 0 && r < N - 1) ? 2 : 1));
      return { lat: pt[0], lon: pt[1], elev: elev[i], slope: Math.hypot(gx, gy) * 100, inside: turf.booleanPointInPolygon(turf.point([pt[1], pt[0]]), field) };
    });
    const inside = cells.filter(c => c.inside);
    const elevs = inside.map(c => c.elev).sort((a, b) => a - b);
    const p25 = elevs[Math.floor(elevs.length * 0.25)] ?? 0;
    inside.forEach(c => { c.low = c.elev <= p25 && c.slope < 2; });
    S.terrain = { cells, inside, dx, dy, relief: elevs.length ? elevs[elevs.length - 1] - elevs[0] : 0,
      slopeMean: Engine.avg(inside.map(c => c.slope)), slopeMax: Math.max(0, ...inside.map(c => c.slope)), elevMin: elevs[0], elevMax: elevs[elevs.length - 1] };
    S.status.srtm = 'ok';
    assignTerrain();
    if ($('[data-ov="slope"]').checked) setOverlay('slope', true);
  } catch (e) {
    S.status.srtm = 'error';
    S.terrain = null;
  }
  renderStatus(); renderData(); updateUI();
}
function assignTerrain() {
  if (!S.terrain) return;
  S.parcels.forEach(p => {
    let pts = S.terrain.inside.filter(c => turf.booleanPointInPolygon(turf.point([c.lon, c.lat]), p.geo));
    if (!pts.length) {
      const [lon, lat] = p.center;
      pts = [S.terrain.inside.slice().sort((a, b) => Math.hypot(a.lat - lat, a.lon - lon) - Math.hypot(b.lat - lat, b.lon - lon))[0]].filter(Boolean);
    }
    if (!pts.length) return;
    p.terrain = { slopeMean: Engine.avg(pts.map(c => c.slope)), slopeMax: Math.max(...pts.map(c => c.slope)), lowShare: pts.filter(c => c.low).length / pts.length, n: pts.length };
    refreshParcel(p);
  });
}
function slopeLayer() {
  const g = L.layerGroup();
  const t = S.terrain; if (!t) return g;
  const hLat = t.dy / 110540 / 2, hLon = t.dx / (111320 * Math.cos(S.lat * Math.PI / 180)) / 2;
  t.inside.forEach(c => {
    const col = c.slope < 2 ? '#4F8A3C' : c.slope < 5 ? '#C7C23B' : c.slope < 10 ? '#E08A2B' : '#B5523B';
    L.rectangle([[c.lat - hLat, c.lon - hLon], [c.lat + hLat, c.lon + hLon]], { color: col, weight: 0, fillOpacity: 0.45, interactive: true })
      .bindTooltip(`Slope ${fmt(c.slope, 1)} % · elevation ${fmt(c.elev)} m${c.low ? ' · low spot' : ''}`).addTo(g);
    if (c.low) L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'low-spot', html: '💧', iconSize: [14, 14] }), interactive: false }).addTo(g);
  });
  return g;
}
const slopeWord = s => (s == null ? null : s < 2 ? 'Flat' : s < 5 ? 'Gentle slope' : s < 10 ? 'Moderate slope' : 'Steep');

/* ================= LOCATION & DATA ================= */
async function searchPlace(q) {
  const box = $('#searchResults');
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return setLocation(+m[1], +m[2], `${(+m[1]).toFixed(3)}, ${(+m[2]).toFixed(3)}`);
  box.innerHTML = '<div class="muted xs pad">Searching…</div>';
  try {
    const data = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=en&q=${encodeURIComponent(q)}`)).json();
    if (!data.length) { box.innerHTML = '<div class="muted xs pad">No results. Try another search or enter coordinates.</div>'; return; }
    box.innerHTML = data.map((d, i) => `<button class="sr" data-i="${i}"><span>📍</span>${esc(d.display_name)}</button>`).join('');
    $$('.sr', box).forEach(b => b.onclick = () => { const d = data[+b.dataset.i]; setLocation(+d.lat, +d.lon, d.display_name.split(',').slice(0, 2).join(',')); });
  } catch (err) {
    box.innerHTML = '<div class="muted xs pad">Search failed (offline?). Enter coordinates instead: <code>42.03, -93.47</code></div>';
  }
}
function setLocation(lat, lon, name, zoom = 15) {
  const moved = S.lat === null || Math.abs(S.lat - lat) > 0.05 || Math.abs(S.lon - lon) > 0.05;
  if (S.lat !== null && moved) clearAll(false);
  S.lat = lat; S.lon = lon; S.place = name;
  $('#onboard').classList.add('hidden');
  $('#searchResults').innerHTML = '';
  map.flyTo([lat, lon], Math.min(zoom, map.getMaxZoom()), { duration: 1.2 });
  if (moved) loadData();
  updateUI();
}

const GAEZ_NAMES = [...new Set(CROPS.map(c => c.gaez).filter(Boolean))];
async function loadData() {
  const token = ++S.loadToken;
  const { lat, lon } = S;
  S.raw = {}; S.cond = null; S.cond0 = null;
  ['power', 'imerg', 'smap', 'ndvi', 'gaez'].forEach(k => { S.status[k] = 'loading'; });
  renderStatus(); renderData();
  const live = () => token === S.loadToken;
  const step = (key, promise, assign) => promise.then(v => { if (!live()) return; assign(v); S.status[key] = 'ok'; })
    .catch(() => { if (live()) S.status[key] = 'error'; })
    .finally(() => { if (live()) { recompute(); renderStatus(); } });
  const progress = key => (d, n) => { if (live()) { S.status[key] = `${d}/${n}`; renderStatus(); } };
  step('power', Sources.powerClimatology(lat, lon), v => { S.raw.clim = v; });
  step('imerg', Sources.powerDaily(lat, lon), v => { S.raw.daily = Engine.prepareDaily(v); });
  step('gaez', Sources.gaezSuitability(lat, lon, GAEZ_NAMES, progress('gaez')), v => { S.raw.gaez = v; });
  step('smap', Sources.smapSeries(lat, lon, progress('smap')), v => { S.raw.smap = v; });
  step('ndvi', Sources.ndviSeries(lat, lon, progress('ndvi')), v => { S.raw.ndvi = v; });
}
function recompute() {
  if (S.raw.clim && S.raw.daily) {
    const raw = { lat: S.lat, clim: S.raw.clim, daily: S.raw.daily, smap: S.raw.smap, ndvi: S.raw.ndvi, gaez: S.raw.gaez };
    S.cond0 = Engine.conditions(raw);
    S.cond = wxActive() ? Engine.conditions(raw, { dT: S.wx.dT, rain: S.wx.rain }) : S.cond0;
  }
  renderData();
  updateUI();
}

/* ================= DEMOS ================= */
const DEMOS = {
  iowa: {
    // Real fields: boundaries traced along the roads and field edges visible on Esri World Imagery.
    // The farm is the union of the fields. Crops and history are fictional.
    lat: 42.0145, lon: -93.5333, name: 'Sample farm · Story County, Iowa (fictional)', zoom: 16,
    plots: [
      { name: 'West field', drainage: 'good', history: ['corn', 'fallow', 'soybean', 'fallow', 'corn', 'fallow'],
        ring: [[-93.540173, 42.015791], [-93.53616, 42.015807], [-93.53616, 42.012204], [-93.539357, 42.012188], [-93.539529, 42.013065], [-93.539808, 42.01434], [-93.540173, 42.015791]] },
      { name: 'Middle field', drainage: 'limited', history: ['soybean', 'fallow', 'corn', 'fallow', 'soybean', 'fallow'],
        ring: [[-93.536053, 42.015823], [-93.53116, 42.015855], [-93.53116, 42.012188], [-93.536053, 42.012188], [-93.536053, 42.015823]] },
      { name: 'East field', drainage: 'good', history: ['corn', 'fallow', 'corn', 'rye', 'corn', 'fallow'],
        ring: [[-93.530903, 42.016907], [-93.52644, 42.016939], [-93.526397, 42.012156], [-93.530903, 42.012156], [-93.530903, 42.016907]] },
    ],
  },
  uruguay: {
    // Real paddocks: boundaries traced along the roads, creek and fences visible on Esri World Imagery.
    // The farm is the union of the paddocks. Crops and history are fictional.
    lat: -32.7495, lon: -57.7087, name: 'Sample farm · Río Negro, Uruguay (fictional)', zoom: 16,
    plots: [
      { name: 'North paddock', drainage: 'good', history: ['soybean', 'wheat', 'soybean', 'fallow', 'soybean', 'wheat'],
        ring: [[-57.714186,-32.746136],[-57.709132,-32.745991],[-57.708467,-32.746821],[-57.707984,-32.747832],[-57.707748,-32.748581],[-57.707148,-32.749348],[-57.706536,-32.750205],[-57.706053,-32.751333],[-57.705967,-32.752326],[-57.714261,-32.746298],[-57.714186,-32.746136]] },
      { name: 'West paddock', drainage: 'limited', history: ['soybean', 'fallow', 'soybean', 'fallow', 'soybean', 'fallow'],
        ring: [[-57.714497,-32.746479],[-57.714658,-32.7472],[-57.715366,-32.750025],[-57.715151,-32.750575],[-57.713435,-32.75118],[-57.71086,-32.751063],[-57.709433,-32.750684],[-57.709057,-32.750431],[-57.714497,-32.746479]] },
      { name: 'East paddock', drainage: 'good', history: ['corn', 'oats', 'soybean', 'wheat', 'sunflower', 'fallow'],
        ring: [[-57.707577,-32.746172],[-57.707169,-32.745937],[-57.705678,-32.745847],[-57.704283,-32.746145],[-57.702566,-32.74684],[-57.702105,-32.748085],[-57.702105,-32.750386],[-57.702427,-32.751378],[-57.703103,-32.75293],[-57.704873,-32.753192],[-57.705356,-32.75219],[-57.705731,-32.751423],[-57.706214,-32.750521],[-57.707019,-32.749303],[-57.707641,-32.748536],[-57.707684,-32.747092],[-57.707577,-32.746172]] },
    ],
  },
};
function loadDemo(key) {
  const D = DEMOS[key];
  setLocation(D.lat, D.lon, D.name, D.zoom || 15);
  const { lat, lon, d, e } = D;
  const field = D.plots[0].ring ? D.plots.slice(1).reduce((u, pl) => turf.union(u, turf.polygon([pl.ring])), turf.polygon([D.plots[0].ring])) : turf.polygon([[[lon - e, lat + d], [lon + e * 0.95, lat + d * 1.03], [lon + e, lat - d * 0.95], [lon - e * 1.02, lat - d], [lon - e, lat + d]]]);
  S.demoLoading = true; // the field and plots arrive after the fly-to animation
  setTimeout(() => {
    S.demoLoading = false;
    setField(field);
    if (D.plots[0].ring) { D.plots.forEach(pl => addParcel(turf.polygon([pl.ring]))); assignTerrain(); }
    else autoSplit(D.plots.length);
    S.parcels.forEach((p, i) => { Object.assign(p, { name: D.plots[i].name, drainage: D.plots[i].drainage, history: D.plots[i].history.slice() }); refreshParcel(p); });
    selectParcel(S.parcels[0].id);
    $('#paneField').classList.add('min'); $('#paneField .pane-min').textContent = '+';
    toast('Sample farm loaded.');
  }, 1300);
}

/* ================= SEASONS ================= */
/** Season labels: the last 3 years (past) or the next 3 years (future), summer/winter alternating. */
function seasons(future = false) {
  const south = (S.lat ?? -1) < 0, y = TODAY.getFullYear(), mo = TODAY.getMonth() + 1, out = [];
  const yy = v => String(v).slice(2);
  const ks = future ? [1, 2, 3] : [-2, -1, 0];
  if (south) {
    const lastW = mo >= 11 ? y : y - 1;
    ks.forEach(k => { const w = lastW + k; out.push({ long: `Summer ${yy(w - 1)}/${yy(w)}`, short: `Su ${yy(w - 1)}/${yy(w)}` }, { long: `Winter ${w}`, short: `Wi ${w}` }); });
  } else {
    const lastS = mo >= 10 ? y : y - 1;
    ks.forEach(k => { const s = lastS + k; out.push({ long: `Summer ${s}`, short: `Su ${s}` }, { long: `Winter ${yy(s)}/${yy(s + 1)}`, short: `Wi ${yy(s)}/${yy(s + 1)}` }); });
  }
  return out;
}
const seasonLabels = () => seasons().map(s => s.long);
const seasonIcon = k => (Engine.slotType(k) === 'warm' ? '☀️' : '❄️');

/* ================= HINTS ================= */
function hint(html) { const h = $('#hint'); if (!html) { h.classList.remove('show'); return; } h.innerHTML = html; h.classList.add('show'); }
function autoHint() {
  if (S.drawMode) return;
  if (!S.lat) return hint('');
  if (!S.field) return hint('① <b>⬠ Outline field</b> on the map');
  if (!S.parcels.length) return hint('② Split it into plots (<b>▦</b> or <b>✎</b>)');
  const p = targetPlot();
  if (p && p.history.every(h => !h)) return hint('③ Add what you planted (<b>Farmer input</b>)');
  if (S.plan && !S.simSeen && !S.sel) return hint('Press <b>▶</b> or tap a season below');
  hint('');
}

/* ================= SMALL HELPERS ================= */
function rotationStrip(slots, small = false) {
  const labels = seasonLabels();
  return `<div class="rot-strip ${small ? 'small' : ''}">${slots.map((id, k) => {
    const c = CROP_BY_ID[id];
    return `<span class="rs ${Engine.slotType(k)} ${c ? '' : id === 'fallow' ? 'fallow' : 'unknown'}" style="${c ? `--c:${c.color}` : ''}" title="${labels[k]}: ${c ? esc(c.name) : id === 'fallow' ? 'Nothing planted' : "Don't know"}">${c ? c.emoji : id === 'fallow' ? '' : '?'}</span>`;
  }).join('')}</div>`;
}
const seg = (q, opts, cur) => `<div class="seg" data-q="${q}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
function compareCtx(p) { return { ...S.farm, weights: weights(), drainage: p.drainage, terrain: p.terrain }; }
function targetPlot() { return S.parcels.find(x => x.id === S.selectedId) || S.parcels[0] || null; }
const cropName = id => (CROP_BY_ID[id]?.name || id).replace(/ \(.*\)/, '');
const slotName = id => (CROP_BY_ID[id] ? cropName(id) : id === 'fallow' ? 'Nothing (bare)' : "Don't know");
const cashNames = slots => [...new Set(slots.filter(id => CROP_BY_ID[id] && !CROP_BY_ID[id].isCover))].map(cropName);
const coverNames = slots => [...new Set(slots.filter(id => CROP_BY_ID[id]?.isCover))].map(cropName);
const joinNames = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const monthOf = i => (S.cond ? Engine.monthAt(S.cond, i) : (i % 12) + 1);
function slotAtMonth(i) {
  const c = S.cond; if (!c) return Math.floor(i / 6);
  const off = (c.cal.coolStart - c.cal.warmStart + 12) % 12;
  return 2 * Math.floor(i / 12) + ((i % 12) >= off ? 1 : 0);
}

/* ================= PLAN (recommendation state) ================= */
function computePlan() {
  const p = targetPlot();
  if (!p || !S.cond || p.history.every(h => !h)) return null;
  const ctx = compareCtx(p);
  const current = p.history.slice();
  const { base, options } = Engine.suggest(current, S.cond, ctx);
  const opts = options.map((o, i) => ({ ...o, rank: i + 1 }));
  const now = { key: 'current', slots: current, ind: base };
  const cs = S.custom[p.id];
  const custom = cs ? { key: 'custom', slots: cs, ind: Engine.evaluate(cs, S.cond, ctx) } : null;
  return { p, ctx, now, opts, custom };
}
function heroOf(plan) {
  const all = [plan.now, ...plan.opts, plan.custom].filter(Boolean);
  return all.find(x => x.key === S.heroKey) || plan.opts[0] || plan.now;
}

/** Plain-language title and one-liner for each strategy. */
function plainTitle(s) {
  const cash = cashNames(s.slots), covers = coverNames(s.slots);
  switch (s.key) {
    case 'current': return { title: 'Keep what you do now', text: cash.length ? `Keep growing ${joinNames(cash)} as you have been.` : 'Not entered yet' };
    case 'cover': return { title: 'Same crops + a winter cover crop', text: `Keep growing ${joinNames(cash)}, and plant ${joinNames(covers).toLowerCase() || 'a cover crop'} between harvests so the soil is never left bare.` };
    case 'diverse': return { title: 'Add a new crop to the rotation', text: `Rotate ${joinNames(cash)}. Changing crops every year breaks pest cycles and spreads your risk.` };
    case 'water': return { title: 'Crops that need less water', text: `Grow ${joinNames(cash)} — they handle dry spells better than thirstier crops.` };
    case 'forage': { const f = cash.find(n => /Alfalfa|clover/i.test(n)) || cash[0]; return { title: `Rest the field with ${f.toLowerCase()}`, text: `Two years of ${f.toLowerCase()} cover and feed the soil and add nitrogen; then ${joinNames(cash.filter(n => n !== f))} uses it.` }; }
    default: return { title: 'My plan', text: cash.length ? `Your own rotation: ${joinNames(cash)}${covers.length ? ` with ${joinNames(covers).toLowerCase()}` : ''}.` : 'Choose a crop for each season' };
  }
}

/** Up to 3 benefits and trade-offs in plain words, weighted by the farmer's goals. */
function plainBenefits(ind, base, ctx) {
  const w = ctx.weights, out = [], down = [];
  const pct = (a, b) => (b > 0 ? Math.round((1 - a / b) * 100) : 0);
  const living = Math.round(ind.living), bLiving = Math.round(base.living);
  if (living - bLiving >= 1) out.push({ i: '🛡️', t: `Soil covered <b>${living} of 12 months</b> (now ${bLiving})`, s: (w.erosion + w.soil) * (living - bLiving) / 6 });
  const less = pct(ind.rainOnBare, base.rainOnBare);
  if (less >= 15) out.push({ i: '⛰️', t: `<b>${less}% less rain</b> hitting bare soil — less erosion`, s: w.erosion * less / 50 });
  if (ind.nFix - base.nFix >= 0.3) out.push({ i: '🌱', t: '<b>Legumes add nitrogen</b> — the next crop needs less fertilizer', s: w.nitrogen * 1.2 });
  if (ind.omInputs - base.omInputs >= 0.3) out.push({ i: '🪱', t: '<b>More roots and residue</b> to build soil organic matter', s: w.soil });
  if (ind.repeats < base.repeats || ind.diversity > base.diversity) out.push({ i: '🐛', t: '<b>Breaks pest & disease cycles</b> by changing crops', s: w.pests * 1.1 });
  if (base.waterDeficit - ind.waterDeficit >= 15 || base.waterUse - ind.waterUse >= 60) out.push({ i: '💧', t: '<b>Needs less water</b> — safer in dry years', s: w.water * 1.2 });
  if (ind.harvests - base.harvests >= 0.2) out.push({ i: '💵', t: '<b>More harvests</b> to sell', s: w.income });
  if (ctx.livestock && ind.forage > base.forage) out.push({ i: '🐄', t: '<b>Forage</b> for your animals', s: w.income });
  if (ind.waterUse - base.waterUse >= 80) down.push('Uses more soil water (cover crops drink too)');
  if (base.harvests - ind.harvests >= 0.2) down.push('Fewer cash harvests in some years');
  if (ind.repeats > base.repeats) down.push('More of the same crop family in a row');
  return { good: out.sort((a, b) => b.s - a.s).slice(0, 3), trade: down };
}

/** One risk in plain words. */
function riskText(r) {
  const n = r.crop ? cropName(r.crop.id) : 'A crop';
  return { frost: `${n} may be hit by frost`, heat: `${n} may suffer in heat waves`, water: `${n} may run short of rain in a dry year`,
    waterlog: `${n} doesn't like waterlogged soil — watch the low spots`, suit: `${n} is not a great fit for this climate`,
    timing: `${n}: tight timing after the previous harvest`, equip: `${n} needs special machinery` }[r.kind] || r.text;
}
function plainRisks(s, ind) {
  const seen = new Set(), out = [];
  ind.risks.slice().sort((a, b) => (a.level === 'bad' ? -1 : 1) - (b.level === 'bad' ? -1 : 1)).forEach(r => { const t = riskText(r); if (!seen.has(t)) { seen.add(t); out.push(t); } });
  const has = id => s.slots.includes(id);
  if (has('rye') || has('vetch') || has('oats')) out.push('Stop the cover crop 2–3 weeks before planting the next crop');
  if (has('alfalfa')) out.push('Alfalfa needs well-drained soil and a hay market or animals');
  return out;
}

/* ---- detailed explanation (for "See the data behind this") ---- */
const level = (v, cuts, names) => names[cuts.findIndex(c => v < c) === -1 ? names.length - 1 : cuts.findIndex(c => v < c)];
const INDICATORS = [
  { k: 'living', label: 'Living cover', unit: 'months/yr', better: 'high', f: i => fmt(i.living, 1) },
  { k: 'rainOnBare', label: 'Rain on bare soil', unit: 'mm/yr', better: 'low', f: i => fmt(i.rainOnBare) },
  { k: 'erosion', label: 'Erosion exposure', unit: 'vs now', better: 'low', f: (i, b) => (b.erosion > 0 ? `${fmt(i.erosion / b.erosion * 100)} %` : i.erosion > 0 ? 'higher' : '0') },
  { k: 'waterUse', label: 'Crop water use', unit: 'mm/yr', better: 'low', f: i => fmt(i.waterUse) },
  { k: 'waterDeficit', label: 'Rain shortfall in crop cycles', unit: 'mm/yr', better: 'low', f: i => fmt(i.waterDeficit) },
  { k: 'nFix', label: 'Nitrogen from legumes', unit: '', better: 'high', f: i => level(i.nFix, [0.01, 0.5, 1], ['None', 'Low', 'Moderate', 'High']) },
  { k: 'omInputs', label: 'Organic-matter inputs', unit: '', better: 'high', f: i => level(i.omInputs, [1.1, 1.8], ['Low', 'Moderate', 'High']) },
  { k: 'repeats', label: 'Same-host crops in a row', unit: '/3 yrs', better: 'low', f: i => String(i.repeats) },
  { k: 'diversity', label: 'Plant families', unit: '', better: 'high', f: i => String(i.diversity) },
  { k: 'harvests', label: 'Harvests per year', unit: '', better: 'high', f: i => fmt(i.harvests, 1) },
  { k: 'suitNow', label: 'GAEZ suitability now → 2050s', unit: '/100', better: 'high', f: i => (i.suitNow == null ? 'n/a' : `${fmt(i.suitNow / 100)} → ${fmt((i.suitFuture ?? i.suitNow) / 100)}`) },
];
function cmpClass(ind, base, def) {
  const a = ind[def.k], b = base[def.k];
  if (a == null || b == null) return '';
  const tol = Math.max(Math.abs(b) * 0.05, def.k === 'repeats' || def.k === 'diversity' ? 0.5 : 0.01);
  if (Math.abs(a - b) <= tol) return '';
  return (def.better === 'high' ? a > b : a < b) ? 'better' : 'worse';
}
function evidence(s, base, c, p) {
  const ind = s.ind, ev = [], gaps = [];
  const add = (arr, text, src) => arr.push({ text, src });
  const ff = [...c.cal.frostFree];
  if (c.ndvi) { const low = c.ndvi.low.map((v, i) => (v ? i + 1 : null)).filter(Boolean); if (low.length) add(ev, `Vegetation is typically low in ${monthRange(low)} (MODIS NDVI ${c.ndvi.years}) — land often bare.`, ['modis']); }
  add(ev, `${fmt(c.rainYear)} mm of rain per year (IMERG ${c.period}); ${fmt(ind.rainOnBare)} mm/yr would fall on bare soil with this plan (now: ${fmt(base.rainOnBare)} mm).`, ['imerg']);
  if (p.terrain) add(ev, `Plot slope ${fmt(p.terrain.slopeMean, 1)} % → RUSLE slope factor ${fmt(Engine.sFactor(p.terrain.slopeMean), 2)} used for erosion exposure.`, ['srtm']);
  add(ev, `Frost-free season ${monthRange(ff)}, ${fmt(Engine.sum(c.frostDays))} frost days/yr, ${fmt(Engine.sum(c.heatDays), 1)} days ≥ 35 °C/yr → sowing calendar and frost/heat checks.`, ['power']);
  if (c.smap) { const dry = c.smap.dryFreq.map((f, i) => (f >= 0.3 ? MONTHS_SHORT[i] : null)).filter(Boolean); if (dry.length) add(ev, `Root-zone soil moisture often in its driest fifth in ${dry.join(', ')} (SMAP ${c.smap.years}).`, ['smap']); }
  [...new Set(ind.crops.map(x => x.id))].forEach(id => {
    const cr = CROP_BY_ID[id], g = cr.gaez ? c.gaez[cr.gaez] : null;
    if (g && g.now != null) add(ev, `${cr.name}: FAO GAEZ suitability ${Math.round(g.now / 100)}/100${g.future != null ? ` → ${Math.round(g.future / 100)} in 2041–2070` : ''}.`, ['gaez']);
  });
  if (p.estimated?.length) add(ev, `${p.estimated.length} past season(s) reconstructed from the Landsat / Sentinel-2 archive (simulated in this prototype) — treat them as estimates.`, ['modis']);
  if (p.history.some(h => !h)) add(gaps, `${p.history.filter(h => !h).length} season(s) of history unknown — treated as bare.`, ['farmer']);
  if (p.drainage === 'unknown') add(gaps, 'Drainage not entered — waterlogging estimated from elevation-model low spots only.', ['farmer']);
  add(gaps, 'No soil test: the comparison is about soil cover and inputs, not measured soil health.', ['farmer']);
  add(gaps, 'Rain, temperature and soil moisture describe the area (11–50 km), not this exact plot.', ['imerg', 'power', 'smap']);
  ind.crops.filter(cr => !cr.gaez).forEach(cr => add(gaps, `${cr.name} is not assessed by FAO GAEZ.`, ['gaez']));
  add(gaps, 'Markets and prices are not included.', ['farmer']);
  return { ev, gaps };
}
const srcList = src => (src || []).map(srcChip).join('');
const list = items => `<ul>${items.map(it => `<li>${esc(it.text)} ${srcList(it.src)}</li>`).join('')}</ul>`;

/* ---- 36-month calendar strip ---- */
function strip(ind, c, label) {
  const cells = [];
  for (let i = 0; i < 36; i++) {
    const m = monthOf(i), id = ind.occ[i], cr = CROP_BY_ID[id];
    const first = cr && ind.occ[(i + 35) % 36] !== id;
    cells.push(`<div class="sc ${cr ? '' : 'bare'} ${i % 12 === 0 ? 'ys' : ''}" style="${cr ? `--c:${cr.color}` : ''}" title="${MONTHS[m - 1]}: ${cr ? esc(cr.name) : 'bare soil'}">${first ? `<span>${cr.emoji}</span>` : ''}</div>`);
  }
  return `<div class="strip-row"><span class="strip-label">${label}</span><div class="strip">${cells.join('')}</div></div>`;
}

/* ================= LEFT · FIELD AREA ================= */
function renderPlotList() {
  const el = $('#plotList');
  if (!S.lat) { el.innerHTML = '<p class="muted xs">Choose a location first.</p>'; return; }
  if (!S.field) { el.innerHTML = '<p class="muted xs">Press <b>Outline field</b> and click around it on the map.</p>'; return; }
  el.innerHTML = `<div class="pl-sum"><b>${fmt(turf.area(S.field) / 10000, 1)} ha</b> · ${S.parcels.length} plot${S.parcels.length === 1 ? '' : 's'}</div>`
    + `<div class="plot-chips">${S.parcels.map(p => { const c = lastCrop(p); return `<button class="plot-chip ${p.id === S.selectedId ? 'on' : ''}" data-id="${p.id}"><span>${c ? c.emoji : '◻️'}</span>${esc(p.name)}</button>`; }).join('')}</div>`;
  $$('.plot-chip', el).forEach(b => b.onclick = () => selectParcel(+b.dataset.id));
}

/* ================= LEFT · RANKED CROPS ================= */
function prevCash(slots, k) { for (let j = 1; j < 6; j++) { const c = CROP_BY_ID[slots[(k - j + 6) % 6]]; if (c && !c.isCover) return c; } return null; }
function cropWhy(cr, k, slots, risk) {
  if (risk) return riskText(risk);
  const t = [], prev = prevCash(slots, k);
  if (cr.isCover) t.push('Covers bare soil');
  if (cr.type === 'perennial') t.push('Covers soil all year');
  if (cr.nFix >= 1) t.push('Adds nitrogen');
  if (cr.drought === 2) t.push('Handles drought');
  if (!cr.isCover && prev && prev.host !== cr.host && prev.id !== cr.id) t.push('Breaks pest cycles');
  if (prev && prev.host === cr.host && !cr.isCover) t.push(prev.id === cr.id ? 'Same crop as before' : `Same family as ${cropName(prev.id).toLowerCase()}`);
  const g = cr.gaez ? S.cond.gaez?.[cr.gaez] : null;
  if (!t.length && g && g.now >= 7000) t.push('Suits this climate');
  return t.slice(0, 2).join(' · ') || 'Fits this season';
}
function rankCrops(plan, slots, k) {
  // Each candidate is scored against the chosen rotation with this season left bare,
  // so the % says how much the crop adds here (goals-weighted) plus its FAO GAEZ climate fit.
  const { ctx } = plan, c = S.cond, type = Engine.slotType(k);
  const ref = slots.slice(); ref[k] = 'fallow';
  const refInd = Engine.evaluate(ref, c, ctx);
  const cands = CROPS.filter(cr => (type === 'warm' ? cr.type !== 'cool' : cr.type !== 'warm'));
  return cands.map(cr => {
    if (!Engine.usable(cr, c, ctx)) return null;
    const s = slots.slice(); s[k] = cr.id;
    const ind = Engine.evaluate(s, c, ctx);
    const pl = ind.placements.find(x => x.slot === k);
    if (pl && pl.infeasible) return null;
    const f = Engine.fit(Engine.deltas(ind, refInd, ctx), ind, refInd, ctx.weights);
    const g = cr.gaez ? c.gaez?.[cr.gaez] : null;
    const suit = g && g.now != null ? g.now / 100 : 60;
    const risk = ind.risks.find(r => r.crop && r.crop.id === cr.id && r.level === 'bad');
    let score = 0.55 * Engine.clamp(45 + 110 * f, 0, 100) + 0.45 * suit + (S.want.has(cr.id) ? 6 : 0) - (risk ? 12 : 0);
    return { id: cr.id, c: cr, score: Math.round(Engine.clamp(score, 1, 99)), why: cropWhy(cr, k, slots, risk) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
}
function renderRank() {
  const el = $('#rankBody'), plan = S.plan;
  if (!plan) { el.innerHTML = '<p class="muted xs">Ranked crops appear once we know your field and its history.</p>'; return; }
  const k = S.sel?.when === 'future' ? S.sel.k : 0;
  const lab = seasons(true)[k], hero = heroOf(plan);
  const rows = rankCrops(plan, hero.slots, k);
  el.innerHTML = `<div class="rk-for">${seasonIcon(k)} <b>${lab.long}</b>${S.sel?.when === 'future' ? '' : '<span class="muted xs"> · next</span>'}</div>
    <div class="rk-list">${rows.map(r => `<div role="button" tabindex="0" aria-label="Plant ${esc(cropName(r.id))} in ${lab.long}" class="rk ${r.id === hero.slots[k] ? 'in' : ''}" data-id="${r.id}" style="--c:${r.c.color}" title="${esc(r.why)} — tap to plant it in ${lab.long}, or drag it onto a season">
      <span class="rk-e">${r.c.emoji}</span>
      <span class="rk-n">${esc(cropName(r.id))}${S.want.has(r.id) ? ' <em>★</em>' : ''}</span>
      <b>${r.id === hero.slots[k] ? '✓ ' : ''}${r.score}%</b><i style="width:${r.score}%"></i></div>`).join('') || '<p class="muted xs">No crop fits this season here.</p>'}</div>
    <p class="muted xs rk-note" title="% = how much the crop helps this season for your goals + FAO GAEZ climate fit">Tap, or drag a crop onto a season or a plot ⓘ</p>`;
  $$('.rk', el).forEach(r => {
    r.onclick = () => { if (!Drag.on) setSlot(k, r.dataset.id); };
    r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSlot(k, r.dataset.id); } };
    r.addEventListener('pointerdown', e => startCropDrag(e, r.dataset.id, k));
  });
}
function setSlot(k, id) {
  const plan = S.plan; if (!plan) return;
  const hero = heroOf(plan);
  if (hero.slots[k] === id) return;
  const slots = hero.slots.slice(); slots[k] = id;
  S.custom[plan.p.id] = slots; S.heroKey = 'custom'; S.sel = { when: 'future', k };
  updateUI();
  toast(`${cropName(id)} → ${seasons(true)[k].long} (My plan)`);
  document.dispatchEvent(new CustomEvent('demo:crop-edited'));
}

/* ================= SEASON POPOVER (field shift for one season) ================= */
function renderSeasonPop() {
  const pop = $('#seasonPop'), plan = S.plan, sel = S.sel;
  if (!plan || !sel) { pop.classList.add('hidden'); return; }
  const btn = $(`#rbCircles .rc-c[data-when="${sel.when}"][data-k="${sel.k}"]`);
  const k = sel.k, hero = heroOf(plan);
  const badge = (id, cr) => `<span class="sp-c"><i class="${cr ? '' : 'bare'}" style="${cr ? `--c:${cr.color}` : ''}">${cr ? cr.emoji : ''}</i>${esc(slotName(id))}</span>`;
  let body;
  if (sel.when === 'past') {
    const lab = seasons()[k], id = plan.p.history[k];
    body = `<div class="sp-head">${seasonIcon(k)} ${lab.long}<button class="sp-x" title="Close">✕</button></div>
      <div class="sp-row">${badge(id, CROP_BY_ID[id])}<button class="link" id="spEdit">✏️ edit</button></div>`;
  } else {
    const lab = seasons(true)[k], nowId = plan.now.slots[k], newId = hero.slots[k];
    const oc = CROP_BY_ID[nowId], nc = CROP_BY_ID[newId];
    const pl = hero.ind.placements.find(x => x.slot === k);
    const risk = hero.ind.risks.find(r => r.crop && r.crop.id === newId);
    const same = nowId === newId;
    const why = !nc ? (same ? 'Nothing fits well here' : 'Left free for the next crop') : same ? 'No change needed' : cropWhy(nc, k, hero.slots, null);
    const when = pl && pl.cont ? 'Continues from before' : pl && pl.sow != null ? `🗓️ ${MONTHS_SHORT[monthOf(pl.sow) - 1]} → ${MONTHS_SHORT[monthOf(pl.end) - 1]}` : '';
    body = `<div class="sp-head"><span><small>Field shift</small>${seasonIcon(k)} ${lab.long}</span><button class="sp-x" title="Close">✕</button></div>
      <div class="sp-row">${same ? badge(newId, nc) : `${badge(nowId, oc)}<span class="sp-arr">→</span>${badge(newId, nc)}`}</div>
      <div class="sp-tags"><span class="sp-why">${esc(why)}</span>${when ? `<span>${when}</span>` : ''}</div>
      ${risk ? `<div class="sp-risk">⚠️ ${esc(riskText(risk))}</div>` : ''}`;
  }
  pop.innerHTML = body;
  pop.classList.remove('hidden');
  if (btn) {
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
  }
  $('.sp-x', pop).onclick = () => { S.sel = null; updateUI(); };
  const ed = $('#spEdit'); if (ed) ed.onclick = () => openHistory(plan.p.id);
}

/* ================= PLAN MODAL (specs of one rotation) ================= */
function planTag(o) { return o.key === 'current' ? 'If you change nothing' : o.key === 'custom' ? 'Your own plan' : o.rank === 1 ? '⭐ Top suggestion' : `Option ${o.rank}`; }
function openPlan(key) {
  const plan = S.plan; if (!plan) return;
  const all = [plan.now, ...plan.opts, plan.custom].filter(Boolean);
  const o = all.find(x => x.key === key); if (!o) return;
  const now = plan.now, ht = plainTitle(o), c = S.cond;
  const ben = plainBenefits(o.ind, now.ind, plan.ctx);
  const risks = plainRisks(o, o.ind);
  const watch = o.key === 'current' ? [`Soil bare ~${Math.round(now.ind.bare)} months a year`, ...risks] : [...ben.trade, ...risks];
  const cov = (x) => Math.round(x.ind.living);
  $('#planBody').innerHTML = `
    <div class="pm-top"><span class="hero-tag">${planTag(o)}</span><button class="icon-btn" data-close>✕</button></div>
    <h2 class="pm-title">${SHORT_ICON[o.key] || ''} ${esc(ht.title)}</h2>
    <p class="pm-text">${esc(ht.text)}</p>
    <div class="pm-kpis">
      <div><b>${cov(o)}<small>/12</small></b><span>months soil covered${o.key !== 'current' ? ` <em>now ${cov(now)}</em>` : ''}</span></div>
      <div><b>${fmt(o.ind.rainOnBare)}<small> mm</small></b><span>rain on bare soil / yr${o.key !== 'current' ? ` <em>now ${fmt(now.ind.rainOnBare)}</em>` : ''}</span></div>
      <div><b>${o.ind.diversity}</b><span>plant families${o.key !== 'current' ? ` <em>now ${now.ind.diversity}</em>` : ''}</span></div>
    </div>
    <div class="strips">${o.key !== 'current' ? strip(now.ind, c, 'Now') : ''}${strip(o.ind, c, o.key === 'current' ? 'Now' : o.key === 'custom' ? 'Mine' : 'Plan')}
      <div class="strip-key"><span><i class="k-bare"></i>bare</span><span><i class="k-crop"></i>crop</span><span>3 years →</span></div></div>
    ${o.key !== 'current' && ben.good.filter(x => x.i !== '🛡️').length ? `<div class="sh-box good">${ben.good.filter(x => x.i !== '🛡️').map(x => `<div class="hb"><span>${x.i}</span><p>${x.t}</p></div>`).join('')}</div>` : ''}
    ${watch.length ? `<div class="sh-box watch">${watch.slice(0, 2).map(t => `<div class="hb"><span>⚠️</span><p>${esc(t)}</p></div>`).join('')}</div>` : ''}
    <div class="pm-foot"><button class="link" id="pmWhy">📊 Data behind this</button><button class="btn primary sm" id="pmSim">▶ Simulate it</button></div>`;
  $('#planBody [data-close]').onclick = () => $('#planModal').classList.add('hidden');
  $('#pmWhy').onclick = () => openWhy(plan, o);
  $('#pmSim').onclick = () => { $('#planModal').classList.add('hidden'); if (!S.playing) toggleSim(); };
  $('#planModal').classList.remove('hidden');
}
function openWhy(plan, hero) {
  const ex = evidence(hero, plan.now.ind, S.cond, plan.p);
  $('#whyTitle').textContent = `The data behind “${plainTitle(hero).title}”`;
  $('#whyBody').innerHTML = `
    <div class="wd-col"><h4>What the data says</h4>${list(ex.ev)}<h4>What we don't know</h4>${list(ex.gaps)}</div>
    <div class="wd-col"><h4>All indicators: now vs. this plan</h4>
      <table class="ind"><tr><td></td><td class="nowv"><small>now</small></td><td><small>plan</small></td></tr>${INDICATORS.map(def => `<tr class="${cmpClass(hero.ind, plan.now.ind, def)}"><td>${def.label}<small>${def.unit}</small></td><td class="nowv">${def.f(plan.now.ind, plan.now.ind)}</td><td>${def.f(hero.ind, plan.now.ind)}</td></tr>`).join('')}</table>
      <p class="muted xs">Indicators compare patterns from NASA/FAO data and crop traits; they are not yield or profit forecasts. Check with your agronomist before changing your rotation.</p>
      <button class="link" id="whySources">ⓘ About the data sources</button></div>`;
  $('#whySources').onclick = () => { renderSources(); $('#sourcesModal').classList.remove('hidden'); };
  $('#whyModal').classList.remove('hidden');
  document.dispatchEvent(new CustomEvent('demo:evidence-opened'));
}

/* ================= RIGHT · FARMER INPUT ================= */
function openOnboard() { $('#onboard').classList.remove('hidden'); $('#searchInput').focus(); }
function renderInput() {
  const el = $('#inputBody');
  if (!S.lat) { el.innerHTML = '<button class="btn primary sm" id="inLoc">📍 Choose your location</button>'; $('#inLoc').onclick = openOnboard; return; }
  const p = targetPlot();
  const loc = `<div class="fr"><span class="fr-l">📍</span><span class="fr-v">${esc(S.place)}<small>${S.lat.toFixed(4)}, ${S.lon.toFixed(4)}</small></span><button class="link" id="inLoc">change</button></div>`;
  if (!p) { el.innerHTML = loc + '<p class="muted xs">Outline your field in <b>Field area</b>.</p>'; $('#inLoc').onclick = openOnboard; return; }
  const filled = p.history.filter(Boolean).length;
  const sw = slopeWord(p.terrain?.slopeMean);
  const wantable = CROPS.filter(c => !c.isCover && !S.want.has(c.id));
  el.innerHTML = loc + `
    <div class="fr"><span class="fr-l">🌾</span><span class="fr-v"><input class="pc-name" id="pcName" value="${esc(p.name)}" /><small>${fmt(p.areaHa, 1)} ha${sw ? ` · ${sw}` : ''}</small></span></div>
    <div class="fr stack"><span class="fr-t">Planted before</span>
      <button class="hist-btn ${filled ? '' : 'empty'}" id="pcHist" title="Edit what you planted">${filled ? rotationStrip(p.history, true) : 'Tell us what you planted'}<span>✏️</span></button></div>
    <div class="fr stack"><span class="fr-t">Want to plant</span>
      <div class="want">${[...S.want].map(id => `<button class="wchip" data-id="${id}" title="Remove">${CROP_BY_ID[id].emoji} ${esc(cropName(id))} ✕</button>`).join('')}
        <select id="wantAdd"><option value="">＋ crop</option>${wantable.map(c => `<option value="${c.id}">${c.emoji} ${esc(cropName(c.id))}</option>`).join('')}</select></div></div>
    <div class="fr stack"><span class="fr-t">Irrigation</span>${seg('irrigation', [['none', 'None'], ['some', 'Some'], ['full', 'Full']], S.farm.irrigation)}</div>
    <div class="fr stack"><span class="fr-t">Goals <small>up to 3</small></span>
      <div class="goals">${Object.entries(GOALS).map(([k, g]) => `<button class="goal ${S.goals.has(k) ? 'on' : ''}" data-g="${k}" title="${g.label}"><span>${g.icon}</span>${g.short}</button>`).join('')}</div></div>
    <details class="more"><summary>More</summary>
      <div class="fr stack"><span class="fr-t">Waterlogging after rain</span>${seg('drainage', [['unknown', '?'], ['good', 'Never'], ['limited', 'Sometimes'], ['poor', 'Often']], p.drainage)}</div>
      <div class="fr stack"><span class="fr-t">Livestock</span>${seg('livestock', [['no', 'No'], ['yes', 'Yes']], S.farm.livestock ? 'yes' : 'no')}</div>
      <div class="fr stack"><span class="fr-t">Machinery</span>${seg('equipment', [['standard', 'Standard'], ['any', 'Special too']], S.farm.equipment)}</div>
      <button class="link danger" id="pcDel">Delete this plot</button></details>`;
  $('#inLoc').onclick = openOnboard;
  $('#pcName').onchange = e => { p.name = e.target.value.trim() || p.name; refreshParcel(p); updateUI(); };
  $('#pcDel').onclick = () => deleteParcel(p.id);
  $('#pcHist').onclick = () => openHistory(p.id);
  $('#wantAdd').onchange = e => { if (e.target.value) { S.want.add(e.target.value); updateUI(); } };
  $$('.wchip', el).forEach(b => b.onclick = () => { S.want.delete(b.dataset.id); updateUI(); });
  $$('.goal', el).forEach(b => b.onclick = () => {
    const k = b.dataset.g;
    if (S.goals.has(k)) S.goals.delete(k);
    else { if (S.goals.size >= 3) return toast('Pick up to 3.'); S.goals.add(k); }
    S.heroKey = null; updateUI();
  });
  $$('.seg', el).forEach(sg => sg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const q = sg.dataset.q, v = b.dataset.v;
    if (q === 'livestock') S.farm.livestock = v === 'yes';
    else if (q === 'drainage') p.drainage = v;
    else S.farm[q] = v;
    updateUI();
  }));
}

/* ================= RIGHT · WEATHER (what-if sliders by period) ================= */
const STATUS_LABEL = { power: 'POWER climate', imerg: 'IMERG rain', smap: 'SMAP moisture', ndvi: 'MODIS NDVI', gaez: 'FAO GAEZ', srtm: 'Terrain (DEM)' };
function renderStatus() {
  if (!S.lat) { $('#loadStatus').innerHTML = ''; return; }
  $('#loadStatus').innerHTML = Object.keys(STATUS_LABEL).map(k => {
    const st = S.status[k] || (k === 'srtm' ? 'waiting' : 'idle');
    const cls = st === 'ok' ? 'ok' : st === 'error' ? 'err' : st === 'waiting' ? 'wait' : 'load';
    const txt = st === 'ok' ? '✓' : st === 'error' ? '✕' : st === 'waiting' ? 'needs field' : st === 'loading' ? '…' : st;
    return `<span class="ls ${cls}">${STATUS_LABEL[k]} <b>${txt}</b></span>`;
  }).join('');
}
const srcChip = key => `<a class="src" href="${SOURCES[key].url || '#'}" target="_blank" rel="noopener" title="${esc(SOURCES[key].name)} · ${esc(SOURCES[key].scale)}">${SOURCES[key].short}</a>`;
const monthRange = list => {
  if (!list.length) return 'none';
  if (list.length === 12) return 'all year';
  const s = new Set(list);
  const start = list.find(m => !s.has(((m + 10) % 12) + 1)) || list[0];
  const ordered = []; for (let i = 0; i < 12; i++) { const m = ((start - 1 + i) % 12) + 1; if (s.has(m)) ordered.push(m); }
  return `${MONTHS[ordered[0] - 1]} – ${MONTHS[ordered[ordered.length - 1] - 1]}`;
};
function renderData() { renderWeather(); renderConditions(); }

/** Plain sentences about the area (data modal). */
function glanceRows(c) {
  const rows = [];
  const ff = [...c.cal.frostFree];
  rows.push(['🌡️', ff.length === 12 ? 'No frost: crops can grow <b>all year</b>' : `Frost-free: <b>${monthRange(ff)}</b>`, 'power']);
  rows.push(['🌧️', `<b>${fmt(Math.round(c.rainYear / 10) * 10)} mm</b> of rain a year`, 'imerg']);
  if (c.smap) { const dry = c.smap.clim.map((v, i) => [v, i + 1]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]); rows.push(['💧', `Soil driest in <b>${monthRange(dry)}</b>`, 'smap']); }
  if (c.ndvi) { const low = c.ndvi.low.map((v, i) => (v ? i + 1 : null)).filter(Boolean); if (low.length) rows.push(['🟫', `Fields here often bare <b>${monthRange(low)}</b>`, 'modis']); }
  if (c.tmaxTrend != null && c.tmaxTrend * 10 >= 0.2) rows.push(['📈', `Summers getting hotter: <b>+${fmt(c.tmaxTrend * 10, 1)} °C/decade</b>`, 'power']);
  const recent = c.normalRain12 ? (c.recentRain / c.normalRain12 - 1) * 100 : 0;
  if (Math.abs(recent) >= 15) rows.push([recent < 0 ? '☀️' : '☔', `Last 12 months <b>${recent < 0 ? 'drier' : 'wetter'} than normal</b> (${recent > 0 ? '+' : ''}${fmt(recent)} %)`, 'imerg']);
  return rows;
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const wxActive = () => S.wx.rain.some(v => v !== 1) || S.wx.dT.some(v => v !== 0);
/** The period the weather sliders apply to: picked chip, else the simulated month, else the selected season, else the whole year. */
function curPeriod() {
  if (S.wxPeriod) return S.wxPeriod;
  if (S.simMonth != null) return { type: 'month', m: monthOf(S.simMonth) };
  if (S.sel) return { type: Engine.slotType(S.sel.k) };
  return { type: 'year' };
}
function periodMonths(per) {
  const c = S.cond0 || S.cond;
  if (!c || per.type === 'year') return ALL_MONTHS;
  if (per.type === 'month') return [per.m];
  const off = (c.cal.coolStart - c.cal.warmStart + 12) % 12 || 6;
  const warm = Array.from({ length: off }, (_, i) => ((c.cal.warmStart - 1 + i) % 12) + 1);
  return per.type === 'warm' ? warm : ALL_MONTHS.filter(m => !warm.includes(m));
}
function periodName(per) {
  if (per.type === 'year') return 'every month';
  if (per.type === 'month') return MONTHS[per.m - 1];
  return `${per.type === 'warm' ? 'summer' : 'winter'}, ${monthRange(periodMonths(per)).replace(/[A-Z][a-z]+/g, w => w.slice(0, 3))}`;
}
function wxValues(c, ms) {
  const smWord = (() => {
    if (!c.smap) return null;
    const v = c.smap.clim.filter(x => x != null).sort((a, b) => a - b);
    const sm = Engine.avg(ms.map(m => c.smap.clim[m - 1])); if (sm == null) return null;
    let r = v.filter(x => x <= sm).length / v.length;
    r += (Engine.avg(ms.map(m => S.wx.rain[m - 1])) - 1) * 1.5; // wetter/drier what-if shifts it
    return r < 0.34 ? 'Dry' : r > 0.66 ? 'Moist' : 'Normal';
  })();
  return { rain: Engine.sum(ms.map(m => c.rain[m - 1])), t: Engine.avg(ms.map(m => c.t2m[m - 1])), frost: Engine.sum(ms.map(m => c.frostDays[m - 1])), heat: Engine.sum(ms.map(m => c.heatDays[m - 1])), sm: smWord };
}
function wxSliderVals(ms) {
  return { rain: Math.round((Engine.avg(ms.map(m => S.wx.rain[m - 1])) - 1) * 100), dT: Math.round(Engine.avg(ms.map(m => S.wx.dT[m - 1])) * 2) / 2 };
}
const sgn = (v, d = 0) => `${v > 0 ? '+' : ''}${fmt(v, d)}`;
function renderWxReadouts() {
  const c = S.cond, c0 = S.cond0 || c; if (!c) return;
  const ms = periodMonths(curPeriod()), v = wxValues(c, ms), v0 = wxValues(c0, ms);
  const diff = (a, b, d, u) => (Math.abs(a - b) >= (d ? 0.05 : 1) ? `<em>${sgn(a - b, d)}${u}</em>` : '');
  const el = $('#wxRead'); if (!el) return;
  el.innerHTML = `
    <div title="Rain in this period (NASA IMERG)"><span>🌧️</span><b>${fmt(v.rain)} mm</b>${diff(v.rain, v0.rain, 0, '')}</div>
    <div title="Mean temperature (NASA POWER)"><span>🌡️</span><b>${fmt(v.t, 1)}°</b>${diff(v.t, v0.t, 1, '°')}</div>
    <div title="Frost days (min ≤ 0 °C)"><span>❄️</span><b>${fmt(v.frost)} d</b>${diff(v.frost, v0.frost, 0, '')}</div>
    <div title="Root-zone soil moisture (NASA SMAP)"><span>💧</span><b>${v.sm || '—'}</b></div>`;
  const sv = wxSliderVals(ms);
  const rl = $('#wxRainV'), tl = $('#wxTempV');
  if (rl) rl.textContent = `${sgn(sv.rain)} %`;
  if (tl) tl.textContent = `${sgn(sv.dT, 1)} °C`;
}
let wxTimer = null;
function renderWeather() {
  const el = $('#weatherBody'), c = S.cond;
  if (!S.lat) { el.innerHTML = '<p class="muted xs">Choose a location.</p>'; return; }
  if (!c) { el.innerHTML = '<div class="skeleton"></div><p class="muted xs">Loading NASA data…</p>'; return; }
  if (S.wxDragging) { renderWxReadouts(); return; }
  const per = curPeriod(), ms = periodMonths(per), sv = wxSliderVals(ms);
  const chip = (p, label, title) => `<button data-per='${JSON.stringify(p)}' class="${JSON.stringify(p) === JSON.stringify(per) ? 'on' : ''}" title="${title}">${label}</button>`;
  const mChip = S.simMonth != null ? chip({ type: 'month', m: monthOf(S.simMonth) }, MONTHS_SHORT[monthOf(S.simMonth) - 1], 'The month on the time slider') : '';
  el.innerHTML = `
    <div class="seg per">${chip({ type: 'year' }, 'Year', 'Every month')}${chip({ type: 'warm' }, '☀️ Summer', 'Summer-season months')}${chip({ type: 'cool' }, '❄️ Winter', 'Winter-season months')}${mChip}</div>
    <div class="wx-read" id="wxRead"></div>
    <label class="wx-sl"><span>🌧️ Rain</span><b id="wxRainV"></b><input type="range" id="wxRain" min="-50" max="50" step="5" value="${sv.rain}" /></label>
    <label class="wx-sl"><span>🌡️ Temperature</span><b id="wxTempV"></b><input type="range" id="wxTemp" min="-3" max="4" step="0.5" value="${sv.dT}" /></label>
    <div class="wx-foot"><span class="muted xs" title="Applies to every ${periodName(per)} of the 3-year plan">What-if for ${periodName(per)}</span>
      ${wxActive() ? '<button class="link" id="wxReset">↺ reset</button>' : ''}<button class="link" id="openData">📊 Data</button></div>`;
  renderWxReadouts();
  $$('[data-per]', el).forEach(b => b.onclick = () => { S.wxPeriod = JSON.parse(b.dataset.per); renderWeather(); });
  const onSlide = (key, toVal) => e => {
    S.wxDragging = true;
    const val = toVal(+e.target.value);
    ms.forEach(m => { S.wx[key][m - 1] = val; });
    renderWxReadouts();
    clearTimeout(wxTimer); wxTimer = setTimeout(recompute, 180);
  };
  const done = () => { S.wxDragging = false; clearTimeout(wxTimer); recompute(); toast(wxActive() ? 'Plans re-tested with your weather.' : 'Back to normal weather.'); };
  $('#wxRain').oninput = onSlide('rain', v => 1 + v / 100);
  $('#wxTemp').oninput = onSlide('dT', v => v);
  $('#wxRain').onchange = done; $('#wxTemp').onchange = done;
  const rs = $('#wxReset'); if (rs) rs.onclick = () => { S.wx = { rain: Array(12).fill(1), dT: Array(12).fill(0) }; recompute(); };
  $('#openData').onclick = () => { renderConditions(); renderStatus(); $('#dataModal').classList.remove('hidden'); };
}

/* Detailed cards (data modal) */
function climateChart(c) {
  const W = 268, H = 120, pb = 18, pt = 8, bw = W / 12;
  const maxR = Math.max(60, ...c.rain), tmin = Math.min(...c.t2m, 0), tmax = Math.max(...c.t2m, 25);
  const y = v => pt + (H - pb - pt) * (1 - (v - tmin) / (tmax - tmin));
  const line = c.t2m.map((t, i) => `${i ? 'L' : 'M'}${(i + 0.5) * bw},${y(t)}`).join('');
  const bars = c.rain.map((r, i) => { const h = (H - pb - pt) * r / maxR; return `<rect x="${i * bw + 3}" y="${H - pb - h}" width="${bw - 6}" height="${h}" rx="2" class="${c.cal.frostFree.has(i + 1) ? 'rb' : 'rb cold'}"><title>${MONTHS[i]}: ${fmt(r)} mm rain, ${fmt(c.t2m[i], 1)} °C mean, ${fmt(c.frostDays[i], 1)} frost days</title></rect>`; }).join('');
  const labels = MONTHS_SHORT.map((m, i) => `<text x="${(i + 0.5) * bw}" y="${H - 4}">${m[0]}</text>`).join('');
  const zero = tmin < 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zero"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${bars}${zero}<path d="${line}" class="tl"/>${c.t2m.map((t, i) => `<circle cx="${(i + 0.5) * bw}" cy="${y(t)}" r="2.2" class="td"/>`).join('')}${labels}</svg>
    <div class="chart-key"><span><i class="k-rain"></i>Rain (IMERG, mm)</span><span><i class="k-cold"></i>Frost months</span><span><i class="k-temp"></i>Mean temp (POWER)</span></div>`;
}
function miniBars(vals, fmtv, cls = '', marks = []) {
  const max = Math.max(...vals.filter(v => v != null), 0.0001), min = Math.min(...vals.filter(v => v != null));
  return `<div class="minibars ${cls}">${vals.map((v, i) => `<div class="mb ${marks[i] ? 'mark' : ''}" title="${MONTHS[i]}: ${v == null ? 'no data' : fmtv(v)}"><i style="height:${v == null ? 0 : 15 + 85 * (v - min) / Math.max(max - min, 0.0001)}%"></i><span>${MONTHS_SHORT[i][0]}</span></div>`).join('')}</div>`;
}
function renderConditions() {
  const el = $('#conditions');
  const c = S.cond;
  if (!S.lat || !c) { el.innerHTML = '<p class="muted xs">Loading…</p>'; return; }
  const ff = [...c.cal.frostFree];
  const recentPct = c.normalRain12 ? (c.recentRain / c.normalRain12 - 1) * 100 : null;
  let html = `
  <section class="card"><div class="block-head"><h3>At a glance</h3></div>
    <div class="wx-rows">${glanceRows(c).map(([ic, t, s]) => `<div class="gl"><span class="gl-i">${ic}</span><span class="gl-t">${t}</span>${srcChip(s)}</div>`).join('')}</div>
    ${wxActive() ? '<p class="muted xs">Includes your weather what-if changes.</p>' : ''}</section>
  <section class="card">
    <div class="block-head"><h3>Climate & seasons</h3></div>
    ${climateChart(c)}
    <ul class="facts">
      <li><span>Frost-free season</span><b>${monthRange(ff)}</b></li>
      <li><span>Frost days (Tmin ≤ 0 °C)</span><b>${fmt(Engine.sum(c.frostDays))} /yr</b></li>
      <li><span>Hot days (Tmax ≥ 35 °C)</span><b>${fmt(Engine.sum(c.heatDays), 1)} /yr</b></li>
      <li><span>Rain (IMERG ${c.period})</span><b>${fmt(c.rainYear)} mm/yr</b></li>
      <li><span>Heavy-rain days (≥ 50 mm)</span><b>${fmt(c.heavyYear, 1)} /yr</b></li>
      <li><span>Evapotranspiration (POWER)</span><b>${fmt(c.etYear)} mm/yr</b></li>
      <li><span>Last 12 months of rain</span><b>${recentPct == null ? '—' : `${recentPct >= 0 ? '+' : ''}${fmt(recentPct)} % vs normal`}</b></li>
      <li><span>Max. temperature trend</span><b>${c.tmaxTrend == null ? '—' : `${c.tmaxTrend >= 0 ? '+' : ''}${fmt(c.tmaxTrend * 10, 2)} °C/decade`}</b></li>
      <li><span>Annual rain trend</span><b>${c.rainTrend == null ? '—' : `${c.rainTrend >= 0 ? '+' : ''}${fmt(c.rainTrend * 10)} mm/decade`}</b></li>
    </ul>
    <p class="cal-note">Sowing calendar derived from these data: summer crops from <b>${MONTHS[c.cal.warmStart - 1]}</b>, winter crops from <b>${MONTHS[c.cal.coolStart - 1]}</b>${c.cal.winterSevere ? '; winters too cold for non-hardy winter crops' : ''}.</p>
    <div class="card-foot">${srcChip('power')} ${srcChip('imerg')}<span>~50 km / ~11 km grids</span></div>
  </section>`;
  if (c.smap) html += `<section class="card"><div class="block-head"><h3>Root-zone soil moisture</h3></div>
      ${miniBars(c.smap.clim, v => `${fmt(v, 3)} m³/m³`, 'blue', c.smap.dryFreq.map(f => f != null && f >= 0.3))}
      <p class="muted xs">▲ months often in drought (≥ 30 % of years in the driest fifth). Recent 6 months: ${c.smap.recentAnom == null ? '—' : `${c.smap.recentAnom >= 0 ? '+' : ''}${fmt(c.smap.recentAnom, 3)} m³/m³ vs normal`}.</p>
      <div class="card-foot">${srcChip('smap')}<span>9 km · ${c.smap.years} · ${c.smap.n} samples</span></div></section>`;
  if (c.ndvi) html += `<section class="card"><div class="block-head"><h3>Greenness (NDVI)</h3></div>
      ${miniBars(c.ndvi.clim, v => `NDVI ${fmt(v, 2)}`, 'green', c.ndvi.low)}
      <p class="muted xs">Highlighted: NDVI below 0.4 — land often bare.</p>
      <div class="card-foot">${srcChip('modis')}<span>~1 km · ${c.ndvi.years}</span></div></section>`;
  if (S.terrain) html += `<section class="card"><div class="block-head"><h3>Terrain</h3><button class="link" id="showSlope">show on map</button></div>
      <ul class="facts"><li><span>Mean slope</span><b>${fmt(S.terrain.slopeMean, 1)} % (max ${fmt(S.terrain.slopeMax, 1)} %)</b></li><li><span>Relief</span><b>${fmt(S.terrain.relief)} m</b></li>
      ${S.parcels.filter(p => p.terrain).map(p => `<li><span>${esc(p.name)}</span><b>${fmt(p.terrain.slopeMean, 1)} % · ${Math.round(p.terrain.lowShare * 100)} % low spots</b></li>`).join('')}</ul>
      <div class="card-foot">${srcChip('srtm')}<span>90 m · ${S.terrain.inside.length} samples</span></div></section>`;
  else if (S.field && S.status.srtm === 'error') html += `<section class="card"><p class="muted xs">Elevation data unavailable right now (offline?). Slope and low spots are left out.</p></section>`;
  const g = c.gaez || {};
  const rows = CROPS.filter(cr => cr.gaez && g[cr.gaez] && g[cr.gaez].now != null).sort((a, b) => g[b.gaez].now - g[a.gaez].now);
  if (rows.length) html += `<section class="card"><div class="block-head"><h3>Crop suitability</h3><span class="muted xs">now → 2041–2070</span></div>
      <div class="suit-list">${rows.slice(0, 10).map(cr => { const v = g[cr.gaez]; return `<div class="sl"><span>${cr.emoji} ${esc(cr.name)}</span><div class="sl-t"><i style="width:${v.now / 100}%"></i>${v.future != null ? `<u style="left:${v.future / 100}%"></u>` : ''}</div><b>${Math.round(v.now / 100)}</b></div>`; }).join('')}</div>
      <div class="card-foot">${srcChip('gaez')}<span>~9 km · rainfed, high input · tick = 2041–2070</span></div></section>`;
  el.innerHTML = html;
  const ss = $('#showSlope'); if (ss) ss.onclick = () => { $('[data-ov="slope"]').checked = true; setOverlay('slope', true); $('#dataModal').classList.add('hidden'); $('#layers').open = true; };
}

/* ================= BOTTOM · ROTATION BAR ================= */
const SHORT_ICON = { current: '🔁', cover: '🌾', diverse: '🔀', water: '💧', forage: '🐄', custom: '✏️' };
const PILL = { current: 'Now', cover: 'Cover crops', diverse: 'More crops', water: 'Water-wise', forage: 'Pasture', custom: 'Mine' };
function renderRotBar() {
  const plan = S.plan, p = targetPlot();
  const past = seasons(false), fut = seasons(true);
  const hero = plan ? heroOf(plan) : null;
  const circle = (id, k, when, lab) => {
    const c = CROP_BY_ID[id];
    const sel = S.sel && S.sel.when === when && S.sel.k === k;
    const chg = when === 'future' && hero && hero.key !== 'current' && id !== plan.now.slots[k];
    const est = when === 'past' && p && isEstimated(p, k);
    return `<button class="rc-c ${when} ${Engine.slotType(k)} ${sel ? 'sel' : ''} ${chg ? 'chg' : ''} ${est ? 'est' : ''}" data-when="${when}" data-k="${k}" title="${lab.long}: ${esc(slotName(id))}${chg ? ' (change)' : ''}${est ? ' · estimated from satellite images' : ''}">
      <i class="${c ? '' : id === 'fallow' ? 'bare' : 'unk'}" style="${c ? `--c:${c.color}` : ''}">${c ? c.emoji : id === 'fallow' ? '' : '?'}</i><small>${lab.short}</small></button>`;
  };
  const pastSlots = p ? p.history : Array(6).fill('');
  const futSlots = hero ? hero.slots : Array(6).fill('');
  $('#rbCircles').innerHTML = `<div class="rb-group past"><span class="rb-cap">Before</span><div>${pastSlots.map((id, k) => circle(id, k, 'past', past[k])).join('')}</div></div>
    <span class="rb-now" title="Today">»</span>
    <div class="rb-group future"><span class="rb-cap">Next 3 years</span><div>${futSlots.map((id, k) => circle(id, k, 'future', fut[k])).join('')}</div></div>`;
  if (!plan) {
    $('#rbPlans').innerHTML = `<span class="muted xs">${!S.lat ? 'Choose a location' : !p ? 'Outline your field first' : !S.cond ? 'Loading NASA data…' : 'Add what you planted (Farmer input)'}</span>`;
  } else {
    const items = [plan.now, ...plan.opts, plan.custom].filter(Boolean);
    $('#rbPlans').innerHTML = items.map(o => `<button class="rb-plan ${hero.key === o.key ? 'on' : ''}" data-plan="${o.key}" title="${esc(plainTitle(o).title)} — tap for details">
      <span class="rp-i">${SHORT_ICON[o.key] || '•'}</span>${PILL[o.key] || o.key}${o.rank === 1 ? '<span class="rp-star">⭐</span>' : ''}</button>`).join('');
    $$('.rb-plan').forEach(b => b.onclick = () => { S.heroKey = b.dataset.plan; S.sel = null; updateUI(); openPlan(b.dataset.plan); });
  }
  $('#simBtn').disabled = !plan;
  $$('#rbCircles .rc-c').forEach(b => {
    b.onclick = () => {
      if (!plan) { if (p && b.dataset.when === 'past') openHistory(p.id); return; }
      const s = { when: b.dataset.when, k: +b.dataset.k };
      S.sel = S.sel && S.sel.when === s.when && S.sel.k === s.k ? null : s;
      S.wxPeriod = null;
      updateUI();
    };
  });
  markLive();
}
function markLive() {
  const k = S.simMonth == null ? -1 : slotAtMonth(S.simMonth);
  $$('#rbCircles .rc-c.future').forEach(b => b.classList.toggle('live', +b.dataset.k === k));
}

/* ================= SIMULATION & TIME SLIDER ================= */
function occFor(p) {
  if (S.plan && p.id === S.plan.p.id) return heroOf(S.plan).ind.occ;
  return p._occ;
}
function renderTimeLabel() {
  const i = +$('#timeSlider').value, m = monthOf(i);
  const p = S.plan?.p, occ = p ? occFor(p) : null, cr = occ ? CROP_BY_ID[occ[i]] : null;
  const fut = seasons(true)[slotAtMonth(i)];
  $('#timeLabel').innerHTML = `<b>${MONTHS[m - 1]}</b> · ${fut ? fut.long : `Year ${Math.floor(i / 12) + 1}`}${occ ? ` · ${cr ? `${cr.emoji} ${esc(cropName(cr.id))}` : '🟫 bare soil'}` : ''}`;
  $('#timeReset').classList.toggle('hidden', S.simMonth == null);
  $('#timePane').classList.toggle('on', S.simMonth != null);
}
function renderSimFrame() {
  S.parcels.forEach(refreshParcel);
  renderTimeLabel(); markLive(); renderWeather();
}
function stopSim() {
  clearInterval(S.simTimer); S.simTimer = null; S.playing = false;
  $('#simIcon').textContent = '▶'; $('#simBtn').classList.remove('playing');
}
function toggleSim() {
  if (!S.plan) return toast('Tell us your field and what you planted first.');
  if (S.playing) return stopSim();
  const sl = $('#timeSlider');
  let i = S.simMonth == null || +sl.value >= 35 ? 0 : +sl.value;
  S.playing = true; S.simSeen = true; autoHint();
  $('#simIcon').textContent = '❚❚'; $('#simBtn').classList.add('playing');
  const tgt = S.plan.p; if (tgt.layer) map.fitBounds(S.fieldLayer ? S.fieldLayer.getBounds() : tgt.layer.getBounds(), { padding: [40, 40], maxZoom: map.getMaxZoom() });
  S.simMonth = i; sl.value = i; renderSimFrame();
  S.simTimer = setInterval(() => {
    i++;
    if (i > 35) {
      stopSim(); S.sel = null; updateUI();
      const plan = S.plan; if (!plan) return;
      const h = heroOf(plan);
      toast(`3 years simulated: soil covered <b>${Math.round(h.ind.living)} of 12 months</b> (now ${Math.round(plan.now.ind.living)}).`);
      return;
    }
    sl.value = i; S.simMonth = i; renderSimFrame();
  }, 420);
}

/* ================= HISTORY MODAL ================= */
function cropOptions(k) {
  const type = Engine.slotType(k);
  const groups = type === 'warm'
    ? [['Summer crops', CROPS.filter(c => c.type === 'warm')], ['Pasture', CROPS.filter(c => c.type === 'perennial')], ['Spring-sown', CROPS.filter(c => c.type === 'cool' && !c.isCover)]]
    : [['Winter crops', CROPS.filter(c => c.type === 'cool' && !c.isCover)], ['Cover crops', CROPS.filter(c => c.isCover)], ['Pasture', CROPS.filter(c => c.type === 'perennial')]];
  return '<option value="">I don\'t know</option><option value="fallow">Nothing (left bare)</option>'
    + groups.map(([g, l]) => `<optgroup label="${g}">${l.map(c => `<option value="${c.id}">${c.emoji} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}
function openHistory(id) {
  const p = S.parcels.find(x => x.id === id); if (!p) return;
  S.historyFor = id;
  $('#hName').textContent = p.name;
  const labels = seasonLabels();
  $('#hRows').innerHTML = labels.map((s, k) => ({ s, k })).reverse().map(({ s, k }) => `
    <label class="h-row ${Engine.slotType(k)}"><span class="h-season"><i></i>${s}</span><select data-k="${k}">${cropOptions(k)}</select></label>`).join('');
  $$('#hRows select').forEach(sel => {
    const k = +sel.dataset.k;
    sel.value = p.history[k] || '';
    sel.closest('.h-row').classList.toggle('est', isEstimated(p, k));
    sel.onchange = () => { p.history[k] = sel.value; unmarkEstimated(p, k); sel.closest('.h-row').classList.remove('est'); delete S.custom[p.id]; refreshParcel(p); renderHistoryPreview(p); updateUI(); };
  });
  renderHistoryPreview(p);
  $('#historyModal').classList.remove('hidden');
}
function renderHistoryPreview(p) {
  let txt = '';
  if (S.cond && p.history.some(h => h)) {
    const ind = Engine.evaluate(p.history, S.cond, compareCtx(p));
    txt = `<div class="hp"><b>${fmt(12 - ind.bare, 0)} of 12 months</b><small>your soil is covered by a crop</small></div>`;
  }
  $('#hPreview').innerHTML = `<div class="h-prev-head">Your rotation</div>${rotationStrip(p.history)}${txt}`;
}

/* ================= SATELLITE RECONSTRUCTION (simulated) =================
   In the real product, seasons the farmer can't remember are classified from the
   Landsat / Sentinel-2 archive (NDVI phenology per plot). Here it is mocked: a short
   staged loader, then plausible crops filled in and flagged as estimates. */
const isEstimated = (p, k) => !!p.estimated?.includes(k);
const unmarkEstimated = (p, k) => { if (p.estimated) p.estimated = p.estimated.filter(x => x !== k); };
const RECON_STEPS = [
  { t: 'Fetching the satellite archive', d: n => `Landsat 8/9 + Sentinel-2 · ${n} scenes since ${TODAY.getFullYear() - 3}` },
  { t: 'Removing clouds and shadows', d: () => 'Cloud mask per pixel · clear views only' },
  { t: 'Building the greenness curve of each plot', d: () => 'NDVI time series · 10–30 m' },
  { t: 'Matching curves to crop signatures', d: () => 'Sowing, peak and harvest dates' },
  { t: 'Reconstructing soil state', d: () => 'Bare-soil periods and residue cover' },
];
function guessSlot(p, k, h) {
  const seed = (p.id * 7 + k * 3 + Math.round(Math.abs(S.lat || 0) * 10)) % 7;
  if (Engine.slotType(k) === 'warm') {
    const near = h[k - 2] || h[k + 2];
    return near === 'soybean' ? 'corn' : near === 'corn' ? 'soybean' : seed % 3 ? 'soybean' : 'corn';
  }
  const opts = (S.lat ?? 0) < 0 ? ['wheat', 'fallow', 'oats', 'wheat', 'barley', 'fallow', 'oats'] : ['fallow', 'rye', 'fallow', 'wheat', 'fallow', 'rye', 'fallow'];
  return opts[seed];
}
function reconstructHistory() {
  document.dispatchEvent(new CustomEvent('demo:history-confirmed'));
  const plots = S.parcels.filter(p => p.history.some(h => !h));
  $('#historyModal').classList.add('hidden');
  if (!plots.length) return;
  const labels = seasonLabels();
  const gaps = plots.flatMap(p => p.history.map((h, k) => (h ? null : { p, k })).filter(Boolean));
  const scenes = 96 + gaps.length * 11 + Math.round(Math.abs(S.lon || 0)) % 17;
  const tiles = gaps.slice(0, 12).map(({ p, k }, i) => `<div class="rc-tile" style="--d:${i}"><i></i><span>${seasonIcon(k)}</span><small>${esc(p.name)}<br>${labels[k]}</small></div>`).join('');
  $('#reconBody').innerHTML = `
    <div class="rc-sat"><span class="rc-orbit"></span><span class="rc-icon">🛰️</span></div>
    <h2>Reconstructing your field's history</h2>
    <p class="muted xs">${gaps.length} season${gaps.length === 1 ? '' : 's'} you didn't remember across ${plots.length} plot${plots.length === 1 ? '' : 's'} · estimated from satellite images</p>
    <div class="rc-tiles">${tiles}</div>
    <ol class="rc-steps">${RECON_STEPS.map((s, i) => `<li data-i="${i}"><span class="rc-dot"></span><div><b>${s.t}</b><small>${s.d(scenes)}</small></div></li>`).join('')}</ol>
    <div class="rc-bar"><i id="reconBar"></i></div>
    <p class="muted xs rc-note">Simulated in this prototype — no real images are processed.</p>`;
  $('#reconModal').classList.remove('hidden');
  const steps = $$('#reconBody .rc-steps li'), dur = 4600, t0 = performance.now();
  const tick = now => {
    const f = Math.min(1, (now - t0) / dur), cur = Math.min(steps.length - 1, Math.floor(f * steps.length));
    $('#reconBar').style.width = `${(f * 100).toFixed(1)}%`;
    steps.forEach((li, i) => { li.classList.toggle('done', i < cur || f === 1); li.classList.toggle('on', i === cur && f < 1); });
    $$('#reconBody .rc-tile').forEach((el, i, all) => el.classList.toggle('lit', f > 0.25 + 0.7 * i / all.length));
    if (f < 1) return requestAnimationFrame(tick);
    gaps.forEach(({ p, k }) => { p.history[k] = guessSlot(p, k, p.history); p.estimated = [...new Set([...(p.estimated || []), k])]; delete S.custom[p.id]; });
    setTimeout(() => {
      $('#reconModal').classList.add('hidden');
      S.parcels.forEach(refreshParcel); if (S.parcels.some(p => p.id === S.historyFor)) selectParcel(S.historyFor); else updateUI();
      toast(`🛰️ ${gaps.length} season${gaps.length === 1 ? '' : 's'} reconstructed from satellite history — marked as estimates.`);
    }, 450);
  };
  requestAnimationFrame(tick);
}

/* ================= DRAG CROPS (pointer-based: mouse, pen and touch) =================
   Drop a ranked crop on a future season circle, or on a plot on the map. */
const Drag = { on: false, hover: null };
function parcelAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !el.closest('#map') || el.closest('.leaflet-control')) return null;
  const r = map.getContainer().getBoundingClientRect(), ll = map.containerPointToLatLng([x - r.left, y - r.top]);
  return S.parcels.find(p => turf.booleanPointInPolygon(turf.point([ll.lng, ll.lat]), p.geo)) || null;
}
function dropTarget(x, y) {
  const el = document.elementFromPoint(x, y), c = el?.closest('.rc-c.future');
  if (c) return { kind: 'season', el: c, k: +c.dataset.k };
  const p = parcelAt(x, y);
  return p ? { kind: 'plot', p } : null;
}
function setDragHover(t) {
  const old = Drag.hover;
  if (old?.el === t?.el && old?.p === t?.p) return;
  if (old?.el) old.el.classList.remove('over');
  if (old?.p) refreshParcel(old.p);
  if (t?.el) t.el.classList.add('over');
  if (t?.p) t.p.layer.setStyle({ color: '#FFFFFF', weight: 5, fillColor: '#E9F5C9', fillOpacity: 0.5 });
  Drag.hover = t;
}
function startCropDrag(e, id, k) {
  if (e.button !== 0 || !CROP_BY_ID[id]) return;
  const src = e.currentTarget, x0 = e.clientX, y0 = e.clientY, cr = CROP_BY_ID[id];
  let ghost = null;
  const move = ev => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.style.setProperty('--c', cr.color);
      ghost.innerHTML = `<span>${cr.emoji}</span>${esc(cropName(id))}`;
      document.body.append(ghost);
      document.body.classList.add('is-dragging'); src.classList.add('dragging'); Drag.on = true;
    }
    ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
    const t = dropTarget(ev.clientX, ev.clientY);
    ghost.classList.toggle('ok', !!t);
    setDragHover(t);
  };
  const end = ev => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
    if (!ghost) return;
    const t = ev.type === 'pointerup' ? dropTarget(ev.clientX, ev.clientY) : null;
    setDragHover(null);
    ghost.remove(); document.body.classList.remove('is-dragging'); src.classList.remove('dragging');
    setTimeout(() => { Drag.on = false; }, 0); // swallow the click that follows a drag
    if (!t) return;
    if (t.kind === 'season') return setSlot(t.k, id);
    if (t.p.id !== targetPlot()?.id) selectParcel(t.p.id);
    if (!S.plan) return toast(`Add what was planted in ${esc(t.p.name)} first.`);
    setSlot(k, id);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
}

/* ================= SOURCES MODAL ================= */
function renderSources() {
  $('#sourcesBody').innerHTML = Object.entries(SOURCES).map(([k, s]) => `
    <div class="srow"><div class="s-name">${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>` : s.name}<small>${s.scale}</small></div>
      <div><p>${s.what}</p><p class="muted xs">⚠ ${s.limit}</p></div></div>`).join('')
    + `<p class="muted xs">Live access: NASA POWER API (climate + IMERG), NASA GIBS map tiles (SMAP, MODIS NDVI — data values decoded from the published color maps), FAO GAEZ v4 image services, Open-Meteo elevation API (Copernicus DEM GLO-90). Crop-history reconstruction from the Landsat/Sentinel-2 archive is simulated in this prototype.</p><p class="muted xs">Open source: <a href="https://github.com/GTula/juxtacrop-nasa" target="_blank" rel="noopener">github.com/GTula/juxtacrop-nasa ↗</a></p>`;
}

/* ================= GLOBAL ================= */
function updateUI() {
  S.parcels.forEach(p => { p._occ = S.cond && p.history.some(Boolean) ? Engine.schedule(p.history, S.cond, compareCtx(p)).occ : null; });
  S.plan = computePlan();
  if (S.plan && S.heroKey === 'custom' && !S.plan.custom) S.heroKey = null;
  renderPlotList(); renderInput(); renderRank(); renderRotBar(); renderSeasonPop(); renderWeather(); renderTimeLabel();
  S.parcels.forEach(refreshParcel);
  autoHint();
  document.dispatchEvent(new CustomEvent('demo:updated'));
}
let toastT;
function toast(msg) { const t = $('#toast'); t.innerHTML = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3800); }

/* ================= EVENTS ================= */
$('#searchForm').onsubmit = e => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) searchPlace(q); };
$('#geoBtn').onclick = () => {
  if (!navigator.geolocation) return toast('Your browser does not support geolocation.');
  navigator.geolocation.getCurrentPosition(pos => setLocation(pos.coords.latitude, pos.coords.longitude, 'My location'), () => toast('Could not get your location.'), { timeout: 8000 });
};
$$('[data-demo]').forEach(b => b.onclick = () => loadDemo(b.dataset.demo));
$('#onboard').addEventListener('click', e => { if (e.target.id === 'onboard' && S.lat) $('#onboard').classList.add('hidden'); });
$('#sourcesBtn').onclick = () => { renderSources(); $('#sourcesModal').classList.remove('hidden'); };

$$('.pane-head').forEach(h => h.onclick = () => {
  const pane = h.closest('.pane'); pane.classList.toggle('min');
  $('.pane-min', h).textContent = pane.classList.contains('min') ? '+' : '–';
});

$('#drawFieldBtn').onclick = () => startDraw('field');
$('#drawParcelBtn').onclick = () => startDraw('parcel');
$('#splitBtn').onclick = () => { cancelDraw(true); autoSplit(+$('#splitN').value); };
$('#clearBtn').onclick = () => { cancelDraw(true); clearAll(); toast('Field and plots cleared.'); };

$$('[data-ov]').forEach(cb => cb.onchange = () => setOverlay(cb.dataset.ov, cb.checked));

$('#simBtn').onclick = toggleSim;
$('#timeSlider').oninput = e => { if (S.playing) stopSim(); S.simMonth = +e.target.value; S.wxPeriod = null; renderSimFrame(); };
$('#timeReset').onclick = () => { stopSim(); S.simMonth = null; S.wxPeriod = null; $('#timeSlider').value = 0; renderSimFrame(); };
window.addEventListener('resize', () => renderSeasonPop());

$$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hidden'));
['historyModal', 'sourcesModal', 'whyModal', 'dataModal', 'planModal'].forEach(id => $('#' + id).addEventListener('click', e => { if (e.target.id === id) e.target.classList.add('hidden'); }));
$('#hDone').onclick = reconstructHistory;
$('#hCopyAll').onclick = () => {
  const src = S.parcels.find(x => x.id === S.historyFor); if (!src) return;
  S.parcels.forEach(p => { p.history = src.history.slice(); p.estimated = (src.estimated || []).slice(); delete S.custom[p.id]; refreshParcel(p); });
  updateUI(); toast('Same history copied to all plots.');
};
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (S.drawMode && !typing) {
    if (e.key === 'Escape') { cancelDraw(); return; }
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(); return; }
    if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undoDraw(); return; }
  }
  if (e.key === 'Escape') $$('.modal').forEach(m => { if ((m.id !== 'onboard' || S.lat) && m.id !== 'reconModal') m.classList.add('hidden'); });
});

renderStatus();
updateUI();
setTimeout(() => $('#searchInput').focus(), 200);
if (location.hash === '#demo' || location.hash === '#iowa') loadDemo('iowa');
if (location.hash === '#uruguay') loadDemo('uruguay');
