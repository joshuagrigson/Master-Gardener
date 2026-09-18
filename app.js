/* app.js — Master Gardener: photo-mapped garden beds, harvest countdowns, check-ins, weather analytics.
   Vanilla JS, no build step. Data lives in IndexedDB on this device; export/import JSON to move it. */
(() => {
'use strict';

const APP_VERSION = '1.1.0';

/* ---------- utilities ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { if (!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) { const d = new Date(s); return isNaN(d) ? null : d; } return new Date(+m[1], +m[2] - 1, +m[3]); };
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDateY = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDT = d => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const toLocalDT = d => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexRgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const relDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} d` : `${-n} d ago`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sevRank = { good: 0, warn: 1, serious: 2, critical: 3 };

let toastTimer;
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- state ---------- */
const DEFAULT_SETTINGS = { place: 'Texarkana, TX', lat: 33.4418, lon: -94.0377, firstFrost: '11-10', lastFrost: '03-20', rows: 2, cols: 4 };
const S = {
  view: 'beds', bedId: null, photoId: null, mode: 'view', compareId: null, selCell: null, alignDraft: null,
  beds: [], photos: [], plantings: [], logs: [], settings: { ...DEFAULT_SETTINGS },
  wx: null, wxErr: null, wxLoading: false, urls: new Map(), renderToken: 0,
};
const HEALTH = ['', '😟', '😕', '😐', '🙂', '🤩'];
const FLAGS = [['watered', '💧 Watered'], ['fertilized', '🧪 Fertilized'], ['pests', '🐛 Pests'], ['disease', '🍂 Disease'], ['flowering', '🌸 Flowering'], ['fruit', '🍅 Fruit set'], ['harvested', '🧺 Harvested some'], ['pruned', '✂️ Pruned']];

const bedById = id => S.beds.find(b => b.id === id);
const photosOf = bedId => S.photos.filter(p => p.bedId === bedId).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
const latestPhoto = bedId => { const ps = photosOf(bedId); return ps.length ? ps[ps.length - 1] : null; };
const plantingsOf = bedId => S.plantings.filter(p => p.bedId === bedId);
const logsOf = pid => S.logs.filter(l => l.plantingId === pid).sort((a, b) => b.at.localeCompare(a.at));
const plantingById = id => S.plantings.find(p => p.id === id);
function activeAt(p, asOf) {
  const planted = parseISO(p.plantedAt); if (!planted || planted > asOf) return false;
  if (p.status !== 'active') { const ended = parseISO(p.endedAt); return !!ended && ended > startOfDay(asOf); }
  return true;
}

/* ---------- planting stats ---------- */
function statsFor(p, asOf = new Date()) {
  const crop = cropByKey(p.cropKey);
  const group = CROP_GROUPS[crop.group] || CROP_GROUPS.other;
  const planted = parseISO(p.plantedAt) || startOfDay(asOf);
  const days = Math.max(0, daysBetween(planted, asOf));
  const perennial = crop.stages === 'perennial' || !p.dtm;
  const dtm = p.dtm || 0;
  const progress = perennial ? null : days / dtm;
  const eta = perennial ? null : addDays(planted, dtm);
  const left = perennial ? null : dtm - days;
  const fruitDay = crop.stages === 'fruit' && !perennial ? Math.round(dtm * FRUIT_SET_FRACTION) : null;
  const fruitLeft = fruitDay != null ? fruitDay - days : null;
  const list = STAGES[crop.stages] || STAGES.fruit;
  const stage = perennial ? `Perennial · year ${Math.floor(days / 365) + 1}` : list.find(([t]) => progress < t)[1];
  let sev = 'good';
  if (!perennial) { if (progress >= 1.3) sev = 'critical'; else if (progress >= 1.0) sev = 'warn'; }
  const logs = logsOf(p.id).filter(l => l.at.slice(0, 10) <= isoDate(asOf));
  const last = logs[0] || null, prev = logs[1] || null;
  const health = last ? last.health : null;
  const trend = last && prev ? Math.sign(last.health - prev.health) : 0;
  const sinceLog = last ? daysBetween(parseISO(last.at), asOf) : null;
  const attention = [];
  if (p.status === 'active') {
    if (health != null && health <= 2) attention.push({ sev: 'critical', text: `Rated ${health}/5 at last check-in` });
    if (!perennial && progress >= 1.3) attention.push({ sev: 'serious', text: `Past its harvest window by ${days - dtm} d` });
    if (sinceLog != null && sinceLog >= 14) attention.push({ sev: 'warn', text: `No check-in for ${sinceLog} d` });
  }
  return { crop, group, color: group.color, planted, days, dtm, perennial, progress, eta, left, fruitDay, fruitLeft, stage, sev, logs, last, health, trend, sinceLog, attention };
}
function weatherFlagsFor(p, st) {
  const out = [];
  const nxt = upcomingDays(3);
  if (!nxt.length || p.status !== 'active') return out;
  const hot = nxt.some(d => d.tmax != null && d.tmax >= 90);
  const cold = nxt.some(d => d.tmin != null && d.tmin <= 36);
  const heatSensitive = ['tomato', 'pepper', 'cucurbit'].includes(st.crop.group) || st.crop.key === 'bush-bean' || st.crop.key === 'pole-bean';
  const tender = st.crop.base >= 50 && st.crop.stages !== 'perennial';
  if (hot && heatSensitive && st.crop.stages === 'fruit') out.push({ sev: 'warn', text: 'Highs ≥ 90°F ahead: expect blossom drop (heat, not a fix)' });
  if (cold && tender) out.push({ sev: 'serious', text: 'Lows ≤ 36°F ahead: cover or harvest tender crops' });
  return out;
}
function upcomingDays(n) {
  if (!S.wx) return [];
  const out = []; const today = isoDate(new Date());
  for (let i = 0; i < n; i++) { const d = S.wx.days.get(isoDate(addDays(new Date(), i))); if (d) out.push(d); }
  return out;
}
function sevClass(sev) { return sev === 'good' ? 'good' : sev; }

/* ---------- geometry ---------- */
const defaultQuad = (map) => map ? [[0.06, 0.1], [0.94, 0.1], [0.94, 0.9], [0.06, 0.9]] : [[0.1, 0.15], [0.9, 0.15], [0.9, 0.85], [0.1, 0.85]];
function homography(q) { // unit square (u east, v south) -> quad [NW, NE, SE, SW]
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g = 0, h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) { a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; }
  else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = (dx1 * dy2 - dx2 * dy1) || 1e-9;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
}
function cellPoly(H, rows, cols, r, c) {
  const u0 = c / cols, u1 = (c + 1) / cols, v0 = r / rows, v1 = (r + 1) / rows;
  return [H(u0, v0), H(u1, v0), H(u1, v1), H(u0, v1)];
}
/* Re-assign the bed's compass corners onto the quad's geometric corners for the direction the camera was facing.
   Looking N: far-left of the photo is the NW corner. Looking S: far-left is SE. Looking E: far-left is NE. Looking W: far-left is SW. */
const FACINGS = { N: ['TL', 'TR', 'BR', 'BL'], S: ['BR', 'BL', 'TL', 'TR'], E: ['BL', 'TL', 'TR', 'BR'], W: ['TR', 'BR', 'BL', 'TL'] };
function facingQuad(quad, facing) {
  const sorted = [...quad].sort((a, b) => a[1] - b[1]);
  const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]), bot = sorted.slice(2).sort((a, b) => a[0] - b[0]);
  const g = { TL: top[0], TR: top[1], BL: bot[0], BR: bot[1] };
  return (FACINGS[facing] || FACINGS.N).map(k => [...g[k]]);
}
const centroid = poly => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const pts = poly => poly.map(([x, y]) => `${(x * 1000).toFixed(1)},${(y * 1000).toFixed(1)}`).join(' ');

/* ---------- persistence ---------- */
async function loadAll() {
  const [beds, photos, plantings, logs, settings] = await Promise.all([DB.all('beds'), DB.all('photos'), DB.all('plantings'), DB.all('logs'), DB.setting('settings', null)]);
  S.beds = beds.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.createdAt.localeCompare(b.createdAt));
  S.photos = photos; S.plantings = plantings; S.logs = logs;
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!S.beds.length) await seedBeds();
}
async function seedBeds() {
  const now = new Date().toISOString();
  const beds = [
    { id: uid(), name: 'Bed 1 · South', subtitle: 'Front bed: berries + cool season', rows: 2, cols: 4, sort: 1, createdAt: now },
    { id: uid(), name: 'Bed 2 · Middle', subtitle: 'Roots, bulbs, squash corner', rows: 2, cols: 4, sort: 2, createdAt: now },
    { id: uid(), name: 'Bed 3 · North', subtitle: 'Back bed by the fence: nightshades', rows: 2, cols: 4, sort: 3, createdAt: now },
  ];
  await DB.putMany('beds', beds); S.beds = beds;
}
async function savePlanting(p) { await DB.put('plantings', p); const i = S.plantings.findIndex(x => x.id === p.id); if (i >= 0) S.plantings[i] = p; else S.plantings.push(p); }
async function saveLog(l) { await DB.put('logs', l); const i = S.logs.findIndex(x => x.id === l.id); if (i >= 0) S.logs[i] = l; else S.logs.push(l); }
async function saveBed(b) { await DB.put('beds', b); const i = S.beds.findIndex(x => x.id === b.id); if (i >= 0) S.beds[i] = b; else S.beds.push(b); }
async function savePhoto(p) { await DB.put('photos', p); const i = S.photos.findIndex(x => x.id === p.id); if (i >= 0) S.photos[i] = p; else S.photos.push(p); }
async function deletePhoto(id) {
  await DB.del('photos', id); await DB.del('blobs', id);
  S.photos = S.photos.filter(p => p.id !== id);
  const u = S.urls.get(id); if (u) { URL.revokeObjectURL(u.full); URL.revokeObjectURL(u.thumb); S.urls.delete(id); }
}
async function urlFor(photoId, kind = 'full') {
  let e = S.urls.get(photoId);
  if (!e) {
    const b = await DB.get('blobs', photoId); if (!b) return '';
    e = { full: URL.createObjectURL(b.full), thumb: URL.createObjectURL(b.thumb || b.full) };
    S.urls.set(photoId, e);
  }
  return e[kind];
}

