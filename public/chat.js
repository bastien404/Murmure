const code = sessionStorage.getItem('murmure:code');
if (!code) { location.href = '/'; }
const MY_PSEUDO = (sessionStorage.getItem('murmure:pseudo') || 'Anonyme').slice(0, 32);
let peerPseudo = null;
const titleEl = document.getElementById('title');
function updateTitleBar() {
  if (peerPseudo) titleEl.textContent = peerPseudo;
  else titleEl.textContent = 'Tu es ' + MY_PSEUDO;
}
updateTitleBar();

function refreshAuthorLabels() {
  const text = peerPseudo || '';
  for (const el of stream.querySelectorAll('.bubble.them .author')) {
    el.textContent = text;
    el.hidden = !text;
  }
}

const stream = document.getElementById('stream');
const statusEl = document.getElementById('status');
const orb = document.getElementById('status-orb');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const typingEl = document.getElementById('typing');
const leaveBtn = document.getElementById('leave');
const notifBtn = document.getElementById('notif-toggle');
const cbCode = document.getElementById('cb-code');
const cbFp = document.getElementById('cb-fp');
const cbToggle = document.getElementById('cb-toggle');
const cbCopy = document.getElementById('cb-copy');
const attachBtn = document.getElementById('attach-btn');
const attachInput = document.getElementById('attach-input');
const replyBar = document.getElementById('reply-bar');
const replySnippet = document.getElementById('reply-snippet');
const replyCancel = document.getElementById('reply-cancel');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const callBtn = document.getElementById('call-btn');
const gifBtn = document.getElementById('gif-btn');
const emojiPicker = document.getElementById('emoji-picker');
const gifPanel = document.getElementById('gif-panel');
const gifSearch = document.getElementById('gif-search');
const gifGrid = document.getElementById('gif-grid');
const gifClose = document.getElementById('gif-close');

let codeRevealed = false;
function maskCode(c) { return '•'.repeat(Math.min(c.length, 12)); }
function renderCode() {
  cbCode.textContent = codeRevealed ? code : maskCode(code);
}
renderCode();
cbToggle.addEventListener('click', () => { codeRevealed = !codeRevealed; renderCode(); });
cbCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code);
    const old = cbCopy.textContent;
    cbCopy.textContent = '✓';
    setTimeout(() => { cbCopy.textContent = old; }, 1200);
  } catch {}
});

// ----- Notifications -----
const baseTitle = document.title;
let unread = 0;
let notifEnabled = localStorage.getItem('murmure:notif') !== '0';
let audioCtx = null;

function refreshNotifBtn() {
  notifBtn.textContent = notifEnabled ? '🔔' : '🔕';
  notifBtn.title = notifEnabled ? 'Notifications activées' : 'Notifications coupées';
}
refreshNotifBtn();

notifBtn.addEventListener('click', async () => {
  notifEnabled = !notifEnabled;
  localStorage.setItem('murmure:notif', notifEnabled ? '1' : '0');
  refreshNotifBtn();
  if (notifEnabled) {
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
    }
    if (Notification.permission === 'granted') subscribePush().catch(() => {});
  } else {
    unsubscribePush().catch(() => {});
  }
});

window.addEventListener('pointerdown', function once() {
  window.removeEventListener('pointerdown', once);
  if (notifEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then((p) => {
      if (p === 'granted') subscribePush().catch(() => {});
    }).catch(() => {});
  } else if (notifEnabled && Notification.permission === 'granted') {
    subscribePush().catch(() => {});
  }
}, { once: true });

// ----- Push subscription -----
let swReg = null;
let pushSub = null;

function urlB64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  if (swReg) return swReg;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    return swReg;
  } catch (e) { return null; }
}

async function subscribePush() {
  if (!('PushManager' in window)) return;
  const reg = await registerSW();
  if (!reg) return;
  try {
    const r = await fetch('/api/vapid');
    const { publicKey } = await r.json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey)
      });
    }
    pushSub = sub;
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, subscription: sub.toJSON() })
    });
  } catch (e) {}
}

async function unsubscribePush() {
  try {
    if (!pushSub && swReg) pushSub = await swReg.pushManager.getSubscription();
    if (pushSub) {
      await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, endpoint: pushSub.endpoint })
      });
      try { await pushSub.unsubscribe(); } catch {}
      pushSub = null;
    }
  } catch (e) {}
}

function updateTitle() {
  document.title = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { unread = 0; updateTitle(); }
});

function beep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.27);
  } catch {}
}

