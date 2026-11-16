// Mandarin service worker: precached app shell, network-first with a short timeout, Google Fonts cached for offline,
// and the share target: rota files shared from WhatsApp or Files arrive as a POST to ./share, are kept for one read, and the app imports them.
const CACHE = 'mandarin-7d06c17ce0';
const FONTS = 'mandarin-fonts-v1';
const SHARE = 'mandarin-share';   // files shared to the app, read once by the page   // kept across releases: font files are immutable, no need to fetch them again
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Pixelify+Sans:wght@500;700&family=Source+Sans+3:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap';
// Without these the app cannot start offline: install fails (and the old worker stays) if one is missing.
const CORE = ['./', './index.html', './css/app.css', './js/app.js', './js/util.js', './manifest.webmanifest'];
// Everything else in docs/js (test/D17.mjs checks this list against the folder). Fetched one by one so a
// file that was renamed or merged away does not block the install; it just is not cached.
const JS = ['backup-check','board','career-plus-ui','career-ui','career','changes-ui','changes','creds','custom','cv','daily-ui','daily','daymap','directory','google','hub','ics','inbound','inbox','labor-ui','labor','migrate','model','month-ui','nurse-board','nurses','payslips','people-logic','people-ui','plans-ui','plans','rota-codes','rota-parser','shiftlog','store-alerts','store','swaplog','team-ui','team','today-model','xlsx-lite'];
const ASSETS = [...JS.map(f => `./js/${f}.js`), './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];
const NET_TIMEOUT = 2500;   // on weak signal ("lie-fi") serve the cached shell after 2.5 s instead of hanging on the fetch

const isFont = (u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

// Fonts: fetch the stylesheet (Google returns the right formats for this browser), cache it, and precache the latin
// font files it names; other subsets (cyrillic, greek…) are cached the first time a page needs them. Best effort: never fails the install.
async function cacheFonts() {
  try {
    const c = await caches.open(FONTS), res = await fetch(FONT_CSS, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return; await c.put(FONT_CSS, res.clone());
    const css = await res.text(), urls = [];
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{[^}]*?url\(([^)]+)\)/g)) if (m[1] === 'latin') urls.push(m[2].replace(/['"]/g, ''));
    if (!urls.length) for (const m of css.matchAll(/url\(([^)]+)\)/g)) urls.push(m[1].replace(/['"]/g, ''));   // no subset comments: take all
    await Promise.all([...new Set(urls)].map(async u => { if (!(await c.match(u))) { const r = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (r.ok) await c.put(u, r); } }));
  } catch { /* offline at install time: fonts get cached on first online use instead */ }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    await Promise.all(ASSETS.map(u => c.add(u).catch(() => {})));
    await cacheFonts();
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FONTS && k !== SHARE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

// Fonts: cache first (they never change at a given URL); the stylesheet is refreshed in the background so a new font version arrives next time.
async function fontResponse(req) {
  const c = await caches.open(FONTS), hit = await c.match(req, { ignoreVary: true });
  const get = () => fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; });
  if (hit) { if (new URL(req.url).hostname === 'fonts.googleapis.com') get().catch(() => {}); return hit; }
  return get().catch(() => Response.error());
}

// Network first so a new release shows up at once; the cache is the offline (or slow-network) fallback.
// Only successful same-origin GETs are cached; only page navigations fall back to the app shell.
async function shellResponse(e) {
  const req = e.request, cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  let saved; const net = fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); saved = caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  });
  // keep the worker alive until a late network answer has refreshed the cache, even after the cached copy was served
  e.waitUntil(net.then(() => saved, () => {}).catch(() => {}));
  // race the network against a timer; on timeout use the cache if it has the file, otherwise keep waiting for the network
  const slow = new Promise(res => setTimeout(res, NET_TIMEOUT)).then(cached);
  try {
    return await Promise.race([net, slow.then(r => r || net)]);
  } catch {
    return (await cached()) || Response.error();
  }
}

// Share target (manifest share_target, POST multipart): keep the files, then open the app, which reads and imports them.
async function shareResponse(e) {
  try {
    const form = await e.request.formData(), c = await caches.open(SHARE), files = form.getAll('files').filter(f => f && typeof f === 'object' && f.size);
    let i = 0; for (const f of files.slice(0, 8)) await c.put(new Request(`./shared/${Date.now()}-${i++}/${encodeURIComponent(f.name || 'rota.xlsx')}`), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
    const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n').slice(0, 4000);
    const q = new URLSearchParams(files.length ? { shared: '1' } : {}); if (text) q.set('text', text);
    return Response.redirect(`./index.html?${q}`, 303);
  } catch { return Response.redirect('./index.html', 303); }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) return e.respondWith(shareResponse(e));
  if (req.method !== 'GET') return;
  if (isFont(url)) return e.respondWith(fontResponse(req));
  if (url.origin !== location.origin) return;   // Google APIs, sign-in: straight to the network
  e.respondWith(shellResponse(e));
});