/* ---------- weather ---------- */
function hydrateWx(store) { return { ...store, days: new Map(store.days.map(d => [d.day, d])) }; }
async function loadWeather(force) {
  if (S.wxLoading) return; S.wxLoading = true;
  const { lat, lon } = S.settings;
  const earliest = S.plantings.filter(p => p.status === 'active').map(p => p.plantedAt).sort()[0] || isoDate(addDays(new Date(), -30));
  const floor = isoDate(addDays(new Date(), -370));
  const start = earliest < floor ? floor : earliest;
  try {
    const cached = await DB.setting('wx', null);
    const fresh = cached && cached.lat === lat && cached.lon === lon && cached.start <= start && Date.now() - cached.fetchedAt < 60 * 60 * 1000;
    if (!force && fresh) { S.wx = hydrateWx(cached); }
    else {
      const res = await WX.dailySeries(lat, lon, start);
      const store = { lat, lon, start, fetchedAt: res.fetchedAt, current: res.current, partial: res.partial, days: Array.from(res.days.values()) };
      await DB.setSetting('wx', store); S.wx = hydrateWx(store); S.wxErr = null;
    }
  } catch (e) {
    S.wxErr = e.message || 'offline';
    try { const cached = await DB.setting('wx', null); if (cached) S.wx = hydrateWx(cached); } catch (_) { /* ignore */ }
  }
  S.wxLoading = false;
  if (S.view === 'analytics' || S.view === 'beds') render();
}
function gddFor(p, st) {
  if (!S.wx || st.perennial) return null;
  const end = isoDate(addDays(new Date(), -1));
  const start = isoDate(st.planted);
  if (start > end) return { gdd: 0, covered: 0, total: 0 };
  return WX.gdd(S.wx.days, start, end, st.crop.base || 50);
}

/* ---------- photos ---------- */
function processImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const full = drawScaled(img, 1600, 0.86), thumb = drawScaled(img, 360, 0.8);
        Promise.all([full.blob, thumb.blob]).then(([fb, tb]) => { URL.revokeObjectURL(url); resolve({ full: fb, thumb: tb, w: full.w, h: full.h }); }, reject);
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}
function drawScaled(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', q));
  return { blob, w, h };
}
async function importFiles(files, bedId) {
  const list = Array.from(files || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length) { toast('No images found'); return; }
  if (!bedId) { toast('Open a bed first, then add photos'); return; }
  toast(`Processing ${plural(list.length, 'photo')}…`);
  let lastId = null;
  for (const f of list) {
    try {
      const { full, thumb, w, h } = await processImage(f);
      const id = uid();
      const takenAt = new Date(f.lastModified && f.lastModified > 0 ? f.lastModified : Date.now());
      const prev = latestPhoto(bedId);
      const photo = { id, bedId, takenAt: takenAt.toISOString(), w, h, quad: prev ? prev.quad.map(p => [...p]) : defaultQuad(false), facing: prev ? (prev.facing || 'N') : 'N', note: '', createdAt: new Date().toISOString() };
      await DB.put('blobs', { id, full, thumb });
      await savePhoto(photo); lastId = id;
    } catch (e) { console.error(e); toast(`Could not read ${f.name}`); }
  }
  if (lastId) { S.photoId = lastId; S.mode = 'view'; S.compareId = null; toast('Photo added. Align the grid, then tap cells to tag what is growing.', 3200); }
  render();
}

function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode failed')); i.src = url; }); }
async function rotateBlob(blob, q) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas'); c.width = img.naturalHeight; c.height = img.naturalWidth;
    const g = c.getContext('2d'); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', q));
  } finally { URL.revokeObjectURL(url); }
}
/* Rotate a stored photo 90° clockwise; the alignment quad rotates with it so tags stay on their cells. */
async function rotatePhoto(id) {
  const ph = S.photos.find(p => p.id === id); const b = await DB.get('blobs', id); if (!ph || !b) return;
  toast('Rotating…');
  const full = await rotateBlob(b.full, 0.86), thumb = await rotateBlob(b.thumb || b.full, 0.8);
  await DB.put('blobs', { id, full, thumb });
  const u = S.urls.get(id); if (u) { URL.revokeObjectURL(u.full); URL.revokeObjectURL(u.thumb); S.urls.delete(id); }
  const turn = ([x, y]) => [+(1 - y).toFixed(4), +x.toFixed(4)];
  const quad = ph.quad.map(turn);
  await savePhoto({ ...ph, w: ph.h, h: ph.w, quad });
  if (S.mode === 'align' && S.alignDraft) S.alignDraft = S.alignDraft.map(turn);
  render();
}

/* ---------- routing ---------- */
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [seg, id] = h.split('/');
  if (seg === 'bed' && id && bedById(id)) { if (S.view !== 'bed' || S.bedId !== id) { S.photoId = null; S.mode = 'view'; S.compareId = null; S.selCell = null; } S.view = 'bed'; S.bedId = id; }
  else if (seg === 'analytics') S.view = 'analytics';
  else if (seg === 'settings') S.view = 'settings';
  else S.view = 'beds';
  if (S.view !== 'bed') { S.mode = 'view'; S.compareId = null; S.alignDraft = null; }
  render();
}

/* ---------- rendering ---------- */
async function render() {
  const token = ++S.renderToken;
  let html = '';
  if (S.view === 'beds') html = await renderBeds();
  else if (S.view === 'bed') html = await renderBed();
  else if (S.view === 'analytics') html = renderAnalytics();
  else html = renderSettings();
  if (token !== S.renderToken) return;
  $('#view').innerHTML = html;
  renderTopbar();
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === (S.view === 'bed' ? 'beds' : S.view)));
  afterRender();
}
function renderTopbar() {
  const back = $('#back-btn'), title = $('#title'), sub = $('#subtitle'), acts = $('#topbar-actions');
  if (S.view === 'bed') {
    const bed = bedById(S.bedId); const n = plantingsOf(bed.id).filter(p => p.status === 'active').length;
    back.hidden = false; title.textContent = bed.name; sub.textContent = `${bed.rows}×${bed.cols} · ${n} active · ${plural(photosOf(bed.id).length, 'photo')}`;
    acts.innerHTML = `<button class="icon-btn" data-act="take-photo" title="Take photo">📷</button><button class="icon-btn" data-act="add-photo" title="Add from library">🖼️</button><button class="icon-btn" data-act="edit-bed" data-id="${bed.id}" title="Bed settings">⋯</button>`;
  } else {
    back.hidden = true; title.textContent = 'Master Gardener';
    sub.textContent = S.view === 'analytics' ? 'Live analytics' : S.view === 'settings' ? 'Settings & data' : 'Bed mapper · harvest tracker';
    acts.innerHTML = S.view === 'analytics' ? `<button class="icon-btn" data-act="refresh-wx" title="Refresh weather">↻</button>` : S.view === 'beds' ? `<button class="icon-btn" data-act="add-bed" title="Add bed">＋</button>` : '';
  }
}

function summaryTiles(bedFilter) {
  const now = new Date();
  const act = S.plantings.filter(p => p.status === 'active' && (!bedFilter || p.bedId === bedFilter));
  const stats = act.map(p => ({ p, st: statsFor(p, now) }));
  const ready = stats.filter(x => !x.st.perennial && x.st.progress >= 1 && x.st.progress < 1.3).length;
  const due7 = stats.filter(x => !x.st.perennial && x.st.left > 0 && x.st.left <= 7).length;
  const attention = stats.filter(x => x.st.attention.length || weatherFlagsFor(x.p, x.st).length).length;
  return { act: act.length, ready, due7, attention, stats };
}

async function renderBeds() {
  const t = summaryTiles(null);
  let html = `<div class="stat-grid">
    <div class="stat"><div class="stat-label">Active</div><div class="stat-value">${t.act}</div><div class="stat-sub">${plural(S.beds.length, 'bed')}</div></div>
    <div class="stat ${t.ready ? 'good' : ''}"><div class="stat-label">Ready now</div><div class="stat-value">${t.ready}</div><div class="stat-sub">${t.due7 ? `+${t.due7} within 7 d` : 'harvest window'}</div></div>
    <div class="stat ${t.attention ? 'alert' : ''}"><div class="stat-label">Attention</div><div class="stat-value">${t.attention}</div><div class="stat-sub">${t.attention ? 'see Analytics' : 'all clear'}</div></div>
  </div>`;
  for (const bed of S.beds) {
    const lp = latestPhoto(bed.id);
    const thumb = lp ? await urlFor(lp.id, 'thumb') : '';
    const act = plantingsOf(bed.id).filter(p => activeAt(p, new Date()));
    const owners = new Map(); act.forEach(p => p.cells.forEach(c => owners.set(c, p)));
    let mini = '';
    if (!thumb) {
      mini = `<div class="mini" style="grid-template-columns:repeat(${bed.cols},1fr);grid-template-rows:repeat(${bed.rows},1fr)">` +
        Array.from({ length: bed.rows * bed.cols }, (_, i) => { const o = owners.get(i); return `<i class="${o ? 'on' : ''}" style="${o ? `--c:${CROP_GROUPS[cropByKey(o.cropKey).group].color}` : ''}"></i>`; }).join('') + '</div>';
    }
    const chips = act.slice(0, 6).map(p => { const c = cropByKey(p.cropKey); const st = statsFor(p); return `<span class="chip" style="--c:${st.color}"><span class="dot"></span>${c.emoji} ${esc(p.variety || c.name)} <span class="mono">d${st.days}</span></span>`; }).join('') + (act.length > 6 ? `<span class="chip">+${act.length - 6}</span>` : '');
    const next = act.map(p => statsFor(p)).filter(s => !s.perennial && s.left != null).sort((a, b) => a.left - b.left)[0];
    html += `<button class="bed-card" data-act="open-bed" data-id="${bed.id}">
      <div class="bed-thumb">${thumb ? `<img src="${thumb}" alt="">` : mini}</div>
      <div class="grow">
        <h3>${esc(bed.name)}</h3><div class="sub">${esc(bed.subtitle || '')}${bed.subtitle ? ' · ' : ''}${bed.rows}×${bed.cols}${lp ? ` · photo ${fmtDate(new Date(lp.takenAt))}` : ' · no photos yet'}</div>
        <div class="chips">${chips || '<span class="hint">Nothing tagged yet</span>'}</div>
        ${next ? `<div class="meta">Next harvest: ${next.crop.emoji} ${esc(next.crop.name)} ${next.left <= 0 ? '<b>now</b>' : `<b>${relDays(next.left)}</b>`}</div>` : ''}
      </div></button>`;
  }
  html += `<button class="btn ghost block" data-act="add-bed">＋ Add a bed</button>`;
  if (!S.plantings.length) {
    html += `<div class="card welcome" style="margin-top:14px"><h2>How it works</h2><ol>
      <li><b>Open a bed</b> and take a photo of it (or drop one in).</li>
      <li><b>Align</b>: drag the four corners of the grid onto the bed's corners so the cells sit on the soil.</li>
      <li><b>Tap a cell</b> to tag what is planted there, with the date you planted it.</li>
      <li><b>Check in</b> weekly with a 1–5 rating. New photos keep the same tags; day counts and harvest countdowns update themselves.</li>
    </ol><p class="hint" style="margin-top:10px">Everything is stored on this device. Back it up from Settings → Export.</p></div>`;
  }
  return html;
}

