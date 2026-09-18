/* app.js — Master Gardener: photo-mapped garden beds, harvest countdowns, check-ins, weather analytics.
   Vanilla JS, no build step. Data lives in IndexedDB on this device; export/import JSON to move it. */
(() => {
'use strict';

const APP_VERSION = '1.9.0';

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
  beds: [], photos: [], plantings: [], logs: [], shots: [], settings: { ...DEFAULT_SETTINGS },
  wx: null, wxErr: null, wxLoading: false, urls: new Map(), renderToken: 0,
  gardenZoom: 1, gardenArrange: false, shotBed: null, shotPlanting: null,
  scrub: null, playing: false, playTimer: null,
};
const HEALTH = ['', '😟', '😕', '😐', '🙂', '🤩'];
const FLAGS = [['watered', '💧 Watered'], ['fertilized', '🧪 Fertilized'], ['pests', '🐛 Pests'], ['disease', '🍂 Disease'], ['flowering', '🌸 Flowering'], ['fruit', '🍅 Fruit set'], ['harvested', '🧺 Harvested some'], ['pruned', '✂️ Pruned']];

const bedById = id => S.beds.find(b => b.id === id);
const bedAt = i => S.beds[((i % S.beds.length) + S.beds.length) % S.beds.length];
const stepBed = d => { const i = S.beds.findIndex(b => b.id === S.bedId); if (i < 0 || S.beds.length < 2) return; go(`#/bed/${bedAt(i + d).id}`); };
const photosOf = bedId => S.photos.filter(p => p.bedId === bedId).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
const latestPhoto = bedId => { const ps = photosOf(bedId); return ps.length ? ps[ps.length - 1] : null; };
const plantingsOf = bedId => S.plantings.filter(p => p.bedId === bedId);
const logsOf = pid => S.logs.filter(l => l.plantingId === pid).sort((a, b) => b.at.localeCompare(a.at));
const shotsOf = bedId => S.shots.filter(s => s.bedId === bedId).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
const shotsOfPlanting = pid => S.shots.filter(s => s.plantingId === pid).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
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
    const recent = shotsOfPlanting(p.id).filter(s => daysBetween(new Date(s.takenAt), asOf) <= 14 && (s.symptoms || []).length)[0];
    if (recent) { const f = shotFindings(recent, null)[0]; if (f && f.sev !== 'good') attention.push({ sev: f.sev, text: `${f.title} (close-up ${fmtDate(new Date(recent.takenAt))})`, shotId: recent.id }); }
    if (health != null && health <= 2) attention.push({ sev: 'critical', text: `Rated ${health}/5 at last check-in` });
    if (!perennial && progress >= 1.3) attention.push({ sev: 'serious', text: `Past its harvest window by ${days - dtm} d` });
    if (sinceLog != null && sinceLog >= 14) attention.push({ sev: 'warn', kind: 'stale-log', text: `No check-in for ${sinceLog} d` });
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
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const norm360 = d => ((d % 360) + 360) % 360;
const dirName = deg => DIRS[Math.round(norm360(deg) / 45) % 8];
const dirDeg = name => Math.max(0, DIRS.indexOf(name)) * 45;
/* A bed's plan has a top edge (row 0), right edge (last column), bottom and left. `heading` is the compass
   direction the top edge faces (0 = north, 90 = east). Edge and corner labels follow it. */
const bedHeading = bed => norm360(+bed.heading || 0);
const edgeNames = bed => { const h = bedHeading(bed); return { top: dirName(h), right: dirName(h + 90), bottom: dirName(h + 180), left: dirName(h + 270) }; };
const cornerNames = bed => { const h = bedHeading(bed); return [dirName(h + 315), dirName(h + 45), dirName(h + 135), dirName(h + 225)]; }; // TL, TR, BR, BL of the plan
const isMasked = (bed, idx) => Array.isArray(bed.mask) && bed.mask.includes(idx);
const bedCellCount = bed => bed.rows * bed.cols - (bed.mask ? bed.mask.filter(i => i < bed.rows * bed.cols).length : 0);
/* Camera-facing relative to the bed: looking along the top edge's direction means the plan's top-left corner is the far-left of the photo. */
const REL = { 0: ['TL', 'TR', 'BR', 'BL'], 180: ['BR', 'BL', 'TL', 'TR'], 90: ['BL', 'TL', 'TR', 'BR'], 270: ['TR', 'BR', 'BL', 'TL'] };
function facingQuad(quad, facing, bed) {
  const sorted = [...quad].sort((a, b) => a[1] - b[1]);
  const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]), bot = sorted.slice(2).sort((a, b) => a[0] - b[0]);
  const g = { TL: top[0], TR: top[1], BL: bot[0], BR: bot[1] };
  const rel = Math.round(norm360(dirDeg(facing) - bedHeading(bed)) / 90) * 90 % 360;
  return (REL[rel] || REL[0]).map(k => [...g[k]]);
}
/* Plan view: the bed rectangle drawn north-up, rotated by its heading and fitted into the square stage. */
function planQuad(bed) {
  const th = bedHeading(bed) * Math.PI / 180;
  const real = bed.lengthFt > 0 && bed.widthFt > 0;
  const L = real ? bed.lengthFt : bed.cols, Wd = real ? bed.widthFt : bed.rows;
  const c = Math.cos(th), s = Math.sin(th);
  const rot = [[-L / 2, -Wd / 2], [L / 2, -Wd / 2], [L / 2, Wd / 2], [-L / 2, Wd / 2]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const xs = rot.map(p => p[0]), ys = rot.map(p => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  const k = 0.82 / span;
  return rot.map(([x, y]) => [0.5 + x * k, 0.5 + y * k]);
}
/* Garden map geometry: north-up schematic, beds axis-aligned to the nearest quarter turn of their heading.
   k = quarter turns clockwise. Plan cell (r,c) -> screen cell (sr,sc). */
const bedTurns = bed => Math.round(bedHeading(bed) / 90) % 4;
function bedFootprint(bed) {
  const L = bed.lengthFt > 0 ? bed.lengthFt : bed.cols * 2, Wd = bed.widthFt > 0 ? bed.widthFt : bed.rows * 2;
  const k = bedTurns(bed);
  return k % 2 ? { w: Wd, h: L, k, scols: bed.rows, srows: bed.cols } : { w: L, h: Wd, k, scols: bed.cols, srows: bed.rows };
}
function toScreenCell(bed, k, r, c) {
  if (k === 1) return { sr: c, sc: bed.rows - 1 - r };
  if (k === 2) return { sr: bed.rows - 1 - r, sc: bed.cols - 1 - c };
  if (k === 3) return { sr: bed.cols - 1 - c, sc: r };
  return { sr: r, sc: c };
}
/* Whole-grid transforms in pixel space (normalized coords are not isotropic). rw/rh = stage size in px. */
function quadTransform(quad, rw, rh, fn) {
  const px = quad.map(([x, y]) => [x * rw, y * rh]);
  const cx = px.reduce((s, p) => s + p[0], 0) / 4, cy = px.reduce((s, p) => s + p[1], 0) / 4;
  return px.map(([x, y]) => fn(x - cx, y - cy)).map(([x, y]) => [clamp((x + cx) / rw, -0.25, 1.25), clamp((y + cy) / rh, -0.25, 1.25)]);
}
const rotateQuad = (quad, rw, rh, deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return quadTransform(quad, rw, rh, (x, y) => [x * c - y * s, x * s + y * c]); };
const scaleQuad = (quad, rw, rh, k) => quadTransform(quad, rw, rh, (x, y) => [x * k, y * k]);
const mirrorQuad = quad => [quad[1], quad[0], quad[3], quad[2]].map(p => [...p]);
const centroid = poly => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const pts = poly => poly.map(([x, y]) => `${(x * 1000).toFixed(1)},${(y * 1000).toFixed(1)}`).join(' ');

/* ---------- persistence ---------- */
async function loadAll() {
  const [beds, photos, plantings, logs, shots, settings] = await Promise.all([DB.all('beds'), DB.all('photos'), DB.all('plantings'), DB.all('logs'), DB.all('shots'), DB.setting('settings', null)]);
  S.beds = beds.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.createdAt.localeCompare(b.createdAt));
  S.photos = photos; S.plantings = plantings; S.logs = logs; S.shots = shots;
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!S.beds.length) await seedBeds();
  await ensureBedPositions();
}
/* Beds without a garden position get stacked in a column, highest bed number at the top (north). Drag to rearrange. */
async function ensureBedPositions() {
  const missing = S.beds.filter(b => !(Number.isFinite(b.x) && Number.isFinite(b.y)));
  if (!missing.length) return;
  const placed = S.beds.filter(b => Number.isFinite(b.x) && Number.isFinite(b.y));
  let y = placed.length ? Math.max(...placed.map(b => b.y + bedFootprint(b).h)) + 3 : 0;
  for (const b of missing.sort((a, c) => (c.sort ?? 0) - (a.sort ?? 0))) {
    const nb = { ...b, x: 0, y }; y += bedFootprint(nb).h + 3; await saveBed(nb);
  }
}
async function seedBeds() {
  const now = new Date().toISOString();
  const beds = [
    { id: uid(), name: 'Bed 1 · South', subtitle: 'Front bed: berries + cool season', rows: 2, cols: 4, lengthFt: 7, widthFt: 4, heading: 0, mask: [], x: 0, y: 14, sort: 1, createdAt: now },
    { id: uid(), name: 'Bed 2 · Middle', subtitle: 'Roots, bulbs, squash corner', rows: 2, cols: 4, lengthFt: 7, widthFt: 4, heading: 0, mask: [], x: 0, y: 7, sort: 2, createdAt: now },
    { id: uid(), name: 'Bed 3 · North', subtitle: 'Back bed by the fence: nightshades', rows: 2, cols: 4, lengthFt: 7, widthFt: 4, heading: 0, mask: [], x: 0, y: 0, sort: 3, createdAt: now },
  ];
  await DB.putMany('beds', beds); S.beds = beds;
}
async function savePlanting(p) { await DB.put('plantings', p); const i = S.plantings.findIndex(x => x.id === p.id); if (i >= 0) S.plantings[i] = p; else S.plantings.push(p); }
async function saveLog(l) { await DB.put('logs', l); const i = S.logs.findIndex(x => x.id === l.id); if (i >= 0) S.logs[i] = l; else S.logs.push(l); }
async function saveBed(b) { await DB.put('beds', b); const i = S.beds.findIndex(x => x.id === b.id); if (i >= 0) S.beds[i] = b; else S.beds.push(b); }
async function savePhoto(p) { await DB.put('photos', p); const i = S.photos.findIndex(x => x.id === p.id); if (i >= 0) S.photos[i] = p; else S.photos.push(p); }
async function saveShot(s) { await DB.put('shots', s); const i = S.shots.findIndex(x => x.id === s.id); if (i >= 0) S.shots[i] = s; else S.shots.push(s); }
async function deleteShot(id) {
  await DB.del('shots', id); await DB.del('blobs', id);
  S.shots = S.shots.filter(s => s.id !== id);
  const u = S.urls.get(id); if (u) { URL.revokeObjectURL(u.full); URL.revokeObjectURL(u.thumb); S.urls.delete(id); }
}
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
function processImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const full = drawScaled(img, max, 0.86), thumb = drawScaled(img, 360, 0.8);
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
/* Rotate pixels by an arbitrary angle (clockwise, degrees) into a canvas big enough to hold the whole turned image. */
async function rotateBlobDeg(blob, deg, q) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const t = deg * Math.PI / 180, W = img.naturalWidth, H = img.naturalHeight;
    const W2 = Math.ceil(Math.abs(W * Math.cos(t)) + Math.abs(H * Math.sin(t))), H2 = Math.ceil(Math.abs(W * Math.sin(t)) + Math.abs(H * Math.cos(t)));
    const c = document.createElement('canvas'); c.width = W2; c.height = H2;
    const g = c.getContext('2d'); g.fillStyle = '#EBE3D1'; g.fillRect(0, 0, W2, H2); // corners exposed by the turn
    g.translate(W2 / 2, H2 / 2); g.rotate(t); g.drawImage(img, -W / 2, -H / 2);
    const out = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', q));
    return { blob: out, W, H, W2, H2 };
  } finally { URL.revokeObjectURL(url); }
}
/* Straighten: the photo turns under the grid, the grid stays where it is on screen (its pixel offsets from the centre are kept). */
async function straightenPhoto(id, deg) {
  const ph = S.photos.find(p => p.id === id); const b = await DB.get('blobs', id); if (!ph || !b) return;
  toast('Straightening…');
  const full = await rotateBlobDeg(b.full, deg, 0.86), thumb = await rotateBlobDeg(b.thumb || b.full, deg, 0.8);
  await DB.put('blobs', { id, full: full.blob, thumb: thumb.blob });
  const u = S.urls.get(id); if (u) { URL.revokeObjectURL(u.full); URL.revokeObjectURL(u.thumb); S.urls.delete(id); }
  const keep = ([x, y]) => [+((full.W2 / 2 + (x - 0.5) * full.W) / full.W2).toFixed(4), +((full.H2 / 2 + (y - 0.5) * full.H) / full.H2).toFixed(4)];
  await savePhoto({ ...ph, w: full.W2, h: full.H2, quad: ph.quad.map(keep) });
  if (S.mode === 'align' && S.alignDraft) S.alignDraft = S.alignDraft.map(keep);
  render();
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

/* ---------- close-up shots ---------- */
let SF = null; // shot draft while tagging
async function importShots(files, bedId, plantingId) {
  const list = Array.from(files || []).filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length || !bedId) { if (!bedId) toast('Open a bed first'); return; }
  toast(`Processing ${plural(list.length, 'close-up')}…`);
  const made = [];
  for (const f of list) {
    try {
      const { full, thumb, w, h } = await processImage(f, 2000); // close-ups keep more detail than bed photos
      const id = uid();
      const takenAt = new Date(f.lastModified && f.lastModified > 0 ? f.lastModified : Date.now());
      const pl = plantingId ? plantingById(plantingId) : null;
      const shot = { id, bedId, plantingId: plantingId || null, cropKey: pl ? pl.cropKey : null, takenAt: takenAt.toISOString(), w, h, part: 'whole', symptoms: [], note: '', createdAt: new Date().toISOString() };
      await DB.put('blobs', { id, full, thumb });
      await saveShot(shot); made.push(shot);
    } catch (e) { console.error(e); toast(`Could not read ${f.name}`); }
  }
  render();
  if (made.length) shotTagForm(made[0].id, made.length > 1 ? made.map(s => s.id) : null);
}
function shotTagForm(id, batch) {
  const shot = S.shots.find(s => s.id === id); if (!shot) return;
  SF = { ...shot, symptoms: [...(shot.symptoms || [])], batch: batch || null };
  const bed = bedById(shot.bedId);
  const act = plantingsOf(shot.bedId).filter(p => p.status === 'active');
  const groups = [...new Set(SYMPTOMS.map(s => s.group))];
  const groupName = { leaf: 'Leaves', whole: 'Whole plant', stem: 'Stem', fruit: 'Fruit', soil: 'Soil' };
  openSheet(`<h3>Tag this close-up ${xBtn}</h3>
    <img id="shot-preview" class="shot-preview" alt="">
    <span class="hint fld">Which plant</span>
    <div class="variety-chips">${act.map(p => { const c = cropByKey(p.cropKey); return `<button type="button" class="chip ${SF.plantingId === p.id ? 'on' : ''}" data-act="shot-plant" data-id="${p.id}">${c.emoji} ${esc(p.variety || c.name)}</button>`; }).join('')}<button type="button" class="chip ${SF.plantingId ? '' : 'on'}" data-act="shot-plant" data-id="">🛏️ Whole bed / not sure</button></div>
    <span class="hint fld">What is in the frame</span>
    <div class="variety-chips">${SHOT_PARTS.map(pt => `<button type="button" class="chip ${SF.part === pt.key ? 'on' : ''}" data-act="shot-part" data-p="${pt.key}" title="${esc(pt.how)}">${pt.emoji} ${esc(pt.label)}</button>`).join('')}</div>
    <p class="hint" id="shot-part-how" style="margin:-6px 0 12px"></p>
    <span class="hint fld">What do you see? Tag anything that applies</span>
    ${groups.map(g => `<div class="variety-chips">${SYMPTOMS.filter(s => s.group === g).map(s => `<button type="button" class="chip ${SF.symptoms.includes(s.key) ? 'on' : ''}" data-act="shot-symptom" data-k="${s.key}">${s.emoji} ${esc(s.label)}</button>`).join('')}</div>`).join('')}
    <label class="field"><span>Note</span><textarea id="shot-note" placeholder="Anything the photo does not show: smell, texture, how fast it spread">${esc(SF.note || '')}</textarea></label>
    <div class="btn-row"><button class="btn primary" data-act="shot-save">Save${SF.batch ? ` (1 of ${SF.batch.length})` : ''}</button><button class="btn danger" data-act="shot-delete" data-id="${shot.id}">Delete</button></div>`);
  urlFor(shot.id, 'full').then(u => { const el = $('#shot-preview'); if (el) el.src = u; });
  $('#shot-note').addEventListener('input', e => { SF.note = e.target.value; });
  updatePartHow();
}
function updatePartHow() { const el = $('#shot-part-how'); if (!el || !SF) return; const pt = SHOT_PARTS.find(p => p.key === SF.part); el.textContent = pt ? pt.how : ''; }

