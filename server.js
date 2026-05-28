require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10e6 });

app.use(express.json({ limit: '1mb' }));

// URL canoniques : /index.html → /
app.get('/index.html', (_req, res) => res.redirect(301, '/'));

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'allow', // pour servir /.well-known/security.txt
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    if (/security\.txt$/.test(filePath)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
  }
}));

// ---------- Persistence ----------
const DATA_DIR = path.join(__dirname, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let vapid;
if (fs.existsSync(VAPID_FILE)) {
  vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2));
}
webpush.setVapidDetails(
  process.env.VAPID_CONTACT || 'mailto:admin@bastienbrousse.pro',
  vapid.publicKey,
  vapid.privateKey
);

// subs[roomHash] = [{ endpoint, keys: { p256dh, auth } }, ...]
let subs = {};
try { if (fs.existsSync(SUBS_FILE)) subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); }
catch { subs = {}; }

let subsSaveTimer = null;
function saveSubsDebounced() {
  clearTimeout(subsSaveTimer);
  subsSaveTimer = setTimeout(() => {
    fs.writeFile(SUBS_FILE, JSON.stringify(subs), () => {});
  }, 400);
}

// ---------- Server-side encrypted message history ----------
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
if (!fs.existsSync(ROOMS_DIR)) fs.mkdirSync(ROOMS_DIR, { recursive: true });
const HIST_TTL_MS = 6 * 60 * 60 * 1000;   // 6 heures
const HIST_MAX_PER_ROOM = 2000;
const histCache = new Map();        // roomHash -> array
const histSaveTimers = new Map();   // roomHash -> timer

function histFile(roomHash) { return path.join(ROOMS_DIR, roomHash + '.json'); }

function loadHistory(roomHash) {
  if (histCache.has(roomHash)) return histCache.get(roomHash);
  let list = [];
  try {
    if (fs.existsSync(histFile(roomHash))) {
      const arr = JSON.parse(fs.readFileSync(histFile(roomHash), 'utf8'));
      if (Array.isArray(arr)) list = arr;
    }
  } catch {}
  const cutoff = Date.now() - HIST_TTL_MS;
  list = list.filter(m => m && typeof m.ts === 'number' && m.ts >= cutoff);
  histCache.set(roomHash, list);
  return list;
}

function saveHistoryDebounced(roomHash) {
  clearTimeout(histSaveTimers.get(roomHash));
  histSaveTimers.set(roomHash, setTimeout(() => {
    const list = histCache.get(roomHash) || [];
    if (!list.length) {
      fs.unlink(histFile(roomHash), () => {});
    } else {
      fs.writeFile(histFile(roomHash), JSON.stringify(list), () => {});
    }
  }, 500));
}

function appendHistory(roomHash, entry) {
  const list = loadHistory(roomHash);
  list.push(entry);
  if (list.length > HIST_MAX_PER_ROOM) list.splice(0, list.length - HIST_MAX_PER_ROOM);
  saveHistoryDebounced(roomHash);
}

// Purge globale toutes les heures
setInterval(() => {
  const cutoff = Date.now() - HIST_TTL_MS;
  for (const [h, list] of histCache.entries()) {
    const kept = list.filter(m => m.ts >= cutoff);
    if (kept.length !== list.length) {
      histCache.set(h, kept);
      saveHistoryDebounced(h);
    }
  }
}, 60 * 60 * 1000);

function hashCode(code) {
  return crypto.createHash('sha256').update('murmure-room::' + code).digest('hex');
}

// ---------- Turnstile (Cloudflare) ----------
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_ENABLED = !!(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
if (!TURNSTILE_ENABLED) {
  console.warn('[turnstile] désactivé (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY non définis). Le captcha sera bypassé.');
}

// Clé HMAC pour signer le token de passage (persistée pour survivre aux redémarrages)
const PASS_SECRET_FILE = path.join(DATA_DIR, 'pass-secret');
let PASS_SECRET;
try {
  if (fs.existsSync(PASS_SECRET_FILE)) PASS_SECRET = fs.readFileSync(PASS_SECRET_FILE);
  else {
    PASS_SECRET = crypto.randomBytes(32);
    fs.writeFileSync(PASS_SECRET_FILE, PASS_SECRET, { mode: 0o600 });
  }
} catch { PASS_SECRET = crypto.randomBytes(32); }

const PASS_TTL_MS = 10 * 60 * 1000; // 10 min de validité après verify
const usedPassJti = new Map(); // jti -> exp (anti-rejeu)
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of usedPassJti) if (exp < now) usedPassJti.delete(k);
}, 60 * 1000);