function currentPhoto(bed) {
  if (S.photoId === 'map') return null;
  if (S.photoId) { const p = S.photos.find(x => x.id === S.photoId && x.bedId === bed.id); if (p) return p; }
  return latestPhoto(bed.id);
}
function asOfFor(bed, photo) {
  if (!photo) return new Date();
  const latest = latestPhoto(bed.id);
  if (latest && latest.id === photo.id) return new Date();
  return new Date(photo.takenAt);
}

async function renderBed() {
  const bed = bedById(S.bedId);
  const photos = photosOf(bed.id);
  const photo = currentPhoto(bed);
  const asOf = asOfFor(bed, photo);
  const historical = photo && daysBetween(asOf, new Date()) !== 0 && !(latestPhoto(bed.id) && latestPhoto(bed.id).id === photo.id);
  let stage = '';
  if (S.mode === 'compare' && photo) stage = await renderCompare(bed, photo);
  else stage = await renderStage(bed, photo, asOf, historical);

  const strip = `<div class="strip">
    <button class="thumb map ${!photo ? 'active' : ''}" data-act="pick-photo" data-id="map">🗺️<span class="thumb-date">PLAN</span></button>
    ${(await Promise.all(photos.map(async p => `<button class="thumb ${photo && p.id === photo.id ? 'active' : ''} ${S.mode === 'compare' && S.compareId === p.id ? 'cmp' : ''}" data-act="pick-photo" data-id="${p.id}"><img src="${await urlFor(p.id, 'thumb')}" alt=""><span class="thumb-date">${fmtDate(new Date(p.takenAt))}</span></button>`))).join('')}
  </div>`;

  let toolbar = '';
  if (S.mode === 'align') {
    const facing = S.alignFacing || photo.facing || 'N';
    toolbar = `<div class="align-help">1. Tap the direction you were facing when you took the photo. 2. Drag the four corners onto the bed's real corners (the labels say which compass corner each one is). Grid: ${bed.rows} rows N→S × ${bed.cols} columns W→E.</div>
      <div class="row" style="margin-bottom:8px"><span class="hint" style="white-space:nowrap">Camera looking</span><div class="seg grow">${['N', 'E', 'S', 'W'].map(f => `<button type="button" class="${facing === f ? 'on' : ''}" data-act="set-facing" data-f="${f}">${f}</button>`).join('')}</div><button class="btn small" data-act="rotate-photo" data-id="${photo.id}" title="Rotate photo 90°">↻ Rotate</button></div>
      <div class="btn-row"><button class="btn primary" data-act="align-save">Save alignment</button><button class="btn" data-act="align-reset">Reset corners</button><button class="btn ghost" data-act="align-cancel">Cancel</button></div>`;
  } else if (S.mode === 'compare') {
    toolbar = `<div class="align-help">Tap another photo in the strip to compare against. Slide to reveal.</div>
      <div class="btn-row"><button class="btn" data-act="compare-end">Done comparing</button></div>`;
  } else {
    toolbar = `<div class="stage-toolbar">
      <button class="btn small primary" data-act="take-photo">📷 Take photo</button>
      <button class="btn small" data-act="add-photo">🖼️ Add photos</button>
      ${photo ? `<button class="btn small" data-act="align-start">📐 Align grid</button>` : ''}
      ${photos.length > 1 && photo ? `<button class="btn small" data-act="compare-start">⇄ Compare</button>` : ''}
      ${photo ? `<button class="btn small" data-act="photo-info" data-id="${photo.id}">ℹ️ Photo</button>` : ''}
      <button class="btn small" data-act="new-planting" data-bed="${bed.id}">＋ Plant</button>
    </div>`;
  }

  const all = plantingsOf(bed.id);
  const active = all.filter(p => p.status === 'active').sort((a, b) => a.plantedAt.localeCompare(b.plantedAt));
  const done = all.filter(p => p.status !== 'active').sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
  let list = `<div class="section"><h2>Plantings</h2><span class="hint">${plural(active.length, 'active')}</span></div>`;
  list += active.length ? active.map(p => plantingCard(p, new Date(), false)).join('') : `<div class="empty"><strong>Nothing tagged in this bed yet</strong>Tap a cell on the photo or plan, or use ＋ Plant.</div>`;
  if (done.length) list += `<div class="section"><h2>Finished</h2></div>` + done.map(p => plantingCard(p, new Date(), false)).join('');
  return stage + toolbar + strip + list;
}

async function renderStage(bed, photo, asOf, historical) {
  const rows = bed.rows, cols = bed.cols;
  const quad = S.mode === 'align' && S.alignDraft ? S.alignDraft : (photo ? photo.quad : defaultQuad(true));
  const H = homography(quad);
  const active = plantingsOf(bed.id).filter(p => activeAt(p, asOf));
  const owners = new Map(); active.forEach(p => p.cells.forEach(c => owners.set(c, p)));
  const w = photo ? photo.w : 4, h = photo ? photo.h : 3;
  const src = photo ? await urlFor(photo.id, 'full') : '';
  const small = (Math.min(window.innerWidth, 760) / cols) < 105;
  let polys = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c; const o = owners.get(idx); const poly = cellPoly(H, rows, cols, r, c);
    const color = o ? CROP_GROUPS[cropByKey(o.cropKey).group].color : null;
    polys += `<polygon class="cell ${o ? 'on' : ''} ${S.selCell === idx ? 'sel' : ''}" points="${pts(poly)}" ${o ? `style="fill:${hexRgba(color, 0.26)};stroke:${color}"` : ''} data-act="cell" data-idx="${idx}"></polygon>`;
  }
  let frame = '';
  if (S.mode === 'align') frame = `<polygon class="frame" points="${pts(quad)}"></polygon>`;
  let labels = '';
  for (const p of active) {
    const st = statsFor(p, asOf);
    const cs = p.cells.map(i => centroid(cellPoly(H, rows, cols, Math.floor(i / cols), i % cols)));
    if (!cs.length) continue;
    const [cx, cy] = centroid(cs);
    const pct = st.perennial ? 100 : clamp(Math.round(st.progress * 100), 0, 100);
    const dayTxt = st.perennial ? `y${Math.floor(st.days / 365) + 1}` : `d${st.days}`;
    labels += `<div class="tag ${small ? 'small' : ''}" style="left:${(cx * 100).toFixed(2)}%;top:${(cy * 100).toFixed(2)}%;--c:${st.color};--c-soft:${hexRgba(st.color, 0.5)};--p:${pct}" data-act="open-planting" data-id="${p.id}" title="${esc(p.variety || st.crop.name)} · ${esc(st.stage)}"><span class="ring"></span><span>${st.crop.emoji}</span><span class="name">${esc(p.variety || st.crop.name)}</span><span class="d">${dayTxt}${st.left != null && st.left <= 0 && !st.perennial ? ' ✓' : ''}</span></div>`;
  }
  const mids = [['N', H(0.5, 0)], ['S', H(0.5, 1)], ['W', H(0, 0.5)], ['E', H(1, 0.5)]];
  const compass = mids.map(([t, [x, y]]) => `<div class="compass-lbl" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%">${t}</div>`).join('');
  let handles = '';
  if (S.mode === 'align') handles = ['NW', 'NE', 'SE', 'SW'].map((n, i) => `<div class="handle-dot" data-corner="${i}" style="left:${(quad[i][0] * 100).toFixed(2)}%;top:${(quad[i][1] * 100).toFixed(2)}%">${n}</div>`).join('');
  const style = `aspect-ratio:${w}/${h};width:min(100%, calc(62vh * ${(w / h).toFixed(4)}))`;
  const empty = !photo ? `<div class="stage-empty"><strong>Plan view</strong><span>No photo selected. Take one and the grid will overlay it.</span></div>` : '';
  return `<div class="stage-wrap"><div class="stage ${photo ? '' : 'map-mode'} ${S.mode === 'align' ? 'aligning' : ''}" id="stage" style="${style}">
    ${photo ? `<img class="stage-img" src="${src}" alt="Bed photo">` : ''}
    ${!photo && !active.length ? empty : ''}
    <svg class="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">${frame}${polys}</svg>
    <div class="labels">${compass}${S.mode === 'align' ? '' : labels}${handles}</div>
    <span class="hud-corner tl"></span><span class="hud-corner tr"></span><span class="hud-corner bl"></span><span class="hud-corner br"></span>
    ${photo ? '<div class="scan"></div>' : ''}
    ${historical ? `<div class="asof">AS OF <b>${fmtDateY(asOf).toUpperCase()}</b> · ${daysBetween(asOf, new Date())} D AGO</div>` : ''}
  </div></div>`;
}
async function renderCompare(bed, photo) {
  const photos = photosOf(bed.id);
  let other = S.compareId ? photos.find(p => p.id === S.compareId) : null;
  if (!other) { const i = photos.findIndex(p => p.id === photo.id); other = photos[i - 1] || photos[i + 1] || null; S.compareId = other ? other.id : null; }
  if (!other) return `<div class="empty">Add a second photo of this bed to compare.</div>`;
  const [a, b] = new Date(other.takenAt) <= new Date(photo.takenAt) ? [other, photo] : [photo, other];
  const w = b.w, h = b.h;
  const style = `aspect-ratio:${w}/${h};width:min(100%, calc(62vh * ${(w / h).toFixed(4)}))`;
  const delta = daysBetween(new Date(a.takenAt), new Date(b.takenAt));
  return `<div class="stage-wrap"><div class="compare" id="compare" style="${style};margin:0 auto">
      <img src="${await urlFor(b.id)}" alt="After"><img class="top" id="cmp-top" src="${await urlFor(a.id)}" alt="Before">
      <div class="divider" id="cmp-div"></div>
      <span class="lbl a">${fmtDate(new Date(a.takenAt))}</span><span class="lbl b">${fmtDate(new Date(b.takenAt))} · +${delta} d</span>
    </div></div>
    <input type="range" class="cmp" id="cmp-range" min="0" max="100" value="50" aria-label="Reveal">`;
}