/* ---------- Master Gardener context ---------- */
const FAMILY = g => (g === 'tomato' || g === 'pepper') ? 'nightshade' : g === 'cucurbit' ? 'squash family' : g === 'brassica' ? 'cabbage family' : null;
function rotationWarningFor(p) {
  const crop = cropByKey(p.cropKey), fam = FAMILY(crop.group);
  const planted = parseISO(p.plantedAt); if (!planted) return null;
  const year = planted.getFullYear();
  const mates = S.plantings.filter(x => x.bedId === p.bedId && x.id !== p.id);
  if (fam) {
    const prior = mates.find(x => { const d = parseISO(x.plantedAt); return d && d.getFullYear() < year && FAMILY(cropByKey(x.cropKey).group) === fam; });
    if (prior) return `This bed grew ${fam} crops in ${parseISO(prior.plantedAt).getFullYear()} as well. Move the family to another bed next season — that is how soil disease gets a foothold.`;
  }
  if (crop.group === 'tomato') {
    const spud = mates.find(x => x.cropKey === 'potato' && x.status === 'active');
    if (spud) return 'Potatoes are in this same bed. Keep them apart in future — they share late blight and pass it back and forth.';
  }
  if (crop.key === 'potato') {
    const tom = mates.find(x => cropByKey(x.cropKey).group === 'tomato' && x.status === 'active');
    if (tom) return 'Tomatoes are in this same bed. Separate beds next time; late blight moves straight between them.';
  }
  return null;
}
function companionFor(p) {
  const crop = cropByKey(p.cropKey);
  const mates = S.plantings.filter(x => x.bedId === p.bedId && x.id !== p.id && x.status === 'active').map(x => cropByKey(x.cropKey));
  if (crop.key === 'carrot' && mates.some(c => c.key === 'onion' || c.key === 'chives')) return 'Onions alongside are doing real work here — their smell puts carrot fly off the scent.';
  if (crop.key === 'onion' && mates.some(c => c.key === 'carrot')) return 'Good pairing with the carrots: the onions mask them from carrot fly.';
  if (crop.group === 'tomato' && mates.some(c => c.key === 'marigold' || c.key === 'basil')) return 'The marigolds and basil nearby earn their space around tomatoes.';
  if (crop.group === 'leafy' && mates.some(c => c.group === 'berry')) return 'The shade off the berry canes slows this down from bolting. That is why it works in this spot.';
  return null;
}
function daysToFirstFrost() { const f = nextFrost(S.settings.firstFrost); return f ? daysBetween(new Date(), f) : null; }
function gardenerCtx(p, asOf = new Date()) {
  const st = statsFor(p, asOf);
  return { p, crop: st.crop, st, gdd: gddFor(p, st), wx: wxFlagsNow(), daysToFrost: daysToFirstFrost(),
    rotationWarning: rotationWarningFor(p), companion: companionFor(p), fmtDate };
}
const readFor = (p, asOf) => gardenerRead(gardenerCtx(p, asOf));

