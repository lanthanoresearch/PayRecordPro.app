/* PayRecord Pro service worker — caches the app itself so it works offline.
   It never touches your data: that lives only in this device's local storage. */
const CACHE = 'payrecordpro-v26';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {            // network first, so updates arrive; cached copy when offline
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
});

/* ---- Optional reminders. Everything here is read from this device's own storage; nothing is fetched or sent. ---- */
function nOpen() { return new Promise((res, rej) => { const r = indexedDB.open('prp-notify', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function nGet(k) { const d = await nOpen(); return new Promise(r => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); }
async function nSet(k, v) { const d = await nOpen(); return new Promise(r => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => r(true); t.onerror = () => r(false); }); }
const nMin = v => { const [h, m] = String(v).split(':').map(Number); return h * 60 + m; };
function nQuiet(c) { const d = new Date(), m = d.getHours() * 60 + d.getMinutes(), a = nMin(c.qFrom), b = nMin(c.qTo); if (a === b) return false; return a < b ? (m >= a && m < b) : (m >= a || m < b); }
async function remind() {
  const cfg = await nGet('cfg'); if (!cfg || !cfg.on || nQuiet(cfg)) return;
  const q = (await nGet('queue')) || [], shown = (await nGet('shown')) || {}, now = Date.now();
  for (const it of q) if (it.at <= now && it.at > now - 36 * 3600e3 && !shown[it.key]) {
    await self.registration.showNotification(it.title, { body: it.body, tag: it.key, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: it.url || './#/bills' } }); shown[it.key] = now; const L = (await nGet('log')) || []; L.unshift({ at: now, title: it.title, body: it.body }); await nSet('log', L.slice(0, 30));
  }
  await nSet('shown', shown); await nSet('last', Date.now());
}
self.addEventListener('periodicsync', e => { if (e.tag === 'prp-bills') e.waitUntil(remind().catch(() => {})); });
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = new URL((e.notification.data && e.notification.data.url) || './#/bills', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