function plantingCard(p, asOf, withSpark) {
  const st = statsFor(p, asOf);
  const bed = bedById(p.bedId);
  const pct = st.perennial ? 100 : clamp(st.progress * 100, 0, 100);
  const meterClass = st.sev === 'good' ? '' : st.sev === 'warn' ? 'warn' : st.sev === 'serious' ? 'serious' : 'critical';
  const doneTxt = p.status !== 'active' ? `${p.status === 'harvested' ? 'Harvested' : 'Removed'} ${p.endedAt ? fmtDate(parseISO(p.endedAt)) : ''}` : '';
  let eta = '';
  if (p.status !== 'active') eta = `<div class="eta">${doneTxt}</div>`;
  else if (st.perennial) eta = `<div class="eta"><b>${st.days >= 365 ? `yr ${Math.floor(st.days / 365) + 1}` : `d${st.days}`}</b>perennial</div>`;
  else if (st.left > 0) eta = `<div class="eta"><b>${st.left} d</b>to harvest</div>`;
  else eta = `<div class="eta"><b>${st.progress < 1.3 ? 'Ready' : 'Over'}</b>${fmtDate(st.eta)}</div>`;
  const gdd = withSpark ? gddFor(p, st) : null;
  const flags = p.status === 'active' ? [...st.attention, ...weatherFlagsFor(p, st)] : [];
  const worst = flags.sort((a, b) => sevRank[b.sev] - sevRank[a.sev])[0];
  return `<button class="planting-card ${p.status !== 'active' ? 'done' : ''}" style="--c:${st.color}" data-act="open-planting" data-id="${p.id}">
    <div class="em">${st.crop.emoji}</div>
    <div class="grow">
      <div class="name">${esc(p.variety || st.crop.name)} ${p.variety ? `<small>${esc(st.crop.name)}</small>` : ''}</div>
      <div class="where">${withSpark && bed ? esc(bed.name) + ' · ' : ''}${plural(p.cells.length, 'cell')} · planted ${fmtDate(st.planted)} · day ${st.days}${st.perennial ? '' : ` of ${st.dtm}`}</div>
      <div class="stage">${esc(st.stage)}${st.health ? ` · ${HEALTH[st.health]} ${st.health}/5${st.trend > 0 ? ' ↑' : st.trend < 0 ? ' ↓' : ''}` : ''}${gdd && gdd.covered ? ` · <span class="mono">${gdd.gdd} GDD</span>` : ''}</div>
      ${p.status === 'active' ? `<div class="meter"><i class="${meterClass}" style="width:${pct.toFixed(1)}%"></i>${st.fruitDay && !st.perennial ? `<span class="tick" style="left:${(FRUIT_SET_FRACTION * 100).toFixed(1)}%" title="fruit set"></span>` : ''}</div>` : ''}
      ${worst ? `<div style="margin-top:6px"><span class="badge ${sevClass(worst.sev)}">${worst.sev === 'critical' ? '⛔' : worst.sev === 'serious' ? '⚠️' : '△'} ${esc(worst.text)}</span></div>` : ''}
      ${withSpark && st.logs.length >= 2 ? sparkline(st.logs) : ''}
    </div>
    ${eta}
  </button>`;
}
function sparkline(logsDesc) {
  const logs = logsDesc.slice(0, 10).reverse();
  const W = 320, Hh = 48, padL = 8, padR = 44, top = 8, bottom = 8;
  const y = v => top + (5 - v) / 4 * (Hh - top - bottom);
  const x = i => padL + (logs.length === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (logs.length - 1));
  const path = logs.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(l.health).toFixed(1)}`).join(' ');
  const dots = logs.map((l, i) => `<circle class="pt ${i === logs.length - 1 ? 'last' : ''}" cx="${x(i).toFixed(1)}" cy="${y(l.health).toFixed(1)}" r="4"><title>${fmtDate(parseISO(l.at))}: ${l.health}/5${l.note ? ' · ' + esc(l.note) : ''}</title></circle>`).join('');
  const last = logs[logs.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" aria-label="Health check-ins, last ${logs.length}">
    <line class="grid" x1="${padL}" x2="${W - padR + 6}" y1="${y(5).toFixed(1)}" y2="${y(5).toFixed(1)}"></line><line class="grid" x1="${padL}" x2="${W - padR + 6}" y1="${y(3).toFixed(1)}" y2="${y(3).toFixed(1)}"></line><line class="grid" x1="${padL}" x2="${W - padR + 6}" y1="${y(1).toFixed(1)}" y2="${y(1).toFixed(1)}"></line>
    <path class="ln" d="${path}"></path>${dots}
    <text class="lbl" x="${(W - padR + 12).toFixed(1)}" y="${(y(last.health) + 4).toFixed(1)}">${last.health}/5</text></svg>`;
}

function nextFrost(mmdd) {
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd || ''); if (!m) return null;
  const now = new Date(); let d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
  if (d < startOfDay(now)) d = new Date(now.getFullYear() + 1, +m[1] - 1, +m[2]);
  return d;
}

function renderAnalytics() {
  const now = new Date();
  const t = summaryTiles(null);
  const frost = nextFrost(S.settings.firstFrost);
  const frostDays = frost ? daysBetween(now, frost) : null;
  let html = `<div class="stat-grid">
    <div class="stat"><div class="stat-label">Active</div><div class="stat-value">${t.act}</div><div class="stat-sub">${plural(S.beds.length, 'bed')}</div></div>
    <div class="stat ${t.ready ? 'good' : ''}"><div class="stat-label">Ready now</div><div class="stat-value">${t.ready}</div><div class="stat-sub">harvest window</div></div>
    <div class="stat"><div class="stat-label">Due in 7 d</div><div class="stat-value">${t.due7}</div><div class="stat-sub">first harvests</div></div>
    <div class="stat ${t.attention ? 'alert' : ''}"><div class="stat-label">Attention</div><div class="stat-value">${t.attention}</div><div class="stat-sub">${t.attention ? 'listed below' : 'all clear'}</div></div>
    <div class="stat"><div class="stat-label">Photos</div><div class="stat-value">${S.photos.length}</div><div class="stat-sub">${plural(S.logs.length, 'check-in')}</div></div>
    <div class="stat"><div class="stat-label">First frost</div><div class="stat-value">${frostDays != null ? frostDays : '—'}</div><div class="stat-sub">${frost ? `days · ${fmtDate(frost)}` : 'set in Settings'}</div></div>
  </div>`;
  html += renderWeather();

  const active = S.plantings.filter(p => p.status === 'active');
  const stats = active.map(p => ({ p, st: statsFor(p, now) }));
  const timeline = stats.filter(x => !x.st.perennial).sort((a, b) => a.st.left - b.st.left);
  html += `<div class="card"><h2>Harvest timeline</h2>`;
  if (!timeline.length) html += `<p class="hint">Tag some plantings and their harvest countdowns show up here.</p>`;
  else html += timeline.slice(0, 12).map(({ p, st }) => {
    const bed = bedById(p.bedId);
    return `<div class="hrow" data-act="open-planting" data-id="${p.id}" style="--c:${st.color}"><div class="em">${st.crop.emoji}</div>
      <div><div class="nm">${esc(p.variety || st.crop.name)} <span class="sb">· ${esc(bed ? bed.name : '')}</span></div><div class="sb">${esc(st.stage)}${st.fruitLeft != null && st.fruitLeft > 0 ? ` · fruit set ${relDays(st.fruitLeft)}` : ''}</div><div class="bar"><i style="width:${clamp(st.progress * 100, 2, 100).toFixed(1)}%"></i></div></div>
      <div class="dl"><b>${st.left > 0 ? `${st.left} d` : st.progress < 1.3 ? 'Ready' : 'Over'}</b>${fmtDate(st.eta)}</div></div>`;
  }).join('');
  html += `</div>`;

  const attention = stats.map(x => ({ ...x, flags: [...x.st.attention, ...weatherFlagsFor(x.p, x.st)] })).filter(x => x.flags.length)
    .sort((a, b) => Math.max(...b.flags.map(f => sevRank[f.sev])) - Math.max(...a.flags.map(f => sevRank[f.sev])));
  html += `<div class="card"><h2>Needs attention</h2>`;
  html += attention.length ? `<div class="flags">` + attention.map(({ p, st, flags }) => flags.map(f => `<div class="flag ${sevClass(f.sev)}" data-act="open-planting" data-id="${p.id}" style="cursor:pointer"><span class="fi">${f.sev === 'critical' ? '⛔' : f.sev === 'serious' ? '⚠️' : '△'}</span><div><b>${st.crop.emoji} ${esc(p.variety || st.crop.name)}</b> · ${esc(bedById(p.bedId)?.name || '')}<br><span class="hint">${esc(f.text)}</span></div></div>`).join('')).join('') + `</div>`
    : `<div class="flag good"><span class="fi">✅</span><div>All clear. Nothing is overdue, rated low, or facing a weather flag in the next 3 days.</div></div>`;
  html += `</div>`;

  html += `<div class="section"><h2>All plantings</h2><span class="hint">${plural(active.length, 'active')}</span></div>`;
  html += active.length ? stats.sort((a, b) => (a.st.left ?? 9e9) - (b.st.left ?? 9e9)).map(({ p }) => plantingCard(p, now, true)).join('') : `<div class="empty"><strong>No plantings yet</strong>Open a bed and tag what is growing.</div>`;
  if (S.wx && S.wx.partial) html += `<p class="hint center" style="margin-top:8px">Weather history is partial, so GDD totals may undercount.</p>`;
  return html;
}
function renderWeather() {
  const wx = S.wx;
  let html = `<div class="card"><h2>Weather · ${esc(S.settings.place || 'your garden')}</h2>`;
  if (!wx) { html += `<p class="hint">${S.wxLoading ? 'Loading Open-Meteo…' : S.wxErr ? `Weather unavailable (${esc(S.wxErr)}). Set your location in Settings and refresh.` : 'Loading…'}</p></div>`; return html; }
  const cur = wx.current || {};
  const d = WX.describe(cur.weather_code ?? 0);
  const today = isoDate(new Date());
  const days = [];
  for (let i = -7; i < 7; i++) { const k = isoDate(addDays(new Date(), i)); const r = wx.days.get(k); if (r) days.push({ ...r, key: k, off: i }); }
  const past = days.filter(x => x.off < 0), fut = days.filter(x => x.off >= 0);
  const rain7 = past.reduce((s, x) => s + (x.rain || 0), 0);
  const et7 = past.reduce((s, x) => s + (x.et0 || 0), 0);
  const rainNext3 = fut.slice(0, 3).reduce((s, x) => s + (x.rain || 0), 0);
  const deficit = et7 - rain7;
  const hot = fut.slice(0, 3).some(x => x.tmax >= 90), cold = fut.slice(0, 3).some(x => x.tmin <= 36);
  html += `<div class="wx-now"><div class="ic">${d.icon}</div><div><div class="big">${cur.temperature_2m != null ? Math.round(cur.temperature_2m) + '°' : '—'}</div><div class="desc">${d.text}${cur.relative_humidity_2m != null ? ` · ${cur.relative_humidity_2m}% RH` : ''}${cur.wind_speed_10m != null ? ` · ${Math.round(cur.wind_speed_10m)} mph` : ''}</div></div>
    <div class="right"><dl class="kv"><dt>Rain 7 d</dt><dd class="mono">${rain7.toFixed(2)} in</dd><dt>ET₀ 7 d</dt><dd class="mono">${et7.toFixed(2)} in</dd><dt>Next 3 d</dt><dd class="mono">${rainNext3.toFixed(2)} in</dd></dl></div></div>`;
  html += `<div class="flags">`;
  if (deficit > 1.0 && rainNext3 < 0.5) html += `<div class="flag serious"><span class="fi">💧</span><div><b>Water deeply.</b> The last week evaporated ~${deficit.toFixed(1)} in more than it rained and little is coming. Deep and infrequent, then mulch over moist soil.</div></div>`;
  else if (deficit > 0.5 && rainNext3 < 0.25) html += `<div class="flag warn"><span class="fi">💧</span><div><b>Check soil moisture.</b> Running ~${deficit.toFixed(1)} in behind; water if the top 2 in are dry.</div></div>`;
  else html += `<div class="flag good"><span class="fi">💧</span><div><b>Moisture looks OK.</b> Rain has roughly kept up with evaporation this week.</div></div>`;
  if (hot) html += `<div class="flag warn"><span class="fi">🌡️</span><div><b>Heat ahead (≥ 90°F).</b> Tomatoes and peppers will drop blossoms; that is heat, not a deficiency. Water in the morning.</div></div>`;
  if (cold) html += `<div class="flag critical"><span class="fi">🥶</span><div><b>Frost watch (≤ 36°F).</b> Cover tender crops or pick what is close.</div></div>`;
  html += `</div>`;
  html += `<div class="wx-strip">` + fut.slice(0, 7).map(x => { const dd = WX.describe(x.code ?? 0); const dt = parseISO(x.key); return `<div class="wx-day ${x.key === today ? 'today' : ''} ${x.tmax >= 90 ? 'hot' : ''} ${x.tmin <= 36 ? 'cold' : ''}" title="${dd.text}"><div class="dn">${x.key === today ? 'Today' : dt.toLocaleDateString(undefined, { weekday: 'short' })}</div><div class="ic">${dd.icon}</div><div class="hi">${Math.round(x.tmax)}°</div><div class="lo">${Math.round(x.tmin)}°</div><div class="rn">${x.rain >= 0.05 ? x.rain.toFixed(1) + '"' : (x.pop >= 40 ? x.pop + '%' : '')}</div></div>`; }).join('') + `</div>`;
  html += `<p class="hint" style="margin-top:8px">Open-Meteo · updated ${fmtDT(new Date(wx.fetchedAt))}</p></div>`;
  return html;
}