function signPass(ip) {
  const jti = crypto.randomBytes(12).toString('hex');
  const exp = Date.now() + PASS_TTL_MS;
  const ipHash = crypto.createHash('sha256').update('murmure-ip::' + ip).digest('hex').slice(0, 16);
  const payload = `${jti}.${exp}.${ipHash}`;
  const sig = crypto.createHmac('sha256', PASS_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyPass(token, ip) {
  if (typeof token !== 'string') return { ok: false, error: 'no_token' };
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, error: 'malformed' };
  const [jti, expStr, ipHash, sig] = parts;
  const payload = `${jti}.${expStr}.${ipHash}`;
  const expected = crypto.createHmac('sha256', PASS_SECRET).update(payload).digest('hex');
  let sigOk = false;
  try { sigOk = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); }
  catch { sigOk = false; }
  if (!sigOk) return { ok: false, error: 'bad_sig' };
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return { ok: false, error: 'expired' };
  const ipHashNow = crypto.createHash('sha256').update('murmure-ip::' + ip).digest('hex').slice(0, 16);
  if (ipHash !== ipHashNow) return { ok: false, error: 'ip_mismatch' };
  if (usedPassJti.has(jti)) return { ok: false, error: 'replay' };
  usedPassJti.set(jti, exp);
  return { ok: true };
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_ENABLED) return { success: true, bypass: true };
  if (typeof token !== 'string' || token.length < 10) return { success: false, error: 'no_token' };
  if (typeof fetch !== 'function') return { success: false, error: 'no_fetch' };
  try {
    const body = new URLSearchParams();
    body.set('secret', TURNSTILE_SECRET_KEY);
    body.set('response', token);
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await r.json();
    return { success: !!data.success, codes: data['error-codes'] || [] };
  } catch (e) { return { success: false, error: e.message || 'fetch_failed' }; }
}

// ---------- Rate-limit (par IP) ----------
const RL = {
  verify: { window: 60_000, max: 10, hits: new Map() },     // POST /api/captcha-verify
  join:   { window: 60_000, max: 20, hits: new Map() }      // socket join
};
function rateLimit(bucket, key) {
  const now = Date.now();
  const arr = bucket.hits.get(key) || [];
  const kept = arr.filter(t => now - t < bucket.window);
  if (kept.length >= bucket.max) {
    bucket.hits.set(key, kept);
    return { ok: false, retryAfter: Math.ceil((bucket.window - (now - kept[0])) / 1000) };
  }
  kept.push(now);
  bucket.hits.set(key, kept);
  return { ok: true };
}
setInterval(() => {
  const now = Date.now();
  for (const b of [RL.verify, RL.join]) {
    for (const [k, arr] of b.hits) {
      const kept = arr.filter(t => now - t < b.window);
      if (!kept.length) b.hits.delete(k); else b.hits.set(k, kept);
    }
  }
}, 60 * 1000);

function normIp(ip) {
  if (!ip) return 'unknown';
  // Strip IPv6-mapped IPv4 prefix
  return ip.replace(/^::ffff:/, '');
}
function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return normIp(xf || req.socket?.remoteAddress);
}
function socketIp(socket) {
  const xf = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return normIp(xf || socket.handshake.address);
}

// ---------- Rooms (in-memory) ----------
const rooms = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms.entries()) {
    if (r.sockets.size === 0 && now - r.createdAt > 10 * 60 * 1000) rooms.delete(k);
  }
}, 60 * 1000);

// ---------- IndexNow ping (Bing, Yandex, …) ----------
const INDEXNOW_KEY = '6fc3320d14d1ad32424fc8e23fed0add';
const INDEXNOW_HOST = 'chat.bastienbrousse.pro';
const INDEXNOW_URLS = [
  `https://${INDEXNOW_HOST}/`,
  `https://${INDEXNOW_HOST}/alternative-signal.html`,
  `https://${INDEXNOW_HOST}/chiffrement-bout-en-bout-explication.html`,
  `https://${INDEXNOW_HOST}/comparaison-messageries-chiffrees.html`,
  `https://${INDEXNOW_HOST}/comment-partager-mot-de-passe.html`
];