function notifyIncoming(text) {
  if (!notifEnabled) return;
  beep();
  if (document.hidden) {
    unread++;
    updateTitle();
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('Murmure · Nouveau message', {
          body: text.length > 120 ? text.slice(0, 117) + '…' : (text || '[image]'),
          tag: 'murmure-msg',
          silent: false
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {}
    }
  }
}

// ----- Crypto -----
const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode('murmure::v1::salt');

async function deriveKey(passphrase) {
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 250000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function computeFingerprint(c) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode('murmure-fp::' + c));
  const bytes = new Uint8Array(buf);
  const hex = [...bytes.slice(0, 3)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.toUpperCase().match(/.{2}/g).join('-');
}

let aesKey = null;
let socket = null;
let peerCount = 1;
let typingTimer = null;
let myTypingState = false;
let myTypingStop = null;
let replyTarget = null;       // {id, text}
const messages = new Map();   // id -> {id, text, mine, img?}

async function encryptObject(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, enc.encode(JSON.stringify(obj))
  );
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptObject(p) {
  const iv = unb64(p.iv);
  const ct = unb64(p.ct);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  const str = dec.decode(plain);
  try { return JSON.parse(str); }
  catch { return { v: 0, text: str }; } // backward compat plain string
}

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ----- Réactions et accusés de lecture -----
// Nouveau modèle : un utilisateur peut poser PLUSIEURS réactions différentes sur un même message.
// reactions: targetId -> Map<emoji, Set<senderId>>
const reactions = new Map();
const seenIds = new Set();     // ids de MES messages vus par l'autre
const EMOJI_LIST = [
  '👍','👎','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💖','💗','💘','💝','💞','💓','💕','💟',
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
  '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬',
  '🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸',
  '😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱',
  '😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻',
  '👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾',
  '🙈','🙉','🙊','💋','💌','💯','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤',
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍',
  '👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂',
  '🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄',
  '🔥','✨','🎉','🎊','🎁','🎂','🍰','🍕','🍔','🍟','🌭','🥪','🌮','🌯','🥗','🍿','🧂','🥫','🍱','🍣',
  '🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍩','🍪','🌰','🥜','🍯','🥛',
  '🍼','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️',
  '🌹','🌺','🌸','🌼','🌻','💐','🌷','🌱','🌿','☘️','🍀','🌳','🌴','🎄','🌵','🌾','💎','🌍','🌎','🌏',
  '🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌙','🌚','🌛','🌜','☀️','🌝','🌞','⭐','🌟','💫','🌠','☄️',
  '⚡','☔','❄️','☃️','⛄','🌬️','💨','🌪️','🌫️','🌈','☁️','⛅','🌤️','🌥️','🌦️','🌧️','⛈️','🌩️','🌨️',
  '✅','❌','⭕','❎','✔️','☑️','❗','❓','❕','❔','‼️','⁉️','♻️','🔁','🔂','🔃','🔄','🔀','▶️','⏸️',
  '⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️',
  '↔️','🔄','🔼','➕','➖','➗','✖️','💲','💱','⚠️','🚸','🚫','⛔','🔞','🚷','🚯','🚳','🚱','📵','🔕',
  '🎵','🎶','🎼','🎤','🎧','🎷','🎸','🎹','🎺','🎻','🥁','🎬','📷','📸','📹','📺','📻','🎙️','🎚️','🎛️',
  '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🥅','🏒','🏑','🥍','🏏','🪃','🎯',
  '🎳','🎮','🕹️','🎲','🧩','♟️','🎰','🎴','🃏','🀄','🎭','🩰','🎨','🎪'
];

// ----- Identité locale (pour distinguer mes messages dans le backlog) -----
function getSenderId() {
  let s = localStorage.getItem('murmure:sender');
  if (!s) {
    s = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('murmure:sender', s);
  }
  return s;
}
const SENDER_ID = getSenderId();
const myPendingIds = new Set();

// Purge of local-history cleanup (compat ancienne version)
function pruneOldLocalHistory() {
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('murmure:hist:')) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch {}
}

// ----- URL detection / rich content -----
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VIMEO_RE = /vimeo\.com\/(\d+)/;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:\?.*)?$/i;

function ytId(url) { const m = url.match(YT_RE); return m ? m[1] : null; }
function vimeoId(url) { const m = url.match(VIMEO_RE); return m ? m[1] : null; }
function isImgUrl(url) { return IMG_EXT_RE.test(new URL(url, location.href).pathname); }

function normalizeUrl(u) {
  if (/^https?:\/\//i.test(u)) return u;
  return 'https://' + u;
}

// Insert anchors + media blocks into a container
function renderTextWithEmbeds(container, text) {
  const result = { mediaEmbeds: [], previewUrls: [] };
  if (!text) return result;
  let lastIndex = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[1];
    const url = normalizeUrl(raw);
    if (m.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    }
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = raw;
    a.className = 'msg-link';
    container.appendChild(a);
    lastIndex = m.index + raw.length;

    try {
      const yt = ytId(url);
      if (yt) { result.mediaEmbeds.push({ kind: 'yt', id: yt }); continue; }
      const vi = vimeoId(url);
      if (vi) { result.mediaEmbeds.push({ kind: 'vimeo', id: vi }); continue; }
      if (isImgUrl(url)) { result.mediaEmbeds.push({ kind: 'img', url }); continue; }
      result.previewUrls.push(url);
    } catch {}
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return result;
}

// ----- Link preview (OG card) -----
const previewCache = new Map(); // url -> data | null | Promise
function getPreview(url) {
  if (previewCache.has(url)) return Promise.resolve(previewCache.get(url));
  const p = fetch('/api/preview?url=' + encodeURIComponent(url))
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)
    .then(data => { previewCache.set(url, data); return data; });
  previewCache.set(url, p);
  return p;
}