function renderSettings() {
  const s = S.settings;
  return `<form class="card" id="settings-form">
    <h2>Location & season</h2>
    <label class="field"><span>Place name</span><input name="place" value="${esc(s.place)}"></label>
    <div class="row"><label class="field grow"><span>Latitude</span><input name="lat" type="number" step="0.0001" value="${s.lat}"></label><label class="field grow"><span>Longitude</span><input name="lon" type="number" step="0.0001" value="${s.lon}"></label></div>
    <div class="row"><label class="field grow"><span>Avg first fall frost (MM-DD)</span><input name="firstFrost" value="${esc(s.firstFrost)}" placeholder="11-10"></label><label class="field grow"><span>Avg last spring frost (MM-DD)</span><input name="lastFrost" value="${esc(s.lastFrost)}" placeholder="03-20"></label></div>
    <div class="row"><label class="field grow"><span>New bed rows (N→S)</span><input name="rows" type="number" min="1" max="8" value="${s.rows}"></label><label class="field grow"><span>New bed columns (W→E)</span><input name="cols" type="number" min="1" max="10" value="${s.cols}"></label></div>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="use-location">📍 Use my location</button></div>
  </form>
  <div class="card"><h2>Data</h2>
    <p class="hint" style="margin-bottom:10px">Photos, tags, and check-ins are stored only on this device (${plural(S.photos.length, 'photo')}, ${plural(S.plantings.length, 'planting')}, ${plural(S.logs.length, 'check-in')}). Export a backup before switching phones or clearing the browser.</p>
    <div class="btn-row"><button class="btn" data-act="export">⬇︎ Export backup</button><button class="btn" data-act="import">⬆︎ Import backup</button></div>
    <div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="sample">Load sample garden</button>${S.plantings.some(p => p.sample) ? `<button class="btn ghost" data-act="clear-sample">Remove sample data</button>` : ''}</div>
    <div class="btn-row" style="margin-top:8px"><button class="btn danger" data-act="wipe">Erase everything</button></div>
  </div>
  <div class="card"><h2>Install on your phone</h2>
    <p class="hint">iPhone: open this site in Safari → Share → <b>Add to Home Screen</b>. Android: Chrome menu → <b>Install app</b>. It then opens full-screen and works offline in the garden (weather needs a signal).</p>
  </div>
  <div class="card"><h2>About</h2>
    <p class="hint">Master Gardener v${APP_VERSION}. Grid orientation: row 1 is the north edge of the bed, column 1 is the west edge. Days-to-maturity defaults come from common seed-packet figures for each variety; edit them per planting. Growing degree days use base ${''}50°F for warm crops and 40°F for cool crops from Open-Meteo daily highs and lows.</p>
  </div>`;
}

/* ---------- sheets ---------- */
function openSheet(html) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog"><div class="sheet-handle"></div>${html}</div>`;
  document.body.style.overflow = 'hidden';
}
function closeSheet() { $('#sheet-root').innerHTML = ''; document.body.style.overflow = ''; }
const xBtn = `<button class="icon-btn x" data-act="close-sheet" aria-label="Close">✕</button>`;

let F = null; // planting form draft
function deriveDtm(crop, varietyName, method) {
  if (crop.stages === 'perennial') return 0;
  const v = (crop.varieties || []).find(x => x.name === varietyName);
  let dtm = v && v.dtm ? v.dtm : crop.dtm;
  if (method === 'seed' && crop.from === 'transplant') dtm += crop.s2t || 0;
  if (method === 'transplant' && crop.from === 'seed') dtm = Math.max(7, dtm - 14);
  return dtm;
}
function plantingForm(bedId, existing, presetCell) {
  const bed = bedById(bedId);
  F = existing ? { ...existing, cells: [...existing.cells], dtmManual: true } : { id: uid(), bedId, cropKey: '', variety: '', plantedAt: isoDate(new Date()), method: 'transplant', dtm: 0, cells: presetCell != null ? [presetCell] : [], status: 'active', notes: '', createdAt: new Date().toISOString(), dtmManual: false };
  openSheet(`<h3>${existing ? 'Edit planting' : 'Plant something'} ${xBtn}</h3>
    <label class="field"><span>Crop</span><input id="crop-search" placeholder="Search crops…" autocomplete="off"></label>
    <div class="crop-list" id="crop-list"></div>
    <div id="variety-area"></div>
    <label class="field"><span>Variety (optional)</span><input id="f-variety" value="${esc(F.variety)}" placeholder="e.g. Roma"></label>
    <div class="row" style="margin-bottom:12px"><div class="grow"><span class="hint" style="display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--ink2)">Started as</span><div class="seg"><button type="button" class="${F.method === 'transplant' ? 'on' : ''}" data-act="pick-method" data-m="transplant">Transplant</button><button type="button" class="${F.method === 'seed' ? 'on' : ''}" data-act="pick-method" data-m="seed">Direct seed</button></div></div></div>
    <div class="row"><label class="field grow"><span>Planted on</span><input id="f-date" type="date" value="${esc(F.plantedAt)}"></label><label class="field grow"><span>Days to harvest</span><input id="f-dtm" type="number" min="0" max="400" value="${F.dtm}"></label></div>
    <p class="hint" id="dtm-hint" style="margin:-6px 0 12px"></p>
    <span class="hint" style="display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--ink2)">Where in ${esc(bed.name)} (tap cells)</span>
    <div class="mini-wrap"><span></span><span class="compass">N</span><span></span><span class="compass">W</span><div class="mini-grid" id="mini-grid" style="grid-template-columns:repeat(${bed.cols},1fr)"></div><span class="compass">E</span><span></span><span class="compass">S</span><span></span></div>
    <label class="field"><span>Notes</span><textarea id="f-notes" placeholder="Where the seed came from, spacing, anything to remember">${esc(F.notes || '')}</textarea></label>
    <div class="btn-row"><button class="btn primary" data-act="save-planting">Save</button>${existing ? `<button class="btn danger" data-act="delete-planting" data-id="${existing.id}">Delete</button>` : ''}</div>`);
  const search = $('#crop-search');
  search.addEventListener('input', () => renderCropList(search.value));
  renderCropList('');
  renderVarieties(); renderMiniGrid(); updateDtmHint();
  $('#f-variety').addEventListener('input', e => { F.variety = e.target.value; });
  $('#f-date').addEventListener('change', e => { F.plantedAt = e.target.value; });
  $('#f-dtm').addEventListener('input', e => { F.dtm = +e.target.value || 0; F.dtmManual = true; updateDtmHint(); });
  $('#f-notes').addEventListener('input', e => { F.notes = e.target.value; });
  if (!existing) setTimeout(() => search.focus(), 50);
}
function renderCropList(q) {
  const list = $('#crop-list'); if (!list) return;
  const ql = q.trim().toLowerCase();
  const items = CROPS.filter(c => !ql || c.name.toLowerCase().includes(ql) || c.varieties.some(v => v.name.toLowerCase().includes(ql)) || CROP_GROUPS[c.group].name.toLowerCase().includes(ql));
  list.innerHTML = items.map(c => `<button type="button" class="crop-item ${F.cropKey === c.key ? 'on' : ''}" data-act="pick-crop" data-key="${c.key}"><span class="em">${c.emoji}</span><span>${esc(c.name)}</span></button>`).join('') || `<p class="hint">No match. Pick “Other / custom”.</p>`;
}
function renderVarieties() {
  const area = $('#variety-area'); if (!area) return;
  const crop = F.cropKey ? cropByKey(F.cropKey) : null;
  if (!crop || !crop.varieties.length) { area.innerHTML = ''; return; }
  area.innerHTML = `<div class="variety-chips">` + crop.varieties.map(v => `<button type="button" class="chip ${F.variety === v.name ? 'on' : ''}" data-act="pick-variety" data-name="${esc(v.name)}">${esc(v.name)}${v.dtm ? ` <span class="mono">${v.dtm}d</span>` : ''}</button>`).join('') + `</div>`;
}
function renderMiniGrid() {
  const g = $('#mini-grid'); if (!g) return;
  const bed = bedById(F.bedId);
  const taken = new Map(); plantingsOf(bed.id).filter(p => p.status === 'active' && p.id !== F.id).forEach(p => p.cells.forEach(c => taken.set(c, p)));
  const crop = F.cropKey ? cropByKey(F.cropKey) : null;
  g.innerHTML = Array.from({ length: bed.rows * bed.cols }, (_, i) => {
    const t = taken.get(i); const mine = F.cells.includes(i);
    const color = t ? CROP_GROUPS[cropByKey(t.cropKey).group].color : crop ? CROP_GROUPS[crop.group].color : null;
    return `<button type="button" class="${mine ? 'on mine' : t ? 'taken' : ''}" style="${color ? `--c:${color}` : ''}" data-act="toggle-cell" data-idx="${i}" title="${t ? esc(t.variety || cropByKey(t.cropKey).name) : `Cell ${i + 1}`}">${mine ? (crop ? crop.emoji : '✓') : t ? cropByKey(t.cropKey).emoji : ''}</button>`;
  }).join('');
}
function updateDtmHint() {
  const el = $('#dtm-hint'); if (!el) return;
  const crop = F.cropKey ? cropByKey(F.cropKey) : null;
  if (!crop) { el.textContent = 'Pick a crop to fill in a default.'; return; }
  if (crop.stages === 'perennial') { el.textContent = 'Perennial: no harvest countdown, just age.'; return; }
  const planted = parseISO(F.plantedAt) || new Date();
  const eta = addDays(planted, F.dtm || 0);
  el.textContent = `${crop.from === 'transplant' ? 'Packet days count from transplant' : 'Packet days count from sowing'}${F.method === 'seed' && crop.from === 'transplant' ? ` (+${crop.s2t || 0} d added for starting from seed)` : ''}. First harvest ≈ ${fmtDateY(eta)}.`;
}