async function pingIndexNow() {
  if (typeof fetch !== 'function') return { ok: false, error: 'no_fetch' };
  try {
    const r = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: INDEXNOW_URLS
      })
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

const INDEXNOW_ADMIN_TOKEN = process.env.INDEXNOW_ADMIN_TOKEN || '';
app.post('/api/indexnow-ping', async (req, res) => {
  if (!INDEXNOW_ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'admin_token_disabled' });
  if ((req.headers['x-admin-token'] || '') !== INDEXNOW_ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const r = await pingIndexNow();
  console.log('[indexnow] ping result', r);
  res.json(r);
});

// ---------- VAPID public key ----------
app.get('/api/vapid', (_req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

// ---------- Turnstile config + verify ----------
app.get('/api/turnstile/config', (_req, res) => {
  res.json({ enabled: TURNSTILE_ENABLED, siteKey: TURNSTILE_SITE_KEY || null });
});

app.post('/api/captcha-verify', async (req, res) => {
  const ip = clientIp(req);
  const rl = rateLimit(RL.verify, ip);
  if (!rl.ok) {
    res.setHeader('retry-after', String(rl.retryAfter));
    return res.status(429).json({ ok: false, error: 'rate_limited', retryAfter: rl.retryAfter });
  }
  const token = (req.body && req.body.token) || '';
  const r = await verifyTurnstile(token, ip);
  if (!r.success) {
    console.warn('[captcha] échec verify', ip, r);
    return res.status(400).json({ ok: false, error: r.error || 'captcha_failed', codes: r.codes });
  }
  const pass = signPass(ip);
  res.json({ ok: true, pass, ttlMs: PASS_TTL_MS, bypass: !!r.bypass });
});

// ---------- Push subscribe / unsubscribe ----------
app.post('/api/subscribe', (req, res) => {
  const { code, subscription } = req.body || {};
  if (typeof code !== 'string' || code.length < 4 || code.length > 128) return res.status(400).json({ error: 'bad code' });
  if (!subscription || !subscription.endpoint || !subscription.keys) return res.status(400).json({ error: 'bad sub' });
  const room = hashCode(code);
  if (!subs[room]) subs[room] = [];
  const exists = subs[room].some(s => s.endpoint === subscription.endpoint);
  if (!exists) subs[room].push({ endpoint: subscription.endpoint, keys: subscription.keys });
  saveSubsDebounced();
  res.json({ ok: true, count: subs[room].length });
});

app.post('/api/unsubscribe', (req, res) => {
  const { code, endpoint } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'bad code' });
  const room = hashCode(code);
  if (subs[room]) {
    subs[room] = subs[room].filter(s => s.endpoint !== endpoint);
    if (!subs[room].length) delete subs[room];
    saveSubsDebounced();
  }
  res.json({ ok: true });
});

async function pushToRoom(roomHash, payload, excludeEndpoint) {
  const list = subs[roomHash] || [];
  const dead = [];
  let sent = 0;
  await Promise.all(list.map(async (s) => {
    if (excludeEndpoint && s.endpoint === excludeEndpoint) return;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        JSON.stringify(payload),
        { TTL: 300, urgency: 'high' }
      );
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.endpoint);
    }
  }));
  if (dead.length) {
    subs[roomHash] = (subs[roomHash] || []).filter(s => !dead.includes(s.endpoint));
    if (!subs[roomHash].length) delete subs[roomHash];
    saveSubsDebounced();
  }
  return sent;
}

// ---------- Link preview (OG/Twitter cards) ----------
const previewCache = new Map(); // url -> { at, data }
const PREVIEW_TTL = 6 * 60 * 60 * 1000; // 6h
const PREVIEW_MAX_BYTES = 512 * 1024;

function isUrlSafe(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    if (!h) return false;
    if (h === 'localhost' || h === '0.0.0.0') return false;
    if (/^127\./.test(h)) return false;
    if (/^10\./.test(h)) return false;
    if (/^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (/^169\.254\./.test(h)) return false;
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return false;
    return true;
  } catch { return false; }
}