function buildPreviewCard(data) {
  if (!data) return null;
  const card = document.createElement('a');
  card.className = 'preview-card';
  card.href = data.url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  if (data.image) {
    const im = document.createElement('div');
    im.className = 'pv-img';
    const img = document.createElement('img');
    img.src = data.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => im.remove();
    im.appendChild(img);
    card.appendChild(im);
  }

  const body = document.createElement('div');
  body.className = 'pv-body';

  if (data.siteName || data.hostname) {
    const site = document.createElement('div');
    site.className = 'pv-site';
    site.textContent = data.siteName || data.hostname;
    body.appendChild(site);
  }
  if (data.title) {
    const t = document.createElement('div');
    t.className = 'pv-title';
    t.textContent = data.title;
    body.appendChild(t);
  }
  if (data.description) {
    const d = document.createElement('div');
    d.className = 'pv-desc';
    d.textContent = data.description;
    body.appendChild(d);
  }
  card.appendChild(body);
  return card;
}

async function attachPreviews(bubble, urls) {
  for (const url of urls) {
    try {
      const data = await getPreview(url);
      if (!data) continue;
      const card = buildPreviewCard(data);
      if (card) {
        // insert before the .ts span if present
        const ts = bubble.querySelector(':scope > .ts');
        bubble.insertBefore(card, ts || null);
        if (bubble.isConnected) {
          const atBottom = (stream.scrollHeight - stream.scrollTop - stream.clientHeight) < 80;
          if (atBottom) stream.scrollTop = stream.scrollHeight;
        }
      }
    } catch {}
  }
}

function buildEmbed(embed) {
  const wrap = document.createElement('div');
  wrap.className = 'embed embed-' + embed.kind;
  if (embed.kind === 'yt') {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${embed.id}`;
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    f.referrerPolicy = 'no-referrer';
    f.loading = 'lazy';
    wrap.appendChild(f);
  } else if (embed.kind === 'vimeo') {
    const f = document.createElement('iframe');
    f.src = `https://player.vimeo.com/video/${embed.id}`;
    f.allow = 'autoplay; fullscreen; picture-in-picture';
    f.allowFullscreen = true;
    f.referrerPolicy = 'no-referrer';
    f.loading = 'lazy';
    wrap.appendChild(f);
  } else if (embed.kind === 'img') {
    const img = document.createElement('img');
    img.src = embed.url;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('click', () => openLightbox(embed.url));
    wrap.appendChild(img);
  }
  return wrap;
}

// ----- Lightbox -----
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.hidden = false;
}
function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = '';
}
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
lightboxClose.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// ----- UI -----
function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function snippetFor(msg) {
  if (msg.text) return msg.text.length > 80 ? msg.text.slice(0, 77) + '…' : msg.text;
  if (msg.img) return '🖼 Image';
  return '…';
}