function logForm(plantingId) {
  const p = plantingById(plantingId); const crop = cropByKey(p.cropKey);
  const L = { id: uid(), plantingId, bedId: p.bedId, at: new Date().toISOString(), health: 0, flags: [], note: '' };
  openSheet(`<h3>${crop.emoji} Check-in · ${esc(p.variety || crop.name)} ${xBtn}</h3>
    <span class="hint" style="display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--ink2)">How is it doing?</span>
    <div class="health-picker" id="health-picker">${[1, 2, 3, 4, 5].map(h => `<button type="button" data-act="pick-health" data-h="${h}" title="${h}/5">${HEALTH[h]}<div class="hint">${h}</div></button>`).join('')}</div>
    <div class="flag-picker" id="flag-picker">${FLAGS.map(([k, l]) => `<button type="button" class="chip" data-act="toggle-flag" data-k="${k}">${l}</button>`).join('')}</div>
    <label class="field"><span>Note</span><textarea id="l-note" placeholder="What you saw: new flowers, pests, wilting, first fruit…"></textarea></label>
    <label class="field"><span>When</span><input id="l-at" type="datetime-local" value="${toLocalDT(new Date())}"></label>
    <div class="btn-row"><button class="btn primary" data-act="save-log">Save check-in</button></div>`);
  const root = $('#sheet-root');
  root._log = L;
  $('#l-note').addEventListener('input', e => { L.note = e.target.value; });
  $('#l-at').addEventListener('change', e => { const d = new Date(e.target.value); if (!isNaN(d)) L.at = d.toISOString(); });
}