function pickMeta(html, key) {
  // property="og:..." or name="..."
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["'][^>]+content=["']([^"']+)["']`, 'i'
  );
  let m = html.match(re);
  if (m) return m[1];
  // content-first ordering
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["']`, 'i'
  );
  m = html.match(re2);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function fetchPreview(rawUrl) {
  if (typeof fetch !== 'function') {
    console.error('[preview] Node sans fetch global (v18+ requis). Version actuelle:', process.version);
    return null;
  }
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(rawUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ctl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MurmureBot/1.0; +https://chat.bastienbrousse.pro)',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'fr,en;q=0.8'
      }
    });
    if (!res.ok) { console.warn('[preview] status', res.status, 'pour', rawUrl); return null; }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('html') && !ct.includes('xml')) { console.warn('[preview] content-type non html:', ct, 'pour', rawUrl); return null; }

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= PREVIEW_MAX_BYTES) { try { reader.cancel(); } catch {} break; }
    }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).slice(0, PREVIEW_MAX_BYTES));

    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const title = decodeEntities(
      pickMeta(html, 'og:title') ||
      pickMeta(html, 'twitter:title') ||
      (titleTag ? titleTag.trim() : null)
    );
    const description = decodeEntities(
      pickMeta(html, 'og:description') ||
      pickMeta(html, 'twitter:description') ||
      pickMeta(html, 'description')
    );
    let image = pickMeta(html, 'og:image') || pickMeta(html, 'twitter:image');
    if (image) {
      try { image = new URL(image, res.url || rawUrl).href; } catch {}
    }
    const siteName = decodeEntities(pickMeta(html, 'og:site_name'));
    const finalUrl = res.url || rawUrl;
    const hostname = (() => { try { return new URL(finalUrl).hostname; } catch { return null; } })();

    if (!title && !description && !image) return null;
    return {
      url: finalUrl,
      hostname,
      siteName,
      title: title ? title.slice(0, 300) : null,
      description: description ? description.slice(0, 500) : null,
      image
    };
  } catch (e) { console.warn('[preview] fetch échoué:', e.message); return null; }
  finally { clearTimeout(to); }
}

// ---------- Giphy GIF proxy ----------
const GIPHY_KEY = process.env.GIPHY_API_KEY || '';
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

function pickGiphy(images, key) {
  const im = images && images[key];
  if (!im || !im.url) return null;
  return {
    url: im.url,
    dims: (im.width && im.height) ? [Number(im.width), Number(im.height)] : null
  };
}

function simplifyGiphy(json) {
  const list = Array.isArray(json && json.data) ? json.data : [];
  const results = list.map(r => {
    const im = r.images || {};
    return {
      id: r.id,
      title: r.title || '',
      preview: pickGiphy(im, 'fixed_width_small') || pickGiphy(im, 'fixed_width_downsampled') || pickGiphy(im, 'preview_gif') || pickGiphy(im, 'fixed_width'),
      tiny: pickGiphy(im, 'fixed_width') || pickGiphy(im, 'downsized') || pickGiphy(im, 'original'),
      gif: pickGiphy(im, 'original') || pickGiphy(im, 'downsized_large') || pickGiphy(im, 'fixed_width')
    };
  }).filter(r => r.preview && r.gif);
  const pag = (json && json.pagination) || {};
  const next = (Number(pag.offset || 0) + Number(pag.count || 0));
  return { results, next: String(next || '') };
}

async function giphyRequest(endpoint, params) {
  if (!GIPHY_KEY) return { error: 'GIPHY_API_KEY non configurée côté serveur.' };
  if (typeof fetch !== 'function') return { error: 'Node v18+ requis.' };
  const url = new URL(GIPHY_BASE + endpoint);
  url.searchParams.set('api_key', GIPHY_KEY);
  url.searchParams.set('rating', 'pg-13');
  url.searchParams.set('lang', 'fr');
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return { error: 'Giphy ' + r.status };
    return simplifyGiphy(await r.json());
  } catch (e) {
    return { error: e.message || 'fetch_failed' };
  }
}

app.get('/api/gifs/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json({ results: [] });
  const offset = String(req.query.pos || req.query.offset || '0');
  const data = await giphyRequest('/search', { q, offset, limit: 24 });
  if (data && data.error) res.setHeader('cache-control', 'no-store');
  else res.setHeader('cache-control', 'public, max-age=300');
  res.json(data);
});

app.get('/api/gifs/featured', async (req, res) => {
  const offset = String(req.query.pos || req.query.offset || '0');
  const data = await giphyRequest('/trending', { offset, limit: 24 });
  if (data && data.error) res.setHeader('cache-control', 'no-store');
  else res.setHeader('cache-control', 'public, max-age=300');
  res.json(data);
});