function buildReplyBlock(refId) {
  const ref = messages.get(refId);
  const wrap = document.createElement('div');
  wrap.className = 'reply-quote';
  wrap.dataset.target = refId;
  const ico = document.createElement('span');
  ico.className = 'reply-ico'; ico.textContent = '↩';
  const txt = document.createElement('span');
  txt.className = 'reply-text';
  txt.textContent = ref ? snippetFor(ref) : '(message indisponible)';
  wrap.appendChild(ico); wrap.appendChild(txt);
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = stream.querySelector(`[data-mid="${refId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('flash');
      // force reflow then add class
      void target.offsetWidth;
      target.classList.add('flash');
    }
  });
  return wrap;
}

function renderMessage(obj, kind, ts, opts = {}) {
  // obj: { v, id, text, replyTo?, img? }
  const id = obj.id || newId();
  const row = document.createElement('div');
  row.className = 'bubble-row ' + kind;
  const div = document.createElement('div');
  div.className = 'bubble ' + kind;
  div.dataset.mid = id;

  // auteur (pseudo) pour bulles entrantes
  if (kind === 'them') {
    const auth = document.createElement('div');
    auth.className = 'author';
    auth.textContent = peerPseudo || '';
    auth.hidden = !peerPseudo;
    div.appendChild(auth);
  }

  // reply quote
  if (obj.replyTo) {
    div.appendChild(buildReplyBlock(obj.replyTo));
  }

  // text + embeds
  const mediaEmbeds = [];
  let previewUrls = [];
  if (obj.text) {
    const body = document.createElement('div');
    body.className = 'msg-text';
    const r = renderTextWithEmbeds(body, obj.text);
    mediaEmbeds.push(...r.mediaEmbeds);
    previewUrls = r.previewUrls;

    // Si le message n'est qu'une URL média (gif/image/yt/vimeo), on cache le lien texte.
    const linkCount = body.querySelectorAll('a.msg-link').length;
    const textNodes = [...body.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    const isMediaOnly = mediaEmbeds.length === 1 && linkCount === 1 && textNodes.length === 0;
    if (!isMediaOnly) div.appendChild(body);
  }

  // inline image attachment (uploaded)
  if (obj.img && obj.img.data && obj.img.mime) {
    try {
      const bytes = unb64(obj.img.data);
      const blob = new Blob([bytes], { type: obj.img.mime });
      const url = URL.createObjectURL(blob);
      const wrap = document.createElement('div');
      wrap.className = 'embed embed-img attach';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(url));
      wrap.appendChild(img);
      div.appendChild(wrap);
    } catch {}
  }

  // url embeds (media)
  for (const e of mediaEmbeds) div.appendChild(buildEmbed(e));

  // conteneur réactions (vide tant qu'il n'y en a pas)
  const reactionsBar = document.createElement('div');
  reactionsBar.className = 'reactions';
  reactionsBar.hidden = true;
  div.appendChild(reactionsBar);

  // ligne timestamp + statut (sent/seen) pour mes messages
  const t = document.createElement('span');
  t.className = 'ts';
  const d = new Date(ts || Date.now());
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  t.innerHTML = timeStr;
  if (kind === 'me') {
    const st = document.createElement('span');
    st.className = 'msg-status';
    st.textContent = '⌛';
    st.title = 'Envoi…';
    t.appendChild(document.createTextNode(' '));
    t.appendChild(st);
  }
  div.appendChild(t);

  // actions flottantes (répondre + réagir) — siblings dans la rangée
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';

  const reactBtn = document.createElement('button');
  reactBtn.type = 'button';
  reactBtn.className = 'bubble-action';
  reactBtn.title = 'Réagir';
  reactBtn.textContent = '😊';
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEmojiPicker(reactBtn, id);
  });

  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'bubble-action';
  replyBtn.title = 'Répondre';
  replyBtn.textContent = '↩';
  replyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setReply(id);
  });

  actions.appendChild(reactBtn);
  actions.appendChild(replyBtn);

  if (kind === 'me') {
    row.appendChild(actions);
    row.appendChild(div);
  } else {
    row.appendChild(div);
    row.appendChild(actions);
  }

  // double-clic n'importe où dans la bulle = répondre
  div.addEventListener('dblclick', (e) => {
    if (e.target.closest('a, img, button, iframe, .preview-card')) return;
    setReply(id);
  });

  stream.appendChild(row);
  if (!opts.historic) stream.scrollTop = stream.scrollHeight;

  // async link previews (OG/Twitter cards)
  if (previewUrls && previewUrls.length) {
    attachPreviews(div, previewUrls.slice(0, 3));
  }

  messages.set(id, {
    id,
    text: obj.text || '',
    mine: kind === 'me',
    img: !!obj.img
  });

  // appliquer les réactions déjà reçues pour ce message
  if (reactions.has(id)) renderReactions(id);

  // si mon message a déjà été vu (history), reflet
  if (kind === 'me' && seenIds.has(id)) markBubbleStatus(div, 'seen');

  // observer pour seen (uniquement messages reçus, non historiques)
  if (kind === 'them' && !opts.historic) observeForSeen(div);
  else if (kind === 'them' && opts.historic) observeForSeen(div);

  return div;
}

// ----- Réactions -----
function renderReactions(targetId) {
  const bubble = stream.querySelector(`[data-mid="${targetId}"]`);
  if (!bubble) return;
  const bar = bubble.querySelector(':scope > .reactions');
  if (!bar) return;
  const map = reactions.get(targetId);
  if (!map || !map.size) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = '';
  for (const [emo, who] of map.entries()) {
    if (!who.size) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'react-chip';
    if (who.has(SENDER_ID)) chip.classList.add('mine');
    const e = document.createElement('span'); e.textContent = emo;
    const c = document.createElement('span'); c.className = 'ct'; c.textContent = who.size;
    chip.appendChild(e); chip.appendChild(c);
    chip.title = who.size > 1 ? `${who.size} réactions` : '1 réaction';
    chip.addEventListener('click', (ev) => { ev.stopPropagation(); sendReact(targetId, emo); });
    bar.appendChild(chip);
  }
  bar.hidden = !bar.children.length;
}

async function sendReact(targetId, emoji) {
  if (!aesKey || !socket) return;
  let m = reactions.get(targetId);
  if (!m) { m = new Map(); reactions.set(targetId, m); }
  let set = m.get(emoji);
  if (!set) { set = new Set(); m.set(emoji, set); }
  const remove = set.has(SENDER_ID);
  if (remove) {
    set.delete(SENDER_ID);
    if (!set.size) m.delete(emoji);
  } else {
    set.add(SENDER_ID);
  }
  renderReactions(targetId);
  try {
    const id = newId();
    const obj = { v: 2, id, from: SENDER_ID, kind: 'react', targetId, emoji, remove };
    const payload = await encryptObject(obj);
    socket.emit('msg', payload);
  } catch {}
}

function applyRemoteReact(obj) {
  const tid = obj.targetId, sid = obj.from, emo = obj.emoji;
  if (!tid || !sid || !emo) return;
  let m = reactions.get(tid);
  if (!m) { m = new Map(); reactions.set(tid, m); }
  let set = m.get(emo);
  if (!set) { set = new Set(); m.set(emo, set); }
  if (obj.remove) {
    set.delete(sid);
    if (!set.size) m.delete(emo);
  } else {
    set.add(sid);
  }
  renderReactions(tid);
}

// ----- Emoji picker -----
let pickerTarget = null;
const EMOJI_KEYWORDS = {
  '👍':'pouce ok bien like','👎':'pouce non dislike','❤️':'coeur amour love','🔥':'feu fire hot',
  '😂':'rire laugh lol','😍':'amour love heart eyes','😮':'wow surprise oh','😢':'triste sad cry',
  '🎉':'fete party celebration','👏':'applaudir clap bravo','💯':'cent perfect','✅':'oui ok valide',
  '❌':'non croix erreur','🤔':'reflexion penser think','😡':'colere angry rage','😴':'dormir sleep',
  '🥳':'fete party','🤩':'star etoile waouh','😎':'cool sunglasses','😭':'pleurer cry sad',
  '🙏':'merci priere thanks please','💪':'force muscle strong','🤝':'accord deal','💔':'coeur brise',
  '🌹':'rose fleur','🎂':'gateau anniversaire','☀️':'soleil sun','🌙':'lune moon','⭐':'etoile star',
  '⚡':'eclair fast','💀':'mort skull dead','👻':'fantome ghost','🤖':'robot','👽':'alien',
  '🎵':'musique note','🎮':'jeu game','⚽':'foot football','🍕':'pizza','🍔':'burger','☕':'cafe coffee'
};
function emojiMatchesQuery(emoji, q) {
  if (!q) return true;
  const kw = EMOJI_KEYWORDS[emoji] || '';
  return kw.includes(q);
}
function renderEmojiGrid(grid, targetId, query) {
  grid.innerHTML = '';
  const seen = new Set();
  const q = query.trim().toLowerCase();
  for (const e of EMOJI_LIST) {
    if (seen.has(e)) continue;
    seen.add(e);
    if (q && !emojiMatchesQuery(e, q)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      sendReact(targetId, e);
      // Pas de fermeture : on permet d'enchaîner plusieurs réactions.
    });
    grid.appendChild(b);
  }
  if (!grid.children.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;text-align:center;color:var(--muted);padding:18px;font-size:13px;';
    empty.textContent = 'Aucun résultat';
    grid.appendChild(empty);
  }
}
function openEmojiPicker(anchor, targetId) {
  pickerTarget = targetId;
  emojiPicker.innerHTML = '';
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'ep-search';
  search.placeholder = 'Rechercher un emoji…';
  search.spellcheck = false;
  search.autocomplete = 'off';
  const grid = document.createElement('div');
  grid.className = 'ep-grid';
  emojiPicker.appendChild(search);
  emojiPicker.appendChild(grid);
  renderEmojiGrid(grid, targetId, '');
  search.addEventListener('input', () => renderEmojiGrid(grid, targetId, search.value));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEmojiPicker(); });

  const r = anchor.getBoundingClientRect();
  emojiPicker.hidden = false;
  requestAnimationFrame(() => {
    const pw = emojiPicker.offsetWidth;
    const ph = emojiPicker.offsetHeight;
    let left = r.left + r.width / 2 - pw / 2;
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    if (left < 8) left = 8;
    if (left + pw > innerWidth - 8) left = innerWidth - pw - 8;
    if (top + ph > innerHeight - 8) top = Math.max(8, innerHeight - ph - 8);
    emojiPicker.style.left = left + 'px';
    emojiPicker.style.top = top + 'px';
    setTimeout(() => search.focus(), 30);
  });
}
function closeEmojiPicker() {
  emojiPicker.hidden = true;
  emojiPicker.innerHTML = '';
  pickerTarget = null;
}
document.addEventListener('click', (e) => {
  if (!emojiPicker.hidden && !emojiPicker.contains(e.target)) closeEmojiPicker();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEmojiPicker(); });

// ----- Accusés "vu" -----
const unseenSet = new Set();
const pendingSeen = new Set();
let seenDebounce = null;

function scheduleSeenSend() {
  clearTimeout(seenDebounce);
  seenDebounce = setTimeout(async () => {
    if (!pendingSeen.size || document.hidden) return;
    const ids = [...pendingSeen];
    pendingSeen.clear();
    try {
      const id = newId();
      const obj = { v: 1, id, from: SENDER_ID, kind: 'seen', ids };
      const payload = await encryptObject(obj);
      socket.emit('msg', payload);
    } catch {}
  }, 600);
}

const seenObserver = new IntersectionObserver((entries) => {
  if (document.hidden) return;
  for (const e of entries) {
    if (e.isIntersecting) {
      const mid = e.target.dataset.mid;
      if (mid) {
        pendingSeen.add(mid);
        seenObserver.unobserve(e.target);
        unseenSet.delete(e.target);
      }
    }
  }
  if (pendingSeen.size) scheduleSeenSend();
}, { threshold: 0.5 });

function observeForSeen(div) {
  unseenSet.add(div);
  seenObserver.observe(div);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const div of [...unseenSet]) {
    const r = div.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) {
      const mid = div.dataset.mid;
      if (mid) { pendingSeen.add(mid); seenObserver.unobserve(div); unseenSet.delete(div); }
    }
  }
  if (pendingSeen.size) scheduleSeenSend();
});

function applyRemoteSeen(obj) {
  if (!Array.isArray(obj.ids)) return;
  for (const tid of obj.ids) {
    seenIds.add(tid);
    const b = stream.querySelector(`[data-mid="${tid}"]`);
    if (b && b.classList.contains('me')) markBubbleStatus(b, 'seen');
  }
}

function markBubbleStatus(bubble, status) {
  const st = bubble.querySelector('.msg-status');
  if (!st) return;
  if (status === 'sent') { st.textContent = '✓'; st.title = 'Envoyé'; st.dataset.s = 'sent'; }
  else if (status === 'seen') { st.textContent = '✓✓'; st.title = 'Vu'; st.dataset.s = 'seen'; }
}

function addSys(text) {
  const div = document.createElement('div');
  div.className = 'bubble sys';
  div.textContent = text;
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

// ----- Reply state -----
function setReply(id) {
  const ref = messages.get(id);
  if (!ref) return;
  replyTarget = { id, text: snippetFor(ref) };
  replySnippet.textContent = replyTarget.text;
  replyBar.hidden = false;
  input.focus();
}
function clearReply() {
  replyTarget = null;
  replyBar.hidden = true;
}
replyCancel.addEventListener('click', clearReply);

// ----- Image attachment -----
const MAX_IMG_DIM = 1600;
const MAX_IMG_BYTES = 6 * 1024 * 1024;

async function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function compressImage(file) {
  // Keep GIFs as-is (animations)
  if (file.type === 'image/gif') {
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_IMG_BYTES) throw new Error('GIF trop volumineux (>6 Mo).');
    return { mime: 'image/gif', bytes: new Uint8Array(buf) };
  }
  const img = await loadImageFromFile(file);
  let { width, height } = img;
  const scale = Math.min(1, MAX_IMG_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const mime = (file.type === 'image/png' && /\.png$/i.test(file.name || '')) ? 'image/webp' : 'image/webp';
  const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.85));
  if (!blob) throw new Error('Compression échouée.');
  const buf = await blob.arrayBuffer();
  if (buf.byteLength > MAX_IMG_BYTES) throw new Error('Image trop volumineuse après compression.');
  return { mime, bytes: new Uint8Array(buf) };
}

async function sendImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    addSys('Type de fichier non supporté.');
    return;
  }
  try {
    addSys('Envoi de l\'image…');
    const { mime, bytes } = await compressImage(file);
    const id = newId();
    myPendingIds.add(id);
    const obj = {
      v: 1, id, from: SENDER_ID,
      text: '',
      replyTo: replyTarget ? replyTarget.id : undefined,
      img: { mime, data: b64(bytes) }
    };
    const payload = await encryptObject(obj);
    const ts = Date.now();
    const sys = stream.querySelector('.bubble.sys:last-child');
    if (sys && sys.textContent.startsWith('Envoi')) sys.remove();
    const bubble = renderMessage(obj, 'me', ts);
    socket.emit('msg', payload, (res) => {
      if (res && res.ok && bubble) markBubbleStatus(bubble, 'sent');
    });
    clearReply();
  } catch (err) {
    addSys('Échec image : ' + (err.message || 'inconnue'));
  }
}

attachBtn.addEventListener('click', () => attachInput.click());
attachInput.addEventListener('change', () => {
  const f = attachInput.files && attachInput.files[0];
  if (f) sendImage(f);
  attachInput.value = '';
});

// Paste image
window.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { sendImage(f); e.preventDefault(); break; }
    }
  }
});

// Drag & drop
['dragenter', 'dragover'].forEach(ev =>
  window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); })
);
['dragleave', 'drop'].forEach(ev =>
  window.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.remove('dragging'); })
);
window.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) sendImage(f);
});

// ----- Composer -----
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
function setMyTyping(v) {
  if (!socket) return;
  if (v === myTypingState) return;
  myTypingState = v;
  socket.emit('typing', v);
}
function onInputActivity() {
  const hasText = input.value.length > 0;
  if (!hasText) { clearTimeout(myTypingStop); setMyTyping(false); return; }
  setMyTyping(true);
  clearTimeout(myTypingStop);
  myTypingStop = setTimeout(() => setMyTyping(false), 2000);
}
input.addEventListener('input', () => { autosize(); onInputActivity(); });
input.addEventListener('blur', () => { clearTimeout(myTypingStop); setMyTyping(false); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
  if (e.key === 'Escape' && replyTarget) clearReply();
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !aesKey || !socket) return;
  try {
    const id = newId();
    myPendingIds.add(id);
    const obj = {
      v: 1, id, from: SENDER_ID, text,
      replyTo: replyTarget ? replyTarget.id : undefined
    };
    const payload = await encryptObject(obj);
    const ts = Date.now();
    const bubble = renderMessage(obj, 'me', ts);
    socket.emit('msg', payload, (res) => {
      if (res && res.ok && bubble) markBubbleStatus(bubble, 'sent');
    });
    input.value = '';
    autosize();
    clearTimeout(myTypingStop);
    setMyTyping(false);
    clearReply();
  } catch (err) {
    addSys('Erreur de chiffrement : ' + err.message);
  }
});

leaveBtn.addEventListener('click', () => {
  sessionStorage.removeItem('murmure:code');
  location.href = '/';
});

// ----- GIF library (Tenor) -----
let gifLoading = false;
let gifQuery = '';
async function loadGifs(q) {
  if (gifLoading) return;
  gifLoading = true;
  gifGrid.innerHTML = '<div class="gif-status">Chargement…</div>';
  const url = q ? '/api/gifs/search?q=' + encodeURIComponent(q) : '/api/gifs/featured';
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data && data.error) {
      gifGrid.innerHTML = '<div class="gif-status err">' + data.error + '</div>';
      return;
    }
    if (!data || !data.results || !data.results.length) {
      gifGrid.innerHTML = '<div class="gif-status">Aucun résultat.</div>';
      return;
    }
    gifGrid.innerHTML = '';
    for (const g of data.results) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'gif-cell';
      const img = document.createElement('img');
      img.src = g.preview.url;
      img.alt = g.title || 'gif';
      img.loading = 'lazy';
      cell.appendChild(img);
      cell.addEventListener('click', () => sendGif(g));
      gifGrid.appendChild(cell);
    }
  } catch (e) {
    gifGrid.innerHTML = '<div class="gif-status err">Erreur réseau.</div>';
  } finally {
    gifLoading = false;
  }
}

async function sendGif(g) {
  const url = (g.tiny && g.tiny.url) || (g.gif && g.gif.url);
  if (!url || !aesKey || !socket) return;
  try {
    const id = newId();
    myPendingIds.add(id);
    const obj = { v: 1, id, from: SENDER_ID, text: url };
    const payload = await encryptObject(obj);
    const ts = Date.now();
    const bubble = renderMessage(obj, 'me', ts);
    socket.emit('msg', payload, (res) => {
      if (res && res.ok && bubble) markBubbleStatus(bubble, 'sent');
    });
    closeGifPanel();
    clearReply();
  } catch (e) {
    addSys('Échec envoi GIF : ' + e.message);
  }
}

function openGifPanel() {
  gifPanel.hidden = false;
  gifSearch.value = '';
  gifQuery = '';
  loadGifs('');
  setTimeout(() => gifSearch.focus(), 50);
}
function closeGifPanel() {
  gifPanel.hidden = true;
  gifGrid.innerHTML = '';
}
gifBtn.addEventListener('click', () => {
  if (gifPanel.hidden) openGifPanel(); else closeGifPanel();
});
gifClose.addEventListener('click', closeGifPanel);

let gifDebounce = null;
gifSearch.addEventListener('input', () => {
  clearTimeout(gifDebounce);
  const q = gifSearch.value.trim();
  if (q === gifQuery) return;
  gifQuery = q;
  gifDebounce = setTimeout(() => loadGifs(q), 300);
});
gifSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeGifPanel();
});

// ----- Offre d'activation des notifications (pour recevoir les appels) -----
function maybeOfferNotifs() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') return;
  if (sessionStorage.getItem('murmure:notif-offered')) return;
  sessionStorage.setItem('murmure:notif-offered', '1');

  const div = document.createElement('div');
  div.className = 'bubble sys cta';
  div.innerHTML = '🔔 Active les notifications pour recevoir les appels même si l\'onglet est fermé. ';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cta-btn';
  btn.textContent = 'Activer';
  btn.addEventListener('click', async () => {
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') {
        notifEnabled = true;
        localStorage.setItem('murmure:notif', '1');
        refreshNotifBtn();
        await subscribePush();
        div.textContent = '✅ Notifications activées. Tu recevras les appels même page fermée.';
      } else {
        div.textContent = '🔕 Notifications refusées. Tu ne recevras pas les appels page fermée.';
      }
    } catch (e) {
      div.textContent = '⚠ Activation impossible : ' + e.message;
    }
  });
  div.appendChild(btn);
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

// ----- Call button -----
let callBusy = false;
function ring(times = 3) {
  for (let i = 0; i < times; i++) setTimeout(beep, i * 400);
}
callBtn.addEventListener('click', async () => {
  if (callBusy || !socket) return;
  callBusy = true;
  callBtn.classList.add('busy');
  try {
    const endpoint = pushSub ? pushSub.endpoint : null;
    socket.emit('call', { excludeEndpoint: endpoint }, (res) => {
      if (res && res.ok) {
        const { pushed = 0, connected = 0 } = res;
        if (pushed === 0 && connected === 0) {
          addSys('📞 Aucun destinataire joignable. L\'autre n\'a pas encore activé les notifications dans ce salon.');
        } else {
          const bits = [];
          if (connected) bits.push(`${connected} en ligne`);
          if (pushed) bits.push(`${pushed} notif${pushed > 1 ? 's' : ''} push envoyée${pushed > 1 ? 's' : ''}`);
          addSys('📞 Appel envoyé — ' + bits.join(' · '));
        }
      } else {
        addSys('Appel impossible : ' + ((res && res.error) || 'inconnu'));
      }
    });
  } catch (e) {
    addSys('Erreur appel : ' + e.message);
  } finally {
    setTimeout(() => { callBusy = false; callBtn.classList.remove('busy'); }, 1500);
  }
});

// ----- Init -----
(async () => {
  setStatus('Dérivation de la clé…');
  try {
    aesKey = await deriveKey(code);
    cbFp.textContent = await computeFingerprint(code);
  } catch (e) {
    setStatus('Erreur clé', 'err');
    return;
  }

  pruneOldLocalHistory();
  setStatus('Connexion au salon…');

  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    const pass = sessionStorage.getItem('murmure:pass');
    socket.emit('join', { code, pass }, (res) => {
      if (!res || !res.ok) {
        setStatus(res && res.error || 'Échec de connexion', 'err');
        addSys(res && res.error || 'Échec de connexion');
        if (res && (res.captchaError || /captcha/i.test(res.error || ''))) {
          sessionStorage.removeItem('murmure:pass');
          sessionStorage.removeItem('murmure:pass-exp');
          setTimeout(() => { location.href = '/'; }, 1500);
        }
        return;
      }
      // Pass à usage unique : on le supprime après succès
      sessionStorage.removeItem('murmure:pass');
      sessionStorage.removeItem('murmure:pass-exp');
      peerCount = res.peers;
      if (peerCount === 1) {
        setStatus('En attente d\'un autre participant…', 'warn');
        addSys('Partage le code avec l\'autre personne. En attente…');
      } else {
        setStatus('Chiffré · 2 connectés', 'ok');
        addSys('L\'autre personne est connectée. Messages chiffrés de bout en bout.');
      }
      sendHello();
      maybeOfferNotifs();
    });
  });

  async function sendHello() {
    if (!aesKey || !socket) return;
    try {
      const id = newId();
      const obj = { v: 1, id, from: SENDER_ID, kind: 'hello', name: MY_PSEUDO };
      const payload = await encryptObject(obj);
      socket.emit('msg', payload);
    } catch {}
  }

  socket.on('peer-joined', ({ peers }) => {
    peerCount = peers;
    setStatus('Chiffré · 2 connectés', 'ok');
    addSys('L\'autre personne a rejoint le salon.');
    beep();
    sendHello();
  });

  socket.on('peer-left', ({ peers }) => {
    peerCount = peers;
    setStatus('En attente…', 'warn');
    addSys('L\'autre personne a quitté le salon.');
    typingEl.hidden = true;
  });

  function isMine(obj) {
    if (obj.from && obj.from === SENDER_ID) return true;
    if (obj.id && myPendingIds.has(obj.id)) return true;
    return false;
  }

  socket.on('history', async (list) => {
    if (!Array.isArray(list) || !list.length) return;
    list.sort((a, b) => a.ts - b.ts);
    let count = 0;
    for (const p of list) {
      try {
        const obj = await decryptObject(p);
        if (obj.kind === 'react') { applyRemoteReact(obj); continue; }
        if (obj.kind === 'seen') { applyRemoteSeen(obj); continue; }
        if (obj.kind === 'hello') {
          if (obj.name && obj.from !== SENDER_ID) { peerPseudo = String(obj.name).slice(0, 32); updateTitleBar(); refreshAuthorLabels(); }
          continue;
        }
        if (!obj.id || messages.has(obj.id)) continue;
        renderMessage(obj, isMine(obj) ? 'me' : 'them', p.ts, { historic: true });
        count++;
      } catch {}
    }
    if (count > 0) {
      const sep = document.createElement('div');
      sep.className = 'bubble sys';
      sep.textContent = `— ${count} message${count > 1 ? 's' : ''} restauré${count > 1 ? 's' : ''} —`;
      stream.insertBefore(sep, stream.firstChild);
    }
    stream.scrollTop = stream.scrollHeight;
  });

  socket.on('msg', async (p) => {
    try {
      const obj = await decryptObject(p);
      const ts = p.ts || Date.now();
      if (obj.kind === 'react') { applyRemoteReact(obj); return; }
      if (obj.kind === 'seen') { applyRemoteSeen(obj); return; }
      if (obj.kind === 'hello') {
        if (obj.name) { peerPseudo = String(obj.name).slice(0, 32); updateTitleBar(); refreshAuthorLabels(); }
        return;
      }
      if (obj.id && messages.has(obj.id)) return;
      const mine = isMine(obj);
      if (mine && obj.id) myPendingIds.delete(obj.id);
      renderMessage(obj, mine ? 'me' : 'them', ts);
      typingEl.hidden = true;
      if (!mine) notifyIncoming(obj.text || (obj.img ? '[image]' : ''));
    } catch (e) {
      addSys('Message indéchiffrable (code différent ?).');
    }
  });

  socket.on('typing', (v) => {
    clearTimeout(typingTimer);
    if (v && peerCount > 1) {
      typingEl.hidden = false;
      typingTimer = setTimeout(() => { typingEl.hidden = true; }, 5000);
    } else {
      typingEl.hidden = true;
    }
  });

  socket.on('incoming-call', () => {
    ring(3);
    addSys('📞 L\'autre veut te parler.');
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification('Murmure · Appel', {
          body: 'Quelqu\'un veut te parler.',
          tag: 'murmure-call',
          requireInteraction: true
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {}
    }
  });

  socket.on('disconnect', () => setStatus('Déconnecté', 'err'));

  // register SW + subscribe push if allowed
  if (notifEnabled && 'Notification' in window && Notification.permission === 'granted') {
    subscribePush().catch(() => {});
  } else {
    registerSW().catch(() => {});
  }
})();