function plantingSheet(id) {
  const p = plantingById(id); if (!p) return;
  const st = statsFor(p, new Date()); const bed = bedById(p.bedId); const crop = st.crop;
  const gdd = gddFor(p, st);
  const flags = p.status === 'active' ? [...st.attention, ...weatherFlagsFor(p, st)] : [];
  const pct = st.perennial ? 100 : clamp(st.progress * 100, 0, 100);
  const meterClass = st.sev === 'good' ? '' : st.sev === 'warn' ? 'warn' : st.sev === 'serious' ? 'serious' : 'critical';
  openSheet(`<h3><span>${crop.emoji}</span><span class="grow">${esc(p.variety || crop.name)} ${p.variety ? `<small style="color:var(--ink2);font-weight:500">${esc(crop.name)}</small>` : ''}</span>${xBtn}</h3>
    <div class="row wrap" style="margin-bottom:10px"><span class="badge" style="border-color:${st.color};color:var(--ink)"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:${st.color};display:inline-block"></span> ${esc(bed ? bed.name : '')}</span><span class="badge">${plural(p.cells.length, 'cell')}</span><span class="badge ${sevClass(st.sev)}">${esc(st.stage)}</span>${p.status !== 'active' ? `<span class="badge">${p.status}</span>` : ''}</div>
    ${p.status === 'active' ? `<div class="meter" style="margin:0 0 12px"><i class="${meterClass}" style="width:${pct.toFixed(1)}%"></i></div>` : ''}
    <dl class="kv" style="margin-bottom:12px">
      <dt>Planted</dt><dd>${fmtDateY(st.planted)} · ${p.method === 'seed' ? 'direct seeded' : 'transplanted'} · <b>day ${st.days}</b></dd>
      ${st.perennial ? '' : `<dt>First harvest</dt><dd>≈ ${fmtDateY(st.eta)} (${st.left > 0 ? relDays(st.left) : st.progress < 1.3 ? 'in the window now' : `${-st.left} d past`}) · ${st.dtm} days total</dd>`}
      ${st.fruitDay != null ? `<dt>Fruit set</dt><dd>≈ ${fmtDateY(addDays(st.planted, st.fruitDay))} (${st.fruitLeft > 0 ? relDays(st.fruitLeft) : 'should be underway'})</dd>` : ''}
      ${gdd && gdd.covered ? `<dt>Heat units</dt><dd class="mono">${gdd.gdd} GDD (base ${crop.base}°F)${crop.gdd ? ` · typical ${crop.gdd[0]}–${crop.gdd[1]} to harvest` : ''}${gdd.covered < gdd.total ? ` · ${gdd.total - gdd.covered} d missing` : ''}</dd>` : ''}
      <dt>Last check-in</dt><dd>${st.last ? `${HEALTH[st.last.health]} ${st.last.health}/5 · ${fmtDate(parseISO(st.last.at))} (${relDays(-st.sinceLog)})` : 'none yet'}</dd>
      ${p.notes ? `<dt>Notes</dt><dd>${esc(p.notes)}</dd>` : ''}
    </dl>
    ${flags.length ? `<div class="flags" style="margin:0 0 12px">${flags.map(f => `<div class="flag ${sevClass(f.sev)}"><span class="fi">${f.sev === 'critical' ? '⛔' : f.sev === 'serious' ? '⚠️' : '△'}</span><div>${esc(f.text)}</div></div>`).join('')}</div>` : ''}
    <div class="btn-row">${p.status === 'active' ? `<button class="btn primary" data-act="log" data-id="${p.id}">📝 Check-in</button>` : ''}<button class="btn" data-act="edit-planting" data-id="${p.id}">Edit</button>${p.status === 'active' ? `<button class="btn" data-act="finish-planting" data-id="${p.id}" data-status="harvested">🧺 Harvested</button><button class="btn ghost" data-act="finish-planting" data-id="${p.id}" data-status="removed">Pulled</button>` : `<button class="btn" data-act="reactivate-planting" data-id="${p.id}">Reactivate</button>`}</div>
    ${crop.tips && crop.tips.length ? `<details style="margin-top:12px"><summary class="hint" style="cursor:pointer">Tips for ${esc(crop.name.toLowerCase())}</summary><ul class="tips">${crop.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
    ${st.logs.length ? `<div class="section"><h2>Check-ins</h2></div>${st.logs.length >= 2 ? sparkline(st.logs) : ''}<div class="log-list">${st.logs.slice(0, 12).map(l => `<div class="log-item"><div class="h">${HEALTH[l.health] || '📝'}</div><div><div class="when">${fmtDT(new Date(l.at))}${l.flags && l.flags.length ? ' · ' + l.flags.map(k => (FLAGS.find(f => f[0] === k) || [k, k])[1]).join(', ') : ''}</div>${l.note ? esc(l.note) : ''}</div></div>`).join('')}</div>` : ''}`);
}

function photoSheet(id) {
  const ph = S.photos.find(p => p.id === id); if (!ph) return;
  openSheet(`<h3>Photo details ${xBtn}</h3>
    <label class="field"><span>Taken</span><input id="ph-at" type="datetime-local" value="${toLocalDT(new Date(ph.takenAt))}"></label>
    <label class="field"><span>Note</span><textarea id="ph-note" placeholder="Anything to remember about this shot">${esc(ph.note || '')}</textarea></label>
    <p class="hint" style="margin-bottom:10px">${ph.w}×${ph.h} · older photos show tags as of their date, so back-dating a photo places it correctly on the timeline.</p>
    <div class="btn-row"><button class="btn primary" data-act="save-photo" data-id="${ph.id}">Save</button><button class="btn" data-act="rotate-photo-sheet" data-id="${ph.id}">↻ Rotate 90°</button><button class="btn danger" data-act="delete-photo" data-id="${ph.id}">Delete photo</button></div>`);
}
function bedForm(existing) {
  const b = existing || { id: uid(), name: `Bed ${S.beds.length + 1}`, subtitle: '', rows: S.settings.rows, cols: S.settings.cols, sort: S.beds.length + 1, createdAt: new Date().toISOString() };
  openSheet(`<h3>${existing ? 'Bed settings' : 'New bed'} ${xBtn}</h3>
    <label class="field"><span>Name</span><input id="b-name" value="${esc(b.name)}"></label>
    <label class="field"><span>Description</span><input id="b-sub" value="${esc(b.subtitle || '')}" placeholder="e.g. Back bed by the fence"></label>
    <div class="row"><label class="field grow"><span>Rows (north → south)</span><input id="b-rows" type="number" min="1" max="8" value="${b.rows}"></label><label class="field grow"><span>Columns (west → east)</span><input id="b-cols" type="number" min="1" max="10" value="${b.cols}"></label></div>
    <p class="hint" style="margin-bottom:10px">A 4×7 ft bed maps well to 2 rows × 4 columns (cells ≈ 2 ft × 1.75 ft). Changing the grid keeps plantings whose cells still exist.</p>
    <div class="btn-row"><button class="btn primary" data-act="save-bed" data-id="${b.id}" data-new="${existing ? '' : '1'}">Save</button>${existing ? `<button class="btn danger" data-act="delete-bed" data-id="${b.id}">Delete bed</button>` : ''}</div>`);
  $('#sheet-root')._bed = b;
}

/* ---------- actions ---------- */
const ACT = {
  'close-sheet': () => closeSheet(),
  'open-bed': el => go(`#/bed/${el.dataset.id}`),
  'add-bed': () => bedForm(null),
  'edit-bed': el => bedForm(bedById(el.dataset.id)),
  'save-bed': async el => {
    const b = $('#sheet-root')._bed; const name = $('#b-name').value.trim(); if (!name) { toast('Give the bed a name'); return; }
    const rows = clamp(+$('#b-rows').value || 1, 1, 8), cols = clamp(+$('#b-cols').value || 1, 1, 10);
    const nb = { ...b, name, subtitle: $('#b-sub').value.trim(), rows, cols };
    if (!el.dataset.new && (rows !== b.rows || cols !== b.cols)) {
      for (const p of plantingsOf(b.id)) { const keep = p.cells.filter(i => i < rows * cols); if (keep.length !== p.cells.length) await savePlanting({ ...p, cells: keep }); }
    }
    await saveBed(nb); closeSheet(); toast('Bed saved'); render();
  },
  'delete-bed': async el => {
    const b = bedById(el.dataset.id); const n = plantingsOf(b.id).length + photosOf(b.id).length;
    if (!confirm(`Delete “${b.name}”${n ? ` and its ${plural(photosOf(b.id).length, 'photo')} and ${plural(plantingsOf(b.id).length, 'planting')}` : ''}? This cannot be undone.`)) return;
    for (const ph of photosOf(b.id)) await deletePhoto(ph.id);
    for (const p of plantingsOf(b.id)) { for (const l of logsOf(p.id)) await DB.del('logs', l.id); await DB.del('plantings', p.id); }
    S.logs = S.logs.filter(l => l.bedId !== b.id); S.plantings = S.plantings.filter(p => p.bedId !== b.id);
    await DB.del('beds', b.id); S.beds = S.beds.filter(x => x.id !== b.id);
    closeSheet(); toast('Bed deleted'); go('#/beds');
  },
  'take-photo': () => $('#file-camera').click(),
  'add-photo': () => $('#file-library').click(),
  'pick-photo': el => {
    const id = el.dataset.id;
    if (S.mode === 'compare') { if (id === 'map') return; const cur = currentPhoto(bedById(S.bedId)); if (cur && cur.id === id) return; S.compareId = id; render(); return; }
    S.photoId = id; S.selCell = null; S.mode = 'view'; S.alignDraft = null; render();
  },
  'align-start': () => { const bed = bedById(S.bedId); const ph = currentPhoto(bed); if (!ph) return; S.mode = 'align'; S.alignDraft = ph.quad.map(p => [...p]); S.alignFacing = ph.facing || 'N'; render(); },
  'align-reset': () => { S.alignDraft = facingQuad(defaultQuad(false), S.alignFacing || 'N'); render(); },
  'align-cancel': () => { S.mode = 'view'; S.alignDraft = null; S.alignFacing = null; render(); },
  'set-facing': el => { S.alignFacing = el.dataset.f; S.alignDraft = facingQuad(S.alignDraft || defaultQuad(false), S.alignFacing); render(); },
  'rotate-photo': el => rotatePhoto(el.dataset.id),
  'align-save': async () => {
    const bed = bedById(S.bedId); const ph = currentPhoto(bed); if (!ph || !S.alignDraft) return;
    await savePhoto({ ...ph, quad: S.alignDraft.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]), facing: S.alignFacing || ph.facing || 'N' });
    S.mode = 'view'; S.alignDraft = null; S.alignFacing = null; toast('Grid aligned'); render();
  },
  'compare-start': () => { S.mode = 'compare'; S.compareId = null; render(); },
  'compare-end': () => { S.mode = 'view'; S.compareId = null; render(); },
  'photo-info': el => photoSheet(el.dataset.id),
  'rotate-photo-sheet': async el => { closeSheet(); await rotatePhoto(el.dataset.id); toast('Rotated'); },
  'save-photo': async el => {
    const ph = S.photos.find(p => p.id === el.dataset.id); if (!ph) return;
    const d = new Date($('#ph-at').value); if (isNaN(d)) { toast('Enter a valid date'); return; }
    await savePhoto({ ...ph, takenAt: d.toISOString(), note: $('#ph-note').value.trim() }); closeSheet(); toast('Photo updated'); render();
  },
  'delete-photo': async el => {
    if (!confirm('Delete this photo? Tags stay with the bed; only the picture goes.')) return;
    await deletePhoto(el.dataset.id); if (S.photoId === el.dataset.id) S.photoId = null; closeSheet(); toast('Photo deleted'); render();
  },
  'cell': el => {
    if (S.mode !== 'view') return;
    const idx = +el.dataset.idx; const bed = bedById(S.bedId); const ph = currentPhoto(bed); const asOf = asOfFor(bed, ph);
    const owner = plantingsOf(bed.id).find(p => activeAt(p, asOf) && p.cells.includes(idx));
    if (owner) plantingSheet(owner.id); else plantingForm(bed.id, null, idx);
  },
  'open-planting': el => plantingSheet(el.dataset.id),
  'new-planting': el => plantingForm(el.dataset.bed, null, null),
  'edit-planting': el => { const p = plantingById(el.dataset.id); closeSheet(); plantingForm(p.bedId, p, null); },
  'pick-crop': el => {
    const crop = cropByKey(el.dataset.key); F.cropKey = crop.key;
    if (!F.dtmManual) { F.dtm = deriveDtm(crop, F.variety, F.method); $('#f-dtm').value = F.dtm; }
    if (crop.stages === 'perennial') { F.dtm = 0; $('#f-dtm').value = 0; }
    $$('#crop-list .crop-item').forEach(b => b.classList.toggle('on', b.dataset.key === crop.key));
    renderVarieties(); renderMiniGrid(); updateDtmHint();
  },
  'pick-variety': el => {
    F.variety = F.variety === el.dataset.name ? '' : el.dataset.name; $('#f-variety').value = F.variety;
    const crop = cropByKey(F.cropKey); F.dtmManual = false; F.dtm = deriveDtm(crop, F.variety, F.method); $('#f-dtm').value = F.dtm;
    renderVarieties(); updateDtmHint();
  },
  'pick-method': el => {
    F.method = el.dataset.m; $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.m === F.method));
    if (F.cropKey && !F.dtmManual) { F.dtm = deriveDtm(cropByKey(F.cropKey), F.variety, F.method); $('#f-dtm').value = F.dtm; }
    updateDtmHint();
  },
  'toggle-cell': el => {
    if (el.classList.contains('taken')) { toast('That cell already has an active planting'); return; }
    const i = +el.dataset.idx; F.cells = F.cells.includes(i) ? F.cells.filter(x => x !== i) : [...F.cells, i].sort((a, b) => a - b); renderMiniGrid();
  },
  'save-planting': async () => {
    if (!F.cropKey) { toast('Pick a crop first'); return; }
    if (!F.cells.length) { toast('Tap at least one cell on the bed plan'); return; }
    if (!parseISO(F.plantedAt)) { toast('Enter the planting date'); return; }
    const crop = cropByKey(F.cropKey);
    const p = { id: F.id, bedId: F.bedId, cropKey: F.cropKey, variety: (F.variety || '').trim(), plantedAt: F.plantedAt, method: F.method, dtm: crop.stages === 'perennial' ? 0 : Math.max(0, +F.dtm || 0), cells: F.cells, status: F.status || 'active', endedAt: F.endedAt || null, notes: (F.notes || '').trim(), sample: F.sample || false, createdAt: F.createdAt || new Date().toISOString() };
    await savePlanting(p); closeSheet(); toast(`${crop.emoji} ${p.variety || crop.name} saved`); render(); loadWeather(false);
  },
  'delete-planting': async el => {
    if (!confirm('Delete this planting and its check-ins?')) return;
    for (const l of logsOf(el.dataset.id)) await DB.del('logs', l.id);
    S.logs = S.logs.filter(l => l.plantingId !== el.dataset.id);
    await DB.del('plantings', el.dataset.id); S.plantings = S.plantings.filter(p => p.id !== el.dataset.id);
    closeSheet(); toast('Planting deleted'); render();
  },
  'finish-planting': async el => {
    const p = plantingById(el.dataset.id); await savePlanting({ ...p, status: el.dataset.status, endedAt: isoDate(new Date()) });
    closeSheet(); toast(el.dataset.status === 'harvested' ? '🧺 Marked harvested' : 'Marked pulled'); render();
  },
  'reactivate-planting': async el => { const p = plantingById(el.dataset.id); await savePlanting({ ...p, status: 'active', endedAt: null }); closeSheet(); render(); },
  'log': el => logForm(el.dataset.id),
  'pick-health': el => { const L = $('#sheet-root')._log; L.health = +el.dataset.h; $$('#health-picker button').forEach(b => b.classList.toggle('on', +b.dataset.h === L.health)); },
  'toggle-flag': el => { const L = $('#sheet-root')._log; const k = el.dataset.k; L.flags = L.flags.includes(k) ? L.flags.filter(x => x !== k) : [...L.flags, k]; el.classList.toggle('on', L.flags.includes(k)); },
  'save-log': async () => {
    const L = $('#sheet-root')._log; if (!L.health) { toast('Rate it 1–5 first'); return; }
    await saveLog(L); const id = L.plantingId; closeSheet(); toast('Check-in saved'); render(); plantingSheet(id);
  },
  'refresh-wx': () => { toast('Refreshing weather…'); loadWeather(true); },
  'use-location': () => {
    if (!navigator.geolocation) { toast('Geolocation not available'); return; }
    navigator.geolocation.getCurrentPosition(pos => { $('input[name=lat]').value = pos.coords.latitude.toFixed(4); $('input[name=lon]').value = pos.coords.longitude.toFixed(4); toast('Location filled in. Save to apply.'); }, () => toast('Could not get location'));
  },
  'export': () => exportData(),
  'import': () => $('#file-import').click(),
  'sample': async () => { await loadSample(); toast('Sample garden loaded. Remove it any time from Settings.'); render(); loadWeather(true); },
  'clear-sample': async () => {
    const ids = new Set(S.plantings.filter(p => p.sample).map(p => p.id));
    for (const l of S.logs.filter(l => ids.has(l.plantingId))) await DB.del('logs', l.id);
    for (const id of ids) await DB.del('plantings', id);
    S.logs = S.logs.filter(l => !ids.has(l.plantingId)); S.plantings = S.plantings.filter(p => !p.sample);
    toast('Sample data removed'); render();
  },
  'wipe': async () => {
    if (!confirm('Erase ALL beds, photos, plantings, and check-ins on this device?')) return;
    if (!confirm('Last chance. Did you export a backup first?')) return;
    for (const s of DB.STORES) await DB.clear(s);
    S.urls.forEach(u => { URL.revokeObjectURL(u.full); URL.revokeObjectURL(u.thumb); }); S.urls.clear();
    S.beds = []; S.photos = []; S.plantings = []; S.logs = []; S.wx = null; await seedBeds(); toast('Erased'); go('#/beds');
  },
};