app.get('/api/preview', async (req, res) => {
  const url = String(req.query.url || '');
  if (!isUrlSafe(url)) {
    console.warn('[preview] URL rejetée (SSRF/scheme):', url);
    return res.status(400).json({ error: 'invalid url' });
  }
  res.setHeader('cache-control', 'public, max-age=3600');
  const cached = previewCache.get(url);
  if (cached && (Date.now() - cached.at) < PREVIEW_TTL) {
    return res.json(cached.data || null);
  }
  const data = await fetchPreview(url);
  previewCache.set(url, { at: Date.now(), data });
  if (previewCache.size > 500) {
    const oldest = [...previewCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) previewCache.delete(oldest[0]);
  }
  console.log('[preview]', url, data ? `OK (${data.title || '(sans titre)'})` : 'aucune méta');
  res.json(data);
});

// ---------- Socket.io ----------
const callCooldown = new Map(); // roomHash -> last ts

io.on('connection', (socket) => {
  let roomId = null;
  let joinedCode = null;

  socket.on('join', ({ code, pass } = {}, ack) => {
    const ip = socketIp(socket);
    const rl = rateLimit(RL.join, ip);
    if (!rl.ok) {
      return ack && ack({ ok: false, error: `Trop de tentatives. Réessaie dans ${rl.retryAfter}s.` });
    }
    if (typeof code !== 'string' || code.length < 4 || code.length > 128) {
      return ack && ack({ ok: false, error: 'Code invalide (4-128 caractères).' });
    }
    const pv = verifyPass(pass, ip);
    if (!pv.ok) {
      return ack && ack({ ok: false, error: 'Captcha requis ou expiré. Recharge la page.', captchaError: pv.error });
    }
    const id = hashCode(code);
    let room = rooms.get(id);
    if (!room) {
      room = { sockets: new Set(), createdAt: Date.now() };
      rooms.set(id, room);
    }
    if (room.sockets.size >= 5) {
      return ack && ack({ ok: false, error: 'Salon plein (2 personnes max).' });
    }
    room.sockets.add(socket.id);
    roomId = id;
    joinedCode = code;
    socket.join(id);
    const peers = room.sockets.size;
    ack && ack({ ok: true, peers });

    // backlog chiffré (E2E préservé — serveur ne sait pas déchiffrer)
    const backlog = loadHistory(id);
    if (backlog.length) socket.emit('history', backlog);

    socket.to(id).emit('peer-joined', { peers });
  });

  socket.on('msg', (payload, ack) => {
    if (!roomId) return;
    if (!payload || typeof payload.iv !== 'string' || typeof payload.ct !== 'string') return;
    if (payload.ct.length > 10_000_000) return;
    const ts = Date.now();
    const entry = { iv: payload.iv, ct: payload.ct, ts, from: socket.id };
    appendHistory(roomId, entry);
    socket.to(roomId).emit('msg', entry);
    if (typeof ack === 'function') ack({ ok: true, ts });
  });

  socket.on('typing', (v) => {
    if (!roomId) return;
    socket.to(roomId).emit('typing', !!v);
  });

  socket.on('call', async ({ excludeEndpoint } = {}, ack) => {
    if (!roomId) return ack && ack({ ok: false, error: 'pas dans un salon' });
    const now = Date.now();
    const last = callCooldown.get(roomId) || 0;
    if (now - last < 20_000) {
      return ack && ack({ ok: false, error: 'Trop rapide — réessaie dans quelques secondes.' });
    }
    callCooldown.set(roomId, now);

    // realtime ping to connected peers
    socket.to(roomId).emit('incoming-call', { ts: now });

    // push notification to subscribed (even offline)
    let pushed = 0;
    try {
      pushed = await pushToRoom(roomId, {
        type: 'call',
        title: 'Murmure · Reviens',
        body: 'Quelqu\'un veut te parler — clique pour revenir.',
        url: '/chat.html'
      }, excludeEndpoint);
    } catch {}

    const connected = (rooms.get(roomId) ? rooms.get(roomId).sockets.size : 1) - 1;
    ack && ack({ ok: true, pushed, connected });
  });

  socket.on('disconnect', () => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
      room.sockets.delete(socket.id);
      socket.to(roomId).emit('peer-left', { peers: room.sockets.size });
      if (room.sockets.size === 0) room.createdAt = Date.now();
    }
  });
});

const PORT = process.env.PORT || 2704;
server.listen(PORT, () => {
  console.log(`Murmure sur http://localhost:${PORT}`);
});