function wxFlagsNow() {
  const d = upcomingDays(3);
  return { hot: d.some(x => x.tmax != null && x.tmax >= 90), cold: d.some(x => x.tmin != null && x.tmin <= 36), wet: d.reduce((s, x) => s + (x.rain || 0), 0) > 1, dry: d.length > 0 && d.reduce((s, x) => s + (x.rain || 0), 0) < 0.1 };
}
/* Pass st explicitly (null included) when calling from inside statsFor — computing it here would recurse. */
function shotFindings(shot, st) {
  if (!shot || !(shot.symptoms || []).length) return [];
  const p = shot.plantingId ? plantingById(shot.plantingId) : null;
  const crop = p ? cropByKey(p.cropKey) : (shot.cropKey ? cropByKey(shot.cropKey) : null);
  const stage = st === undefined ? (p ? statsFor(p, new Date()) : null) : st;
  return diagnose({ symptoms: shot.symptoms, crop, st: stage, wx: wxFlagsNow() });
}
async function shotSheet(id) {
  const shot = S.shots.find(s => s.id === id); if (!shot) return;
  const p = shot.plantingId ? plantingById(shot.plantingId) : null;
  const crop = p ? cropByKey(p.cropKey) : null;
  const st = p ? statsFor(p, new Date()) : null;
  const findings = shotFindings(shot);
  const part = SHOT_PARTS.find(x => x.key === shot.part);
  const bed = bedById(shot.bedId);
  const tags = (shot.symptoms || []).map(k => { const s = symptomByKey(k); return `<span class="badge">${s.emoji} ${esc(s.label)}</span>`; }).join(' ');
  openSheet(`<h3>${part ? part.emoji : '📷'} ${p && crop ? `${crop.emoji} ${esc(p.variety || crop.name)}` : 'Close-up'} ${xBtn}</h3>
    <img id="shot-preview" class="shot-preview" alt="">
    <dl class="kv" style="margin-bottom:10px">
      <dt>Taken</dt><dd>${fmtDateY(new Date(shot.takenAt))} · ${relDays(-daysBetween(new Date(shot.takenAt), new Date()))}</dd>
      <dt>Where</dt><dd>${esc(bed ? bed.name : '')}${part ? ` · ${esc(part.label)}` : ''}${st ? ` · day ${st.days}, ${esc(st.stage.toLowerCase())}` : ''}</dd>
      ${shot.note ? `<dt>Note</dt><dd>${esc(shot.note)}</dd>` : ''}
    </dl>
    ${tags ? `<div class="row wrap" style="margin-bottom:12px">${tags}</div>` : ''}
    ${p && p.status === 'active' ? gardenerPanel(readFor(p), { max: 3 }) : ''}
    ${findings.length ? `<div class="section"><h2>From what you tagged</h2></div><div class="flags">${findings.map(f => `<div class="flag ${sevClass(f.sev)}"><span class="fi">${f.sev === 'critical' ? '⛔' : f.sev === 'serious' ? '⚠️' : f.sev === 'warn' ? '△' : '✅'}</span><div><b>${esc(f.title)}</b><br><span class="hint">${esc(f.why)}</span><ul class="tips">${f.todo.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div></div>`).join('')}</div>
      <p class="hint" style="margin-top:8px">Field heuristics from what you tagged, this crop's stage and your forecast. They tell you what to check, not what it definitely is.</p>`
      : `<p class="hint" style="margin-bottom:12px">No symptoms tagged on this shot. The read above is the Master Gardener's take on the plant as it stands; tagging what you see sharpens it.</p>`}
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="shot-edit" data-id="${shot.id}">Edit tags</button><button class="btn" data-act="shot-share" data-id="${shot.id}">↗ Share with context</button>${p ? `<button class="btn ghost" data-act="open-planting" data-id="${p.id}">Open planting</button>` : ''}</div>
    <details style="margin-top:12px"><summary class="hint" style="cursor:pointer">How to shoot a diagnostic close-up</summary>
      <ul class="tips">${SHOT_PARTS.map(x => `<li><b>${x.emoji} ${esc(x.label)}.</b> ${esc(x.how)}</li>`).join('')}${CAPTURE_TIPS.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`);
  urlFor(shot.id, 'full').then(u => { const el = $('#shot-preview'); if (el) el.src = u; });
}
function shotContext(shot) {
  const p = shot.plantingId ? plantingById(shot.plantingId) : null;
  const crop = p ? cropByKey(p.cropKey) : null;
  const st = p ? statsFor(p, new Date()) : null;
  const bed = bedById(shot.bedId);
  const wx = S.wx ? upcomingDays(3) : [];
  const lines = [
    `Garden close-up — ${S.settings.place || 'my garden'}`,
    `Plant: ${p && crop ? `${p.variety || crop.name} (${crop.name})` : 'not identified'}`,
    st ? `Planted ${fmtDateY(st.planted)}, day ${st.days} of ${st.dtm || '?'}, stage: ${st.stage}` : null,
    `Bed: ${bed ? bed.name : '?'} · photo of: ${(SHOT_PARTS.find(x => x.key === shot.part) || {}).label || 'plant'} · taken ${fmtDateY(new Date(shot.takenAt))}`,
    (shot.symptoms || []).length ? `Symptoms tagged: ${shot.symptoms.map(k => symptomByKey(k).label).join(', ')}` : 'Symptoms tagged: none',
    shot.note ? `Note: ${shot.note}` : null,
    st && st.last ? `Last check-in: ${st.last.health}/5 on ${fmtDate(parseISO(st.last.at))}` : null,
    wx.length ? `Next 3 days: highs ${wx.map(d => Math.round(d.tmax)).join('/')}°F, lows ${wx.map(d => Math.round(d.tmin)).join('/')}°F, rain ${wx.reduce((s, d) => s + (d.rain || 0), 0).toFixed(2)} in` : null,
    '', 'What is going on and what should I do?',
  ].filter(Boolean);
  return lines.join('\n');
}

/* ---------- routing ---------- */
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [seg, id] = h.split('/');
  if (seg === 'bed' && id && bedById(id)) { if (S.view !== 'bed' || S.bedId !== id) { S.photoId = null; S.mode = 'view'; S.compareId = null; S.selCell = null; S.scrub = null; stopPlay(); } S.view = 'bed'; S.bedId = id; }
  else if (seg === 'analytics') S.view = 'analytics';
  else if (seg === 'garden') S.view = 'garden';
  else if (seg === 'settings') S.view = 'settings';
  else S.view = 'beds';
  if (S.view !== 'bed') { S.mode = 'view'; S.compareId = null; S.alignDraft = null; S.scrub = null; stopPlay(); }
  render();
}

/* ---------- rendering ---------- */
async function render() {
  const token = ++S.renderToken;
  let html = '';
  if (S.view === 'beds') html = await renderBeds();
  else if (S.view === 'bed') html = await renderBed();
  else if (S.view === 'analytics') html = renderAnalytics();
  else if (S.view === 'garden') html = renderGarden();
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
    const i = S.beds.findIndex(b => b.id === bed.id);
    back.hidden = false; title.textContent = bed.name;
    sub.textContent = `${i + 1} of ${S.beds.length} · ${bed.rows}×${bed.cols} · ${n} active · ${plural(photosOf(bed.id).length, 'photo')}`;
    acts.innerHTML = `<button class="icon-btn" data-act="take-photo" title="Take photo">📷</button><button class="icon-btn" data-act="add-photo" title="Add from library">🖼️</button><button class="icon-btn" data-act="edit-bed" data-id="${bed.id}" title="Bed settings">⋯</button>`;
  } else {
    back.hidden = true; title.textContent = 'Master Gardener';
    sub.textContent = S.view === 'analytics' ? 'Garden check · live analytics' : S.view === 'settings' ? 'Settings & data' : S.view === 'garden' ? 'Garden map · north up' : 'Bed mapper · harvest tracker';
    acts.innerHTML = S.view === 'analytics' ? `<button class="icon-btn" data-act="refresh-wx" title="Refresh weather">↻</button>`
      : S.view === 'beds' ? `<button class="icon-btn" data-act="add-bed" title="Add bed">＋</button>`
      : S.view === 'garden' ? `<button class="icon-btn" data-act="garden-zoom" data-z="-1" title="Zoom out">−</button><button class="icon-btn" data-act="garden-zoom" data-z="1" title="Zoom in">＋</button><button class="btn small ${S.gardenArrange ? 'on' : ''}" data-act="garden-arrange">${S.gardenArrange ? '✓ Done' : '⤧ Arrange'}</button>` : '';
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
        Array.from({ length: bed.rows * bed.cols }, (_, i) => { const o = owners.get(i); return `<i class="${o ? 'on' : ''}" style="${isMasked(bed, i) ? 'visibility:hidden' : o ? `--c:${CROP_GROUPS[cropByKey(o.cropKey).group].color}` : ''}"></i>`; }).join('') + '</div>';
    }
    const dims = bed.lengthFt && bed.widthFt ? `${bed.lengthFt}×${bed.widthFt} ft · ` : '';
    const chips = act.slice(0, 6).map(p => { const c = cropByKey(p.cropKey); const st = statsFor(p); return `<span class="chip" style="--c:${st.color}"><span class="dot"></span>${c.emoji} ${esc(p.variety || c.name)} <span class="mono">d${st.days}</span></span>`; }).join('') + (act.length > 6 ? `<span class="chip">+${act.length - 6}</span>` : '');
    const next = act.map(p => statsFor(p)).filter(s => !s.perennial && s.left != null).sort((a, b) => a.left - b.left)[0];
    html += `<button class="bed-card" data-act="open-bed" data-id="${bed.id}">
      <div class="bed-thumb">${thumb ? `<img src="${thumb}" alt="">` : mini}</div>
      <div class="grow">
        <h3>${esc(bed.name)}</h3><div class="sub">${esc(bed.subtitle || '')}${bed.subtitle ? ' · ' : ''}${dims}${bed.rows}×${bed.cols} · top ${edgeNames(bed).top}${lp ? ` · photo ${fmtDate(new Date(lp.takenAt))}` : ' · no photos yet'}</div>
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
  if (S.scrub != null) { // timeline: the most recent photo taken at or before the scrub date
    const ps = photosOf(bed.id).filter(p => new Date(p.takenAt) <= new Date(S.scrub));
    return ps.length ? ps[ps.length - 1] : null;
  }
  if (S.photoId === 'map') return null;
  if (S.photoId) { const p = S.photos.find(x => x.id === S.photoId && x.bedId === bed.id); if (p) return p; }
  return latestPhoto(bed.id);
}
function asOfFor(bed, photo) {
  if (S.scrub != null) return new Date(S.scrub);
  if (!photo) return new Date();
  const latest = latestPhoto(bed.id);
  if (latest && latest.id === photo.id) return new Date();
  return new Date(photo.takenAt);
}
/* The window the timeline covers: from the first thing that happened in this bed to today. */
function bedSpan(bed) {
  const dates = [...plantingsOf(bed.id).map(p => parseISO(p.plantedAt)), ...photosOf(bed.id).map(p => new Date(p.takenAt))].filter(d => d && !isNaN(d));
  if (!dates.length) return null;
  const start = startOfDay(new Date(Math.min(...dates.map(d => +d))));
  const end = startOfDay(new Date());
  const days = daysBetween(start, end);
  return days < 1 ? null : { start, end, days };
}

async function renderBed() {
  const bed = bedById(S.bedId);
  const photos = photosOf(bed.id);
  const photo = currentPhoto(bed);
  const asOf = asOfFor(bed, photo);
  const historical = S.scrub != null ? daysBetween(asOf, new Date()) !== 0
    : photo && daysBetween(asOf, new Date()) !== 0 && !(latestPhoto(bed.id) && latestPhoto(bed.id).id === photo.id);
  let stage = '';
  if (S.mode === 'compare' && photo) stage = await renderCompare(bed, photo);
  else stage = await renderStage(bed, photo, asOf, historical);
  const bi = S.beds.findIndex(b => b.id === bed.id);
  const switcher = S.beds.length < 2 ? '' : `<div class="bed-switch">
    <button class="icon-btn" data-act="bed-step" data-d="-1" aria-label="Previous bed" title="${esc(bedAt(bi - 1).name)}">‹</button>
    <div class="bed-switch-chips" id="bed-switch-chips">${S.beds.map(b => {
      const n = plantingsOf(b.id).filter(p => p.status === 'active').length;
      const ready = plantingsOf(b.id).filter(p => p.status === 'active').map(p => statsFor(p)).filter(s => !s.perennial && s.progress >= 1 && s.progress < 1.3).length;
      return `<button class="chip bed-chip ${b.id === bed.id ? 'on' : ''}" data-act="open-bed" data-id="${b.id}" title="${plural(n, 'active planting')}${ready ? `, ${ready} ready` : ''}">${esc(b.name)}${ready ? `<span class="rdy">●</span>` : ''}<span class="hint">${n}</span></button>`;
    }).join('')}</div>
    <button class="icon-btn" data-act="bed-step" data-d="1" aria-label="Next bed" title="${esc(bedAt(bi + 1).name)}">›</button>
  </div>`;

  const span = bedSpan(bed);
  const timeline = !span || S.mode !== 'view' ? '' : (() => {
    const day = S.scrub != null ? daysBetween(span.start, new Date(S.scrub)) : span.days;
    const at = addDays(span.start, day);
    const live = S.scrub == null;
    const marks = photosOf(bed.id).map(ph => { const d = clamp(daysBetween(span.start, new Date(ph.takenAt)), 0, span.days); return `<i style="left:${((d / span.days) * 100).toFixed(2)}%" title="${fmtDate(new Date(ph.takenAt))}"></i>`; }).join('');
    const growing = plantingsOf(bed.id).filter(p => activeAt(p, at)).length;
    return `<div class="timeline">
      <div class="tl-head"><button class="icon-btn" data-act="tl-play" aria-label="Play the season">${S.playing ? '⏸' : '▶'}</button>
        <div class="grow"><b>${live ? 'Today' : fmtDateY(at)}</b><span class="hint"> · ${live ? 'live' : `${plural(span.days - day, 'day')} ago`} · ${plural(growing, 'planting')} in the ground</span></div>
        ${live ? '' : `<button class="btn small" data-act="tl-now">Now</button>`}</div>
      <div class="tl-track"><div class="tl-marks">${marks}</div>
        <input type="range" id="tl-range" min="0" max="${span.days}" step="1" value="${day}" aria-label="Slide through the season"></div>
      <div class="tl-ends"><span>${fmtDate(span.start)} · first went in</span><span>today</span></div>
    </div>`;
  })();

  const strip = `<div class="strip">
    <button class="thumb map ${!photo ? 'active' : ''}" data-act="pick-photo" data-id="map">🗺️<span class="thumb-date">PLAN</span></button>
    ${(await Promise.all(photos.map(async p => `<button class="thumb ${photo && p.id === photo.id ? 'active' : ''} ${S.mode === 'compare' && S.compareId === p.id ? 'cmp' : ''}" data-act="pick-photo" data-id="${p.id}"><img src="${await urlFor(p.id, 'thumb')}" alt=""><span class="thumb-date">${fmtDate(new Date(p.takenAt))}</span></button>`))).join('')}
  </div>`;

  let toolbar = '';
  if (S.mode === 'align') {
    const facing = S.alignFacing || photo.facing || 'N';
    const en = edgeNames(bed);
    toolbar = `<div class="align-help">Drag inside the grid to move it. Pinch with two fingers to resize and spin it. Drag a corner to match the bed's perspective. Each handle names its compass corner; this bed's top edge faces ${en.top} (${bed.rows} rows ${en.top}→${en.bottom} × ${bed.cols} columns ${en.left}→${en.right}).</div>
      <div class="row" style="margin-bottom:8px"><span class="hint" style="white-space:nowrap">Grid</span><button class="btn small" data-act="grid-rotate" data-deg="-15" title="Spin grid 15° counter-clockwise">↺ 15°</button><button class="btn small" data-act="grid-rotate" data-deg="-2" title="Spin 2° counter-clockwise">↺ 2°</button><button class="btn small" data-act="grid-rotate" data-deg="2" title="Spin 2° clockwise">↻ 2°</button><button class="btn small" data-act="grid-rotate" data-deg="15" title="Spin grid 15° clockwise">↻ 15°</button></div>
      <div class="row" style="margin-bottom:8px"><span class="hint" style="white-space:nowrap">Grid</span><button class="btn small" data-act="grid-scale" data-k="0.9">− Smaller</button><button class="btn small" data-act="grid-scale" data-k="1.1">＋ Bigger</button><button class="btn small" data-act="grid-mirror" title="Swap the left and right corners">⇄ Mirror</button></div>
      <div class="row" style="margin-bottom:8px"><span class="hint" style="white-space:nowrap">Camera looking</span><div class="seg grow seg-8">${DIRS.map(f => `<button type="button" class="${facing === f ? 'on' : ''}" data-act="set-facing" data-f="${f}">${f}</button>`).join('')}</div></div>
      <div class="row" style="margin-bottom:4px"><span class="hint" style="white-space:nowrap">Straighten photo</span><input type="range" id="straighten" min="-45" max="45" step="0.5" value="0" style="flex:1;accent-color:var(--cyan)" aria-label="Rotate the photo by a few degrees"><span class="mono hint" id="straighten-val" style="min-width:42px;text-align:right">0°</span></div>
      <div class="row" style="margin-bottom:8px"><button class="btn small" data-act="rotate-photo" data-id="${photo.id}" title="Rotate photo 90° clockwise">↻ Photo 90°</button><button class="btn small" data-act="open-grid" data-id="${bed.id}">⊞ Grid ${bed.rows}×${bed.cols}</button><button class="btn small" data-act="edit-bed" data-id="${bed.id}">⟲ Bed shape</button></div>
      <div class="btn-row"><button class="btn primary" data-act="align-save">Save alignment</button><button class="btn" data-act="align-reset">Reset corners</button><button class="btn ghost" data-act="align-cancel">Cancel</button></div>`;
  } else if (S.mode === 'compare') {
    toolbar = `<div class="align-help">Tap another photo in the strip to compare against. Slide to reveal.</div>
      <div class="btn-row"><button class="btn" data-act="compare-end">Done comparing</button></div>`;
  } else {
    toolbar = `<div class="stage-toolbar">
      <button class="btn small primary" data-act="take-photo">📷 Take photo</button>
      <button class="btn small" data-act="add-photo">🖼️ Add photos</button>
      ${photo ? `<button class="btn small" data-act="align-start">📐 Align grid</button>` : ''}
      <button class="btn small" data-act="open-grid" data-id="${bed.id}" title="Change how the bed is split into cells">⊞ Grid ${bed.rows}×${bed.cols}</button>
      ${photos.length > 1 && photo ? `<button class="btn small" data-act="compare-start">⇄ Compare</button>` : ''}
      ${photo ? `<button class="btn small" data-act="photo-info" data-id="${photo.id}">ℹ️ Photo</button>` : ''}
      <button class="btn small" data-act="new-planting" data-bed="${bed.id}">＋ Plant</button>
    </div>`;
  }

  const all = plantingsOf(bed.id);
  const active = all.filter(p => p.status === 'active').sort((a, b) => a.plantedAt.localeCompare(b.plantedAt));
  const done = all.filter(p => p.status !== 'active').sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
  let list = bedCheckCard(bed);
  list += `<div class="section"><h2>Plantings</h2><span class="hint">${plural(active.length, 'active')}</span></div>`;
  list += active.length ? active.map(p => plantingCard(p, new Date(), false)).join('') : `<div class="empty"><strong>Nothing tagged in this bed yet</strong>Tap a cell on the photo or plan, or use ＋ Plant.</div>`;
  if (done.length) list += `<div class="section"><h2>Finished</h2></div>` + done.map(p => plantingCard(p, new Date(), false)).join('');
  list += await closeupSection(bed);
  return switcher + stage + timeline + toolbar + strip + list;
}

async function renderStage(bed, photo, asOf, historical) {
  const rows = bed.rows, cols = bed.cols;
  const quad = S.mode === 'align' && S.alignDraft ? S.alignDraft : (photo ? photo.quad : planQuad(bed));
  const H = homography(quad);
  const active = plantingsOf(bed.id).filter(p => activeAt(p, asOf));
  const owners = new Map(); active.forEach(p => p.cells.forEach(c => owners.set(c, p)));
  const w = photo ? photo.w : 1, h = photo ? photo.h : 1;
  const src = photo ? await urlFor(photo.id, 'full') : '';
  const cellPx = Math.min(window.innerWidth, 760) / cols;
  const small = cellPx < 105, tiny = cellPx < 58;
  let polys = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c; if (isMasked(bed, idx)) continue;
    const o = owners.get(idx); const poly = cellPoly(H, rows, cols, r, c);
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
    labels += `<div class="tag ${tiny ? 'small tiny' : small ? 'small' : ''}" style="left:${(cx * 100).toFixed(2)}%;top:${(cy * 100).toFixed(2)}%;--c:${st.color};--c-soft:${hexRgba(st.color, 0.5)};--p:${pct}" data-act="open-planting" data-id="${p.id}" title="${esc(p.variety || st.crop.name)} · ${esc(st.stage)}"><span class="ring"></span><span>${st.crop.emoji}</span><span class="name">${esc(p.variety || st.crop.name)}</span><span class="d">${dayTxt}${st.left != null && st.left <= 0 && !st.perennial ? ' ✓' : ''}</span></div>`;
  }
  const en = edgeNames(bed);
  const mids = [[en.top, H(0.5, 0)], [en.bottom, H(0.5, 1)], [en.left, H(0, 0.5)], [en.right, H(1, 0.5)]];
  const compass = mids.map(([t, [x, y]]) => `<div class="compass-lbl" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%">${t}</div>`).join('');
  let handles = '';
  if (S.mode === 'align') handles = cornerNames(bed).map((n, i) => `<div class="handle-dot" data-corner="${i}" style="left:${(quad[i][0] * 100).toFixed(2)}%;top:${(quad[i][1] * 100).toFixed(2)}%">${n}</div>`).join('');
  const style = `aspect-ratio:${w}/${h};width:min(100%, calc(62vh * ${(w / h).toFixed(4)}))`;
  const empty = !photo ? `<div class="stage-empty"><strong>Plan view</strong><span>No photo selected. Take one and the grid will overlay it.</span></div>` : '';
  return `<div class="stage-wrap"><div class="stage ${photo ? '' : 'map-mode'} ${S.mode === 'align' ? 'aligning' : ''}" id="stage" style="${style}">
    ${photo ? `<img class="stage-img" src="${src}" alt="Bed photo">` : ''}
    ${!photo && !active.length ? empty : ''}
    <svg class="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">${frame}${polys}</svg>
    <div class="labels">${compass}${S.mode === 'align' ? '' : labels}${handles}</div>
    ${!photo ? `<div class="north-rose" title="Plan is drawn north-up">N<br>▲</div>` : ''}
    <span class="hud-corner tl"></span><span class="hud-corner tr"></span><span class="hud-corner bl"></span><span class="hud-corner br"></span>
    ${photo && S.scrub == null ? '<div class="scan"></div>' : ''}
    ${historical ? `<div class="asof">${fmtDateY(asOf)} · ${daysBetween(asOf, new Date())} d ago</div>` : ''}
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

/* A drop target for close-ups. Also a button, so tapping it opens the file picker. */
function dropzone(bedId, plantingId, label) {
  return `<button class="dropzone" data-kind="shot" data-bed="${bedId}" ${plantingId ? `data-planting="${plantingId}"` : ''} data-act="shot-library">
    <span class="dz-icon">🔬</span>
    <span class="dz-main">Drop close-ups${label ? ` of ${esc(label)}` : ''} here</span>
    <span class="hint">or tap to browse. Pasting an image works too.</span>
  </button>`;
}

/* The Master Gardener's take on just this bed. */
function bedCheckCard(bed) {
  const now = new Date();
  const act = plantingsOf(bed.id).filter(p => p.status === 'active');
  if (!act.length) return '';
  const rows = act.map(p => {
    const st = statsFor(p, now), read = readFor(p, now);
    const flags = [...st.attention, ...weatherFlagsFor(p, st)].filter(f => f.kind !== 'stale-log').sort((a, b) => sevRank[b.sev] - sevRank[a.sev]);
    const sev = flags[0] ? flags[0].sev : read.sev;
    const text = flags[0] ? flags[0].text : (st.left != null && st.left <= 0 && st.progress < 1.3 ? 'Ready to pick. Keeping up with it is what keeps it producing.' : read.tasks[0] || read.headline);
    return { p, st, crop: st.crop, sev, text, pri: sevRank[sev] };
  }).sort((a, b) => b.pri - a.pri || (a.st.left ?? 9e9) - (b.st.left ?? 9e9));
  const top = rows.slice(0, 3);
  const worst = top[0].sev;
  return `<div class="card gcheck bedcheck"><div class="section" style="margin:0 0 8px"><h2>🧑‍🌾 Bed check</h2><span class="hint">${plural(act.length, 'planting')}</span></div>
    <ol class="gc-list">${top.map(r => `<li class="gc-item ${sevClass(r.sev)}" data-act="open-planting" data-id="${r.p.id}" style="cursor:pointer"><b>${r.crop.emoji} ${esc(r.p.variety || r.crop.name)}</b><span>${esc(r.text)}</span></li>`).join('')}</ol>
    ${act.length > 3 ? `<p class="hint" style="margin-top:8px">${act.length - 3} more below.</p>` : ''}</div>`;
}

async function closeupSection(bed) {
  const shots = shotsOf(bed.id);
  const flagged = shots.filter(s => (s.symptoms || []).length).length;
  let html = `<div class="section"><h2>Plant close-ups</h2><span class="hint">${shots.length ? `${shots.length}${flagged ? ` · ${flagged} tagged` : ''}` : ''}</span></div>
    <div class="btn-row" style="margin-bottom:10px"><button class="btn primary" data-act="shot-camera" data-bed="${bed.id}">🔬 Take close-up</button><button class="btn" data-act="shot-library" data-bed="${bed.id}">🖼️ Add close-ups</button><button class="btn ghost" data-act="shot-guide">❓ What to shoot</button></div>
    ${dropzone(bed.id, null, null)}`;
  if (!shots.length) {
    html += `<div class="empty"><strong>No close-ups yet</strong>Macro shots of a leaf, a stem base or a fruit tell you far more about health than a photo of the whole bed. Tag what you see and the app reads it back against the crop, its stage and your weather.</div>`;
    return html;
  }
  html += `<div class="shot-grid">`;
  for (const s of shots.slice(0, 24)) {
    const p = s.plantingId ? plantingById(s.plantingId) : null;
    const crop = p ? cropByKey(p.cropKey) : null;
    const worst = shotFindings(s)[0];
    const part = SHOT_PARTS.find(x => x.key === s.part);
    html += `<button class="shot-cell ${worst ? sevClass(worst.sev) : ''}" data-act="shot-open" data-id="${s.id}" title="${esc(p && crop ? p.variety || crop.name : 'Close-up')}">
      <img src="${await urlFor(s.id, 'thumb')}" alt="" loading="lazy">
      <span class="sc-top">${part ? part.emoji : '📷'}${crop ? ` ${crop.emoji}` : ''}</span>
      ${worst ? `<span class="sc-sev">${worst.sev === 'critical' ? '⛔' : worst.sev === 'serious' ? '⚠️' : worst.sev === 'warn' ? '△' : '✅'}</span>` : ''}
      <span class="sc-date">${fmtDate(new Date(s.takenAt))}</span>
    </button>`;
  }
  html += `</div>`;
  if (shots.length > 24) html += `<p class="hint center">Showing the 24 most recent of ${shots.length}.</p>`;
  return html;
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

/* ---------- garden map (digital view) ---------- */
function renderGarden() {
  const now = new Date();
  if (!S.beds.length) return `<div class="empty"><strong>No beds yet</strong>Add a bed and it appears here.</div>`;
  const fps = S.beds.map(b => ({ bed: b, fp: bedFootprint(b) }));
  const minX = Math.min(...fps.map(f => f.bed.x)), minY = Math.min(...fps.map(f => f.bed.y));
  const maxX = Math.max(...fps.map(f => f.bed.x + f.fp.w)), maxY = Math.max(...fps.map(f => f.bed.y + f.fp.h));
  const pad = 1;
  const gw = maxX - minX + pad * 2, gh = maxY - minY + pad * 2;
  const avail = Math.min(window.innerWidth, 760) - 28;
  const scale = clamp((avail / gw) * S.gardenZoom, 14, 120);
  const px = ft => (ft * scale).toFixed(1);
  const active = S.plantings.filter(p => activeAt(p, now));
  const groups = new Set();
  let beds = '';
  for (const { bed, fp } of fps) {
    const tileW = fp.w / fp.scols * scale, tileH = fp.h / fp.srows * scale;
    const size = Math.min(tileW, tileH);
    const cls = size < 40 ? 'xs' : size < 58 ? 'sm' : size < 92 ? 'md' : 'lg';
    const occupied = new Set();
    let tiles = '';
    for (const p of active.filter(p => p.bedId === bed.id)) {
      const st = statsFor(p, now); groups.add(st.crop.group);
      const cells = p.cells.filter(i => i < bed.rows * bed.cols && !isMasked(bed, i)).map(i => toScreenCell(bed, fp.k, Math.floor(i / bed.cols), i % bed.cols));
      if (!cells.length) continue;
      const r0 = Math.min(...cells.map(c => c.sr)), r1 = Math.max(...cells.map(c => c.sr)), c0 = Math.min(...cells.map(c => c.sc)), c1 = Math.max(...cells.map(c => c.sc));
      const solid = cells.length === (r1 - r0 + 1) * (c1 - c0 + 1);
      const blocks = solid ? [{ r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1, main: true }] : cells.map((c, i) => ({ r: c.sr, c: c.sc, rs: 1, cs: 1, main: i === 0 }));
      cells.forEach(c => occupied.add(c.sr * fp.scols + c.sc));
      for (const bl of blocks) tiles += gardenTile(p, st, bl, cls);
    }
    for (let sr = 0; sr < fp.srows; sr++) for (let sc = 0; sc < fp.scols; sc++) {
      if (occupied.has(sr * fp.scols + sc)) continue;
      // map screen cell back to plan index to know if it is masked / which cell to plant
      let planIdx = -1;
      for (let r = 0; r < bed.rows && planIdx < 0; r++) for (let c = 0; c < bed.cols; c++) { const s = toScreenCell(bed, fp.k, r, c); if (s.sr === sr && s.sc === sc) { planIdx = r * bed.cols + c; break; } }
      const off = planIdx < 0 || isMasked(bed, planIdx);
      tiles += `<button class="gcell ${off ? 'off' : 'empty'}" style="grid-row:${sr + 1};grid-column:${sc + 1}" ${off ? 'disabled' : `data-act="garden-plant" data-bed="${bed.id}" data-idx="${planIdx}" title="Plant here"`}>${off ? '' : '＋'}</button>`;
    }
    const en = edgeNames(bed);
    beds += `<div class="gbed" data-bed="${bed.id}" style="left:${px(bed.x - minX + pad)}px;top:${px(bed.y - minY + pad)}px;width:${px(fp.w)}px;height:${px(fp.h)}px">
      <button class="gbed-title" data-act="open-bed" data-id="${bed.id}" title="Open this bed's photos">${esc(bed.name)} <span class="hint">${bed.lengthFt && bed.widthFt ? `${bed.lengthFt}×${bed.widthFt} ft` : `${bed.cols}×${bed.rows}`}${bedHeading(bed) % 90 ? ` · ${en.top}` : ''}</span></button>
      <div class="ggrid ${cls}" style="grid-template-columns:repeat(${fp.scols},1fr);grid-template-rows:repeat(${fp.srows},1fr)">${tiles}</div>
    </div>`;
  }
  const next = active.map(p => statsFor(p, now)).filter(s => !s.perennial).sort((a, b) => a.left - b.left)[0];
  const legend = [...groups].map(g => `<span class="chip" style="--c:${CROP_GROUPS[g].color}"><span class="dot"></span>${esc(CROP_GROUPS[g].name)}</span>`).join('');
  return `<div class="garden-head"><div class="hint">${plural(S.beds.length, 'bed')} · ${plural(active.length, 'planting')}${next ? ` · next harvest ${next.crop.emoji} ${esc(next.crop.name)} ${next.left <= 0 ? 'now' : relDays(next.left)}` : ''}</div>
      ${S.gardenArrange ? `<div class="align-help">Drag a bed to where it sits in your yard (north is up). Positions snap to half a foot.</div>` : ''}</div>
    <div class="garden-scroll ${S.gardenArrange ? 'arranging' : ''}"><div class="garden" id="garden" style="width:${px(gw)}px;height:${px(gh)}px" data-scale="${scale}" data-minx="${minX - pad}" data-miny="${minY - pad}">
      <div class="north-rose">N<br>▲</div>
      <div class="scalebar" style="width:${px(1)}px">1 ft</div>
      ${beds}
    </div></div>
    ${legend ? `<div class="row wrap" style="margin-top:10px">${legend}</div>` : ''}
    <p class="hint" style="margin-top:8px">Tap a tile for details and check-ins, ＋ to plant, a bed's name for its photos. Beds are drawn to the nearest quarter turn of their heading.</p>`;
}
function gardenTile(p, st, bl, cls) {
  const pct = st.perennial ? 100 : clamp(st.progress * 100, 0, 100);
  const left = st.perennial ? `year ${Math.floor(st.days / 365) + 1}` : st.left > 0 ? `${st.left} d left` : st.progress < 1.3 ? 'Ready' : 'Over';
  const sev = st.sev === 'good' ? '' : st.sev;
  return `<button class="gtile ${bl.main ? '' : 'cont'} ${st.left != null && st.left <= 0 && !st.perennial ? 'ready' : ''}" style="grid-row:${bl.r + 1}/span ${bl.rs};grid-column:${bl.c + 1}/span ${bl.cs};--c:${st.color}" data-act="open-planting" data-id="${p.id}" title="${esc(p.variety || st.crop.name)} · ${esc(st.stage)}">
    <span class="gt-em">${st.crop.emoji}</span>
    ${bl.main ? `<span class="gt-name">${esc(p.variety || st.crop.name)}</span><span class="gt-days"><b>Day ${st.days}</b><em>${left}</em></span>` : `<span class="gt-days"><b>d${st.days}</b></span>`}
    ${bl.main && st.health ? `<span class="gt-health" title="Last check-in ${st.health}/5">${HEALTH[st.health]}</span>` : ''}
    <i class="gt-bar"><i class="${sev}" style="width:${pct.toFixed(0)}%"></i></i>
  </button>`;
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
    <div class="stat"><div class="stat-label">Close-ups</div><div class="stat-value">${S.shots.length}</div><div class="stat-sub">${plural(S.photos.length, 'bed photo')}</div></div>
    <div class="stat"><div class="stat-label">First frost</div><div class="stat-value">${frostDays != null ? frostDays : '—'}</div><div class="stat-sub">${frost ? `days · ${fmtDate(frost)}` : 'set in Settings'}</div></div>
  </div>`;
  const gc = buildGardenCheck();
  html += `<div class="card gcheck"><div class="section" style="margin:0 0 8px"><h2>🧑‍🌾 Garden check</h2><span class="hint">${fmtDate(now)}</span></div>
    <p class="gc-summary">${esc(gc.check.summary)}</p>
    ${gc.check.items.length ? `<ol class="gc-list">${gc.check.items.slice(0, 9).map(i => `<li class="gc-item ${sevClass(i.sev)}" ${i.plantingId || i.shotId ? `data-act="${i.shotId ? 'shot-open' : 'open-planting'}" data-id="${i.shotId || i.plantingId}" style="cursor:pointer"` : ''}><b>${esc(i.title)}</b><span>${esc(i.detail)}</span></li>`).join('')}</ol>` : ''}
    ${gc.check.items.length > 9 ? `<p class="hint center" style="margin-top:8px">Showing the top 9 of ${gc.check.items.length}.</p>` : ''}
    <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Standing principles</summary><ul class="tips">${GARDENER_PRINCIPLES.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
  </div>`;
  html += renderWeather();
  if (gc.windows.length) {
    html += `<div class="card"><h2>What to plant now</h2><p class="hint" style="margin-bottom:8px">${gc.dtf != null ? `About ${gc.dtf} days to the average first frost.` : 'Set your frost dates in Settings for sharper timing.'} Sorted by what fits the remaining season.</p>
      <div class="variety-chips">${gc.windows.slice(0, 14).map(w => `<span class="chip ${w.fit === 'go' ? 'on' : ''}" title="${esc(w.note)}">${w.crop.emoji} ${esc(w.crop.name)} <span class="hint">${w.crop.dtm}d</span></span>`).join('')}</div>
      <p class="hint" style="margin-top:8px">Solid chips fit comfortably. Outlined ones only finish under a cover.</p></div>`;
  }

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
  html += attention.length ? `<div class="flags">` + attention.map(({ p, st, flags }) => flags.map(f => `<div class="flag ${sevClass(f.sev)}" data-act="${f.shotId ? 'shot-open' : 'open-planting'}" data-id="${f.shotId || p.id}" style="cursor:pointer"><span class="fi">${f.sev === 'critical' ? '⛔' : f.sev === 'serious' ? '⚠️' : '△'}</span><div><b>${st.crop.emoji} ${esc(p.variety || st.crop.name)}</b> · ${esc(bedById(p.bedId)?.name || '')}<br><span class="hint">${esc(f.text)}</span></div></div>`).join('')).join('') + `</div>`
    : `<div class="flag good"><span class="fi">✅</span><div>All clear. Nothing is overdue, rated low, or facing a weather flag in the next 3 days.</div></div>`;
  html += `</div>`;

  html += `<div class="section"><h2>All plantings</h2><span class="hint">${plural(active.length, 'active')}</span></div>`;
  html += active.length ? stats.sort((a, b) => (a.st.left ?? 9e9) - (b.st.left ?? 9e9)).map(({ p }) => plantingCard(p, now, true)).join('') : `<div class="empty"><strong>No plantings yet</strong>Open a bed and tag what is growing.</div>`;
  if (S.wx && S.wx.partial) html += `<p class="hint center" style="margin-top:8px">Weather history is partial, so GDD totals may undercount.</p>`;
  return html;
}
/* Rain against evaporation for the last 7 days, and what it means. Shared by the weather card and the check. */
function waterStatus() {
  if (!S.wx) return null;
  const days = [];
  for (let i = -7; i < 3; i++) { const r = S.wx.days.get(isoDate(addDays(new Date(), i))); if (r) days.push({ ...r, off: i }); }
  const past = days.filter(x => x.off < 0), fut = days.filter(x => x.off >= 0);
  const rain7 = past.reduce((s, x) => s + (x.rain || 0), 0), et7 = past.reduce((s, x) => s + (x.et0 || 0), 0);
  const next3 = fut.reduce((s, x) => s + (x.rain || 0), 0), deficit = et7 - rain7;
  if (deficit > 1.0 && next3 < 0.5) return { sev: 'serious', text: `The last week evaporated about ${deficit.toFixed(1)} in more than it rained and little is coming. Water deeply, then mulch over the moist soil.`, deficit, rain7, et7, next3 };
  if (deficit > 0.5 && next3 < 0.25) return { sev: 'warn', text: `Running roughly ${deficit.toFixed(1)} in behind on moisture. Check the top 2 in and water deeply if it is dry.`, deficit, rain7, et7, next3 };
  return { sev: 'good', text: 'Rain has about kept up with evaporation this week. Nothing to do.', deficit, rain7, et7, next3 };
}

/* ---------- the Master Gardener's garden check ---------- */
function buildGardenCheck() {
  const now = new Date();
  const active = S.plantings.filter(p => p.status === 'active');
  const reads = active.map(p => {
    const st = statsFor(p, now);
    const bed = bedById(p.bedId);
    const flags = [...st.attention, ...weatherFlagsFor(p, st)].sort((a, b) => sevRank[b.sev] - sevRank[a.sev]);
    return { p, crop: st.crop, st, bedName: bed ? bed.name : '', read: readFor(p, now), flag: flags[0] || null };
  });
  let emptyCells = 0;
  for (const bed of S.beds) {
    const taken = new Set(); plantingsOf(bed.id).filter(p => p.status === 'active').forEach(p => p.cells.forEach(c => taken.add(c)));
    for (let i = 0; i < bed.rows * bed.cols; i++) if (!taken.has(i) && !isMasked(bed, i)) emptyCells++;
  }
  const rotationWarnings = [...new Set(active.map(p => rotationWarningFor(p)).filter(Boolean))];
  const staleBeds = S.beds.filter(b => { const lp = latestPhoto(b.id); return !lp || daysBetween(new Date(lp.takenAt), now) > 30; }).map(b => b.name);
  const dtf = daysToFirstFrost();
  const windows = plantingWindows({ crops: CROPS, daysToFrost: dtf, month: now.getMonth() + 1 });
  return { check: gardenCheck({ reads, water: waterStatus(), daysToFrost: dtf, emptyCells, windows, rotationWarnings, staleBeds }), windows, reads, dtf };
}

function renderWeather() {
  const wx = S.wx;
  let html = `<div class="card"><h2>Weather · ${esc(S.settings.place || 'your garden')}</h2>`;
  if (!wx) { html += `<p class="hint">${S.wxLoading ? 'Loading Open-Meteo…' : S.wxErr ? `Weather unavailable (${esc(S.wxErr)}). Set your location in Settings and refresh.` : 'Loading…'}</p></div>`; return html; }
  const ws = waterStatus();
  const cur = wx.current || {};
  const d = WX.describe(cur.weather_code ?? 0);
  const today = isoDate(new Date());
  const days = [];
  for (let i = -7; i < 7; i++) { const k = isoDate(addDays(new Date(), i)); const r = wx.days.get(k); if (r) days.push({ ...r, key: k, off: i }); }
  const past = days.filter(x => x.off < 0), fut = days.filter(x => x.off >= 0);
  const rain7 = past.reduce((s, x) => s + (x.rain || 0), 0);
  const et7 = past.reduce((s, x) => s + (x.et0 || 0), 0);
  const rainNext3 = fut.slice(0, 3).reduce((s, x) => s + (x.rain || 0), 0);
  const hot = fut.slice(0, 3).some(x => x.tmax >= 90), cold = fut.slice(0, 3).some(x => x.tmin <= 36);
  html += `<div class="wx-now"><div class="ic">${d.icon}</div><div><div class="big">${cur.temperature_2m != null ? Math.round(cur.temperature_2m) + '°' : '—'}</div><div class="desc">${d.text}${cur.relative_humidity_2m != null ? ` · ${cur.relative_humidity_2m}% RH` : ''}${cur.wind_speed_10m != null ? ` · ${Math.round(cur.wind_speed_10m)} mph` : ''}</div></div>
    <div class="right"><dl class="kv"><dt>Rain 7 d</dt><dd class="mono">${rain7.toFixed(2)} in</dd><dt>ET₀ 7 d</dt><dd class="mono">${et7.toFixed(2)} in</dd><dt>Next 3 d</dt><dd class="mono">${rainNext3.toFixed(2)} in</dd></dl></div></div>`;
  html += `<div class="flags">`;
  if (ws) html += `<div class="flag ${sevClass(ws.sev)}"><span class="fi">💧</span><div>${esc(ws.text)}</div></div>`;
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
    <p class="hint" style="margin-bottom:10px">Photos, tags, and check-ins are stored only on this device (${plural(S.photos.length, 'bed photo')}, ${plural(S.shots.length, 'close-up')}, ${plural(S.plantings.length, 'planting')}, ${plural(S.logs.length, 'check-in')}). Export a backup before switching phones or clearing the browser.</p>
    <div class="btn-row"><button class="btn" data-act="export">⬇︎ Export backup</button><button class="btn" data-act="import">⬆︎ Import backup</button></div>
    <div class="btn-row" style="margin-top:8px"><button class="btn ghost" data-act="sample">Load sample garden</button>${S.plantings.some(p => p.sample) ? `<button class="btn ghost" data-act="clear-sample">Remove sample data</button>` : ''}</div>
    <div class="btn-row" style="margin-top:8px"><button class="btn danger" data-act="wipe">Erase everything</button></div>
  </div>
  <div class="card"><h2>Install on your phone</h2>
    <p class="hint">iPhone: open this site in Safari → Share → <b>Add to Home Screen</b>. Android: Chrome menu → <b>Install app</b>. It then opens full-screen and works offline in the garden (weather needs a signal).</p>
  </div>
  <div class="card"><h2>About</h2>
    <div class="btn-row" style="margin-bottom:10px"><button class="btn" data-act="check-update">↻ Check for updates</button></div>
    <p class="hint">Master Gardener v${APP_VERSION}. Each bed has a heading: the direction its plan's top edge faces (set it in the bed's settings, any angle). Edge and corner labels on the plan, the photo overlay, and the align handles all follow it. Days-to-maturity defaults come from common seed-packet figures for each variety; edit them per planting. Growing degree days use base ${''}50°F for warm crops and 40°F for cool crops from Open-Meteo daily highs and lows.</p>
  </div>`;
}

/* ---------- sheets ---------- */
function openSheet(html) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog"><div class="sheet-handle"></div>${html}</div>`;
  document.body.style.overflow = 'hidden';
  hydrateShotImgs();
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
    ${miniWrap(bed, 'mini-grid')}
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
function miniWrap(bed, id) {
  const en = edgeNames(bed);
  return `<div class="mini-wrap"><span></span><span class="compass">${en.top}</span><span></span><span class="compass">${en.left}</span><div class="mini-grid" id="${id}" style="grid-template-columns:repeat(${bed.cols},1fr)"></div><span class="compass">${en.right}</span><span></span><span class="compass">${en.bottom}</span><span></span></div>`;
}
function renderMiniGrid() {
  const g = $('#mini-grid'); if (!g) return;
  const bed = bedById(F.bedId);
  const taken = new Map(); plantingsOf(bed.id).filter(p => p.status === 'active' && p.id !== F.id).forEach(p => p.cells.forEach(c => taken.set(c, p)));
  const crop = F.cropKey ? cropByKey(F.cropKey) : null;
  g.innerHTML = Array.from({ length: bed.rows * bed.cols }, (_, i) => {
    if (isMasked(bed, i)) return `<button type="button" class="off" disabled aria-hidden="true"></button>`;
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
  const latest = shotsOfPlanting(p.id)[0];
  const flags = p.status === 'active' ? [...st.attention, ...weatherFlagsFor(p, st)] : [];
  const pct = st.perennial ? 100 : clamp(st.progress * 100, 0, 100);
  const meterClass = st.sev === 'good' ? '' : st.sev === 'warn' ? 'warn' : st.sev === 'serious' ? 'serious' : 'critical';
  openSheet(`<h3><span>${crop.emoji}</span><span class="grow">${esc(p.variety || crop.name)} ${p.variety ? `<small style="color:var(--ink2);font-weight:500">${esc(crop.name)}</small>` : ''}</span>${xBtn}</h3>
    <div class="row wrap" style="margin-bottom:10px"><span class="badge" style="border-color:${st.color};color:var(--ink)"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:${st.color};display:inline-block"></span> ${esc(bed ? bed.name : '')}</span><span class="badge">${plural(p.cells.length, 'cell')}</span><span class="badge ${sevClass(st.sev)}">${esc(st.stage)}</span>${p.status !== 'active' ? `<span class="badge">${p.status}</span>` : ''}</div>
    ${p.status === 'active' ? `<div class="meter" style="margin:0 0 12px"><i class="${meterClass}" style="width:${pct.toFixed(1)}%"></i></div>` : ''}
    ${latest ? `<img class="shot-preview" data-shot-full="${latest.id}" data-act="shot-open" data-id="${latest.id}" alt="Latest close-up" style="cursor:pointer">
      <p class="hint" style="margin:-6px 0 12px">Latest close-up · ${esc((SHOT_PARTS.find(x => x.key === latest.part) || {}).label || 'plant')} · ${fmtDate(new Date(latest.takenAt))}</p>` : ''}
    ${p.status === 'active' ? gardenerPanel(readFor(p)) : ''}
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
    <div class="section"><h2>Close-ups</h2><span class="hint">${shotsOfPlanting(p.id).length || ''}</span></div>
    <div class="btn-row" style="margin-bottom:8px"><button class="btn small" data-act="shot-camera" data-bed="${p.bedId}" data-planting="${p.id}">🔬 Take close-up</button><button class="btn small ghost" data-act="shot-library" data-bed="${p.bedId}" data-planting="${p.id}">🖼️ Add</button></div>
    ${dropzone(p.bedId, p.id, p.variety || crop.name)}
    ${shotsOfPlanting(p.id).length ? `<div class="shot-grid" id="planting-shots">${shotsOfPlanting(p.id).slice(0, 12).map(s => { const worst = shotFindings(s)[0]; const part = SHOT_PARTS.find(x => x.key === s.part); return `<button class="shot-cell ${worst ? sevClass(worst.sev) : ''}" data-act="shot-open" data-id="${s.id}"><img data-shot="${s.id}" alt="" loading="lazy"><span class="sc-top">${part ? part.emoji : '📷'}</span>${worst ? `<span class="sc-sev">${worst.sev === 'critical' ? '⛔' : worst.sev === 'serious' ? '⚠️' : worst.sev === 'warn' ? '△' : '✅'}</span>` : ''}<span class="sc-date">${fmtDate(new Date(s.takenAt))}</span></button>`; }).join('')}</div>` : `<p class="hint">No close-ups of this plant yet. A leaf underside and a stem base are the two most useful frames.</p>`}
    ${crop.tips && crop.tips.length ? `<details style="margin-top:12px"><summary class="hint" style="cursor:pointer">Tips for ${esc(crop.name.toLowerCase())}</summary><ul class="tips">${crop.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
    ${st.logs.length ? `<div class="section"><h2>Check-ins</h2></div>${st.logs.length >= 2 ? sparkline(st.logs) : ''}<div class="log-list">${st.logs.slice(0, 12).map(l => `<div class="log-item"><div class="h">${HEALTH[l.health] || '📝'}</div><div><div class="when">${fmtDT(new Date(l.at))}${l.flags && l.flags.length ? ' · ' + l.flags.map(k => (FLAGS.find(f => f[0] === k) || [k, k])[1]).join(', ') : ''}</div>${l.note ? esc(l.note) : ''}</div></div>`).join('')}</div>` : ''}`);
}

/* Fill any <img data-shot> placeholders a sheet just rendered. */
function hydrateShotImgs() {
  $$('img[data-shot]').forEach(img => { urlFor(img.dataset.shot, 'thumb').then(u => { img.src = u; img.removeAttribute('data-shot'); }); });
  $$('img[data-shot-full]').forEach(img => { urlFor(img.dataset.shotFull, 'full').then(u => { img.src = u; img.removeAttribute('data-shot-full'); }); });
}

/* The Master Gardener's read, rendered. */
function gardenerPanel(read, opts = {}) {
  const icon = read.sev === 'critical' ? '⛔' : read.sev === 'serious' ? '⚠️' : '🧑‍🌾';
  return `<div class="gardener ${sevClass(read.sev)}">
    <div class="gd-head"><span class="gd-icon">${icon}</span><div><b>${esc(read.headline)}</b><div class="gd-doing">${esc(read.doing)}</div></div></div>
    ${read.tasks.length ? `<div class="gd-block"><h4>This week</h4><ul class="tips">${read.tasks.slice(0, opts.max || 4).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${read.watch.length ? `<div class="gd-block"><h4>Watch for</h4><ul class="tips">${read.watch.slice(0, 3).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${read.heat ? `<div class="gd-block"><h4>Heat units</h4><p class="hint">${esc(read.heat)}</p></div>` : ''}
    ${read.timing.length ? `<div class="gd-block"><h4>Season &amp; placement</h4><ul class="tips">${read.timing.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function photoSheet(id) {
  const ph = S.photos.find(p => p.id === id); if (!ph) return;
  openSheet(`<h3>Photo details ${xBtn}</h3>
    <label class="field"><span>Taken</span><input id="ph-at" type="datetime-local" value="${toLocalDT(new Date(ph.takenAt))}"></label>
    <label class="field"><span>Note</span><textarea id="ph-note" placeholder="Anything to remember about this shot">${esc(ph.note || '')}</textarea></label>
    <p class="hint" style="margin-bottom:10px">${ph.w}×${ph.h} · older photos show tags as of their date, so back-dating a photo places it correctly on the timeline.</p>
    <div class="btn-row"><button class="btn primary" data-act="save-photo" data-id="${ph.id}">Save</button><button class="btn" data-act="rotate-photo-sheet" data-id="${ph.id}">↻ Rotate 90°</button><button class="btn danger" data-act="delete-photo" data-id="${ph.id}">Delete photo</button></div>`);
}
let BF = null; // bed form draft
function bedForm(existing) {
  const base = existing || { id: uid(), name: `Bed ${S.beds.length + 1}`, subtitle: '', rows: S.settings.rows, cols: S.settings.cols, lengthFt: 7, widthFt: 4, heading: 0, mask: [], sort: S.beds.length + 1, createdAt: new Date().toISOString() };
  BF = { ...base, mask: [...(base.mask || [])], heading: bedHeading(base), lengthFt: base.lengthFt || 0, widthFt: base.widthFt || 0, isNew: !existing };
  openSheet(`<h3>${existing ? 'Bed shape, size & heading' : 'New bed'} ${xBtn}</h3>
    <label class="field"><span>Name</span><input id="b-name" value="${esc(BF.name)}"></label>
    <label class="field"><span>Description</span><input id="b-sub" value="${esc(BF.subtitle || '')}" placeholder="e.g. Back bed by the fence"></label>
    <div class="row"><label class="field grow"><span>Length (ft, along columns)</span><input id="b-len" type="number" min="1" max="100" step="0.5" value="${BF.lengthFt || ''}" placeholder="7"></label><label class="field grow"><span>Width (ft, along rows)</span><input id="b-wid" type="number" min="1" max="100" step="0.5" value="${BF.widthFt || ''}" placeholder="4"></label></div>
    ${gridControls(BF)}
    <div class="row"><label class="field grow"><span>Garden position: ft from west</span><input id="b-x" type="number" step="0.5" value="${Number.isFinite(BF.x) ? BF.x : 0}"></label><label class="field grow"><span>ft from north</span><input id="b-y" type="number" step="0.5" value="${Number.isFinite(BF.y) ? BF.y : 0}"></label></div>
    <span class="hint" style="display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--ink2)">Heading: the plan's top edge faces <b id="b-heading-name">${dirName(BF.heading)}</b> (<span id="b-heading-deg">${BF.heading}</span>°)</span>
    <div class="seg seg-8" style="margin-bottom:8px">${DIRS.map(d => `<button type="button" class="${dirName(BF.heading) === d && BF.heading % 45 === 0 ? 'on' : ''}" data-act="bed-heading" data-d="${dirDeg(d)}">${d}</button>`).join('')}</div>
    <input type="range" id="b-heading" min="0" max="355" step="5" value="${BF.heading}" style="width:100%;margin:0 0 12px;accent-color:var(--accent)" aria-label="Heading in degrees">
    <span class="hint" style="display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--ink2)">Shape: tap cells that are NOT part of the bed (for L, T, or U shapes)</span>
    ${miniWrap(BF, 'bed-mask-grid')}
    <p class="hint" style="margin-bottom:10px" id="b-summary"></p>
    <div class="btn-row"><button class="btn primary" data-act="save-bed">Save</button>${existing ? `<button class="btn danger" data-act="delete-bed" data-id="${BF.id}">Delete bed</button>` : ''}</div>`);
  const upd = () => { BF.name = $('#b-name').value; BF.subtitle = $('#b-sub').value; BF.lengthFt = +$('#b-len').value || 0; BF.widthFt = +$('#b-wid').value || 0; };
  ['#b-name', '#b-sub', '#b-len', '#b-wid'].forEach(s => $(s).addEventListener('input', () => { upd(); renderBedSummary(); }));
  const dims = () => { BF.rows = clamp(+$('#g-rows').value || 1, 1, GRID_MAX.rows); BF.cols = clamp(+$('#g-cols').value || 1, 1, GRID_MAX.cols); renderGridPresets(BF); renderBedMask(); };
  $('#g-rows').addEventListener('change', dims); $('#g-cols').addEventListener('change', dims);
  $('#b-heading').addEventListener('input', e => setBedHeading(+e.target.value));
  renderGridPresets(BF); renderBedMask();
}

/* ---------- grid split controls (shared by the bed form and the quick Grid sheet) ---------- */
const GRID_MAX = { rows: 60, cols: 120 }; // any split you can type; the map and overlay thin their labels as cells shrink
let GF = null; // quick grid sheet draft
const gridDraft = () => ($('#bed-mask-grid') ? BF : GF);
function gridControls(d) {
  return `<span class="hint" style="display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;font-size:12px;color:var(--ink2)">Grid split: rows × columns</span>
    <div class="row" style="margin-bottom:8px">
      <div class="stepper"><button type="button" data-act="grid-step" data-f="rows" data-d="-1" aria-label="Fewer rows">−</button><input id="g-rows" type="number" inputmode="numeric" min="1" max="${GRID_MAX.rows}" value="${d.rows}"><button type="button" data-act="grid-step" data-f="rows" data-d="1" aria-label="More rows">＋</button><span class="hint">rows</span></div>
      <div class="stepper"><button type="button" data-act="grid-step" data-f="cols" data-d="-1" aria-label="Fewer columns">−</button><input id="g-cols" type="number" inputmode="numeric" min="1" max="${GRID_MAX.cols}" value="${d.cols}"><button type="button" data-act="grid-step" data-f="cols" data-d="1" aria-label="More columns">＋</button><span class="hint">columns</span></div>
    </div>
    <div class="variety-chips" id="grid-presets"></div>`;
}
function gridPresets(d) {
  const out = []; const seen = new Set();
  const add = (r, c, label) => { const k = `${r}x${c}`; if (r < 1 || c < 1 || r > GRID_MAX.rows || c > GRID_MAX.cols || seen.has(k)) return; seen.add(k); out.push({ r, c, label }); };
  if (d.lengthFt > 0 && d.widthFt > 0) for (const s of [0.5, 1, 1.5, 2, 3]) add(Math.max(1, Math.round(d.widthFt / s)), Math.max(1, Math.round(d.lengthFt / s)), `${s} ft cells`);
  [[1, 2], [2, 2], [2, 3], [2, 4], [3, 3], [3, 4], [3, 6], [4, 4], [4, 6], [4, 7], [4, 8], [6, 6], [6, 8], [8, 8]].forEach(([r, c]) => add(r, c, ''));
  return out;
}
function renderGridPresets(d) {
  const el = $('#grid-presets'); if (!el) return;
  el.innerHTML = gridPresets(d).map(p => `<button type="button" class="chip ${d.rows === p.r && d.cols === p.c ? 'on' : ''}" data-act="grid-preset" data-r="${p.r}" data-c="${p.c}">${p.r}×${p.c}${p.label ? ` <span class="hint">${p.label}</span>` : ''}</button>`).join('');
}
function setGrid(d, rows, cols) {
  d.rows = clamp(rows, 1, GRID_MAX.rows); d.cols = clamp(cols, 1, GRID_MAX.cols);
  const ri = $('#g-rows'), ci = $('#g-cols'); if (ri) ri.value = d.rows; if (ci) ci.value = d.cols;
  renderGridPresets(d);
  if (d === BF) renderBedMask(); else renderGridPreview();
}
function gridSheet(bedId) {
  const bed = bedById(bedId); if (!bed) return;
  GF = { ...bed, mask: [...(bed.mask || [])] };
  openSheet(`<h3>⊞ Grid split · ${esc(bed.name)} ${xBtn}</h3>
    ${gridControls(GF)}
    ${miniWrap(GF, 'grid-preview')}
    <p class="hint" id="grid-summary" style="margin-bottom:10px"></p>
    <div class="btn-row"><button class="btn primary" data-act="save-grid">Apply grid</button><button class="btn ghost" data-act="edit-bed" data-id="${bed.id}">More bed settings</button></div>`);
  $('#g-rows').addEventListener('change', () => setGrid(GF, +$('#g-rows').value || 1, GF.cols));
  $('#g-cols').addEventListener('change', () => setGrid(GF, GF.rows, +$('#g-cols').value || 1));
  renderGridPresets(GF); renderGridPreview();
}
function renderGridPreview() {
  const wrap = $('#grid-preview'); if (!wrap || !GF) return;
  wrap.parentElement.outerHTML = miniWrap(GF, 'grid-preview');
  const g = $('#grid-preview'); g.style.gridTemplateColumns = `repeat(${GF.cols},1fr)`;
  const owners = new Map(); plantingsOf(GF.id).filter(p => p.status === 'active').forEach(p => p.cells.forEach(c => owners.set(c, p)));
  g.innerHTML = Array.from({ length: GF.rows * GF.cols }, (_, i) => {
    const off = GF.mask.includes(i); const o = owners.get(i);
    return `<button type="button" class="${off ? 'off' : o ? 'mine' : ''}" style="${o && !off ? `--c:${CROP_GROUPS[cropByKey(o.cropKey).group].color}` : ''}" disabled>${off ? '' : o ? cropByKey(o.cropKey).emoji : ''}</button>`;
  }).join('');
  const el = $('#grid-summary');
  const cw = GF.lengthFt && GF.cols ? (GF.lengthFt / GF.cols).toFixed(2).replace(/\.?0+$/, '') : null, ch = GF.widthFt && GF.rows ? (GF.widthFt / GF.rows).toFixed(2).replace(/\.?0+$/, '') : null;
  const lost = plantingsOf(GF.id).filter(p => p.status === 'active' && p.cells.some(c => c >= GF.rows * GF.cols || GF.mask.includes(c))).length;
  const same = GF.rows === bedById(GF.id).rows && GF.cols === bedById(GF.id).cols;
  el.textContent = `${GF.rows * GF.cols} cells${cw && ch ? ` ≈ ${cw} × ${ch} ft each` : ''}. ${same ? 'No change yet.' : lost ? `${lost} active planting${lost === 1 ? '' : 's'} sit in cells that would no longer exist; those cells are dropped, the planting is kept.` : 'Existing plantings keep their cells.'} Tip: photo tags are per cell, so re-tag after a big change.`;
}
function setBedHeading(deg) {
  BF.heading = norm360(Math.round(deg));
  $('#b-heading').value = BF.heading; $('#b-heading-name').textContent = dirName(BF.heading); $('#b-heading-deg').textContent = BF.heading;
  $$('[data-act="bed-heading"]').forEach(b => b.classList.toggle('on', +b.dataset.d === BF.heading));
  const wrap = $('#bed-mask-grid').parentElement; wrap.outerHTML = miniWrap(BF, 'bed-mask-grid'); renderBedMask();
}
function renderBedMask() {
  const g = $('#bed-mask-grid'); if (!g) return;
  g.style.gridTemplateColumns = `repeat(${BF.cols},1fr)`;
  const owners = new Map(); if (!BF.isNew) plantingsOf(BF.id).filter(p => p.status === 'active').forEach(p => p.cells.forEach(c => owners.set(c, p)));
  g.innerHTML = Array.from({ length: BF.rows * BF.cols }, (_, i) => {
    const off = BF.mask.includes(i); const o = owners.get(i);
    return `<button type="button" class="${off ? 'off' : o ? 'mine' : ''}" style="${o && !off ? `--c:${CROP_GROUPS[cropByKey(o.cropKey).group].color}` : ''}" data-act="bed-mask-toggle" data-idx="${i}" title="${off ? 'Not part of the bed' : `Cell ${i + 1}`}">${off ? '✕' : o ? cropByKey(o.cropKey).emoji : ''}</button>`;
  }).join('');
  renderBedSummary();
}
function renderBedSummary() {
  const el = $('#b-summary'); if (!el) return;
  const cells = BF.rows * BF.cols - BF.mask.filter(i => i < BF.rows * BF.cols).length;
  const cw = BF.lengthFt && BF.cols ? (BF.lengthFt / BF.cols).toFixed(2).replace(/\.?0+$/, '') : null, ch = BF.widthFt && BF.rows ? (BF.widthFt / BF.rows).toFixed(2).replace(/\.?0+$/, '') : null;
  const lost = BF.isNew ? 0 : plantingsOf(BF.id).filter(p => p.status === 'active' && p.cells.some(c => c >= BF.rows * BF.cols || BF.mask.includes(c))).length;
  el.textContent = `${cells} usable cell${cells === 1 ? '' : 's'}${cw && ch ? ` ≈ ${cw} × ${ch} ft each` : ''}. ${lost ? `${lost} active planting${lost === 1 ? '' : 's'} would lose cells that no longer exist.` : 'Existing plantings keep their cells.'}`;
}

/* ---------- actions ---------- */
const ACT = {
  'close-sheet': () => closeSheet(),
  'open-bed': el => go(`#/bed/${el.dataset.id}`),
  'bed-step': el => stepBed(+el.dataset.d),
  'tl-play': () => { if (S.playing) { stopPlay(); } else { const span = bedSpan(bedById(S.bedId)); if (!span) return; S.playing = true; S.scrub = +span.start; } render(); },
  'tl-now': () => { stopPlay(); S.scrub = null; render(); },
  'add-bed': () => bedForm(null),
  'edit-bed': el => bedForm(bedById(el.dataset.id)),
  'grid-step': el => { const d = gridDraft(); if (!d) return; const f = el.dataset.f; setGrid(d, d.rows + (f === 'rows' ? +el.dataset.d : 0), d.cols + (f === 'cols' ? +el.dataset.d : 0)); },
  'grid-preset': el => { const d = gridDraft(); if (!d) return; setGrid(d, +el.dataset.r, +el.dataset.c); },
  'open-grid': el => gridSheet(el.dataset.id),
  'save-grid': async () => {
    if (!GF) return; const bed = bedById(GF.id); if (!bed) return;
    const rows = clamp(GF.rows, 1, GRID_MAX.rows), cols = clamp(GF.cols, 1, GRID_MAX.cols);
    const nb = { ...bed, rows, cols, mask: (bed.mask || []).filter(i => i < rows * cols) };
    for (const p of plantingsOf(bed.id)) { const keep = p.cells.filter(i => i < rows * cols && !nb.mask.includes(i)); if (keep.length !== p.cells.length) await savePlanting({ ...p, cells: keep }); }
    await saveBed(nb); GF = null; closeSheet(); toast(`Grid set to ${rows}×${cols}`); render();
  },
  'bed-heading': el => setBedHeading(+el.dataset.d),
  'bed-mask-toggle': el => { const i = +el.dataset.idx; BF.mask = BF.mask.includes(i) ? BF.mask.filter(x => x !== i) : [...BF.mask, i].sort((a, b) => a - b); renderBedMask(); },
  'save-bed': async () => {
    const name = $('#b-name').value.trim(); if (!name) { toast('Give the bed a name'); return; }
    const { isNew, ...rest } = BF;
    const nb = { ...rest, name, subtitle: $('#b-sub').value.trim(), rows: clamp(BF.rows, 1, GRID_MAX.rows), cols: clamp(BF.cols, 1, GRID_MAX.cols), mask: BF.mask.filter(i => i < BF.rows * BF.cols), x: +$('#b-x').value || 0, y: +$('#b-y').value || 0 };
    if (nb.mask.length >= nb.rows * nb.cols) { toast('At least one cell has to be part of the bed'); return; }
    if (!isNew) {
      for (const p of plantingsOf(nb.id)) { const keep = p.cells.filter(i => i < nb.rows * nb.cols && !nb.mask.includes(i)); if (keep.length !== p.cells.length) await savePlanting({ ...p, cells: keep }); }
    }
    await saveBed(nb); closeSheet(); toast('Bed saved'); if (S.mode === 'align') S.alignDraft = facingQuad(S.alignDraft || defaultQuad(false), S.alignFacing || 'N', nb); render();
  },
  'delete-bed': async el => {
    const b = bedById(el.dataset.id); const n = plantingsOf(b.id).length + photosOf(b.id).length;
    if (!confirm(`Delete “${b.name}”${n ? ` and its ${plural(photosOf(b.id).length, 'photo')} and ${plural(plantingsOf(b.id).length, 'planting')}` : ''}? This cannot be undone.`)) return;
    for (const ph of photosOf(b.id)) await deletePhoto(ph.id);
    for (const s of shotsOf(b.id)) await deleteShot(s.id);
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
  'align-reset': () => { S.alignDraft = facingQuad(defaultQuad(false), S.alignFacing || 'N', bedById(S.bedId)); render(); },
  'grid-rotate': el => { const r = $('#stage').getBoundingClientRect(); S.alignDraft = rotateQuad(S.alignDraft, r.width, r.height, +el.dataset.deg); redrawAlign($('#stage')); },
  'grid-scale': el => { const r = $('#stage').getBoundingClientRect(); S.alignDraft = scaleQuad(S.alignDraft, r.width, r.height, +el.dataset.k); redrawAlign($('#stage')); },
  'grid-mirror': () => { S.alignDraft = mirrorQuad(S.alignDraft); redrawAlign($('#stage')); },
  'check-update': async () => {
    toast('Checking for a newer version…');
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* offline */ }
    setTimeout(() => location.reload(), 1200);
  },
  'align-cancel': () => { S.mode = 'view'; S.alignDraft = null; S.alignFacing = null; render(); },
  'set-facing': el => { S.alignFacing = el.dataset.f; S.alignDraft = facingQuad(S.alignDraft || defaultQuad(false), S.alignFacing, bedById(S.bedId)); render(); },
  'rotate-photo': el => rotatePhoto(el.dataset.id),
  'align-save': async () => {
    const bed = bedById(S.bedId); const ph = currentPhoto(bed); if (!ph || !S.alignDraft) return;
    await savePhoto({ ...ph, quad: S.alignDraft.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]), facing: S.alignFacing || ph.facing || 'N' });
    S.mode = 'view'; S.alignDraft = null; S.alignFacing = null; toast('Grid aligned'); render();
  },
  'compare-start': () => { S.mode = 'compare'; S.compareId = null; render(); },
  'compare-end': () => { S.mode = 'view'; S.compareId = null; render(); },
  'shot-camera': el => { S.shotBed = el.dataset.bed; S.shotPlanting = el.dataset.planting || null; $('#file-shot').click(); },
  'shot-library': el => { S.shotBed = el.dataset.bed; S.shotPlanting = el.dataset.planting || null; $('#file-shot-lib').click(); },
  'shot-open': el => shotSheet(el.dataset.id),
  'shot-edit': el => { closeSheet(); shotTagForm(el.dataset.id, null); },
  'shot-plant': el => { SF.plantingId = el.dataset.id || null; $$('[data-act="shot-plant"]').forEach(b => b.classList.toggle('on', (b.dataset.id || null) === SF.plantingId)); },
  'shot-part': el => { SF.part = el.dataset.p; $$('[data-act="shot-part"]').forEach(b => b.classList.toggle('on', b.dataset.p === SF.part)); updatePartHow(); },
  'shot-symptom': el => { const k = el.dataset.k; SF.symptoms = SF.symptoms.includes(k) ? SF.symptoms.filter(x => x !== k) : [...SF.symptoms, k]; el.classList.toggle('on', SF.symptoms.includes(k)); },
  'shot-save': async () => {
    const { batch, ...rest } = SF;
    const pl = rest.plantingId ? plantingById(rest.plantingId) : null;
    await saveShot({ ...rest, cropKey: pl ? pl.cropKey : null, note: (rest.note || '').trim() });
    const next = batch && batch.filter(id => id !== rest.id);
    SF = null; closeSheet(); render();
    if (next && next.length) { toast(`Saved. ${plural(next.length, 'close-up')} left to tag.`); shotTagForm(next[0], next); }
    else { toast('Close-up saved'); shotSheet(rest.id); }
  },
  'shot-delete': async el => {
    if (!confirm('Delete this close-up?')) return;
    await deleteShot(el.dataset.id); SF = null; closeSheet(); toast('Deleted'); render();
  },
  'shot-share': async el => {
    const shot = S.shots.find(s => s.id === el.dataset.id); if (!shot) return;
    const text = shotContext(shot);
    try {
      const blob = await DB.get('blobs', shot.id);
      const file = blob && blob.full ? new File([blob.full], `closeup-${isoDate(new Date(shot.takenAt))}.jpg`, { type: 'image/jpeg' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: 'Garden close-up' }); return; }
      if (navigator.share) { await navigator.share({ text, title: 'Garden close-up' }); return; }
      await navigator.clipboard.writeText(text); toast('Context copied. Paste it with the photo.');
    } catch (e) { if (e && e.name === 'AbortError') return; try { await navigator.clipboard.writeText(text); toast('Context copied. Paste it with the photo.'); } catch (_) { toast('Could not share on this browser'); } }
  },
  'shot-guide': () => openSheet(`<h3>🔬 What to shoot ${xBtn}</h3>
    <p class="hint" style="margin-bottom:10px">Six frames answer nearly every plant-health question. You do not need all six every time, but the underside of a leaf is the one worth making a habit.</p>
    <div class="log-list">${SHOT_PARTS.map(x => `<div class="log-item"><div class="h">${x.emoji}</div><div><b>${esc(x.label)}</b><br><span class="hint">${esc(x.how)}</span></div></div>`).join('')}</div>
    <div class="section"><h2>Getting a usable frame</h2></div>
    <ul class="tips">${CAPTURE_TIPS.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`),
  'garden-zoom': el => { S.gardenZoom = clamp(S.gardenZoom * (+el.dataset.z > 0 ? 1.25 : 0.8), 0.4, 4); render(); },
  'garden-arrange': () => { S.gardenArrange = !S.gardenArrange; render(); },
  'garden-plant': el => { if (S.gardenArrange) return; plantingForm(el.dataset.bed, null, +el.dataset.idx); },
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
    if (el.classList.contains('off')) return;
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
    for (const s of shotsOfPlanting(el.dataset.id)) await saveShot({ ...s, plantingId: null }); // keep the photo, drop the link
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
  const shots = [];
  for (const s of S.shots) { const b = await DB.get('blobs', s.id); shots.push({ ...s, full: b ? await toDataURL(b.full) : null, thumb: b && b.thumb ? await toDataURL(b.thumb) : null }); }
  const data = { app: 'master-gardener', version: APP_VERSION, exportedAt: new Date().toISOString(), settings: S.settings, beds: S.beds, plantings: S.plantings, logs: S.logs, photos, shots };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `master-gardener-${isoDate(new Date())}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`Backup ready: ${plural(photos.length, 'photo')}, ${plural(shots.length, 'close-up')}, ${plural(S.plantings.length, 'planting')}`);
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'master-gardener') throw new Error('Not a Master Gardener backup');
    if (!confirm(`Import ${plural((data.beds || []).length, 'bed')}, ${plural((data.plantings || []).length, 'planting')}, ${plural((data.photos || []).length, 'photo')}, ${plural((data.shots || []).length, 'close-up')}? Existing items with the same id are replaced.`)) return;
    toast('Importing…');
    await DB.putMany('beds', data.beds || []); await DB.putMany('plantings', data.plantings || []); await DB.putMany('logs', data.logs || []);
    for (const [store, list] of [['photos', data.photos || []], ['shots', data.shots || []]]) {
      for (const p of list) {
        const { full, thumb, ...meta } = p;
        if (full) { const fb = await (await fetch(full)).blob(); const tb = thumb ? await (await fetch(thumb)).blob() : fb; await DB.put('blobs', { id: meta.id, full: fb, thumb: tb }); }
        await DB.put(store, meta);
      }
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
    const ptrs = new Map(); let g = null;
    const rect = () => stage.getBoundingClientRect();
    const norm = ev => { const r = rect(); return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]; };
    const px = ([x, y]) => { const r = rect(); return [x * r.width, y * r.height]; };
    const snapshot = () => S.alignDraft.map(p => [...p]);
    const startGesture = () => {
      const list = [...ptrs.values()];
      if (list.length >= 2) g = { type: 'pinch', ids: [...ptrs.keys()].slice(0, 2), a0: list[0].pt, b0: list[1].pt, quad0: snapshot() };
      else if (list.length === 1) g = list[0].corner != null ? { type: 'corner', idx: list[0].corner } : { type: 'move', start: list[0].pt, quad0: snapshot() };
      else g = null;
    };
    stage.addEventListener('pointerdown', ev => {
      if (ev.target.closest('input')) return;
      const h = ev.target.closest('.handle-dot');
      ptrs.set(ev.pointerId, { pt: norm(ev), corner: h ? +h.dataset.corner : null });
      try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic or already-released pointer */ }
      ev.preventDefault(); startGesture();
    });
    stage.addEventListener('pointermove', ev => {
      const rec = ptrs.get(ev.pointerId); if (!rec || !g) return;
      rec.pt = norm(ev);
      if (g.type === 'corner') { S.alignDraft[g.idx] = [clamp(rec.pt[0], -0.1, 1.1), clamp(rec.pt[1], -0.1, 1.1)]; }
      else if (g.type === 'move') { const dx = rec.pt[0] - g.start[0], dy = rec.pt[1] - g.start[1]; S.alignDraft = g.quad0.map(([x, y]) => [x + dx, y + dy]); }
      else if (g.type === 'pinch') {
        const a = ptrs.get(g.ids[0]), b = ptrs.get(g.ids[1]); if (!a || !b) return;
        const [a0, b0, a1, b1] = [g.a0, g.b0, a.pt, b.pt].map(px);
        const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1, d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
        const k = d1 / d0, th = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
        const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], m1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
        const c = Math.cos(th), s = Math.sin(th), r = rect();
        S.alignDraft = g.quad0.map(p => { const x = p[0] * r.width - m0[0], y = p[1] * r.height - m0[1]; return [(k * (x * c - y * s) + m1[0]) / r.width, (k * (x * s + y * c) + m1[1]) / r.height]; });
      }
      redrawAlign(stage);
    });
    const end = ev => { ptrs.delete(ev.pointerId); startGesture(); };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  }
  /* Season timeline: slide from the day the first thing went in through to today. */
  const tl = $('#tl-range');
  if (tl) {
    const bed = bedById(S.bedId), span = bedSpan(bed);
    let raf = 0;
    const paint = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; refreshScrubView(span); }); };
    const setDay = d => { const v = clamp(d, 0, span.days); tl.value = v; S.scrub = v >= span.days ? null : +addDays(span.start, v); paint(); };
    tl.addEventListener('input', () => setDay(+tl.value));
    if (S.playing) {
      const step = Math.max(1, Math.ceil(span.days / 40));
      clearInterval(S.playTimer);
      S.playTimer = setInterval(() => {
        const next = +tl.value + step;
        if (next >= span.days) { setDay(span.days); stopPlay(); render(); return; }
        setDay(next);
      }, 200);
    }
  }
  const chips = $('#bed-switch-chips');
  if (chips) { const on = $('.bed-chip.on', chips); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  const garden = $('#garden');
  if (garden && S.gardenArrange) {
    const scale = +garden.dataset.scale, minX = +garden.dataset.minx, minY = +garden.dataset.miny;
    let drag = null;
    garden.addEventListener('pointerdown', ev => {
      const el = ev.target.closest('.gbed'); if (!el) return;
      const bed = bedById(el.dataset.bed); if (!bed) return;
      drag = { el, bed, sx: ev.clientX, sy: ev.clientY, x0: bed.x, y0: bed.y };
      try { garden.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ }
      el.classList.add('lifted'); ev.preventDefault();
    });
    garden.addEventListener('pointermove', ev => {
      if (!drag) return;
      const nx = Math.round((drag.x0 + (ev.clientX - drag.sx) / scale) * 2) / 2, ny = Math.round((drag.y0 + (ev.clientY - drag.sy) / scale) * 2) / 2;
      drag.nx = nx; drag.ny = ny;
      drag.el.style.left = `${((nx - minX) * scale).toFixed(1)}px`; drag.el.style.top = `${((ny - minY) * scale).toFixed(1)}px`;
    });
    const end = async () => {
      if (!drag) return; const d = drag; drag = null; d.el.classList.remove('lifted');
      if (d.nx != null && (d.nx !== d.x0 || d.ny !== d.y0)) { await saveBed({ ...d.bed, x: d.nx, y: d.ny }); render(); }
    };
    garden.addEventListener('pointerup', end); garden.addEventListener('pointercancel', end);
  }
  const straighten = $('#straighten');
  if (straighten) {
    const img = $('#stage img.stage-img'), val = $('#straighten-val');
    straighten.addEventListener('input', () => { if (img) img.style.transform = `rotate(${straighten.value}deg)`; val.textContent = `${(+straighten.value).toFixed(1).replace(/\.0$/, '')}°`; });
    straighten.addEventListener('change', async () => {
      const deg = +straighten.value; if (!deg) return;
      const bed = bedById(S.bedId); const ph = currentPhoto(bed); if (!ph) return;
      await straightenPhoto(ph.id, deg);
    });
  }
  const range = $('#cmp-range');
  if (range) {
    const apply = () => { const v = +range.value; $('#cmp-top').style.clipPath = `inset(0 ${100 - v}% 0 0)`; $('#cmp-div').style.left = `${v}%`; };
    range.addEventListener('input', apply); apply();
  }
}
function stopPlay() { S.playing = false; clearInterval(S.playTimer); S.playTimer = null; }
/* Repaint only the stage and the timeline header, so dragging stays smooth. */
async function refreshScrubView(span) {
  const bed = bedById(S.bedId); if (!bed) return;
  const photo = currentPhoto(bed), asOf = asOfFor(bed, photo);
  const historical = S.scrub != null ? daysBetween(asOf, new Date()) !== 0 : false;
  const html = await renderStage(bed, photo, asOf, historical);
  const wrap = $('.stage-wrap'); if (wrap) wrap.outerHTML = html;
  const live = S.scrub == null, at = live ? new Date() : new Date(S.scrub);
  const growing = plantingsOf(bed.id).filter(p => activeAt(p, at)).length;
  const head = $('.tl-head .grow');
  if (head) head.innerHTML = `<b>${live ? 'Today' : fmtDateY(at)}</b><span class="hint"> · ${live ? 'live' : `${plural(daysBetween(at, new Date()), 'day')} ago`} · ${plural(growing, 'planting')} in the ground</span>`;
  const bar = $('.tl-head'), nowBtn = $('[data-act="tl-now"]');
  if (live && nowBtn) nowBtn.remove();
  else if (!live && !nowBtn && bar) bar.insertAdjacentHTML('beforeend', `<button class="btn small" data-act="tl-now">Now</button>`);
  /* keep the photo strip pointing at whatever the stage is showing */
  $$('.strip .thumb').forEach(t => t.classList.toggle('active', photo ? t.dataset.id === photo.id : t.dataset.id === 'map'));
}

function redrawAlign(stage) {
  const bed = bedById(S.bedId); const q = S.alignDraft; const H = homography(q);
  const svg = $('svg.overlay', stage);
  let polys = `<polygon class="frame" points="${pts(q)}"></polygon>`;
  for (let r = 0; r < bed.rows; r++) for (let c = 0; c < bed.cols; c++) { if (isMasked(bed, r * bed.cols + c)) continue; polys += `<polygon class="cell" points="${pts(cellPoly(H, bed.rows, bed.cols, r, c))}"></polygon>`; }
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
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && $('#sheet-root').firstChild) { closeSheet(); return; }
  if (S.view !== 'bed' || S.mode !== 'view' || $('#sheet-root').firstChild) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepBed(-1); }
  if (ev.key === 'ArrowRight') { ev.preventDefault(); stepBed(1); }
});
$$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.tab === 'beds' ? '#/beds' : `#/${t.dataset.tab}`)));
window.addEventListener('resize', () => { if (S.view === 'garden') render(); });
$('#back-btn').addEventListener('click', () => go('#/beds'));
$('#file-camera').addEventListener('change', e => { importFiles(e.target.files, S.bedId); e.target.value = ''; });
$('#file-library').addEventListener('change', e => { importFiles(e.target.files, S.bedId); e.target.value = ''; });
$('#file-import').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
$('#file-shot').addEventListener('change', e => { importShots(e.target.files, S.shotBed || S.bedId, S.shotPlanting); e.target.value = ''; });
$('#file-shot-lib').addEventListener('change', e => { importShots(e.target.files, S.shotBed || S.bedId, S.shotPlanting); e.target.value = ''; });
/* Drag & drop. A .dropzone wins and takes close-ups (it works inside sheets too);
   anywhere else on a bed view adds bed photos. Bound once at document level. */
(() => {
  const main = $('#view');
  const zoneOf = t => (t && t.closest ? t.closest('.dropzone') : null);
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let hot = null;
  const clear = () => { if (hot) hot.classList.remove('over'); hot = null; main.classList.remove('drag-over'); };
  document.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const z = zoneOf(e.target);
    if (z !== hot) { if (hot) hot.classList.remove('over'); hot = z; if (z) z.classList.add('over'); }
    main.classList.toggle('drag-over', !z && S.view === 'bed');
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) clear(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) { clear(); return; }
    e.preventDefault();
    const z = zoneOf(e.target), files = e.dataTransfer.files;
    clear();
    if (!files.length) return;
    if (z && z.dataset.kind === 'shot') { importShots(files, z.dataset.bed || S.bedId, z.dataset.planting || null); return; }
    if (S.view === 'bed') importFiles(files, S.bedId);
    else toast('Open a bed first, then drop photos on it');
  });
  /* Paste an image straight into the open bed as a close-up. */
  document.addEventListener('paste', e => {
    if (S.view !== 'bed' || !e.clipboardData || $('#sheet-root').firstChild) return;
    const files = Array.from(e.clipboardData.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    importShots(files, S.bedId, null);
  });
})();
/* Swipe left/right across the bed view to shuffle beds (bound once; #view survives re-renders). */
(() => {
  const view = $('#view'); let sw = null;
  const live = () => S.view === 'bed' && S.mode === 'view' && S.beds.length > 1 && !$('#sheet-root').firstChild;
  view.addEventListener('pointerdown', ev => {
    sw = live() && !ev.target.closest('.strip, .stage-toolbar, .bed-switch-chips, input, textarea, select, button') ? { x: ev.clientX, y: ev.clientY, t: Date.now() } : null;
  });
  view.addEventListener('pointerup', ev => {
    const s = sw; sw = null; if (!s || !live()) return;
    const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.t > 800) return;
    stepBed(dx < 0 ? 1 : -1);
  });
  view.addEventListener('pointercancel', () => { sw = null; });
})();
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { if (S.view === 'bed') render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); loadWeather(false); } });

(async function boot() {
  try { await loadAll(); }
  catch (e) { console.error(e); $('#view').innerHTML = `<div class="empty"><strong>Storage unavailable</strong>${esc(e.message)}. Private browsing on some phones blocks IndexedDB.</div>`; return; }
  route();
  loadWeather(false);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller; let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return; reloading = true;
      toast('Updated to the latest version. Reloading…'); setTimeout(() => location.reload(), 800);
    });
    navigator.serviceWorker.register('sw.js').then(reg => reg.update().catch(() => {})).catch(() => {});
  }
})();
})();