async function exportData() {
  toast('Preparing backup…');
  const toDataURL = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  const photos = [];
  for (const p of S.photos) { const b = await DB.get('blobs', p.id); photos.push({ ...p, full: b ? await toDataURL(b.full) : null, thumb: b && b.thumb ? await toDataURL(b.thumb) : null }); }
  const data = { app: 'master-gardener', version: APP_VERSION, exportedAt: new Date().toISOString(), settings: S.settings, beds: S.beds, plantings: S.plantings, logs: S.logs, photos };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `master-gardener-${isoDate(new Date())}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`Backup ready: ${plural(photos.length, 'photo')}, ${plural(S.plantings.length, 'planting')}`);
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'master-gardener') throw new Error('Not a Master Gardener backup');
    if (!confirm(`Import ${plural((data.beds || []).length, 'bed')}, ${plural((data.plantings || []).length, 'planting')}, ${plural((data.photos || []).length, 'photo')}? Existing items with the same id are replaced.`)) return;
    toast('Importing…');
    await DB.putMany('beds', data.beds || []); await DB.putMany('plantings', data.plantings || []); await DB.putMany('logs', data.logs || []);
    for (const p of data.photos || []) {
      const { full, thumb, ...meta } = p;
      if (full) { const fb = await (await fetch(full)).blob(); const tb = thumb ? await (await fetch(thumb)).blob() : fb; await DB.put('blobs', { id: meta.id, full: fb, thumb: tb }); }
      await DB.put('photos', meta);
    }
    if (data.settings) await DB.setSetting('settings', { ...DEFAULT_SETTINGS, ...data.settings });
    S.urls.forEach(u => { URL.revokeObjectURL(u.full); URL.revokeObjectURL(u.thumb); }); S.urls.clear();
    await loadAll(); toast('Import complete'); render(); loadWeather(true);
  } catch (e) { console.error(e); toast(`Import failed: ${e.message}`); }
}
async function loadSample() {
  if (S.beds.length < 3) { while (S.beds.length < 3) { const n = S.beds.length + 1; await saveBed({ id: uid(), name: `Bed ${n}`, subtitle: '', rows: 2, cols: 4, sort: n, createdAt: new Date().toISOString() }); } }
  const [b1, b2, b3] = S.beds;
  const today = new Date(); const now = today.toISOString();
  const mk = (bed, cropKey, variety, daysAgo, method, cells, dtm) => ({ id: uid(), bedId: bed.id, cropKey, variety, plantedAt: isoDate(addDays(today, -daysAgo)), method, dtm, cells, status: 'active', endedAt: null, notes: 'Sample planting', sample: true, createdAt: now });
  const cols = b => Math.min(b.cols, 4), cell = (b, r, c) => Math.min(r, b.rows - 1) * b.cols + Math.min(c, b.cols - 1);
  const ps = [
    mk(b3, 'tomato', 'Roma', 78, 'transplant', [cell(b3, 0, 0), cell(b3, 0, 1), cell(b3, 0, 2), cell(b3, 0, 3)].slice(0, cols(b3)), 85),
    mk(b3, 'pepper', 'Jalapeño Early', 70, 'transplant', [cell(b3, 1, 0), cell(b3, 1, 1)], 65),
    mk(b3, 'pepper', 'Bell', 70, 'transplant', [cell(b3, 1, 2), cell(b3, 1, 3)], 75),
    mk(b2, 'zucchini', 'Black Beauty', 31, 'seed', [cell(b2, 0, 3), cell(b2, 1, 3)], 50),
    mk(b2, 'carrot', 'Danvers #126', 24, 'seed', [cell(b2, 0, 0), cell(b2, 0, 1)], 70),
    mk(b2, 'onion', 'Evergreen Bunching', 40, 'transplant', [cell(b2, 1, 0), cell(b2, 1, 1)], 65),
    mk(b1, 'broccoli', 'DeCicco', 12, 'transplant', [cell(b1, 0, 0), cell(b1, 0, 1), cell(b1, 0, 2)], 48),
    mk(b1, 'spinach', 'Butterflay', 6, 'seed', [cell(b1, 1, 0), cell(b1, 1, 1)], 45),
    mk(b1, 'blackberry', '', 730, 'transplant', [cell(b1, 0, 3), cell(b1, 1, 3)], 0),
  ];
  const seen = new Set(); for (const p of ps) { p.cells = Array.from(new Set(p.cells)).filter(c => !seen.has(c + ':' + p.bedId)); p.cells.forEach(c => seen.add(c + ':' + p.bedId)); if (p.cells.length) await savePlanting(p); }
  const logs = [];
  const add = (p, daysAgo, health, flags, note) => logs.push({ id: uid(), plantingId: p.id, bedId: p.bedId, at: addDays(today, -daysAgo).toISOString(), health, flags, note });
  add(ps[0], 40, 4, ['watered'], 'Flowering heavily, outgrew the cages'); add(ps[0], 26, 4, ['pruned'], 'Staked, pruned lowest leaves'); add(ps[0], 12, 3, ['fruit'], 'Blossom drop in the heat, fruit on lower trusses'); add(ps[0], 3, 4, ['harvested'], 'First ripe Romas');
  add(ps[1], 30, 3, [], 'A bit leggy'); add(ps[1], 16, 4, ['pruned'], 'Topped one plant to compare'); add(ps[1], 2, 5, ['fruit'], 'Loaded with pods');
  add(ps[2], 30, 3, ['pests'], 'Flea beetle holes, cosmetic'); add(ps[2], 9, 4, ['flowering'], 'Compact and flowering');
  add(ps[3], 14, 4, ['watered'], 'Vigorous, no frass at the base'); add(ps[3], 5, 5, ['flowering'], 'First blooms');
  add(ps[4], 10, 3, ['watered'], 'Germination patchy on the east end');
  add(ps[5], 20, 4, [], ''); add(ps[6], 4, 4, ['watered'], 'Settled in after transplant');
  add(ps[8], 60, 4, ['pruned'], 'Cut spent floricanes');
  for (const l of logs) await saveLog(l);
}

/* ---------- align-mode dragging & compare slider ---------- */
function afterRender() {
  const stage = $('#stage');
  if (stage && S.mode === 'align') {
    let drag = null;
    const norm = ev => { const r = stage.getBoundingClientRect(); return [clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)]; };
    stage.addEventListener('pointerdown', ev => {
      const h = ev.target.closest('.handle-dot'); if (!h) return;
      drag = +h.dataset.corner; h.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    stage.addEventListener('pointermove', ev => {
      if (drag == null) return; S.alignDraft[drag] = norm(ev); redrawAlign(stage);
    });
    const end = () => { drag = null; };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  }
  const range = $('#cmp-range');
  if (range) {
    const apply = () => { const v = +range.value; $('#cmp-top').style.clipPath = `inset(0 ${100 - v}% 0 0)`; $('#cmp-div').style.left = `${v}%`; };
    range.addEventListener('input', apply); apply();
  }
}
function redrawAlign(stage) {
  const bed = bedById(S.bedId); const q = S.alignDraft; const H = homography(q);
  const svg = $('svg.overlay', stage);
  let polys = `<polygon class="frame" points="${pts(q)}"></polygon>`;
  for (let r = 0; r < bed.rows; r++) for (let c = 0; c < bed.cols; c++) polys += `<polygon class="cell" points="${pts(cellPoly(H, bed.rows, bed.cols, r, c))}"></polygon>`;
  svg.innerHTML = polys;
  $$('.handle-dot', stage).forEach((h, i) => { h.style.left = `${(q[i][0] * 100).toFixed(2)}%`; h.style.top = `${(q[i][1] * 100).toFixed(2)}%`; });
  const mids = [H(0.5, 0), H(0.5, 1), H(0, 0.5), H(1, 0.5)];
  $$('.compass-lbl', stage).forEach((el, i) => { el.style.left = `${(mids[i][0] * 100).toFixed(2)}%`; el.style.top = `${(mids[i][1] * 100).toFixed(2)}%`; });
}

/* ---------- global wiring ---------- */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  ev.preventDefault();
  Promise.resolve(fn(el, ev)).catch(e => { console.error(e); toast(`Something went wrong: ${e.message}`); });
});
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'settings-form') return;
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const s = { ...S.settings, place: (fd.get('place') || '').trim(), lat: +fd.get('lat') || DEFAULT_SETTINGS.lat, lon: +fd.get('lon') || DEFAULT_SETTINGS.lon, firstFrost: (fd.get('firstFrost') || '').trim(), lastFrost: (fd.get('lastFrost') || '').trim(), rows: clamp(+fd.get('rows') || 2, 1, 8), cols: clamp(+fd.get('cols') || 4, 1, 10) };
  S.settings = s; await DB.setSetting('settings', s); toast('Settings saved'); loadWeather(true);
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && $('#sheet-root').firstChild) closeSheet(); });
$$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.tab === 'beds' ? '#/beds' : `#/${t.dataset.tab}`)));
$('#back-btn').addEventListener('click', () => go('#/beds'));
$('#file-camera').addEventListener('change', e => { importFiles(e.target.files, S.bedId); e.target.value = ''; });
$('#file-library').addEventListener('change', e => { importFiles(e.target.files, S.bedId); e.target.value = ''; });
$('#file-import').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
const main = $('#view');
['dragenter', 'dragover'].forEach(t => main.addEventListener(t, e => { e.preventDefault(); main.classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(t => main.addEventListener(t, e => { e.preventDefault(); main.classList.remove('drag-over'); }));
main.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { if (S.view !== 'bed') { toast('Open a bed first, then drop photos on it'); return; } importFiles(e.dataTransfer.files, S.bedId); } });
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { if (S.view === 'bed') render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); loadWeather(false); } });

(async function boot() {
  try { await loadAll(); }
  catch (e) { console.error(e); $('#view').innerHTML = `<div class="empty"><strong>Storage unavailable</strong>${esc(e.message)}. Private browsing on some phones blocks IndexedDB.</div>`; return; }
  route();
  loadWeather(false);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
