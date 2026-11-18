// Mandarin — Scheduler & Work. Rotas (GP, specialists, nurses), calendar and day sheet, team and nurses, leave and the labour-law
// check, the after-shift log, and career. Split out of Citrus Maxima (16/11/2026): Mandarin owns every rota and work record;
// Citrus reads hub/mandarin/status.json and shifts.json. Vanilla ES modules, no build step.
import * as store from './store.js';
import { mergeStates } from './store.js';
import * as G from './google.js';
import { parseRotaFile, serializeRota, interpretCode } from './rota-parser.js';
import { dayInfo, myDay, allPeople, isMe, isNurseRota, sharedShifts, monthSummary, shiftWindow, UNIT_LABEL } from './model.js';
import { legendRows, codeOptions, codeText, hoursShort } from './rota-codes.js';
import { dayBusy } from './daymap.js';
import { boardModel, overlapModel } from './board.js';
import * as LU from './labor-ui.js';
import * as RU from './career-ui.js';
import * as CP from './career-plus-ui.js';
import * as XU from './plans-ui.js';
import * as DU from './daily-ui.js';
import * as RC from './changes.js';
import * as CHU from './changes-ui.js';
import * as PU from './people-ui.js';
import * as N from './nurses.js';
import * as L from './labor.js';
import * as TM from './today-model.js';
import * as CZ from './custom.js';
import * as HUB from './hub.js';
import * as MIG from './migrate.js';
import * as DIR from './directory.js';
import * as IN from './inbox.js';
import * as T from './team.js';
import * as SL from './shiftlog.js';
import * as SW from './swaplog.js';
import * as MV from './month-ui.js';
import * as TV from './team-ui.js';
import { shiftsIcs } from './ics.js';
import { checkBackup, describeCounts } from './backup-check.js';
import { h, toast, keyOf, fromKey, addDays, startOfDay, sameDay, fmtDate, fmtDateShort, fmtTime, fmtMin, fmtDur, relDay, pad2, DAY_SHORT, DAY_NAMES, MONTHS, telLink, firstName, atMin, minsOf, uid } from './util.js';

export const VERSION = '1.2.0';
/** Uses the owner's other apps (Citrus, the Claude inbox)? Someone using Mandarin on its own never sees Citrus buttons or wording. */
const family = () => !!(rt.fromCitrus || S().settings.family || (S().migrated && S().migrated.from !== 'skipped'));
const CITRUS_URL = 'https://amaerys.github.io/citrus-maxima/';
const CLEMENTINE_URL = 'https://clementine-social.github.io/Clementine/';

// ---------------- runtime state (not persisted) ----------------
const rt = {
  view: 'today',
  rotaMonth: null,        // Date (1st of month)
  rotaSel: null,          // selected date in the calendar
  events: {},             // dateKey -> events[] (from Google Calendar)
  eventsLoaded: {},       // monthKey -> true
  calendars: [],
  syncing: false,
  online: navigator.onLine,
  hub: { claude: null, citrusPlan: null },   // other apps' files Mandarin reads (never writes)
  fromCitrus: false,      // opened from Citrus (?from=citrus): show "← Citrus"
};

const $ = (s, el = document) => el.querySelector(s);
const S = () => store.get();

// ---------------- boot ----------------
async function boot() {
  applyTheme(); watchSheets();
  rt.rotaMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  for (const b of document.querySelectorAll('nav.tabs button')) b.addEventListener('click', () => go(b.dataset.view));
  $('#btnRefresh').addEventListener('click', () => refreshAll(true));
  $('#btnMore').addEventListener('click', () => show('more'));
  $('#btnSearch').addEventListener('click', () => openSearch());
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    // Escape closes only the top layer: the search box sits above any sheet
    if (e.key === 'Escape') { const sr = document.querySelector('.search'); if (sr) { sr.remove(); e.stopImmediatePropagation(); return; } closeTopSheet(); return; }
    if (typing) return;
    if (e.key === '/' && !document.querySelector('.search')) { openSearch(); e.preventDefault(); return; }
    if (document.querySelector('.sheet-bg, .search')) return;   // tab shortcuts never switch the page behind a sheet
    const tabs = CZ.visibleTabs(S());
    if (/^[1-6]$/.test(e.key) && tabs[+e.key - 1]) { show(tabs[+e.key - 1]); e.preventDefault(); }
    else if (e.key === 'r') { if (!rt.online) toast('Offline — Mandarin syncs when you are back online'); else refreshAll(true); }
    else if (e.key === ',') show('more');
    else if (e.key === 't') { rt.rotaMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); daySheet(startOfDay(new Date())); }
    else if (e.key === '?') { shortcutsSheet(); e.preventDefault(); }
  });
  window.addEventListener('online', () => { rt.online = true; renderSync(); flushOutbox().then(render).catch(() => {}); });
  window.addEventListener('offline', () => { rt.online = false; renderSync(); });
  const sub = { S, update: (fn) => store.update(fn), sheet, render: () => render(), go: (v, sub2) => go(v, sub2), openDay: (d) => daySheet(d), personSheet };
  LU.initLabor(sub); RU.initCareer(sub); CP.initCareerPlus(sub); XU.initPlans(sub); CHU.initChanges(sub); DU.initDaily(sub); MV.initMonth({ ...sub, swapSheet, swapHelper }); TV.initTeam({ ...sub, personKeyOf, importButton });
  PU.initPeople({ ...sub, apps: () => ({}), personKeyOf, shiftChip, importButton, inbox: () => inboxItems(), acceptInbox, dismissInbox: (p) => store.update(s => IN.dismiss(s, p.ref)), cardUrl: () => DIR.source() === 'clementine' ? CLEMENTINE_URL : `${CITRUS_URL}#social` });
  store.subscribe(() => { render(); publishSoon(); });
  store.onRemoteSync(scheduleRemoteSave);
  loadCachedEvents();
  handleIncoming();
  const hashView = location.hash.replace('#', '');
  if (!rt.view || rt.view === 'today') show(hashView || CZ.custom(S()).start);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => takeSharedFiles()).catch(() => {});
  const cid = S().settings.clientId;
  G.onAuthChange(() => { renderSync(); render(); });
  G.renewOnTap(() => { render(); refreshAll(false); });   // the hourly token renews on your next tap (phones only allow Google's window inside a tap)
  if (cid && rt.online) {
    try { await G.init(cid); } catch (e) { console.warn(e); }
    if (G.isSignedIn()) refreshAll(false);
    else if (G.wasSignedIn()) { G.auth.needsSignIn = true; render(); }
  }
  navigator.storage?.persist?.().then(ok => { rt.storagePersisted = ok; }).catch(() => {});
  navigator.storage?.estimate?.().then(e => { rt.storageEst = e; }).catch(() => {});
  setInterval(() => {
    const busy = document.querySelector('.sheet-bg, .search') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (rt.view === 'today' && document.visibilityState === 'visible' && !busy) render();
  }, 60000);
  // keep fresh: a cheap changes check when the app comes back (one request if nothing moved), every few minutes while open,
  // and save right away when it goes to the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushRemoteSave(); return; }
    if (G.isSignedIn() && Date.now() - (S().google.lastSync || 0) > 2 * 60000) refreshAll(false);
    render();
  });
  window.addEventListener('pagehide', flushRemoteSave);
  setInterval(() => { if (document.visibilityState === 'visible' && G.isSignedIn() && rt.online && Date.now() - (S().google.lastSync || 0) > 5 * 60000) refreshAll(false); }, 60000);
  renderSync();
}

// Arriving from another app or a link: ?from=citrus shows "← Citrus"; ?do=<action> (or #view) jumps straight there;
// ?title&text&url from the phone's Share menu; shared .xlsx files arrive through the service worker (share_target, POST).
const DO = { today: ['today'], calendar: ['calendar'], nurses: ['nurses'], team: ['team'], month: ['month'], career: ['career'], log: ['today', 'log'], leave: ['month', 'leave'], pay: ['career', 'pay'], licences: ['career', 'creds'] };
function handleIncoming() {
  try {
    const q = new URLSearchParams(location.search);
    const from = String(q.get('from') || '').toLowerCase(), action = String(q.get('do') || '').toLowerCase();
    if (from === 'citrus') { rt.fromCitrus = true; try { sessionStorage.setItem('mandarin.fromCitrus', '1'); } catch {} }
    else { try { if (sessionStorage.getItem('mandarin.fromCitrus')) rt.fromCitrus = true; } catch {} }   // kept over a reload (T5-19)
    if (q.get('shared') === '1') rt.sharedPending = true;
    const target = DO[action] || DO[location.hash.replace('#', '')] || null;
    if (q.toString()) history.replaceState(null, '', location.pathname + (target ? `#${target[0]}` : location.hash || '#today'));
    if (target) { rt.view = ''; go(target[0], target[1]); }
    if (target?.[1] === 'log') setTimeout(() => { const a = SL.unlogged(S(), new Date(), 3)[0]; if (a) DU.logSheet(a.key); else toast('No shift waiting to be logged'); }, 300);
    const text = [q.get('title'), q.get('text')].filter(Boolean).join('\n');
    // a WhatsApp posting message shared to Mandarin: open Paste postings with it (never saved without a tap)
    if (text && rt.sharedPending) rt.sharedText = text;   // shared with files: the caption is only the file's description (T5-12)
    else if (text && /\b(UPV|LPV|UPO|LPO|upper|lower|village|office clinic|posting|posted)\b/i.test(text)) setTimeout(() => { go('nurses'); PU.pasteFromShare(text); }, 400);
  } catch (e) { console.warn('incoming', e); }
}
/** Files shared to Mandarin from WhatsApp or Files (Web Share Target): the service worker keeps them for one read. */
async function takeSharedFiles() {
  // a rota opened with Mandarin from the Files app (manifest file_handlers, desktop)
  if ('launchQueue' in window) window.launchQueue.setConsumer(async (p) => { const files = await Promise.all((p.files || []).map(f => f.getFile())); if (files.length) { go('calendar'); importFiles(files); } });
  if (!rt.sharedPending || !('caches' in window)) return;
  rt.sharedPending = false;
  try {
    const c = await caches.open('mandarin-share'), keys = await c.keys(), files = [];
    for (const k of keys) { const r = await c.match(k); if (r) { const b = await r.blob(); files.push(new File([b], decodeURIComponent(new URL(k.url).pathname.split('/').pop() || 'rota.xlsx'), { type: b.type })); } await c.delete(k); }
    const xlsx = files.filter(f => /\.xlsx$/i.test(f.name) || /spreadsheet/.test(f.type));
    const text = rt.sharedText; rt.sharedText = '';
    if (!files.length && text && /\b(UPV|LPV|UPO|LPO|upper|lower|village|office clinic|posting|posted)\b/i.test(text)) { go('nurses'); PU.pasteFromShare(text); return; }
    if (xlsx.length) { go('calendar'); importFiles(xlsx); } else if (files.length) toast('Only .xlsx rota files can be shared to Mandarin', 'err');
  } catch (e) { console.warn('shared files', e); toast('Could not read the shared file', 'err'); }
}

// Shown at the top of every screen when the Google session needs a tap to come back
function authBanner() {
  if (!G.auth.needsSignIn || !rt.online) return null;
  return h('div', { class: 'banner' }, h('span', { class: 'grow' }, 'Google needs a tap to reconnect — nothing is lost, sync resumes after.'),
    h('button', { class: 'btn sm primary', onClick: async () => { try { await G.signIn({ renew: G.wasSignedIn() }); refreshAll(true); } catch (e) { try { await G.signIn(); refreshAll(true); } catch (e2) { toast(e2.message, 'err'); } } } }, 'Reconnect'));
}
/** "← Citrus" while you came from Citrus: one tap back, and Citrus toasts "Back from Mandarin" and refreshes its hub. */
function backBar() {
  if (!rt.fromCitrus) return null;
  return h('div', { class: 'back-bar' }, h('a', { class: 'btn sm ghost', href: `${CITRUS_URL}?from=mandarin` }, '← Citrus'), h('button', { class: 'btn sm ghost', 'aria-label': 'Hide', onClick: () => { rt.fromCitrus = false; render(); } }, '✕'));
}

const VIEWS = ['today', 'calendar', 'team', 'nurses', 'month', 'career', 'more'];
const VIEW_NAMES = { today: 'Today', calendar: 'Calendar', team: 'Team', nurses: 'Nurses', month: 'Month', career: 'Career', more: 'Settings' };
const OLD = { rota: 'calendar', work: 'calendar', people: 'team', log: 'today', leave: 'month' };
/** Bottom tabs / rail in your order; hidden ones disappear (Settings › Customise › Tabs). Today and Settings always stay. */
function applyTabs(c) {
  const nav = document.querySelector('nav.tabs'); if (!nav) return;
  for (const id of c.tabs.order) { const b = nav.querySelector(`button[data-view="${id}"]`); if (b) nav.insertBefore(b, nav.querySelector('button[data-view="more"]')); }
  for (const b of nav.querySelectorAll('button[data-view]')) b.hidden = c.tabs.hidden.includes(b.dataset.view);
  nav.style.setProperty('--tabs', String(CZ.TABS.length - c.tabs.hidden.length));
}
/** Open a tab, and optionally a part of it: go('career', 'pay'), go('month', 'leave'), go('nurses', date). */
function go(view, part) {
  if (view === 'career' && part) RU.careerTab(part);
  if (view === 'month' && part) MV.monthPart(part);
  if (view === 'nurses') { if (part instanceof Date) PU.goNurses(part); else PU.nursesNow(); }
  if (view === 'team' && part) TV.teamPart(part);
  show(view);
  if (view === 'month' && part === 'leave') setTimeout(() => XU.leaveSheet(), 50);
}
function show(view) {
  view = OLD[view] || view;
  if (!VIEWS.includes(view)) view = 'today';
  rt.view = view;
  for (const s of document.querySelectorAll('section.view')) s.classList.toggle('active', s.id === `view-${view}`);
  for (const b of document.querySelectorAll('nav.tabs button')) { b.classList.toggle('active', b.dataset.view === view); if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo(0, 0);
}
function render() {
  applyTabs(CZ.custom(S()));
  const fn = { today: renderToday, calendar: renderRota, team: TV.renderTeam, nurses: () => [h('h1', {}, 'Nurses'), ...[PU.renderNurses()].flat()], month: MV.renderMonth, career: RU.renderCareer, more: renderMore }[rt.view] || renderToday;
  const el = $(`#view-${rt.view}`); if (!el) return;
  let body;
  try { body = fn(); } catch (e) { console.error(e); body = crashCard(e); }   // one broken screen never blanks the app
  el.replaceChildren(...[backBar(), authBanner(), body].flat().filter(Boolean));
  if (!el.querySelector('h1')) el.prepend(h('h1', { class: 'sr-only' }, VIEW_NAMES[rt.view] || 'Mandarin'));
  const pt = document.getElementById('pageTitle'), d = new Date(); if (pt) pt.textContent = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function crashCard(e) {
  return h('div', { class: 'card warn' }, h('div', { class: 'title' }, 'This screen hit a problem'), h('div', { class: 'small' }, 'Your data is safe. Try another tab, sync, or download a backup and tell Claude what you tapped.'),
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, String(e?.message || e).slice(0, 160)),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onClick: () => location.reload() }, 'Reload'), h('button', { class: 'btn sm', onClick: downloadBackup }, '⬇ Backup')));
}

// Interfaces (Orange 8.12 pattern): Arcade / Clean / Paper + text size, chosen per device (localStorage, never synced); index.html applies them before first paint.
const UI_KEY = 'mandarin.ui';
function getUi() { let u = {}; try { u = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch {} if (!u.ui) u.ui = S().settings.theme === 'light' ? 'paper' : 'clean'; if (!u.size) u.size = 'normal'; return u; }
function setUi(patch) {
  const u = { ...getUi(), ...patch }; try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch {} applyTheme(); render();
  // the control you just tapped stays where your finger is, even when a bigger text size grows the page (beta T09-18)
  if (rt.view === 'more') document.querySelector('#view-more .ui-pick')?.scrollIntoView({ block: 'nearest' });
}
function applyTheme() { const u = getUi(), r = document.documentElement; r.dataset.ui = u.ui; r.dataset.size = u.size; r.dataset.theme = u.ui === 'paper' ? 'light' : 'dark'; const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = u.ui === 'paper' ? '#F3F4F9' : u.ui === 'arcade' ? '#12141F' : '#0e0f13'; }

// ---------------- sync ----------------
function renderSync() {
  const dot = $('#syncDot'), txt = $('#syncText');
  const signed = G.isSignedIn();
  dot.className = 'sync ' + (rt.syncing ? 'busy' : signed && rt.online ? 'on' : '');
  txt.textContent = !rt.online ? 'offline' : rt.syncing ? 'syncing…' : signed ? (S().google.email || 'Google') : '';
}

// ---------------- Drive sync ----------------
// state.json is written at most every 2.5 s, only when its content changed, and only if no other device wrote it since we
// read it — otherwise Mandarin pulls, merges and writes the merged copy. Drive answers "anything new?" through its changes
// feed, so a sync where nothing moved is a single request; only what changed is read again.
let saveTimer = null, saving = null;
function scheduleRemoteSave() {
  if (!G.wasSignedIn()) return;
  rt.saveDirty = true;
  clearTimeout(saveTimer);
  if (!G.isSignedIn() || !rt.online) return;   // stays dirty: the next sync saves it
  saveTimer = setTimeout(() => saveStateNow().catch(e => console.warn('remote save failed', e.message)), 2500);
}
function flushRemoteSave() { if (rt.saveDirty && G.isSignedIn() && rt.online) { clearTimeout(saveTimer); saveStateNow().catch(() => {}); } }
async function saveStateNow() {
  if (saving) { await saving.catch(() => {}); if (!rt.saveDirty) return; }
  saving = (async () => {
    const root = S().settings.driveFolder;
    rt.saveDirty = false;
    if (store.needsMerge()) await pullState(true);              // a copy recovered from damage never goes out before Drive's is merged in
    try { await G.saveRemoteState(root, stripForRemote(S())); }
    catch (e) {
      if (!e.conflict) { rt.saveDirty = true; throw e; }
      await pullState(true);                                   // someone else saved first: take theirs in, then write the union
      try { await G.saveRemoteState(root, stripForRemote(S()), { force: true }); } catch (e2) { rt.saveDirty = true; throw e2; }
    }
    rt.lastSave = Date.now();
  })().finally(() => { saving = null; });
  return saving;
}
// what goes to Drive: everything except what belongs to this device (sync bookkeeping, calendar outbox, app cache)
function stripForRemote(s) { const { outbox, google, ...rest } = s; return rest; }
const comparable = (s) => G.fingerprint(stripForRemote(s || {}), ['updatedAt']);

/** Read state.json and merge it in. Writes back only if the merged copy holds something Drive doesn't. */
async function pullState(fromConflict = false) {
  const remote = await G.loadRemoteState(S().settings.driveFolder);
  if (!remote) { store.merged(); scheduleRemoteSave(); return false; }
  if (!remote.rotas || typeof remote.rotas !== 'object') throw new Error('state.json on Drive is unreadable — kept your copy (backups are in hub/mandarin/backups)');
  // same content, or the same edit time (this copy already holds that save; device-only tweaks don't bump the time,
  // and two devices must never bounce those back and forth)
  // (after a conflict the merge always runs: someone else's save is known to be missing here)
  const force = fromConflict || store.needsMerge(); store.merged();
  if ((!force && (remote.updatedAt || 0) === (S().updatedAt || 0)) || comparable(remote) === comparable(S())) return false;
  const merged = mergeStates(S(), remote);
  // a merge that holds something Drive doesn't is a new version: one past both, so every other device sees it as new
  merged.updatedAt = Math.max(S().updatedAt || 0, remote.updatedAt || 0) + (comparable({ ...merged, updatedAt: 0 }) !== comparable({ ...remote, updatedAt: 0 }) ? 1 : 0);
  store.replaceState(merged);
  if (comparable(merged) !== comparable(remote)) { if (fromConflict) rt.saveDirty = true; else scheduleRemoteSave(); }
  rt.lastPull = Date.now();
  return true;
}

// where Mandarin listens in the changes feed (persisted, so the first sync after a reload can be incremental too)
const WATCH_KEY = 'mandarin.drive.watch';
function loadWatch() { try { const w = JSON.parse(localStorage.getItem(WATCH_KEY) || 'null'); return w && w.root === S().settings.driveFolder ? w : null; } catch { return null; } }
function saveWatch(w) { rt.watch = w; try { w ? localStorage.setItem(WATCH_KEY, JSON.stringify(w)) : localStorage.removeItem(WATCH_KEY); } catch {} }

async function syncCalendar(force) {
  if (!force && Date.now() - (rt.calendarAt || 0) < 4 * 60000) return;   // calendar has no cheap "anything new?", so it's throttled
  rt.calendars = await G.listCalendars();
  const now = new Date();
  await Promise.all([loadEvents(new Date(now.getFullYear(), now.getMonth(), 1), true), loadEvents(new Date(now.getFullYear(), now.getMonth() + 1, 1), true)]);
  rt.calendarAt = Date.now();
}

async function refreshAll(manual, { full = false } = {}) {
  if (!rt.online && manual) { toast('Offline — Mandarin syncs when you are back online'); return; }   // the real problem first (beta T09-25)
  if (!G.isSignedIn()) { if (manual) toast(G.wasSignedIn() ? 'Google needs a tap to reconnect' : S().settings.clientId ? 'Sign in to Google in Settings' : 'Add your Google client ID in Settings'); render(); return; }
  if (!rt.online) { if (manual) toast('You are offline'); return; }
  if (rt.syncing) { if (manual) toast('Already syncing…'); return; }   // one sync at a time (r key, foreground, timer can overlap)
  rt.syncing = true; renderSync();
  const root = S().settings.driveFolder;
  const problems = [];
  const step = async (label, fn) => { try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); } };
  const t0 = performance.now();
  try {
    // 1. what moved on Drive since last time?
    let watch = loadWatch(), plan = null, newToken = '';
    const stale = !watch?.token || Date.now() - (watch.fullAt || 0) > 12 * 3600000;   // a full pass at least twice a day, whatever the feed says
    if (!full && !manual && !stale) {
      try {
        const ch = await G.changesSince(watch.token);
        if (ch) { newToken = ch.token; plan = classifyChanges(ch.changes, watch); if (ch.more) plan = null; }
      } catch (e) { if (e.auth) throw e; }
    }
    if (!plan) {   // full pass: mark "now" in the feed first so nothing that changes during the pass is missed
      G.reverify();
      newToken = await G.startToken().catch(() => '');
      plan = { full: true, state: true, rotas: true, hub: true };
    }
    if (!G.seenStateRev() && !rt.stateLoaded) plan.state = true;   // read state.json once per app session at least
    rt.syncMode = plan.full ? 'full' : plan.state || plan.rotas || plan.hub ? 'changes' : 'nothing new';
    // 2. state first (the merge decides what everything else shows), then the rest in parallel
    if (plan.state) await step('state', async () => { await pullState(); rt.stateLoaded = true; });
    await Promise.all([
      step('account', async () => { if (!S().google.email) { const u = await G.userInfo(); store.update(s => ({ ...s, google: { ...s.google, email: u.email } }), { remote: false, silent: true }); } }),
      plan.rotas ? step('rotas', pullRotasFromDrive) : null,
      plan.hub || !rt.hub.at ? step('hub', () => syncHub({ full: plan.full })) : null,
      step('calendar', () => syncCalendar(manual || plan.full)),
    ]);
    // 3. queued calendar writes, unsaved local changes, shift mirror
    await step('outbox', flushOutbox);
    if (rt.saveDirty) await step('save', saveStateNow);
    if (S().settings.pushShifts && (plan.full || plan.rotas || plan.state)) await step('shift push', pushShiftsToCalendar);
    // 4. remember where we are in the feed — only when everything worked, so a failed step is retried next time
    if (!problems.length && newToken) {
      const next = { ...(watch || {}), root, token: newToken };
      if (plan.full) { Object.assign(next, await G.watchedFolders(root).catch(() => ({})), { fullAt: Date.now() }); }
      saveWatch(next);
    }
    // 5. a daily snapshot of your state on Drive (14 kept) — the undo for a bad merge or a wrong tap; then tell the other apps
    if (!problems.length) G.backupDaily(root, stripForRemote(S()), keyOf(new Date())).catch(e => console.warn('backup', e.message));
    await step('publish', publish);
    store.update(s => ({ ...s, google: { ...s.google, lastSync: Date.now() } }), { remote: false, silent: true });
    rt.lastProblems = problems; rt.lastSyncMs = Math.round(performance.now() - t0);
    if (manual) toast(problems.length ? 'Synced with issues — see Settings › Diagnostics' : 'Synced', problems.length ? 'err' : 'ok');
    else if (problems.length) console.warn(problems);
  } catch (e) {
    rt.lastProblems = [e.message];
    if (manual) toast(e.message, 'err');
  } finally { rt.syncing = false; renderSync(); render(); }
}

/** Turn a page of Drive changes into the smallest sync that covers them. null = can't tell, do a full pass. */
function classifyChanges(changes, w) {
  const plan = { state: false, rotas: false, hub: false };
  const roots = new Set([w.rotas, w.hub, w.me].filter(Boolean));
  const knownRotas = new Set(Object.values(S().rotas).map(r => r.driveId).filter(Boolean));
  for (const c of changes) {
    if (roots.has(c.id) && (c.removed || c.trashed || !(c.parents || []).length)) { G.forgetFolders(); return null; }   // one of our folders vanished: rebuild
    const par = c.parents || [];
    if (par.includes(w.rotas) || knownRotas.has(c.id)) plan.rotas = true;
    if (par.includes(w.me) && c.name === 'state.json' && (c.props?.rev || '') !== G.seenStateRev()) plan.state = true;
    // the files Mandarin reads: the Claude inbox, Citrus's plan (and its state, for the read-only contact cards)
    if ((w.claude && par.includes(w.claude) && c.name === 'status.json') || (w.citrus && par.includes(w.citrus) && c.name === 'plan.json')) plan.hub = true;
    if (par.includes(w.hub) && c.mimeType === 'application/vnd.google-apps.folder' && (c.name === 'claude' || c.name === 'citrus' || c.name === 'clementine') && c.id !== w.claude && c.id !== w.citrus) return null;   // a folder Mandarin reads appeared: full pass
  }
  return plan;
}

// ---------------- backups, scan & repair (Settings › Drive) ----------------
async function backupsSheet() {
  let list = [];
  try { list = await G.listBackups(S().settings.driveFolder); } catch (e) { return toast(e.message, 'err'); }
  const { close } = sheet([h('h2', {}, 'Restore a daily backup'),
    h('p', { class: 'small muted' }, 'Mandarin keeps one snapshot of your rotas, corrections, postings, logs and career per day on Drive (hub/mandarin/backups, newest 14). Restoring replaces this copy and syncs it to your other devices.'),
    list.length ? h('div', { class: 'list' }, ...list.map(b => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, fmtDate(fromKey(b.date))), h('div', { class: 'meta' }, `${Math.max(1, Math.round(b.size / 1024))} KB`)),
      h('button', { class: 'btn sm', onClick: async () => {
        try {
          const j = await G.readBackup(b.id); close(); restoreSheet(j, { source: `Drive backup of ${fmtDate(fromKey(b.date))}` });
        } catch (e) { toast(e.message, 'err'); }
      } }, 'Restore')))) : h('div', { class: 'muted small' }, 'No backups yet — the first is made after today\'s sync.')]);
}
// ---------------- restore: check, show, confirm, keep an undo copy (beta T09-02, T10-11, T10-12) ----------------
const PRE_KEY = 'mandarin.preRestore';
function preRestore() { if (rt.preRestore) return rt.preRestore; try { return JSON.parse(localStorage.getItem(PRE_KEY) || 'null'); } catch { return null; } }
/** The copy taken just before a restore. On this device only; if storage is full it lives in memory until the app closes. */
function keepPreRestore() { const snap = { at: Date.now(), state: S() }; rt.preRestore = snap; try { localStorage.setItem(PRE_KEY, JSON.stringify(snap)); return true; } catch { return false; } }
function dropPreRestore() { rt.preRestore = null; try { localStorage.removeItem(PRE_KEY); } catch {} }
/** Draw every main screen off-page; a restored state that throws anywhere is rolled back before anyone sees an empty app. */
function smokeRender() { for (const fn of [renderToday, renderRota, TV.renderTeam, PU.renderNurses, MV.renderMonth, RU.renderCareer, CP.renderPay, CP.renderCreds]) fn(); }
const when = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'unknown date';
function restoreSheet(json, { source = 'Backup file' } = {}) {
  const chk = checkBackup(json); if (!chk.ok) { toast(`${source}: ${chk.error}`, 'err'); return; }
  const sm = chk.summary, cur = checkBackup(S()).summary, older = sm.savedAt && (S().updatedAt || 0) > sm.savedAt;
  const kv = (rows) => h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)]));
  const { close } = sheet([h('h2', {}, 'Restore this backup?'), h('div', { class: 'small muted', style: { marginBottom: '10px' } }, source),
    h('div', { class: 'rs-cols' },
      h('div', { class: 'card rs-in' }, h('div', { class: 'title' }, 'In the backup'), kv([['Saved', when(sm.savedAt)], ['Holds', describeCounts(sm.counts)], ['Rotas', sm.rotas.join(', ') || 'none'], ['Me', sm.me || 'not set']])),
      h('div', { class: 'card' }, h('div', { class: 'title' }, 'On this device now'), kv([['Saved', when(S().updatedAt)], ['Holds', describeCounts(cur.counts)], ['Me', cur.me || 'not set']]))),
    older ? h('div', { class: 'small late', style: { margin: '8px 0' } }, 'This backup is older than the data on this device.') : null,
    chk.dropped.length ? h('div', { class: 'card warn' }, h('div', { class: 'title' }, `Left out: ${chk.dropped.length} damaged part${chk.dropped.length > 1 ? 's' : ''}`), h('div', { class: 'tiny' }, chk.dropped.slice(0, 8).join(' · '), chk.dropped.length > 8 ? ` · +${chk.dropped.length - 8} more` : '')) : null,
    h('p', { class: 'small muted' }, 'Replace puts the backup in place of everything here, then on your other devices. Merge keeps both: for each item the newest edit wins. Either way Mandarin keeps a copy of your data as it is now, so you can undo.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn danger grow', onClick: () => { close(); applyRestore(chk.state, { merge: false }); } }, 'Replace everything'),
      h('button', { class: 'btn primary grow', onClick: () => { close(); applyRestore(chk.state, { merge: true }); } }, 'Merge into mine'),
      h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}
function applyRestore(next, { merge = false } = {}) {
  const before = S(), kept = keepPreRestore();
  backupBefore(merge ? 'merge' : 'restore');
  const target = merge ? { ...mergeStates(before, next), updatedAt: Math.max(before.updatedAt || 0, next.updatedAt || 0) } : { ...next, outbox: before.outbox, google: before.google };
  try { store.replaceState(target); smokeRender(); }
  catch (e) { console.warn('restore rolled back', e); store.replaceState(before); dropPreRestore(); render(); toast(`That backup would break the app (${String(e.message).slice(0, 60)}). Nothing was changed.`, 'err'); return false; }
  store.replaceState(S(), { bump: true, exact: merge ? null : before });   // only a state that draws is sent on to your other devices
  render();
  toast(h('span', {}, merge ? 'Merged' : 'Restored', kept ? '' : ' (undo copy kept until you close the app)', ' · ', h('button', { class: 'linkish', onClick: undoRestore }, 'Undo')), 'ok');
  return true;
}
function undoRestore() {
  const snap = preRestore(); if (!snap?.state) { toast('Nothing to undo'); return; }
  store.replaceState(snap.state, { bump: true, exact: S() }); dropPreRestore(); render(); toast(`Back to your data from ${when(snap.at)}`, 'ok');
}
async function repairSheet() {
  const body = h('div', {}, h('div', { class: 'muted small' }, 'Looking through Drive › ' + S().settings.driveFolder + '…'));
  const { close } = sheet([h('h2', {}, 'Check Drive'), body]);
  let rep;
  try { rep = await G.scanDrive(S().settings.driveFolder); } catch (e) { body.replaceChildren(h('div', { class: 'small' }, e.message)); return; }
  const issues = [...rep.twinFolders, ...rep.twinFiles].filter(t => t.fixable).length;
  body.replaceChildren(...[
    h('div', { class: 'small' }, `${rep.folders} folders · ${rep.files} files · ${issues ? `${issues} duplicate${issues > 1 ? 's' : ''}` : 'no duplicates'}`),
    ...rep.twinFolders.map(t => h('div', { class: 'small', style: { marginTop: '6px' } }, t.fixable ? `▸ ${t.path} ×${t.items.length} — contents will be merged into the oldest` : `▸ ${t.path} ×${t.items.length} — belongs to its own app; open that app to tidy it`)),
    ...rep.twinFiles.filter(t => t.fixable).map(t => h('div', { class: 'small', style: { marginTop: '6px' } }, `· ${t.path} ×${t.items.length} — newest kept, others to the trash`)),
    rep.strayRoots.length ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Old folder “${rep.strayRoots.map(r => r.name).join(', ')}” is still in My Drive. No app uses it any more — check it and delete it yourself if it's empty.`) : null,
    h('pre', { class: 'tiny', style: { background: 'var(--bg2)', padding: '10px', borderRadius: '10px', overflow: 'auto', marginTop: '10px', maxHeight: '40vh' } }, rep.tree.join('\n') || '(empty)'),
    issues ? h('button', { class: 'btn primary', style: { marginTop: '10px' }, onClick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'Fixing…';
      try { const r = await G.repairDrive(rep); saveWatch(null); close(); toast(`Fixed: ${r.moved} moved, ${r.trashed} to the trash (restorable for 30 days)`, 'ok'); refreshAll(false, { full: true }); }
      catch (err) { toast(err.message, 'err'); e.target.disabled = false; e.target.textContent = 'Fix duplicates'; }
    } }, 'Fix duplicates') : null].filter(Boolean));
}

async function loadEvents(monthDate, force = false) {
  const mk = `${monthDate.getFullYear()}-${pad2(monthDate.getMonth() + 1)}`;
  if (rt.eventsLoaded[mk] && !force) return;
  if (!G.isSignedIn()) return;
  const from = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1), to = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
  const ids = S().settings.calendarIds?.length ? S().settings.calendarIds : ['primary'];
  const all = [];
  for (const id of ids) { try { all.push(...await G.listEvents(id, from, to)); } catch (e) { console.warn('cal', id, e.message); } }
  // clear month then fill
  for (const k of Object.keys(rt.events)) if (k.startsWith(mk)) delete rt.events[k];
  for (const ev of all) {
    if (ev.tag === 'shift' || ev.citrus === 'shift') continue; // the shift mirror (Mandarin's, or Citrus's old one)
    const k = keyOf(ev.start);
    (rt.events[k] ||= []).push(ev);
  }
  rt.eventsLoaded[mk] = true;
  cacheEvents();
}
function cacheEvents() {
  try { localStorage.setItem('mandarin.events', JSON.stringify(rt.events, (k, v) => v instanceof Date ? v.toISOString() : v)); } catch {}
}
function loadCachedEvents() {
  try {
    const raw = JSON.parse(localStorage.getItem('mandarin.events') || '{}');
    for (const [k, list] of Object.entries(raw)) rt.events[k] = list.map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
  } catch {}
}

async function pullRotasFromDrive() {
  const files = await G.listRotaFiles(S().settings.driveFolder);
  const known = S().rotas;
  let added = 0;
  for (const f of files) {
    const already = Object.values(known).find(r => r.driveId === f.id && r.driveModified === f.modifiedTime);
    if (already) continue;
    const removedAt = S().deleted?.[`drive:${f.id}`];
    if (removedAt && removedAt >= Date.parse(f.modifiedTime)) continue;   // you removed this rota; only a newer version of the file brings it back
    try {
      const buf = await G.downloadRota(f);
      const rota = serializeRota(await parseRotaFile(buf, f.name));
      rota.driveId = f.id; rota.driveModified = f.modifiedTime;
      if (!rota.weekdayOk) toast(`${f.name}: the weekdays don't match ${MONTHS[rota.month - 1]} ${rota.year} — check the month cell`, 'err');
      const prev = S().rotas[rota.id], diff = prev ? RC.diffRota(S(), prev, rota) : null;
      store.update(s => { const st = { ...s, rotas: { ...s.rotas, [rota.id]: rota } }; return diff ? RC.recordChanges(st, diff) : st; }, { silent: true });
      if (diff && (diff.total || diff.added.length || diff.removed.length)) toast(`${f.name} updated: ${RC.headline(diff)}`, 'ok');
      added++;
    } catch (e) { console.warn('rota parse failed', f.name, e.message); toast(`Could not read ${f.name}: ${e.message}`, 'err'); }
  }
  if (added) { toast(`Imported ${added} rota file${added > 1 ? 's' : ''} from Drive`, 'ok'); autoPickMe(); }
}

async function pushShiftsToCalendar() {
  const s = S();
  if (!s.me) return;
  let calId = s.settings.shiftCalendarId;
  if (!calId) { calId = await G.ensureCalendar('Mandarin Shifts'); store.update(x => ({ ...x, settings: { ...x.settings, shiftCalendarId: calId } }), { remote: false, silent: true }); }
  for (const r of Object.values(s.rotas)) {
    if (r.unitKind !== 'gp') continue;
    const from = new Date(r.year, r.month - 1, 1), to = new Date(r.year, r.month, 1, 12);   // the month, plus the morning end of a last-night shift
    const wanted = [];
    for (let d = 1; d <= r.daysInMonth; d++) {
      const date = new Date(r.year, r.month - 1, d);
      const info = dayInfo(s, date);
      if (!info.mine || info.mine.shift.kind !== 'work') continue;
      const w = shiftWindow(date, info.mine.shift);
      if (!w) continue;
      const with_ = info.withMe.map(e => firstName(e.person.name)).join(', ');
      wanted.push({ title: `${info.mine.code} · ${info.mine.shift.label}`, start: w.start, end: w.end, location: info.mine.shift.site, description: with_ ? `With: ${with_}` : '', reminders: shiftAlarm() });
    }
    await G.syncTaggedEvents(calId, 'shift', from, to, wanted);
  }
}

// Calendar writes that could not be sent are kept and retried on the next sync / when back online
/** → { how: 'cal', event } when Google has it, { how: 'queued' } when it waits in the outbox. quiet: the caller toasts once itself. */
async function calendarCreate(calendarId, payload, meta = {}, { quiet = false } = {}) {
  const queue = () => { queueOutbox({ type: 'create', calendarId, payload, meta }, { quiet }); return { how: 'queued', event: null }; };
  if (!rt.online || !G.isSignedIn()) return queue();
  try { return { how: 'cal', event: await G.createEvent(calendarId, payload) }; }
  catch (e) { if (e.network || /expired|not signed/i.test(e.message)) return queue(); throw e; }
}
const QUEUED_TXT = 'will reach your calendar when online';
function queueOutbox(op, { quiet = false } = {}) { store.update(s => ({ ...s, outbox: [...(s.outbox || []), { ...op, id: uid(), at: Date.now() }] }), { silent: true, remote: false }); if (!quiet) toast(`Saved — ${QUEUED_TXT}`); }
let flushing = null;
function flushOutbox() { if (!flushing) flushing = flushOutboxOnce().finally(() => { flushing = null; }); return flushing; }
async function flushOutboxOnce() {
  const ops = S().outbox || []; if (!ops.length || !G.isSignedIn() || !rt.online) return;
  const done = new Set();
  for (const op of ops) {
    try {
      if (op.type === 'create') {
        // a create whose answer was lost may already be in the calendar: look for it by its key before sending it again
        const payload = { ...op.payload, start: new Date(op.payload.start), end: new Date(op.payload.end), key: op.id };
        let ev = op.tried ? await G.findEventByKey(op.calendarId, op.id, addDays(payload.start, -1), addDays(payload.end, 1)).catch(() => null) : null;
        if (!ev) { store.update(s => ({ ...s, outbox: (s.outbox || []).map(o => o.id === op.id ? { ...o, tried: true } : o) }), { silent: true, remote: false }); ev = await G.createEvent(op.calendarId, payload); }
      } else if (op.type === 'delete') await G.deleteEvent(op.calendarId, op.eventId);
      done.add(op.id);
    } catch (e) {
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) done.add(op.id);   // rejected for good: don't retry forever
    }
  }
  // remove only what was sent — anything queued during the flush stays
  store.update(s => ({ ...s, outbox: (s.outbox || []).filter(op => !done.has(op.id)) }), { silent: true, remote: false });
}

// Who "me" is decides every shift Mandarin calls yours, so it is never guessed (an early version guessed it from a name, beta T10-01):
// after the first import Mandarin asks, and keeps the answer.
function autoPickMe() {
  if (S().me || !mePeople().length || topSheet()?.querySelector('.me-pick')) return;
  mePicker({ first: true });
}
/** Everyone who can be "me": people in the doctor rotas (GP, FSED, specialists), grouped by unit. Nurses' rows don't drive shifts, so they're left out. */
function mePeople() {
  const order = ['gp', 'fsed', 'uv', 'lv'];
  return allPeople(S()).filter(p => p.units.some(u => order.includes(u))).map(p => ({ ...p, unit: order.find(u => p.units.includes(u)) }))
    .sort((a, b) => order.indexOf(a.unit) - order.indexOf(b.unit) || a.name.localeCompare(b.name));
}
function setMe(p) {
  store.update(s => ({ ...s, me: p ? { name: p.name, id: p.id || '' } : null }));
  render();
  if (p) toast(`Hi ${firstName(p.name)}: Today now shows your shifts`, 'ok');
}
/** "Which one is you?": a searchable list of the rota rows, grouped by unit. */
function mePicker({ first = false } = {}) {
  const s = S(), all = mePeople(); if (!all.length) { toast('Import a rota first'); return; }
  const q = h('input', { type: 'search', placeholder: 'Type your name or staff ID', 'aria-label': 'Search the rota for your name', autocomplete: 'off', 'data-nodirty': '' });
  const list = h('div', { class: 'me-list', role: 'list' });
  const paint = () => {
    const t = q.value.trim().toLowerCase(), hits = all.filter(p => !t || p.name.toLowerCase().includes(t) || String(p.id || '').includes(t) || (p.title || '').toLowerCase().includes(t));
    const groups = {}; for (const p of hits) (groups[p.unit] ||= []).push(p);
    list.replaceChildren(...Object.entries(groups).flatMap(([u, ps]) => [h('div', { class: 'me-unit tiny dim' }, `${UNIT_LABEL[u] || u} · ${ps.length}`),
      ...ps.map(p => h('button', { class: `me-row ${isMe(s, p) ? 'sel' : ''}`, role: 'listitem', onClick: () => { topSheet()?.remove(); setMe(p); } },
        h('span', { class: 'av' }, initials(p.name)), h('span', { class: 'grow' }, h('b', {}, p.name), h('small', {}, [p.title, p.id ? `ID ${p.id}` : ''].filter(Boolean).join(' · '))), isMe(s, p) ? h('span', { class: 'chip sel' }, 'you') : null))]),
      hits.length ? null : h('div', { class: 'muted small', style: { padding: '10px 2px' } }, 'Nobody by that name in the loaded rotas.'));
  };
  q.addEventListener('input', paint); paint();
  sheet(h('div', { class: 'me-pick' }, h('h2', {}, 'Which one is you?'),
    h('p', { class: 'small muted' }, first ? 'Mandarin needs to know your row before it can show your shifts. Pick it once; it stays picked on all your devices.' : 'The row Mandarin treats as yours, in every rota.'),
    q, list,
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn ghost grow', onClick: () => topSheet()?.remove() }, first ? 'Later' : 'Close'), s.me && !first ? h('button', { class: 'btn ghost danger', onClick: () => { topSheet()?.remove(); setMe(null); } }, 'Not me: clear') : null)));
}
/** You're set as someone the month's GP rota doesn't have (new staff ID, typo). A row with exactly your name is offered back. */
function meMissing(info) {
  const s = S(); if (!s.me || info.mine || !TM.hasGpRota(info)) return null;
  const gp = info.rotas.find(r => r.unitKind === 'gp'), nm = String(s.me.name || '').toLowerCase(), twin = gp.people.find(p => p.name.toLowerCase() === nm);
  return { gp, twin };
}

// ---------------- import ----------------
async function importFiles(fileList) {
  let ok = 0; const briefs = [];
  for (const f of fileList) {
    try {
      const rota = serializeRota(await parseRotaFile(await f.arrayBuffer(), f.name));
      if (!rota.weekdayOk) toast(`${f.name}: the weekdays don't match ${MONTHS[rota.month - 1]} ${rota.year} — check the month cell`, 'err');
      const prev = S().rotas[rota.id], diff = prev ? RC.diffRota(S(), prev, rota) : null;
      store.update(s => { const deleted = { ...(s.deleted || {}) }; delete deleted[`rota:${rota.id}`]; const st = { ...s, rotas: { ...s.rotas, [rota.id]: rota }, deleted }; return diff ? RC.recordChanges(st, diff) : st; }, { silent: true });
      if (diff) briefs.push(diff.rotaId);
      ok++;
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
  if (ok) { toast(`Imported ${ok} rota${ok > 1 ? 's' : ''}`, 'ok'); autoPickMe(); render(); }
  if (briefs.length) { const list = RC.unseen(S()).filter(d => briefs.includes(d.rotaId)); if (list.length) CHU.briefSheet(list); else toast('Same schedule as before: nothing changed', 'ok'); }
  if (ok && G.isSignedIn() && rt.online) uploadRotas(fileList).catch(e => console.warn('rota upload', e.message));
}
// Rotas imported on this device go to Drive › My Apps › Rotas too, named "YYYY-MM Unit.xlsx", so every device and app gets them
async function uploadRotas(fileList) {
  const existing = await G.listRotaFiles(S().settings.driveFolder);
  let up = 0;
  for (const f of fileList) {
    let rota; try { rota = await parseRotaFile(await f.arrayBuffer(), f.name); } catch { continue; }
    const name = `${rota.year}-${pad2(rota.month)} ${({ gp: 'GP rota', fsed: 'FSED', uv: 'Upper Village', lv: 'Lower Village', nurse: 'Nurses' })[rota.unitKind] || rota.unit}.xlsx`;
    const same = existing.find(x => x.name === name || x.name === f.name);
    if (same && +same.size === f.size) continue;   // already there
    const r = await G.uploadRota(S().settings.driveFolder, name, f, same?.id);
    store.update(s => ({ ...s, rotas: { ...s.rotas, [rota.id]: { ...s.rotas[rota.id], driveId: r.id, driveModified: r.modifiedTime } } }), { silent: true });
    up++;
  }
  if (up) toast(`Saved ${up} rota file${up > 1 ? 's' : ''} to Drive › ${S().settings.driveFolder} › Rotas`, 'ok');
}

function importButton(label = 'Import rota files') {
  const input = h('input', { type: 'file', accept: '.xlsx', multiple: true, style: { display: 'none' }, onChange: (e) => importFiles([...e.target.files]) });
  return h('span', {}, input, h('button', { class: 'btn', onClick: () => input.click() }, '📄 ', label));
}

// ---------------- sheets (bottom modals) ----------------
// Each sheet is a modal dialog: focus moves in and is trapped, Escape / Back close the TOP sheet only, focus returns to what opened it,
// and the page behind stops scrolling. Sheets are also removed directly (`.sheet-bg` .remove()) all over the app, so the
// bookkeeping (focus, scroll lock, history) runs from a MutationObserver instead of from close().
const sheetOpeners = new WeakMap();
// the search box counts as a sheet: Back closes it and Tab stays in it (T6-02, T6-10)
const topSheet = () => [...document.querySelectorAll('.sheet-bg, body > .search')].pop() || null;
function sheet(content) {
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const bg = h('div', { class: 'sheet-bg', onClick: (e) => { if (e.target === bg) close(); } });
  // a visible ✕: on a desktop or an Arcade screen nothing said that the backdrop closes the sheet (beta T02-08); it warns like Escape
  const x = h('button', { class: 'sheet-x', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onClick: () => { if (topSheet() === bg) closeTopSheet(); else close(); } }, '✕');
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, h('div', { class: 'handle' }), x, ...[content].flat());
  const title = box.querySelector('h2'); if (title) { title.id ||= 'sh-' + uid(); box.setAttribute('aria-labelledby', title.id); } else box.setAttribute('aria-label', 'Details');
  // remember typed edits, so Escape asks before throwing them away
  box.addEventListener('input', (e) => { if (e.target.matches?.('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=search]):not([type=file]):not([data-nodirty])')) bg.dataset.dirty = '1'; });
  bg.append(box); document.body.append(bg); sheetOpeners.set(bg, opener);
  const close = () => bg.remove();
  // focus the first field (or the dialog itself) without scrolling the page; a sheet that already put focus inside keeps it
  queueMicrotask(() => { if (!bg.isConnected || box.contains(document.activeElement)) return; const f = box.querySelector('input:not([type=hidden]):not([type=file]), textarea, select'); (f && !matchMedia('(hover: none)').matches ? f : box).focus({ preventScroll: true }); });
  return { close, box };
}
/** Escape: close the top sheet; with unsaved typing, the first Escape only warns. */
function closeTopSheet() {
  const bg = topSheet(); if (!bg) return false;
  if (bg.dataset.dirty && !bg.dataset.warned) { bg.dataset.warned = '1'; toast('Unsaved changes: press Esc again to discard'); setTimeout(() => { delete bg.dataset.warned; }, 4000); return true; }
  bg.remove(); return true;
}
/** "?" — every keyboard shortcut in one place (beta T09-24). */
function shortcutsSheet() {
  const rows = [['1 – 6', 'Today, Calendar, Team, Nurses, Month, Career (in your tab order)'], [',', 'Settings'], ['/', 'Search people, days, codes'], ['t', 'Open today in the day sheet'], ['↑ ↓ Enter', 'move through search results and open one'], ['r', 'Sync with Google now'], ['Esc', 'close the top sheet or the search'], ['?', 'this list']];
  sheet([h('h2', {}, 'Keyboard shortcuts'), h('div', { class: 'kv keys' }, rows.flatMap(([k, v]) => [h('kbd', {}, k), h('span', {}, v)]))]);
}
// Back button closes the top sheet: one history entry guards all open sheets.
let sheetGuard = false, sheetSelfBack = false, lastSheetClose = 0;
// the second tap of a double-tap on Save lands on whatever was under the sheet (the bottom tabs): swallow it (T4-10)
document.addEventListener('click', (e) => { if (Date.now() - lastSheetClose < 280 && !e.target.closest?.('.sheet, .toast')) { e.preventDefault(); e.stopPropagation(); } }, true);
function watchSheets() {
  new MutationObserver((muts) => {
    const removed = muts.flatMap(m => [...m.removedNodes]).filter(n => n.classList?.contains('sheet-bg') || n.classList?.contains('search')), open = document.querySelectorAll('.sheet-bg, body > .search').length;
    if (removed.length) lastSheetClose = Date.now();
    document.documentElement.classList.toggle('sheet-open', open > 0);
    for (const bg of removed) { const o = sheetOpeners.get(bg); if (o?.isConnected && !topSheet()) o.focus({ preventScroll: true }); }
    // the calendar's selected-day ring belongs to the open day sheet; it goes when the sheet does (beta T02-27)
    if (removed.some(bg => bg.dataset.daySheet) && !document.querySelector('.sheet-bg[data-day-sheet]')) { rt.rotaSel = null; document.querySelectorAll('.cal .day.sel').forEach(c => c.classList.remove('sel')); }
    if (open && !sheetGuard) { history.pushState({ mSheet: 1 }, '', location.href); sheetGuard = true; }
    else if (!open && sheetGuard && !sheetSelfBack && history.state?.mSheet) { sheetSelfBack = true; history.back(); }
  }).observe(document.body, { childList: true });
  addEventListener('popstate', () => {
    if (sheetSelfBack) { sheetSelfBack = false; sheetGuard = false; if (topSheet()) { history.pushState({ mSheet: 1 }, '', location.href); sheetGuard = true; } return; }
    sheetGuard = false; const bg = topSheet(); if (bg) { bg.remove(); if (topSheet()) { history.pushState({ mSheet: 1 }, '', location.href); sheetGuard = true; } }
  });
  // keep Tab inside the top sheet
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return; const bg = topSheet(); if (!bg) return;
    const f = [...bg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) { e.preventDefault(); return; }
    const i = f.indexOf(document.activeElement);
    if (!bg.contains(document.activeElement) || (e.shiftKey && i <= 0) || (!e.shiftKey && i === f.length - 1)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
  });
}
// ---------------- the hub: what Mandarin reads from other apps, and what it publishes ----------------
const HUB_KEY = 'mandarin.hub';   // last copies of the files read from other apps (this device only)
function loadHubCache() { try { const j = JSON.parse(localStorage.getItem(HUB_KEY) || 'null'); if (j && typeof j === 'object') rt.hub = { ...rt.hub, ...j }; } catch {} }
function saveHubCache() { try { localStorage.setItem(HUB_KEY, JSON.stringify(rt.hub)); } catch {} }
loadHubCache();
/** Read the Claude inbox, Citrus's plan, and the contact cards (Clementine's, else Citrus's). Read only: never written back. */
async function syncHub({ full = false } = {}) {
  const root = S().settings.driveFolder;
  const [claude, plan] = await Promise.all([G.readOtherFile(root, 'claude', 'status.json').catch(() => null), G.readOtherFile(root, 'citrus', 'plan.json').catch(() => null)]);
  rt.hub.claude = claude?.data || null; rt.hub.citrusPlan = plan?.data || null; rt.hub.at = Date.now();
  if ((claude?.data || plan?.data) && !S().settings.family) store.update(x => ({ ...x, settings: { ...x.settings, family: true } }));
  // the first time, or twice a day: take over the work parts of Citrus (once), and refresh the read-only contact cards
  if (full || !S().migrated || Date.now() - DIR.syncedAt() > 12 * 3600000) {
    const clem = (await G.readOtherFile(root, 'clementine', 'contacts.json').catch(() => null)) || (await G.readOtherFile(root, 'clementine', 'state.json').catch(() => null));
    const citrus = clem ? null : await G.readOtherFile(root, 'citrus', 'state.json').catch(() => null);
    if (clem?.data) DIR.ingest(clem.data, 'clementine'); else if (citrus?.data) DIR.ingest(citrus.data, 'citrus');
    if (!S().migrated && citrus?.data) offerMigration(citrus.data, 'Citrus on Drive');
  }
  saveHubCache();
}
/** Proposals waiting for Mandarin: postings, swaps and nurse notes from the Claude inbox. */
function inboxItems() { return IN.pending(S(), rt.hub.claude ? { claude: rt.hub.claude } : {}, new Date()); }
function acceptInbox(p, confirmed = false) {
  // a swap changes your shift: say what changes first, warn about an unknown colleague, and keep an Undo (beta T1-18)
  if (p.item.type === 'swap' && !confirmed) {
    const v = IN.checkSwap(S(), p.item); if (v.error) return toast(v.error, 'err');
    const d = fromKey(p.item.date), { close } = sheet([h('h2', {}, `Apply this swap on ${DAY_NAMES[d.getDay()]} ${fmtDate(d)}?`),
      h('div', { class: 'kv' }, h('b', {}, 'Rota'), h('span', {}, v.before), h('b', {}, 'Becomes'), h('span', {}, v.after), p.item.with ? h('b', {}, 'With') : null, p.item.with ? h('span', {}, p.item.with) : null),
      v.withKnown ? null : h('div', { class: 'small late', style: { margin: '8px 0' } }, `${p.item.with} is not in the rota: check the name.`),
      p.item.note ? h('div', { class: 'small muted', style: { margin: '6px 0' } }, p.item.note) : null,
      h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { close(); acceptInbox(p, true); } }, 'Apply swap'), h('button', { class: 'btn ghost', onClick: () => close() }, 'Not now'))]);
    return;
  }
  const before = S(), res = IN.accept(before, p); if (res.error) return toast(res.error, 'err');
  store.update(() => res.state);
  const touched = (coll) => [...new Set([...Object.keys(before[coll] || {}), ...Object.keys(res.state[coll] || {})])].filter(k => before[coll]?.[k] !== res.state[coll]?.[k]);
  const undo = { action: { label: 'Undo', run: () => store.update(s => { let x = s; for (const [coll, pre] of [['swaps', 'swap'], ['posts', 'post']]) for (const k of touched(coll)) x = store.revert(x, coll, pre, k, before[coll]?.[k]); const log = { ...(x.inboxLog || {}) }; delete log[p.ref]; return { ...x, inboxLog: log, settings: p.item.type === 'nurse' ? before.settings : x.settings }; }) } };
  if (p.item.type === 'posting') toast(`${res.placed} posting${res.placed === 1 ? '' : 's'} saved as heard${p.item.from ? ` from ${p.item.from}` : ''}${res.missed?.length ? ` · not matched: ${res.missed.join(', ')}` : ''}`, res.missed?.length ? 'err' : 'ok', undo);
  else if (p.item.type === 'nurse' && res.missed) { const ref = p.ref; toast(`No single nurse matches "${p.item.nurse}" on your nurse sheets`, 'err', { action: { label: 'Dismiss', run: () => { store.update(x => IN.dismiss(x, ref)); render(); } } }); }   // T5-11: no loop of the same error
  else if (p.item.type === 'nurse') toast(res.missed ? `No single nurse matches "${p.item.nurse}" on your nurse sheets` : `${res.name}: ${p.item.canLead ? 'can be team leader' : 'no longer marked as a possible leader'}`, res.missed ? 'err' : 'ok');
  else if (p.item.type === 'swap') toast(`Swap saved for ${fmtDate(fromKey(p.item.date))}${p.item.with ? ` with ${p.item.with}` : ''}`, 'ok', undo);
}
/** Blocks Citrus planned for a day, in minutes from midnight, for the dial and the day sheet. */
function citrusBlocks(d) {
  const p = rt.hub.citrusPlan, day = p?.days?.[keyOf(d)]; if (!day) return [];
  const toMin = (t) => { const m = /^(\d\d):(\d\d)$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
  return (day.blocks || []).filter(b => b && b.status === 'accepted' && b.app !== 'mandarin').map(b => ({ title: String(b.title || '').slice(0, 60), start: toMin(b.start), end: toMin(b.end), app: String(b.app || '') })).filter(b => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
}

// Citrus's work data, taken over once: shown first, applied on a tap (nothing is written without one)
let migrationOffered = false;
function offerMigration(citrus, source) {
  const { counts } = MIG.workPart(citrus); if (!Object.values(counts).some(n => n > 0)) { if (source !== 'Citrus on Drive') toast(`Nothing work-related in ${source}`); return; } if (migrationOffered) return;
  migrationOffered = true;
  setTimeout(() => {
    const { close } = sheet([h('h2', {}, 'Bring your work over from Citrus?'),
      h('p', { class: 'small' }, `Found in ${source}: ${MIG.describe(counts)}.`),
      h('p', { class: 'small muted' }, 'Mandarin copies them and owns them from now on. Citrus keeps its own copy until it hands work over completely; nothing is deleted there. Anything you already changed here is kept: for each item the newest edit wins.'),
      h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { close(); runMigration(citrus, source); } }, 'Bring it over'), h('button', { class: 'btn ghost', onClick: () => { close(); store.update(s => ({ ...s, migrated: { from: 'skipped', at: Date.now(), counts: {} } })); toast('Skipped. You can do it later in Settings › Data.'); } }, 'Not now'))]);
  }, 300);
}
function backupBefore(what) { if (rt.signedIn || S().google?.connected) G.backupBefore(S().settings.driveFolder, stripForRemote(S()), what).catch(e => console.warn('backup before', e.message)); }
function runMigration(citrus, source) {
  const before = S(), r = MIG.applyMigration(before, citrus);
  if (r.changed) backupBefore('migration');
  if (!r.changed) { toast('Nothing work-related found'); return; }
  try { store.replaceState(r.state, { bump: true }); smokeRender(); }
  catch (e) { console.warn(e); store.replaceState(before, { bump: true }); toast(`That copy would break the app (${String(e.message).slice(0, 60)}). Nothing was changed.`, 'err'); return; }
  render(); toast(`Brought over: ${MIG.describe(r.counts)}`, 'ok', { action: { label: 'Undo', run: () => { store.replaceState(before, { bump: true, exact: S() }); render(); } } });
  if (!S().me) autoPickMe();
}
async function migrateNow() {
  if (!G.isSignedIn()) return toast('Sign in with Google first', 'err');
  try { const c = await G.readOtherFile(S().settings.driveFolder, 'citrus', 'state.json'); if (!c?.data) return toast('No Citrus data found on Drive'); migrationOffered = false; offerMigration(c.data, 'Citrus on Drive'); }
  catch (e) { toast(e.message, 'err'); }
}

// What Mandarin publishes: status.json for Citrus, shifts.json for every app. At most every few seconds, only when it changed.
let pubTimer = null;
function publishSoon() { clearTimeout(pubTimer); if (!G.isSignedIn() || !rt.online) return; pubTimer = setTimeout(() => publish().catch(e => console.warn('publish', e.message)), 4000); }
function hubExtra(now = new Date()) {
  const s = S(), tmr = addDays(startOfDay(now), 1), nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const unposted = N.nurseRotas(s).length && dayInfo(s, tmr).mine?.shift.kind === 'work' ? (N.unpostedFor?.(s, tmr)?.length || 0) : 0;
  const missing = now.getDate() >= 22 && Object.keys(s.rotas).length && !Object.values(s.rotas).some(r => r.year === nm.getFullYear() && r.month === nm.getMonth() + 1) ? MONTHS[nm.getMonth()] : '';
  return { unposted, inbox: inboxItems().length, nextMonthMissing: missing };
}
async function publish() {
  if (!G.isSignedIn() || !rt.online) return;
  const root = S().settings.driveFolder, now = new Date();
  await G.writeOwnFile(root, 'status.json', HUB.buildStatus(S(), now, hubExtra(now)), { omit: ['updatedAt'] });
  await G.writeOwnFile(root, 'shifts.json', HUB.buildShifts(S(), now), { omit: ['updatedAt'] });
  rt.publishedAt = Date.now();
}

// ---------------- TODAY ----------------
const UI_MORE = 'moreOpen';   // "More for today" open/closed, remembered per device
function renderToday() {
  const s = S(), now = new Date();
  const main = [], side = [], loaded = Object.keys(s.rotas).length > 0, wide = cockpitWide() && loaded;
  if (!loaded) main.push(onboardingCard());
  const nudge = rotaReminderCard(); if (nudge) main.push(nudge);
  const md = myDay(s, now), { info, today } = md;
  if (loaded) main.push(heroCard(now, md));
  // Everything below the hero is ranked by what matters right now; the top few stay open, the rest fold into "More for today".
  const tailLive = md.overnightTail && now < md.overnightTail.window.end;
  const working = (!!today && now >= today.window.start && now < today.window.end) || !!tailLive, soon = !!today && now < today.window.end, ranked = [];
  const cz = CZ.custom(S());   // Customise › Today: hidden cards never show; pinned ones always lead, open
  const add = (el, score, label) => { if (el && !cz.today.hidden.includes(label)) ranked.push({ el, score: score + (cz.today.pinned.includes(label) ? 1000 : 0), label }); };
  add(shiftBoard(info, md), working ? 92 : soon ? 60 : 30, 'Shift board');
  add(CHU.updatesCard({ today: true }), 100, 'Schedule update');
  for (const c of DU.todayCards(now)) add(c.el, c.score, c.label === 'Overnight' ? 'Briefing' : c.label);
  add(PU.todayCard(), PU.todayScore(working), 'Nurses');   // the evening "tomorrow's postings not set" nudge stays above the fold
  add(proposalsCard(), 96, 'Proposals');
  add(RU.todayCard(), 80, 'Contract dates');
  add(CP.credsTodayCard(now), 78, 'Licences');
  // during last night's tail the people on call now are last night's (beta T1-05)
  if (info.hasRota || tailLive) add(onCallCard(tailLive ? dayInfo(s, addDays(startOfDay(now), -1)) : info, { now: tailLive ? now : null }), working ? 40 : 22, 'On call');
  ranked.sort((x, y) => y.score - x.score);
  // the wide cockpit spreads the cards: the team cards go to the third column instead of stacking under the hero (beta T1-27)
  const COL3 = ['Shift board', 'Tomorrow’s team', 'On call'], col3 = wide ? ranked.filter(r => COL3.includes(r.label)) : [];
  if (wide) for (const r of col3) ranked.splice(ranked.indexOf(r), 1);
  const TOP = cz.today.top + ranked.filter(r => cz.today.pinned.includes(r.label)).length, top = ranked.slice(0, TOP), rest = ranked.slice(TOP);
  main.push(...top.map(r => r.el));
  if (rest.length) main.push(h('details', { class: 'more-today', open: getUi()[UI_MORE] ? '' : null, onToggle: (e) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...getUi(), [UI_MORE]: e.currentTarget.open })); } catch {} } }, h('summary', {}, h('span', { class: 'title' }, 'More for today'), h('span', { class: 'chips' }, rest.map(r => h('span', { class: 'chip' }, r.label)))), ...rest.map(r => r.el)));
  { const ic = iosCard(loaded); if (ic) (loaded ? side : main).push(ic); }   // after the day's own cards, never above them
  if (!cz.today.hidden.includes('Calendar')) side.push(eventsCard(now));
  { const fv = favCard(now); if (fv) side.push(fv); }
  if (wide) return h('div', { class: 'cockpit' }, h('div', { class: 'ck-col' }, ...main),
    h('div', { class: 'ck-col' }, h('div', { class: 'ck-head' }, h('h2', {}, 'Calendar'), h('button', { class: 'btn sm ghost', onClick: () => show('calendar') }, 'Open')), ...[renderRota({ compact: true })].flat().filter(Boolean)),
    h('div', { class: 'ck-col' }, ...col3.map(r => r.el), ...side, ...[TV.renderTeam({ compact: true })].flat().filter(Boolean)));
  return h('div', { class: 'cols' }, h('div', {}, ...main), h('div', {}, ...side));
}
/** Proposals from the Claude inbox (postings, swaps, nurse notes): Take or dismiss, never applied on their own. */
function proposalsCard() {
  const list = inboxItems(); if (!list.length) return null;
  const line = (p) => { const it = p.item;
    return h('div', { class: 'item inbox-row' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, it.title),
      h('div', { class: 'tiny dim' }, it.type === 'posting' ? `${it.postings.map(x => x.nurse).join(', ')}${it.from ? ` · from ${it.from}` : ''}` : it.type === 'swap' ? `${fmtDateShort(fromKey(it.date))}: you work ${it.code || 'nothing (off)'}${it.with ? ` · with ${it.with}` : ''}` : it.type === 'nurse' ? `${it.nurse}: ${it.canLead ? 'can lead' : 'not a leader'}` : '')),
      h('button', { class: 'btn sm primary', onClick: () => acceptInbox(p) }, it.type === 'posting' ? 'Add as heard' : it.type === 'swap' ? 'Apply swap' : 'Apply'),
      h('button', { class: 'btn sm ghost', 'aria-label': `Dismiss ${it.title}`, onClick: () => store.update(s => IN.dismiss(s, p.ref)) }, '✕')); };
  return h('div', { class: 'card inbox-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Proposals'), h('span', { class: 'tiny dim' }, 'from Claude')), h('div', { class: 'list' }, list.slice(0, 5).map(line)), list.length > 5 ? h('div', { class: 'tiny dim' }, `+${list.length - 5} more`) : null);
}
/** Coming shifts with a favourite colleague on them. */
function favCard(now) {
  if (!Object.keys(S().favs || {}).length) return null;
  const list = T.favShifts(S(), now, 14); if (!list.length) return null;
  return h('div', { class: 'card fav-card' }, h('div', { class: 'title' }, '⭐ With your favourites'), h('div', { class: 'list' }, list.slice(0, 5).map(d => h('button', { class: 'item clickable', onClick: () => daySheet(d.date) },
    h('div', { class: 'grow' }, h('div', { class: 'name' }, `${relDay(d.date)} · ${d.code}`), h('div', { class: 'meta' }, d.favs.map(p => firstName(p.name)).join(', '))), h('span', { class: 'chip' }, d.site.replace(/ office clinic.*/i, ' clinic'))))));
}
// ---------------- shared bits ----------------
function shiftChip(shift, code) {
  const cls = shift.kind === 'leave' ? 'leave' : shift.kind === 'off' ? 'off' : (shift.type || 'other');
  return h('span', { class: `chip ${cls}` }, code || shift.label);
}
function personPill(entry, onClick) {
  const p = entry.person;
  return h('button', { class: `pill ${isMe(S(), p) ? 'me' : ''}`, onClick: () => onClick ? onClick(entry) : personSheet(p) },
    h('span', { class: 'av' }, initials(p.name)), firstName(p.name), entry.code ? h('span', { class: 'dim tiny' }, entry.code) : null);
}
function initials(name) { const parts = String(name).replace(/^Dr\.?\s*/i, '').split(/\s+/).filter(Boolean); return (parts[0]?.[0] || '') + (parts[1]?.[0] || ''); }
function personKeyOf(p) { return p.id ? `id:${p.id}` : `name:${p.name.toLowerCase()}`; }


function personSheet(p) {
  const s = S();
  const key = personKeyOf(p);
  const units = [...new Set(Object.values(s.rotas).filter(r => r.people.some(x => personKeyOf(x) === key)).map(r => r.unitKind))], isGp = units.includes('gp');
  const months = Object.values(s.rotas).filter(r => r.people.some(x => personKeyOf(x) === key)).sort((a, b) => a.year - b.year || a.month - b.month);
  // the number the call / WhatsApp buttons use: your saved one first, the rota's as a footnote when they differ (beta T03-17)
  const saved = DIR.contactOf(key).phone, num = saved || p.mobile, digits = (x) => String(x || '').replace(/\D/g, '').replace(/^(966|0)/, '');
  const phoneLine = num ? h('div', { class: 'small muted' }, telLink(num)?.display || num, saved && p.mobile && digits(saved) !== digits(p.mobile) ? h('span', { class: 'dim' }, ` · rota: ${telLink(p.mobile)?.display || p.mobile}`) : null) : null;
  // days on together: GP colleagues share your site and shift; specialists cover your site; nurses can be posted with you (beta T01-26, T03-18)
  const hist = T.history(s).find(x => x.key === key), bal = SW.balances(s).find(b => b.name === p.name);
  const together = isGp ? T.nextWith(s, key, new Date(), 12).map(x => ({ date: x.date, label: x.code, how: '' }))
    : TM.daysWithMe(s, key, { nursesWithMe: (d, mine) => N.workingWithMe(s, d, mine) });
  const heading = isGp ? 'Coming shifts with you' : units.includes('nurse') ? 'On with you' : 'Covers your shifts';
  const how = [...new Set(together.map(x => x.how).filter(Boolean))];
  const chip = (x) => h('button', { class: `chip sw-day ${x.how === 'could be with you' || x.how === 'guess (last time)' ? 'maybe' : ''}`, title: x.how || 'same site and shift', 'aria-label': `${DAY_NAMES[x.date.getDay()]} ${fmtDate(x.date)}, your ${x.label}${x.how ? ', ' + x.how : ''}`, onClick: () => daySheet(x.date) }, `${fmtDateShort(x.date)} `, h('b', {}, x.label));
  const content = [
    h('div', { class: 'row' }, h('div', { class: 'avatar', style: { width: '44px', height: '44px', borderRadius: '50%', background: 'var(--orange-soft)', color: 'var(--orange2)', display: 'grid', placeItems: 'center', fontWeight: '700' } }, initials(p.name)),
      h('div', { class: 'grow' }, h('h2', {}, p.name), h('div', { class: 'small muted' }, [p.title, p.id ? `ID ${p.id}` : ''].filter(Boolean).join(' · ')))),
    h('div', { style: { height: '10px' } }),
    phoneLine,
    ...PU.personBlock(p),
    !isMe(s, p) && isGp && (hist || bal) ? h('div', { class: 'small ps-hist' }, [hist ? `${hist.n} shift${hist.n === 1 ? '' : 's'} together in the loaded rotas${hist.nights ? ` (${hist.nights} night${hist.nights === 1 ? '' : 's'})` : ''}` : '', hist?.last ? `last ${fmtDateShort(hist.last)}` : '', bal && bal.balance ? (bal.balance > 0 ? `owes you ${bal.balance} cover${bal.balance > 1 ? 's' : ''}` : `you owe ${-bal.balance} cover${bal.balance < -1 ? 's' : ''}`) : '', bal?.swaps ? `${bal.swaps} swap${bal.swaps > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')) : null,
    isMe(s, p) || !s.me ? null : h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${heading} (${together.length})`), how.length > 1 ? h('span', { class: 'tiny dim' }, how.map(w => `${together.filter(x => x.how === w).length} ${w}`).join(' · ')) : null),
      together.length ? h('div', { class: 'chips' }, ...together.map(chip)) : h('div', { class: 'muted small' }, isGp ? 'No coming shifts together in the loaded rotas' : units.includes('nurse') && !N.nurseRotas(s).length ? 'Load the nurses’ schedule to see this' : 'None in the loaded rotas')),
    months.length ? PU.personRota(p) : null,
  ];
  sheet(content);
}

function interpretFor(rota, code) { return interpretCode(code, rota.legend, rota.unitKind); }

/** "Day · Upper Village 08:00–20:00", without saying the hours twice when the rota's label already has them ("SF shift (13:00–01:00)", beta T01-25). */
function shiftText(sh) { return /\d\d:\d\d/.test(sh.label) ? sh.label : `${sh.label} ${fmtMin(sh.hours.start)}–${fmtMin(sh.hours.end)}`; }
/** Text with its "08:00–20:00" ranges in no-wrap spans, so a 320px hero never breaks inside a time range (beta T01-21). Same text content. */
const nbTimes = (t) => String(t).split(/(\d\d:\d\d–\d\d:\d\d)/).map((x, i) => i % 2 ? h('span', { class: 'nowrap' }, x) : x).filter(Boolean);
/** What tomorrow holds, or that it isn't known yet: a missing month is not a day off (beta T01-08, T10-04). */
function tomorrowText(now, tmr) {
  if (!S().me) return '';
  if (!TM.hasGpRota(tmr.info) && !tmr.info.mine) { const d = addDays(now, 1); return h('span', { class: 'unk-txt' }, tmr.info.hasRota ? `no GP rota for ${MONTHS[d.getMonth()]} yet` : `no rota yet (${MONTHS[d.getMonth()]} not loaded)`); }
  if (tmr.today) return shiftText(tmr.today.shift);
  if (tmr.noHours) return `${tmr.noHours.shift.label || tmr.noHours.code} (no hours given)`;
  if (tmr.info.mine?.shift.kind === 'leave') return tmr.info.mine.shift.label;
  return tmr.info.mine ? 'off' : 'not in the rota';
}
/**
 * The hero describes the shift that matters NOW (today-model.js heroFocus): the night you are still on after midnight,
 * today's shift until it ends, then tomorrow's. Its team, progress bar and dial all follow that shift (beta T01-02, T01-18, T10-02).
 */
function heroCard(now, md = myDay(S(), now)) {
  const s = S(), { info } = md, tmr = myDay(s, addDays(now, 1)), prevInfo = dayInfo(s, addDays(now, -1));
  const f = TM.heroFocus(now, md, tmr, prevInfo), missing = s.me ? meMissing(info) : null, gpNow = TM.hasGpRota(info) || !!info.mine;
  const night = f.entry?.shift.type === 'N' || f.kind === 'tail' || (f.kind === 'none' && md.afterNight);
  const hero = h('div', { class: `card hero hero-${f.kind}`, style: night ? { '--accent-soft': 'var(--night-soft)' } : {} });
  const words = h('div', {});
  const say = (...kids) => words.append(...kids.filter(Boolean));   // raw append() would print "null"
  const times = (e) => `${fmtTime(e.window.start)}–${fmtTime(e.window.end)} · ${fmtDur(e.shift.hours.durationMin)} · ${e.code}`;
  say(h('div', { class: 'title' }, `${DAY_NAMES[now.getDay()]} ${fmtDate(now)}`, f.kind === 'tomorrow' && f.doneToday ? h('span', { class: 'hero-done' }, ' · today’s shift done ✓') : null));
  if (!s.me && info.hasRota && mePeople().length) say(h('div', { class: 'big' }, 'Who are you?'), h('div', { class: 'sub' }, 'Pick your row once and Mandarin shows your shifts everywhere.'), h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary sm', onClick: () => mePicker({ first: true }) }, 'Pick your row')));
  else if (missing) {
    // you're set as someone this month's GP rota doesn't have: say so, instead of a cheerful "Day off" (beta T10-03)
    const { twin } = missing;
    say(h('div', { class: 'big' }, `You’re not in the ${MONTHS[now.getMonth()]} GP rota`),
      h('div', { class: 'sub' }, twin ? `It has ${twin.name} with ID ${twin.id || '—'}; Mandarin has you as ID ${s.me.id || '—'}.` : `Mandarin has you as ${s.me.name}${s.me.id ? ` (ID ${s.me.id})` : ''}, and no row matches. Until you pick yours, no day here is really off.`),
      h('div', { class: 'row wrap', style: { marginTop: '10px', gap: '6px' } }, twin ? h('button', { class: 'btn primary sm', onClick: () => setMe(twin) }, 'That’s me') : null, h('button', { class: `btn sm ${twin ? '' : 'primary'}`, onClick: () => mePicker() }, 'Pick your row')));
  } else if (f.kind === 'tail' || f.kind === 'today' || f.kind === 'done') {
    const e = f.entry;
    say(h('div', { class: 'big' }, e.shift.label), h('div', { class: 'sub' }, nbTimes(times(e)), f.kind === 'tail' ? ' · since yesterday' : ''), shiftProgress(e.window), e.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null);
  } else if (f.kind === 'tomorrow') {
    const e = f.entry;
    say(h('div', { class: 'big' }, h('span', { class: 'muted' }, 'Tomorrow · '), e.shift.label), h('div', { class: 'sub' }, nbTimes(times(e))), shiftProgress(e.window), e.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null);
  } else if (!info.hasRota && md.overnightTail) say(h('div', { class: 'big' }, 'Off, after a night'), h('div', { class: 'sub' }, `Your night ended ${fmtTime(md.overnightTail.window.end)}. No rota for ${MONTHS[now.getMonth()]} yet: import it to see the rest of the month.`));
  else if (!info.hasRota) say(h('div', { class: 'big' }, `No rota for ${MONTHS[now.getMonth()]} yet`), h('div', { class: 'sub' }, 'Import the Excel files, or drop them in Drive › My Apps › Rotas.'), h('div', { style: { marginTop: '10px' } }, importButton()));
  else if (!gpNow) say(h('div', { class: 'big' }, `No GP rota for ${MONTHS[now.getMonth()]}`), h('div', { class: 'sub' }, 'Other schedules are loaded, but your shifts come from the GP rota.'), h('div', { style: { marginTop: '10px' } }, importButton()));
  else if (info.mine && info.mine.shift.kind === 'leave') say(h('div', { class: 'big' }, info.mine.shift.label), h('div', { class: 'sub' }, 'Enjoy it.'));
  else if (md.noHours) say(h('div', { class: 'big' }, md.noHours.shift.label || md.noHours.code), h('div', { class: 'sub' }, `A working day (${md.noHours.code}); the rota gives no hours for it.`));
  else say(h('div', { class: 'big' }, md.afterNight ? 'Off, after a night' : 'Day off'), h('div', { class: 'sub' }, md.afterNight ? `Your night ended ${fmtTime(md.overnightTail.window.end)}. Recover first; the plan stays light.` : 'A free day: Citrus plans it, Mandarin keeps the rota.'));
  // what comes next: tonight's shift while you're still on last night's; otherwise tomorrow
  if (f.kind === 'tail' && md.today) say(h('div', { class: 'small hero-next' }, h('span', { class: 'muted' }, 'Next '), nbTimes(shiftText(md.today.shift)), ` · in ${fmtDur(Math.max(1, Math.round((md.today.window.start - now) / 60000)))}`));
  else if (f.kind !== 'tomorrow' && !missing) { const t = tomorrowText(now, tmr); if (t) say(h('div', { class: 'small hero-next' }, h('span', { class: 'muted' }, 'Tomorrow '), typeof t === 'string' ? nbTimes(t) : t)); }
  hero.append(h('div', { class: 'hero-grid' }, words, gpNow && s.me && !missing ? dayDial(now) : null));
  const nu = nextUp(now); if (nu) hero.append(nu);
  if (!missing && f.kind !== 'done' && f.kind !== 'none') { const tm = heroTeam(f); if (tm) hero.append(tm); }
  if (s.me) hero.append(weekStrip(now));
  return hero;
}

// ---- the day dial: 24 hours around a ring; shift, commute, sleep, calendar and plan drawn as arcs ----
function dayDial(date) {
  const s = S();
  const k = keyOf(date);
  const blocks = citrusBlocks(date), { busy, today, overnightTail } = dayBusy(s, date, rt.events[k] || [], blocks);
  const C = 110, rOuter = 92, w = 14;
  const ang = (min) => (min / 1440) * 2 * Math.PI - Math.PI / 2;
  const pt = (r, min) => [C + r * Math.cos(ang(min)), C + r * Math.sin(ang(min))];
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(svgNS, tag); for (const [k2, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k2, v); for (const c of kids.flat()) if (c) e.append(c); return e; };
  const arc = (r, a, b, cls, extra = {}) => {
    a = Math.max(0, Math.min(1440, a)); b = Math.max(0, Math.min(1440, b)); if (b - a < 2) return null;
    if (b - a >= 1439) return el('circle', { cx: C, cy: C, r, fill: 'none', 'stroke-width': w, ...extra });
    const [x1, y1] = pt(r, a), [x2, y2] = pt(r, b);
    const large = b - a > 720 ? 1 : 0;
    return el('path', { d: `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`, fill: 'none', 'stroke-width': w, 'stroke-linecap': 'butt', ...extra });
  };
  const paths = [];
  const push = (r, a, b, stroke, extra = {}) => { const p = arc(r, a, b, '', extra); if (p) { p.setAttribute('stroke', stroke); paths.push(p); } };
  // base ring
  paths.push(el('circle', { cx: C, cy: C, r: rOuter, fill: 'none', stroke: 'var(--line)', 'stroke-width': w }));
  for (const b of busy) {
    const color = b.kind === 'shift' ? (today?.shift.type === 'N' || overnightTail && b.start === 0 ? 'var(--night)' : 'var(--day)') : b.kind === 'sleep' ? 'var(--line2)' : b.kind === 'event' ? 'var(--blue)' : b.kind === 'protected' ? 'var(--dim)' : 'var(--orange)';
    push(rOuter, b.start, Math.min(1440, b.end), color, b.kind === 'sleep' ? { 'stroke-dasharray': '2 3' } : {});
  }
  // commute = thin inner marks around shift
  for (const p of blocks) push(rOuter - w - 4, p.start, p.end, 'var(--orange)', { 'stroke-width': 5 });   // what Citrus planned (read only)
  // hour ticks
  const ticks = [];
  for (let hh = 0; hh < 24; hh += 3) { const [x1, y1] = pt(rOuter + w / 2 + 3, hh * 60), [x2, y2] = pt(rOuter + w / 2 + (hh % 6 ? 6 : 9), hh * 60); ticks.push(el('line', { x1, y1, x2, y2, stroke: 'var(--dim)', 'stroke-width': 1.5 })); }
  const labels = [0, 6, 12, 18].map(hh => { const [x, y] = pt(rOuter - w - 16, hh * 60); return el('text', { x, y: y + 3.5, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--dim)' }, String(hh)); });
  // now marker
  const nowMin = sameDay(date, new Date()) ? minsOf(new Date()) : null;
  const marker = nowMin == null ? null : (() => { const [x1, y1] = pt(rOuter - w / 2 - 3, nowMin), [x2, y2] = pt(rOuter + w / 2 + 3, nowMin); // the pip: the family's "now" mark, a small seed sitting on the ring and pointing out from the centre
    const [px, py] = pt(rOuter + w / 2 + 7, nowMin), deg = (nowMin / 1440) * 360;
    return el('g', { class: 'now' }, el('line', { x1, y1, x2, y2, stroke: 'var(--orange)', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      el('path', { class: 'pip', d: 'M0 -6.5C3.6 -6.5 4.8 -1.5 3.9 2.4C3.2 5.6 -3.2 5.6 -3.9 2.4C-4.8 -1.5 -3.6 -6.5 0 -6.5Z', transform: `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${deg.toFixed(1)})` })); })();
  // the centre names the shift you are on now: last night's until it ends, then today's (beta T10-02: 03:00 mid-night said "post-night")
  const nowD = new Date(), tailLive = overnightTail && sameDay(date, nowD) && nowD < overnightTail.window.end, cur = tailLive ? overnightTail : today;
  const nh = !cur ? myDay(s, date).noHours : null, done = cur && !tailLive && nowD >= shiftWindow(date, today.shift).end;
  const short = (c) => { const t = String(c || ''); return t.length <= 4 ? t : t.split(/\s+/).map(x => x[0]).join('').slice(0, 4).toUpperCase(); };
  const centre = cur ? [el('text', { x: C, y: C - 4, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: done ? 'var(--muted)' : 'var(--text)' }, short(cur.code)), el('text', { x: C, y: C + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, tailLive ? `until ${fmtTime(overnightTail.window.end)}` : done ? 'done ✓' : `${fmtMin(today.shift.hours.start)}–${fmtMin(today.shift.hours.end)}`)]
    : nh ? [el('text', { x: C, y: C - 2, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 800, fill: 'var(--text)' }, short(nh.code)), el('text', { x: C, y: C + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, 'working · no hours')]
    : [el('text', { x: C, y: C + 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'var(--muted)' }, overnightTail ? 'post-night' : 'free')];
  const w0 = cur ? (tailLive ? overnightTail.window : shiftWindow(date, today.shift)) : null;
  const said = !cur ? (nh ? `${nh.code}, working, no hours in the rota` : overnightTail ? 'off after a night' : 'no shift') : nowD < w0.start ? `${cur.code} ${fmtTime(w0.start)}–${fmtTime(w0.end)}, starts in ${fmtDur(Math.round((w0.start - nowD) / 60000))}` : nowD < w0.end ? `${cur.code} until ${fmtTime(w0.end)}, ${fmtDur(Math.round((w0.end - nowD) / 60000))} left` : `${cur.code} done`;
  const svg = el('svg', { viewBox: `0 0 ${2 * C} ${2 * C}`, class: 'dial', role: 'img', 'aria-label': `Your day as a 24-hour ring: ${said}${nowMin != null ? `; now ${fmtTime(nowD)}` : ''}` }, ...paths, ...ticks, ...labels, marker, ...centre);
  return svg;
}

// next 7 days at a glance
const hh24 = (m) => pad2(Math.floor((((m % 1440) + 1440) % 1440) / 60));
/** People from the day's rotas → short names that stay unique ("Ahmed A." / "Ahmed E."), used by the hero, the board and the brief (beta T01-05). */
/** A one-word rota name ("Wed") reads like a weekday or a stray word: it keeps its "Dr" (beta T1-26). */
const keepDr = (p, n) => { const w = String(p.name || '').replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean); return w.length === 1 && /^dr\b/i.test(String(p.name)) ? `Dr ${w[0][0].toUpperCase()}${w[0].slice(1)}` : n; };
function namerFor(...infos) { const names = TM.shortNames(infos.flatMap(i => (i?.entries || []).map(e => e.person))); return (p) => keepDr(p, names.get(personKeyOf(p)) || firstName(p.name)); }
/**
 * Hero names: unique among everyone on that day (doctors AND nurses), your saved nickname for a friend linked to the row,
 * a surname initial when a first name is also a friend's ("Fatima K." next to your friend Fatima M.), and never a 1–2 letter stub
 * like "Al" (beta T04-09).
 */
function teamNamer(s, info, date) {
  const nurses = N.nurseRotas(s).filter(r => r.year === date.getFullYear() && r.month === date.getMonth() + 1).flatMap(r => r.people);
  const people = [...(info?.entries || []).map(e => e.person), ...nurses], names = TM.shortNames(people);
  const bare = (n) => String(n || '').replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  return (p) => {
    const k = personKeyOf(p), nick = DIR.contactOf(k).nick; if (nick) return nick;   // the nickname from your contact card
    let n = names.get(k) || firstName(p.name); const w = bare(p.name);
    if (n.length <= 2 && w.length > 1) n = `${w[0]} ${w[1]}`;
    return keepDr(p, n);
  };
}
/**
 * Above the fold: who you are with on the shift the hero describes (f from heroFocus) — colleagues at YOUR site who share part of
 * your shift (the same list as the day sheet), nurses only when posted or tipped, and the specialist covering your site with their hours.
 */
function heroTeam(f) {
  const info = f.info, mine = info?.mine; if (!f.entry || !mine || mine.shift.kind !== 'work') return null;
  const s = S(), site = mine.shift.site || '', team = TM.teamAtSite(info), nm = teamNamer(s, info, f.date), MAX = 8;
  const pill = (name, sub, onClick, cls = '', label = '') => h('button', { class: `tm-pill ${cls}`, onClick, 'aria-label': label || null }, name, sub ? h('small', {}, sub) : null);
  const line = (label, kids) => kids.filter(Boolean).length ? h('div', { class: 'tm-line' }, h('span', { class: 'tm-lab' }, label), h('div', { class: 'tm-pills' }, kids)) : null;
  const span = (e) => { const x = e.shift.hours; return `${hh24(x.start)}–${hh24(x.end)}`; };
  const shortSite = site.replace(/ office clinic/i, ' clinic');
  const docs = team.rows.slice(0, MAX).map(r => pill((T.isFav(s, personKeyOf(r.entry.person)) ? '⭐ ' : '') + nm(r.entry.person), r.same ? '' : span(r.entry), () => personSheet(r.entry.person), r.same ? 'same' : '', `${r.entry.person.name}, ${r.entry.shift.label} ${span(r.entry)}`));
  if (team.rows.length > MAX) docs.push(pill(`+${team.rows.length - MAX}`, '', () => daySheet(f.date), 'more', 'Everyone at your site'));
  if (!team.rows.length) docs.push(h('span', { class: 'tm-alone' }, site ? `Alone at ${shortSite}` : `${mine.shift.label}: no site team`));   // Admin day, HQ, SF: no clinical team (beta T1-11)
  if (team.otherSites) docs.push(pill(`${team.otherSites} at other sites`, '', () => daySheet(f.date), 'ghost', 'See every site in the day sheet'));
  // nurses: a 25% guess on three of fourteen nurses is noise; show who is confirmed (or heard), and the rest as one count (beta T01-16)
  let nurses = [];
  if (N.nurseRotas(s).length) {
    // the board opens on the shift's own day (yesterday's for a night after midnight), not wherever it was left (beta T04-15)
    const w = N.workingWithMe(s, f.date, mine), goN = () => { go('nurses', f.date); };
    if (w?.hasNurses) {
      // a pill that names a nurse opens that nurse
      // confirmed, then heard, then a guess from last time (labelled as a guess, never as "heard"), then the ones history points at you
      const tip = (r) => r.guess ? pill(nm(r.person), 'last time?', () => personSheet(r.person), 'maybe guess', `${r.person.name}, a guess from where they went last time`) : pill(nm(r.person), 'heard', () => personSheet(r.person), 'maybe', `${r.person.name}, heard to be with you`);
      nurses = [...w.confirmed.map(r => pill(nm(r.person), '', () => personSheet(r.person), 'same', `${r.person.name}, posted with you`)), ...(w.tipped || []).map(tip),
        ...(w.likely || []).slice(0, 2).map(r => pill(nm(r.person), 'likely', () => personSheet(r.person), 'maybe guess', `${r.person.name}, likely with you from past postings`))].slice(0, 5);
      const rest = w.possible.length - Math.min(2, (w.likely || []).length);
      if (rest > 0) nurses.push(pill(`${rest} could be sent`, nurses.length ? '' : 'post them', goN, 'ghost', `${rest} nurses could be posted with you: open the Nurses board`));
      else if (!nurses.length) nurses.push(pill('Nurses board', '', goN, 'ghost', 'Open the Nurses board'));
    }
  }
  // the specialist who covers your site; on a site with no specialist rota loaded, say so instead of showing nothing (beta T01-17)
  const kind = /upper/i.test(site) ? 'uv' : /lower/i.test(site) ? 'lv' : '', loadedKind = kind && info.rotas.some(r => r.unitKind === kind);
  // who is in at this minute leads (an FSED day doctor who left at 21:00 is not the one on call at 00:30, beta T1-06)
  const nowD = new Date(), isOn = (e) => { const w = shiftWindow(f.date, e.shift); return w && w.start <= nowD && nowD < w.end ? 1 : 0; };
  const overl = (list) => { const m = overlapModel(mine, list); return (m?.rows || []).map(r => r.entry).sort((a, b) => isOn(b) - isOn(a)); };
  let spec = kind ? overl(info[kind]) : [], specLab = 'Specialist';
  if (!spec.length) { const fs = overl(info.fsed); if (fs.length) { spec = fs; specLab = 'FSED on call'; } }
  const specPills = spec.slice(0, 2).map(e => pill(nm(e.person), span(e), () => personSheet(e.person), '', `${e.person.name}, ${e.shift.label} ${span(e)}`));
  if (kind && !loadedKind) specPills.push(h('span', { class: 'tm-note' }, `${kind === 'uv' ? 'Upper' : 'Lower'} Village specialist rota not loaded`));
  const rows = [line('Doctors', docs), line('Nurses', nurses), line(specLab, specPills)].filter(Boolean);
  return rows.length ? h('div', { class: 'tm' }, rows) : null;
}

/** "Tue 10 Nov, D1 Day · Upper Village 08:00–20:00" — the name a screen reader gives a day button. */
function dayLabel(d, info = dayInfo(S(), d)) {
  const sh = info.mine?.shift, base = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (!info.mine && (!info.hasRota || !S().me && !TM.hasGpRota(info))) return `${base}, no rota loaded`;
  if (!info.mine) return `${base}, ${S().me ? 'you are not in this rota' : 'pick your row to see your shift'}`;   // unknown, not off (beta T02-05)
  if (sh?.kind === 'work' && !sh.hours) return `${base}, ${info.mine.code} (work, no hours in the rota)`;
  if (!sh || sh.kind === 'off') { const t = myDay(S(), d).overnightTail; return t ? `${base}, off after your night (${t.code} until ${fmtTime(t.window.end)})` : `${base}, off`; }
  if (sh.kind === 'leave') return `${base}, ${sh.label}`;
  return `${base}, ${info.mine.code} ${sh.hours ? shiftText(sh) : sh.label}`;
}
function weekStrip(from) {
  const s = S();
  const strip = h('div', { class: 'week', style: { marginTop: '14px' } });
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i); const info = dayInfo(s, d); const sh = info.mine?.shift, unknown = !info.mine && !TM.hasGpRota(info);
    // a month with no rota is unknown, not a week of days off (beta T01-08, T10-05)
    const cls = unknown ? 'unk' : !sh || sh.kind === 'off' ? 'off' : sh.kind === 'leave' ? 'leave' : (/^[DNE]$/.test(sh.type) ? sh.type : 'other');
    strip.append(h('button', { class: `wd ${i === 0 ? 'today' : ''} ${unknown ? 'unk' : ''}`, 'aria-label': dayLabel(d, info), title: unknown ? `No rota for ${MONTHS[d.getMonth()]} yet` : null, onClick: () => { rt.rotaSel = d; daySheet(d); } },
      h('div', { class: 'd' }, DAY_SHORT[d.getDay()]), h('div', { class: 'n' }, d.getDate()),
      h('span', { class: `code ${cls}`, style: cls === 'off' ? { color: 'var(--dim)' } : {}, title: info.mine?.code || null }, unknown ? '?' : !info.mine || sh.kind === 'off' ? '·' : sh.kind === 'leave' ? 'L' : shortCode(info.mine.code)),
      sh?.kind === 'work' && sh.hours ? h('small', { class: 'wh' }, `${Math.round(sh.hours.durationMin / 60)}h`) : null));
  }
  // this Sunday–Saturday week (the labour-law week) against the weekly limit; the strip above runs from today, so the bar names its own dates (beta T01-15)
  const ws = addDays(startOfDay(from), -startOfDay(from).getDay()), we = addDays(ws, 7), cap = L.settings(s).weeklyH || 48; let mins = 0;
  for (const w of L.windows(s, ws, we)) mins += Math.max(0, Math.min(w.end, we) - Math.max(w.start, ws)) / 60000;
  const missing = [...new Set(Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(d => { const x = dayInfo(s, d); return !x.mine && !TM.hasGpRota(x); }).map(d => MONTHS[d.getMonth()].slice(0, 3)))];
  if (!mins) return strip; const hrs = Math.round(mins / 6) / 10, pct = Math.min(100, hrs / cap * 100), over = hrs - cap;
  const range = `${DAY_SHORT[ws.getDay()]} ${ws.getDate()}–${DAY_SHORT[addDays(we, -1).getDay()]} ${addDays(we, -1).getDate()}`;
  const said = missing.length && over <= 0 ? ` so far · ${missing.join(', ')} not loaded` : ` this week · ${over > 0 ? `${Math.round(over * 10) / 10}h over ${cap}h` : `${Math.round(-over * 10) / 10}h left of ${cap}h`}`;
  return h('div', {}, strip, h('div', { class: 'wk-hours', title: `Week ${range}` }, h('div', { class: 'wk-bar' }, h('i', { class: over > 0 ? 'over' : '', style: { width: `${pct}%` } })), h('span', { class: 'small' }, h('b', {}, `${hrs}h`), said, h('span', { class: 'dim' }, ` · ${range}`))));
}

function mciBadge() {
  return h('span', { class: 'mci-quiet', title: 'MCI 2nd physician: if a mass-casualty incident happens near FSED (the 24-hour Free Standing Emergency Department) or the park clinics (Six Flags; Aqua Arabia, which is nurses and paramedics only; both open park hours), you are moved there immediately' }, 'MCI 2nd');
}
/** Shift as a progress bar: how far through, time left, when it ends. */
function shiftProgress(w) {
  const now = Date.now(), total = Math.max(1, w.end - w.start), pct = Math.max(0, Math.min(1, (now - w.start) / total)), left = Math.round((w.end - now) / 60000);
  const toStart = Math.round((w.start - now) / 60000), label = now < w.start ? (toStart < 1 ? 'Starting now' : `Starts in ${fmtDur(toStart)}`) : now < w.end ? (left < 1 ? `Ending now · ${fmtTime(w.end)}` : `${fmtDur(left)} left · ends ${fmtTime(w.end)}`) : 'Shift done ✓';
  return h('div', { class: 'sp-wrap' }, h('div', { class: 'sp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct * 100), 'aria-label': 'Shift progress' }, h('i', { style: { width: `${Math.round(pct * 100)}%` } })), h('div', { class: `small ${now < w.end ? 'orange' : 'muted'}` }, label));
}
/** The next calendar event or accepted plan block today. */
function nextUp(date) {
  const k = keyOf(date), now = Date.now(), items = [];
  for (const ev of rt.events[k] || []) { if (ev.allDay) continue; const t = +new Date(ev.start); if (t > now) items.push({ t, title: ev.title, src: 'calendar' }); }
  for (const p of citrusBlocks(date)) { const t = +atMin(date, p.start); if (t > now) items.push({ t, title: p.title || 'Citrus plan', src: 'plan' }); }
  items.sort((a, b) => a.t - b.t); const n = items[0]; if (!n) return null;
  return h('div', { class: 'next-up' }, h('span', { class: 'nu-dot' }), h('span', { class: 'grow ellipsis' }, h('b', {}, n.title)), h('span', { class: 'dim small' }, `${fmtTime(new Date(n.t))} · in ${fmtDur(Math.round((n.t - now) / 60000))}`));
}
let boardPick = '';   // the site you tapped; otherwise the board follows the shift you're on
/**
 * Who is in, hour by hour. Day, evening and night shifts overlap on one axis, so handovers and thin hours are obvious.
 * Before last night's shifts end, their crew is on the board (left of 00:00) and counted "in now"; tonight's crew is not (beta T01-01).
 */
function shiftBoard(info, md = null) {
  const s = S(), now = new Date(), isToday = sameDay(info.date, now), nowMin = isToday ? minsOf(now) : null;
  const prev = isToday ? dayInfo(s, addDays(info.date, -1)) : null, bySite = { ...info.bySite };
  if (prev) for (const [site, list] of Object.entries(prev.bySite)) { const all = TM.withLastNight(bySite[site] || [], list, nowMin); if (all.length) bySite[site] = all; }
  const tail = md?.overnightTail && now < md.overnightTail.window.end ? md.overnightTail : null, cur = (tail || md?.today || info.mine)?.shift, mine = cur ? (cur.site || cur.label) : '';
  // shifts without a site (Admin day, SF, a project) share one "Other" chip instead of one chip each (beta T1-25)
  for (const k of Object.keys(bySite)) { const e0 = bySite[k][0]; if (!e0?.shift.site && k !== mine) { (bySite.Other ||= []).push(...bySite[k]); delete bySite[k]; } }
  const sites = Object.keys(bySite).sort((a, b) => (b === 'Other' ? -1 : a === 'Other' ? 1 : 0) || bySite[b].length - bySite[a].length); if (!sites.length) return null;
  const site = sites.includes(boardPick) ? boardPick : sites.includes(mine) ? mine : sites[0], meKey = s.me ? personKeyOf({ id: s.me.id, name: String(s.me.name || '') }) : '', nm = namerFor(info, prev);
  const m = boardModel(bySite[site], { nowMin, meKey, keyOf: personKeyOf, wrap: false }); if (!m.rows.length) return null;
  const span = m.axisEnd - m.axisStart, pct = (t) => `${((t - m.axisStart) / span * 100).toFixed(2)}%`, MAXROWS = 14, rows = m.rows.slice(0, MAXROWS);
  const grid = [];
  for (let t = Math.ceil(m.axisStart / 180) * 180; t <= m.axisEnd; t += 180) grid.push(h('span', { class: `bd-tick ${((t % 1440) + 1440) % 1440 === 0 ? 'mid' : ''}`, style: { left: pct(t) } }, h('small', {}, hh24(t))));
  const heat = h('div', { class: 'bd-heat', 'aria-hidden': 'true' }, m.hours.map(x => h('i', { title: `${hh24(x.t)}:00 · ${x.n} in`, style: { opacity: m.peak ? (0.12 + 0.88 * x.n / m.peak).toFixed(2) : 0.12 } })));
  const hmm = (t) => `${hh24(t)}:${pad2(((t % 60) + 60) % 60)}`;
  const summary = m.now == null ? `${m.rows.length} doctor${m.rows.length === 1 ? '' : 's'} across the day` : `${m.nowCount} in now${m.next ? ` · ${hmm(m.next.t)}: ${[m.next.arrive ? `${m.next.arrive} arrive${m.next.arrive === 1 ? 's' : ''}` : '', m.next.leave ? `${m.next.leave} leave${m.next.leave === 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}` : ''}`;
  return h('div', { class: 'card board' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Who’s in'), h('span', { class: 'dim tiny' }, summary)),
    sites.length > 1 ? h('div', { class: 'bd-sites' }, sites.map(x => h('button', { class: `c-chip ${x === site ? 'on' : ''}`, 'aria-pressed': x === site ? 'true' : 'false', style: { '--c': 'var(--orange)' }, onClick: () => { boardPick = x; render(); } }, x.length > 18 ? x.slice(0, 17) + '…' : x, h('small', {}, bySite[x].length)))) : null,
    h('div', { class: 'bd-plot' },
      h('div', { class: 'bd-axis' }, h('div', { class: 'bd-name' }), h('div', { class: 'bd-track bd-top' }, heat, ...grid)),
      ...rows.map(r => { const w = (r.x1 - r.x0) / span, wide = w > 0.2, txt = `${r.code || r.type} ${hh24(r.start)}–${hh24(r.end)}`;
        return h('button', { class: `bd-row ${r.me ? 'me' : ''} ${r.prev ? 'prev' : ''}`, onClick: () => personSheet(r.entry.person), title: `${r.name} · ${r.label} ${hmm(r.start)}–${hmm(r.end)}${r.prev ? ' (since yesterday)' : ''}` },
          h('span', { class: 'bd-name' }, h('span', { class: 'av' }, initials(r.name)), h('span', { class: 'ellipsis' }, r.me ? 'You' : nm(r.entry.person))),
          h('span', { class: 'bd-track' }, h('i', { class: `bd-bar ${r.type}`, style: { left: pct(r.x0), width: `${(w * 100).toFixed(2)}%` } }, wide ? txt : r.code || r.type))); }),
      m.now != null ? h('div', { class: 'bd-overlay' }, h('i', { class: 'bd-now', style: { left: pct(m.now) } })) : null),
    m.rows.length > MAXROWS ? h('div', { class: 'dim tiny' }, `+${m.rows.length - MAXROWS} more at ${site}`) : null,
    m.rows.some(r => r.prev) ? h('div', { class: 'tiny dim bd-foot' }, 'Hatched bars started yesterday evening.') : null);
}

// ── iPhone: no share sheet into web apps, and installing is a manual step, so say how
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
function iosCard(loaded) {
  if (!isIOS()) return null;
  const ui = getUi(), installed = isStandalone();
  if (loaded && (installed || ui.iosHint === 'off')) return null;
  return h('div', { class: 'card ios-card' }, h('div', { class: 'ios-ic', 'aria-hidden': 'true' }, '📱'),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, 'On iPhone'),
      h('ol', { class: 'small' },
        installed ? null : h('li', {}, 'Add Mandarin to your Home Screen: tap Share ', h('b', {}, '⬆'), ' at the bottom of Safari, then ', h('b', {}, 'Add to Home Screen'), '. It then opens full screen, like an app.'),
        h('li', {}, 'Rota from WhatsApp: open the file, tap Share ', h('b', {}, '⬆'), ' › ', h('b', {}, 'Save to Files'), ', then ', h('b', {}, 'Import'), ' here and pick it from Files.')),
      loaded ? h('button', { class: 'btn sm ghost', style: { marginTop: '6px' }, onClick: () => { setUi({ iosHint: 'off' }); render(); } }, 'Got it') : null));
}

/** First run: one card, three steps (import → pick your row → sign in), instead of four "import" calls on one screen (beta T10-17). */
function onboardingCard() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const dz = h('div', { class: 'dropzone' }, h('div', {}, touch ? 'Your rota file (.xlsx)' : 'Drop your rota .xlsx files here'), h('div', { class: 'small', style: { marginTop: '8px' } }, importButton()));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
  const step = (n, title, sub, done = false) => h('li', { class: `ob-step ${done ? 'done' : ''}` }, h('span', { class: 'ob-n' }, done ? '✓' : n), h('div', {}, h('b', {}, title), h('div', { class: 'tiny dim' }, sub)));
  return h('div', { class: 'card onboard' },
    h('div', { class: 'ob-hero' }, h('div', { class: 'ob-mark', 'aria-hidden': 'true' }), h('div', {}, h('h2', {}, 'Welcome to Mandarin'), h('p', { class: 'small muted' }, 'Your shifts, your team, your month and your career, all from the rota you already get.'))),
    h('ol', { class: 'ob-steps' }, step(1, 'Import your rota', 'The monthly rota .xlsx, as it comes on WhatsApp. Add the nurses’ and specialists’ sheets too if you have them.'), step(2, 'Pick your row', 'Mandarin asks which person in the rota is you.'), step(3, 'Sign in with Google (optional)', family() ? 'Settings › Google: rotas dropped in Drive import by themselves, and your work from Citrus comes over.' : 'Settings › Google: your shifts in your calendar, and your data kept safe in your own Drive.', G.isSignedIn())),
    h('p', { class: 'tiny dim ob-privacy' }, '🔒 Your data stays on this device and, if you sign in, in your own Google Drive. Nobody else, not even the person who made Mandarin, can see it.'),
    // after "Not now" the work may still be in Citrus: one line to bring it over (T5-15)
    S().migrated?.from === 'skipped' && (rt.signedIn || S().google?.connected) ? h('div', { class: 'small', style: { margin: '6px 0' } }, 'Your rotas may still be in Citrus. ', h('button', { class: 'linkish', onClick: () => migrateNow() }, 'Bring them over')) : null,
    dz);
}

function onCallCard(info, { now = null } = {}) {
  const groups = [];
  // with `now` (a night's tail), only who is on at this minute: the day crew of the shift's date has gone home
  const on = (e) => { if (!now) return true; const w = shiftWindow(info.date, e.shift); return !!w && w.start <= now && now < w.end; };
  info = now ? { ...info, fsed: info.fsed.filter(on), uv: info.uv.filter(on), lv: info.lv.filter(on) } : info;
  const fsedD = info.fsed.filter(e => e.shift.type === 'D'), fsedN = info.fsed.filter(e => e.shift.type === 'N');
  if (info.fsed.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, 'FSED on call'),
    h('div', { class: 'people' }, ...fsedD.map(e => personPill(e)), ...fsedN.map(e => personPill(e)))));
  if (info.uv.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, 'Upper Village specialist'), h('div', { class: 'people' }, ...info.uv.map(e => personPill(e)))));
  if (info.lv.length) groups.push(h('div', { class: 'site-group' }, h('h3', {}, 'Lower Village specialist'), h('div', { class: 'people' }, ...info.lv.map(e => personPill(e)))));
  if (!groups.length) groups.push(h('div', { class: 'muted small' }, 'No specialist rota loaded for this month'));
  if (info.mci.length) groups.push(h('div', { class: 'mci-line' }, h('span', { class: 'dim tiny', title: 'Moved to the incident site if a mass-casualty incident happens near FSED' }, 'MCI 2nd: '), info.mci.map(e => h('button', { class: 'mci-name', onClick: () => personSheet(e.person) }, firstName(e.person.name)))));
  return h('div', { class: 'card' }, h('div', { class: 'title' }, now ? 'On call now' : 'On call'), ...groups);
}

function eventsCard(date) {
  const k = keyOf(date);
  const evs = (rt.events[k] || []).sort((a, b) => a.start - b.start);
  const quick = h('form', { class: 'row', style: { marginTop: '8px' }, onSubmit: async (e) => {
    e.preventDefault(); const v = quick.q.value.trim(); if (!v) return;
    const parsed = parseQuick(v, date);
    if (!G.isSignedIn()) return toast('Sign in to Google (Settings) to add events');
    try { const ev = await G.createEvent(S().settings.calendarIds?.[0] || 'primary', { ...parsed, tag: 'quick' }); (rt.events[keyOf(ev.start)] ||= []).push(ev); cacheEvents(); quick.reset(); toast('Added to calendar', 'ok'); render(); }
    catch (err) { toast(err.message, 'err'); }
  } }, h('input', { name: 'q', 'aria-label': 'Quick add an event', placeholder: 'Quick add: "Dentist Tue 3pm 1h"', style: { flex: 1, minWidth: '0', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '9px 12px' } }), h('button', { class: 'btn sm primary', 'aria-label': 'Add event' }, '+'));
  return h('div', { class: 'card' }, h('div', { class: 'title' }, `Calendar · ${relDay(date)}`),
    evs.length ? h('div', { class: 'list' }, ...evs.map(ev => h('div', { class: 'item' },
      h('div', { class: 'col', style: { minWidth: '52px' } }, h('b', { class: 'small' }, ev.allDay ? 'all day' : fmtTime(ev.start)), ev.allDay ? null : h('span', { class: 'tiny dim' }, fmtTime(ev.end))),
      h('div', { class: 'grow' }, h('div', { class: 'name ellipsis' }, ev.title), ev.location ? h('div', { class: 'meta ellipsis' }, ev.location) : null),
      ev.htmlLink ? h('a', { href: ev.htmlLink, target: '_blank', class: 'btn sm ghost' }, '↗') : null)))
      : h('div', { class: 'muted small' }, G.isSignedIn() ? 'Nothing in your calendar' : 'Sign in to Google (Settings) to see your calendar here'),
    quick);
}

// "Dentist Tue 3pm 1h" / "Call mum 18:30" / "Gym tomorrow 7am 90m"
function parseQuick(text, base) {
  let t = text, date = startOfDay(base), start = 9 * 60, dur = 60;
  const dayRe = (i) => new RegExp(`\\b(${DAY_NAMES[i]}|${DAY_SHORT[i]})\\b`, 'i');   // whole words: "Wedding" is not Wednesday
  const dayIdx = DAY_SHORT.findIndex((d, i) => dayRe(i).test(t));
  if (/\btomorrow\b/i.test(t)) { date = addDays(date, 1); t = t.replace(/\btomorrow\b/i, ''); }
  else if (dayIdx >= 0) { let diff = (dayIdx - date.getDay() + 7) % 7; if (diff === 0) diff = 7; date = addDays(date, diff); t = t.replace(dayRe(dayIdx), ''); }
  const dm = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
  if (dm) { date = new Date(dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : date.getFullYear(), +dm[2] - 1, +dm[1]); t = t.replace(dm[0], ''); }
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(t);
  if (tm) { let hh = +tm[1]; const mm = +(tm[2] || 0); const ap = (tm[3] || '').toLowerCase(); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; if (!ap && hh < 7) hh += 12; start = hh * 60 + mm; t = t.replace(tm[0], ''); }
  const du = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins)\b/i.exec(t);
  if (du) { dur = /^h/i.test(du[2]) ? Math.round(+du[1] * 60) : +du[1]; t = t.replace(du[0], ''); }
  const title = t.replace(/\s+/g, ' ').replace(/\bat\b\s*$/i, '').trim() || 'Event';
  return { title, start: atMin(date, start), end: atMin(date, start + dur) };
}

// ---------------- ROTA ----------------
/** Is "me" a row in any of these (non-nurse) rotas? Without it every day would read "off" (beta T02-05). */
function meInRotas(rotas, s = S()) { return !!s.me && rotas.some(r => !isNurseRota(r) && r.people.some(p => isMe(s, p))); }
/** "Nov 2026 · GP rota, FSED, Upper Village, Nurses" chips, one per month (beta T02-18). */
function loadedMonths(s = S()) {
  const by = new Map(); for (const r of Object.values(s.rotas)) { const k = `${r.year}-${pad2(r.month)}`; (by.get(k) || by.set(k, []).get(k)).push(r); }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, rs]) => { const [y, m] = k.split('-').map(Number);
    return h('button', { class: 'chip', title: rs.map(r => UNIT_LABEL[r.unitKind] || r.unit).join(', '), onClick: () => { rt.rotaMonth = new Date(y, m - 1, 1); render(); } }, `${MONTHS[m - 1].slice(0, 3)} ${y} · ${rs.length} file${rs.length > 1 ? 's' : ''}`); });
}
/** The planned leave you pencilled in for a month that has no rota yet still shows (it lives in your corrections). */
const pencilled = (s, k) => { const x = s.swaps?.[k]; return x && interpretCode(x.code || '', {}, 'gp').kind === 'leave' ? x : null; };
/** One calendar cell. known: the month has a rota that has you in it; otherwise a day is "?" (unknown), never "off". */
function calCell(date, info, known, todayK) {
  const s = S(), k = keyOf(date), mine = known ? info.mine : null, shift = mine?.shift, pen = !mine ? pencilled(s, k) : null;
  const tail = known && (!shift || shift.kind === 'off') ? myDay(s, date).overnightTail : null;
  const cls = pen ? 'leave' : !known ? 'unk' : !shift || shift.kind === 'off' ? 'off' : shift.kind === 'leave' ? 'leave' : (/^[DNE]$/.test(shift.type) ? shift.type : 'other');
  const txt = pen ? 'L' : !known ? '?' : !shift || shift.kind === 'off' ? '·' : shift.kind === 'leave' ? 'L' : shortCode(mine.code);
  const evs = rt.events[k] || [], plan = citrusBlocks(date), logged = !!s.shiftLog?.[k]?.rating, withN = mine && shift.kind === 'work' ? overlapCount(info) : 0, site = mine && shift.kind === 'work' ? siteNoOf(mine.code) : 0;
  const open = () => { rt.rotaSel = date; daySheet(date); };
  const flags = [k === todayK ? 'today' : '', k < todayK ? 'past' : '', [5, 6].includes(date.getDay()) ? 'weekend' : '', rt.rotaSel && keyOf(rt.rotaSel) === k ? 'sel' : '', mine?.mci ? 'mci' : '', mine?.swap || pen ? `swap sk-${SW.kindOf(S().swaps?.[k]) || 'fix'}` : '', tail ? 'tail' : '', logged ? 'logged' : ''].filter(Boolean).join(' ');
  return h('div', { class: `day ${flags}`, role: 'button', tabindex: '0', 'aria-label': dayLabel(date, info), onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    h('span', { class: 'n' }, date.getDate()),
    h('span', { class: `code ${cls}${site ? ` s${site}` : ''}` }, txt),
    withN ? h('span', { class: 'tiny dim with', title: `${withN} colleague${withN > 1 ? 's' : ''} at your site for at least half of your shift` }, `+${withN}`) : null,
    (evs.length || plan.length) ? h('span', { class: 'dots' }, ...Array.from({ length: Math.min(3, evs.length + plan.length) }, () => h('i'))) : null);
}
/** A code that fits a calendar cell: "Riyadh Season" → "RS", "Nairyiah Project" → "NP"; normal codes (D1, N2, SF) unchanged. */
const shortCode = (c) => { const t = String(c || '').trim(); if (t.length <= 4) return t; const w = t.split(/[\s/\\-]+/).filter(Boolean); return (w.length > 1 ? w.map(x => x[0]).join('') : t).slice(0, 4).toUpperCase(); };
const siteNoOf = (code) => { const m = /^[DNE]([1-9])$/i.exec(String(code || '').trim()); return m ? Math.min(+m[1], 5) : 0; };
function renderRota({ compact = false } = {}) {
  const s = S();
  const m = rt.rotaMonth;
  const y = m.getFullYear(), mo = m.getMonth() + 1, MON = MONTHS[mo - 1];
  const rotas = Object.values(s.rotas).filter(r => r.year === y && r.month === mo), known = meInRotas(rotas, s);
  const head = h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('button', { class: 'btn icon', 'aria-label': 'Previous month', onClick: () => { rt.rotaMonth = new Date(y, mo - 2, 1); render(); } }, '‹'),
    h('h2', { class: 'grow', style: { textAlign: 'center', fontSize: '20px', margin: 0 } }, `${MON} ${y}`),
    h('button', { class: 'btn icon', 'aria-label': 'Next month', onClick: () => { rt.rotaMonth = new Date(y, mo, 1); render(); } }, '›'));
  // the grid is always drawn: events, plans and pencilled leave show in a month with no rota too, and a day can be opened (beta T02-18)
  const grid = h('div', { class: 'cal' });
  const first = new Date(y, mo - 1, 1), todayK = keyOf(new Date()), days = new Date(y, mo, 0).getDate();
  for (let i = 0; i < first.getDay(); i++) grid.append(h('div', { class: 'day pad' }));
  for (let d = 1; d <= days; d++) { const date = new Date(y, mo - 1, d); grid.append(calCell(date, dayInfo(s, date), known, todayK)); }
  // why days show "?": no rota for the month, nobody picked as you, or you're not a row in what's loaded
  const others = rotas.map(r => UNIT_LABEL[r.unitKind] || r.unit).join(', ');
  const banner = !rotas.length ? h('div', { class: 'cal-note' }, h('div', { class: 'grow' }, h('b', {}, `No rota for ${MON} ${y} yet`), h('span', { class: 'tiny dim' }, 'Days show “?” until it is imported. Events, plans and planned leave still show.')),
      h('div', { class: 'row wrap' }, importButton('Import'), h('button', { class: 'btn', onClick: () => XU.leaveSheet() }, '🌴 Plan leave')))
    : !s.me ? h('div', { class: 'cal-note' }, h('div', { class: 'grow' }, h('b', {}, 'Which row is you?'), h('span', { class: 'tiny dim' }, 'Pick it once and the calendar shows your shifts.')), h('button', { class: 'btn primary', onClick: () => mePicker() }, 'Pick your row'))
    : !known ? h('div', { class: 'cal-note warn' }, h('div', { class: 'grow' }, h('b', {}, `You’re not in the ${MON} rotas loaded`), h('span', { class: 'tiny dim' }, `Loaded: ${others}. Mandarin has you as ${s.me.name}${s.me.id ? ` (ID ${s.me.id})` : ''}: import the GP rota, or pick your row. No day here counts as off until then.`)),
      h('div', { class: 'row wrap' }, importButton('Import GP rota'), h('button', { class: 'btn', onClick: () => mePicker() }, 'Pick your row')))
    : null;
  const used = new Set([...grid.querySelectorAll('.code')].map(c => c.classList[1]));
  const key = [['D', 'D day'], ['N', 'N night'], ['E', 'E evening'], ['other', 'other', 'SF'], ['leave', 'L leave'], ['unk', '? unknown']].filter(([c]) => c !== 'unk' || used.has('unk'));
  const calCard = h('div', { class: 'card cal-card' }, banner, h('div', { class: 'cal-head' }, ...DAY_SHORT.map(x => h('span', {}, x))), grid,
    h('div', { class: 'chips cal-key', style: { marginTop: '10px' } }, ...key.map(([c, l, chipCls]) => h('span', { class: `chip ${chipCls || c}` }, l)), h('span', { class: 'chip mci' }, '🚨 MCI 2nd'), known ? h('span', { class: 'chip tail-key' }, h('i'), 'after a night') : null, Object.keys(S().swaps || {}).length ? h('span', { class: 'chip swap-key' }, h('i', { class: 'sk-swap' }), 'swap ', h('i', { class: 'sk-gave' }), 'I covered ', h('i', { class: 'sk-got' }), 'covered for me ', h('i', { class: 'sk-fix' }), 'other change') : null));
  const out = [];
  if (compact) return [head, calCard];
  if (!rotas.length) {
    const loaded = loadedMonths(s);
    if (loaded.length) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Loaded rotas'), h('div', { class: 'chips' }, ...loaded)));
    return [h('h1', {}, 'Calendar'), head, h('div', { class: 'cols' }, h('div', {}, calCard), h('div', {}, ...out))];
  }
  // month numbers and the labor verdict only mean something when you are in the rota: "30 days off · All clear" was a lie (beta T02-05)
  const sum = known ? monthSummary(s, y, mo) : null;
  const monthNum = known ? XU.monthCard(y, mo) : null;   // its numbers repeat "Your month", so only one of the two is drawn (beta T01-27, T02-16)
  if (sum && !monthNum) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your month'),
    h('div', { class: 'grid2' }, stat(sum.work, 'shifts'), stat(sum.nights, 'nights'), stat(`${sum.hours}h`, 'rostered hours'), stat(sum.off, 'days off')),
    h('div', { class: 'chips', style: { marginTop: '10px' } }, ...Object.entries(sum.siteCount).map(([k, v]) => h('span', { class: 'chip' }, `${k} × ${v}`)))));
  { const uc = CHU.updatesCard(); if (uc) out.push(uc); }
  if (monthNum) out.push(monthNum);
  if (known) { const lc = LU.laborCard(y, mo); if (lc) out.push(lc); }
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Sources'),
    h('div', { class: 'list' }, ...rotas.map(r => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, UNIT_LABEL[r.unitKind] || r.unit), h('div', { class: 'meta' }, `${r.people.length} people · ${r.sourceName || 'imported'} · ${new Date(r.importedAt).toLocaleDateString('en-GB')}`)),
      h('button', { class: 'btn sm ghost danger', onClick: () => { if (confirm(`Remove ${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1]}?`)) store.update(x => { const rotas = { ...x.rotas }; delete rotas[r.id]; let deleted = store.tombstone(x, `rota:${r.id}`); if (r.driveId) deleted = { ...deleted, [`drive:${r.driveId}`]: Date.now() }; return { ...x, rotas, deleted }; }); } }, 'Remove')))),
    h('div', { class: 'row wrap', style: { marginTop: '10px' } }, importButton('Import / update files'), G.isSignedIn() ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '☁ Pull from Drive') : null, known ? h('button', { class: 'btn', onClick: () => exportIcs(new Date(y, mo - 1, 1)) }, '📅 Export .ics') : null),
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'Got the files on WhatsApp? Share them to Mandarin from WhatsApp (with Mandarin installed on your phone), or import them here.')));
  const gp = rotas.find(r => r.unitKind === 'gp');
  if (gp) { const lg = legendRows(gp); out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Shift codes'),
    h('div', { class: 'lg-rows' }, ...lg.rows.map(r => h('div', { class: `lg-row ${r.kind}` }, h('b', {}, r.codes), h('span', { class: 'grow' }, r.what), r.hours ? h('span', { class: 'tiny dim lg-h' }, r.hours) : null))),
    lg.marks.length ? h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, `Also marked in the rota by colour: ${lg.marks.join(' · ')}`) : null)); }
  // desktop: month grid on the left, everything else on the right
  return [h('h1', {}, 'Calendar'), head, h('div', { class: 'cols' }, h('div', {}, calCard), h('div', {}, ...out))];
}
const hh = (m) => pad2(Math.floor(m / 60) % 24);
const hm = (m) => `${hh(m)}:${pad2(m % 60)}`;
/** Your shift with everyone who shares part of it: bars on one axis, solid where they overlap yours, faded where they don't. */
function overlapCard(info, today) {
  const others = [...info.withMe, ...info.alsoAtSite], m = overlapModel(info.mine, others); if (!m) return null;
  const [a0, a1] = m.axis, W = a1 - a0, pct = (t) => `${((t - a0) / W * 100).toFixed(2)}%`, wpct = (x, y) => `${((y - x) / W * 100).toFixed(2)}%`;
  const same = new Set(info.withMe.map(e => personKeyOf(e.person)));
  const dup = (e) => m.rows.filter(r => firstName(r.entry.person.name) === firstName(e.person.name)).length > 1, label = (e) => { if (!dup(e)) return firstName(e.person.name); const w = e.person.name.replace(/^Dr\.?\s*/i, '').split(/\s+/); return `${w[0]} ${w[1]?.[0] || ''}.`.trim(); };
  const full = m.alone.length === 0, soloMin = m.alone.reduce((t, [x, y]) => t + (y - x), 0);
  const headline = !m.rows.length ? 'Nobody else overlaps your shift' : full ? `Someone is with you the whole shift` : `You’re on your own ${m.alone.map(([x, y]) => `${hm(x)}–${hm(y % 1440 || 1440)}`).join(', ')} (${fmtDur(soloMin)})`;
  const ticks = []; for (let t = Math.ceil(a0 / 180) * 180; t <= a1; t += 180) ticks.push(h('span', { class: 'ov-tick', style: { left: pct(t) } }, h('small', {}, hh(t))));
  // how many others are in with you, minute by minute → a coverage strip under your own bar
  const edges = [...new Set([m.me[0], m.me[1], ...m.rows.flatMap(r => [r.from, r.to])])].sort((x, y) => x - y), cov = [];
  for (let i = 0; i < edges.length - 1; i++) { const mid = (edges[i] + edges[i + 1]) / 2, n = m.rows.filter(r => r.from <= mid && mid < r.to).length; cov.push(h('i', { class: `ov-cv n${Math.min(n, 4)}`, title: `${hm(edges[i])}–${hm(edges[i + 1])}: ${n} with you`, style: { left: pct(edges[i]), width: wpct(edges[i], edges[i + 1]) } })); }
  const rows = m.rows.slice(0, 12).map(r => { const e = r.entry, sameShift = same.has(personKeyOf(e.person)), kind = e.shift.type;
    return h('button', { class: `ov-row ${sameShift ? 'same' : 'part'}`, onClick: () => personSheet(e.person), title: `${e.person.name} · ${e.shift.label} ${hm(r.start)}–${hm(r.end)}` },
      h('span', { class: 'ov-name' }, h('span', { class: 'av' }, initials(e.person.name)), h('span', { class: 'ellipsis' }, label(e))),
      h('span', { class: 'ov-track' }, h('i', { class: `ov-ghost ${kind}`, style: { left: pct(r.start), width: wpct(r.start, r.end) } }), h('i', { class: `ov-in ${kind}`, style: { left: pct(r.from), width: wpct(r.from, r.to) } })),
      h('span', { class: 'ov-pct' }, r.pct >= 0.995 ? 'all' : `${Math.round(r.pct * 100)}%`, h('small', {}, sameShift ? 'same shift' : `${fmtDur(r.overlap)} · ${kind}`)));
  });
  const type = today.shift.type;
  return h('div', { class: 'card ov' }, h('div', { class: 'title' }, 'Who shares your shift'), h('div', { class: `ov-head ${full ? 'ok' : 'warn'}` }, headline),
    h('div', { class: 'ov-plot' },
      // the band sits in a copy of the rows' own grid, so it lines up with the tracks at any width (it used to start late and run off, beta T02-09)
      h('div', { class: 'ov-row ov-bandrow', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'ov-track' }, h('i', { class: 'ov-band2', style: { left: pct(m.me[0]), width: wpct(m.me[0], m.me[1]) } })), h('span')),
      h('div', { class: 'ov-axis' }, h('span', { class: 'ov-name' }), h('span', { class: 'ov-track' }, ...ticks)),
      h('div', { class: 'ov-row me' }, h('span', { class: 'ov-name' }, h('span', { class: 'av' }, 'You')), h('span', { class: 'ov-track' }, h('i', { class: `ov-in ${type}`, style: { left: pct(m.me[0]), width: wpct(m.me[0], m.me[1]) } }, `${hm(m.me[0])}–${hm(m.me[1])}`)), h('span', { class: 'ov-pct' }, fmtDur(m.len))),
      h('div', { class: 'ov-row cov' }, h('span', { class: 'ov-name' }, h('span', { class: 'tiny dim' }, 'cover')), h('span', { class: 'ov-track' }, ...cov), h('span', { class: 'ov-pct' })),
      ...rows),
    m.rows.length > 12 ? h('div', { class: 'tiny dim' }, `+${m.rows.length - 12} more`) : null,
    h('div', { class: 'chips ov-key' }, h('span', { class: 'chip' }, h('i', { class: `ov-sw in ${type}` }), 'with you'), h('span', { class: 'chip' }, h('i', { class: `ov-sw ghost ${type}` }), 'their time outside your shift'),
      h('span', { class: 'chip' }, h('i', { class: 'ov-sw n0' }), '0 alone', h('i', { class: 'ov-sw n1' }), '1', h('i', { class: 'ov-sw n2' }), '2', h('i', { class: 'ov-sw n3' }), '3+ others in')));
}
/** Colleagues at your site who share at least half of your shift: 2h of a 12h night is not company (beta T02-10). */
function overlapCount(info) { const m = info.mine && info.mine.shift.kind === 'work' ? overlapModel(info.mine, [...info.withMe, ...info.alsoAtSite]) : null; return m ? m.rows.filter(r => r.pct >= 0.5).length : 0; }
function stat(v, l) { return h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)); }
/** "Today" / "Tomorrow" / "in 5 days" / "9 days ago": the header already shows the date, so this says how far (beta T02-26). */
function relWord(date, now = new Date()) { const n = Math.round((startOfDay(date) - startOfDay(now)) / 864e5); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`; }
/** The rota's own code for your day, before your correction. */
const rawCode = (info) => info.mine ? String(info.mine.person.days[info.date.getDate()] || '') : '';

function daySheet(date) {
  const s = S();
  const info = dayInfo(s, date);
  const { today, overnightTail, noHours } = myDay(s, date);
  const k = keyOf(date), known = meInRotas(info.rotas, s), past = k < keyOf(new Date()), swap = info.mine?.swap || pencilled(s, k);
  const raw = rawCode(info), rawSh = info.mine ? interpretFor(info.mine.rota, raw) : null;
  const tailLine = (t) => h('div', { class: 'sub ds-tail' }, `Until ${fmtTime(t.window.end)} you’re still on last night’s ${t.code} (${t.shift.label})`);
  const content = [h('div', { class: 'row ds-head' }, h('h2', { class: 'grow' }, `${DAY_NAMES[date.getDay()]} ${fmtDate(date)}`), h('span', { class: 'small muted' }, relWord(date)))];
  if (today) content.push(h('div', { class: 'card hero' }, h('div', { class: 'title' }, 'Your shift'), h('div', { class: 'big' }, today.shift.label), h('div', { class: 'sub' }, `${fmtTime(today.window.start)} – ${fmtTime(today.window.end)}${today.shift.hours.overnight ? ' (next morning)' : ''} · ${fmtDur(today.shift.hours.durationMin)} · ${today.code}`),
    overnightTail ? tailLine(overnightTail) : null,
    today.mci ? h('div', { style: { marginTop: '6px' } }, mciBadge()) : null));
  if (today) { const oc = overlapCard(info, today); if (oc) content.push(oc); const nc = PU.withMeCard(info.date, info.mine); if (nc) content.push(nc); }
  else if (info.mine?.shift.kind === 'leave' || (!info.mine && swap)) {
    // planned leave is your correction (VL): say so, and what it replaces (beta T02-22)
    const planned = /^VL$/i.test(swap?.code || '') || /planned leave/i.test(swap?.note || '');
    content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, planned ? 'On leave (planned)' : (info.mine?.shift.label || 'On leave')),
      swap && rawSh?.kind === 'work' ? h('div', { class: 'sub' }, `Instead of ${raw} · ${rawSh.label}${rawSh.hours ? ` ${hoursShort(rawSh)}` : ''}`) : !info.hasRota ? h('div', { class: 'sub' }, `No rota for ${MONTHS[date.getMonth()]} yet, so Mandarin can’t tell which shift it replaces`) : null));
  }
  else if (!info.hasRota) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, overnightTail ? 'After your night' : 'Not known yet'), h('div', { class: 'sub' }, overnightTail ? `Your ${overnightTail.code} ends ${fmtTime(overnightTail.window.end)}. ` : '', `No rota for ${MONTHS[date.getMonth()]} ${date.getFullYear()} is loaded.`), h('div', { class: 'row', style: { marginTop: '10px' } }, importButton('Import'))));
  else if (s.me && !known) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, 'You’re not in these rotas'), h('div', { class: 'sub' }, `Loaded for ${MONTHS[date.getMonth()]}: ${info.rotas.map(r => UNIT_LABEL[r.unitKind] || r.unit).join(', ')}. Import the GP rota or pick your row; until then this day is unknown, not off.`), h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => { topSheet()?.remove(); mePicker(); } }, 'Pick your row'))));
  else if (noHours) content.push(h('div', { class: 'card hero' }, h('div', { class: 'title' }, 'Your day'), h('div', { class: 'big' }, noHours.shift.label || noHours.code), h('div', { class: 'sub' }, `Working (${noHours.code}); the rota gives no hours for it.`)));
  else if (s.me) content.push(h('div', { class: 'card hero' }, h('div', { class: 'big' }, overnightTail ? (overnightTail.window.end > new Date() ? `On ${overnightTail.code} until ${fmtTime(overnightTail.window.end)}` : 'Off after night') : 'Day off'), overnightTail ? h('div', { class: 'sub' }, `Your ${overnightTail.code} ends ${fmtTime(overnightTail.window.end)}; the rest of the day is yours`) : null));
  // all sites
  const siteOrder = Object.keys(info.bySite).sort();
  if (siteOrder.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'GP coverage'),
    ...siteOrder.map(site => {
      const list = info.bySite[site].sort((a, b) => (a.shift.type > b.shift.type ? 1 : -1)), plan = plannedCover(info, site);
      return h('div', { class: 'site-group' }, h('h3', {}, site, h('span', { class: 'tiny dim' }, `${list.length}`), plan ? h('span', { class: `tiny cov-plan ${plan.short ? 'late' : 'dim'}`, title: 'Planned in the rota’s own staffing rows' }, ` · planned ${plan.text}`) : null), h('div', { class: 'people' }, ...list.map(e => personPill(e))));
    })));
  if (info.away?.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, `Elsewhere (${info.away.length})`), h('div', { class: 'tiny dim' }, 'Working, on a posting the rota gives no hours for.'), h('div', { class: 'people' }, ...info.away.map(e => personPill(e)))));
  if (info.fsed.length || info.uv.length || info.lv.length) content.push(onCallCard(info));
  if (info.leave.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'On leave'), h('div', { class: 'people' }, ...info.leave.map(e => personPill(e)))));
  if (info.off.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, `Off today (${info.off.length})`), h('div', { class: 'people' }, ...info.off.map(e => personPill(e)))));
  const evs = rt.events[k] || [];
  const plan = citrusBlocks(date);
  if (evs.length || plan.length) content.push(h('div', { class: 'card' }, h('div', { class: 'title' }, plan.length ? 'Calendar and plan' : 'Calendar'),
    ...evs.map(ev => h('div', { class: 'row small', style: { padding: '4px 0' } }, h('b', {}, ev.allDay ? 'all day' : fmtTime(ev.start)), h('span', {}, ev.title))),
    ...plan.map(p => h('div', { class: 'row small', style: { padding: '4px 0' } }, h('b', {}, fmtMin(p.start)), h('span', {}, p.title), h('span', { class: 'tiny dim' }, p.app ? ` · ${p.app}` : '')))));
  // the after-shift log for this day: rating, counts, note
  if (today && today.window.end <= new Date()) { const lg = s.shiftLog?.[k]; content.push(h('div', { class: 'card slog-day' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Shift log'), h('button', { class: 'btn sm ghost', onClick: () => { topSheet()?.remove(); DU.logSheet(k); } }, lg ? '✎ Edit' : '＋ Counts and a note')),
    lg?.rating ? h('div', { class: 'small' }, [SL.FACES[lg.rating - 1], ...SL.COUNTS.filter(([c]) => Number.isFinite(lg[c])).map(([c, l]) => `${lg[c]} ${l.toLowerCase()}`)].filter(Boolean).join(' · '), lg.note ? h('div', { class: 'tiny dim' }, lg.note) : null) : DU.faces(k))); }
  if (info.mine?.swap) { const sw = info.mine.swap, kd = SW.kindOf(sw), who = sw.with ? { swap: `swapped with ${sw.with}`, gave: `you covered ${sw.with}`, got: `${sw.with} covered you` }[kd] || `with ${sw.with}` : '';
    content.splice(1, 0, h('div', { class: 'row small sw-line', style: { margin: '6px 0 10px' } }, h('span', { class: `chip sw-k ${kd}` }, SW.KIND_LABEL[kd]), h('span', { class: 'muted' }, [`rota: ${raw || 'off'}`, who, sw.note].filter(Boolean).join(' · ')))); }
  // cover is for days ahead (beta T02-02); a correction needs your row in the rota
  content.push(h('div', { class: 'row wrap' }, family() ? h('a', { class: 'btn grow', href: `${CITRUS_URL}?from=mandarin#plan`, target: '_blank', rel: 'noopener' }, 'Plan in Citrus ▸') : null,
    known && !past && info.hasRota ? h('button', { class: 'btn grow', onClick: () => { topSheet()?.remove(); swapHelper(date); } }, 'Who could cover?') : null,
    known ? h('button', { class: 'btn grow', onClick: () => { topSheet()?.remove(); swapSheet(date); } }, info.mine?.swap ? 'Edit correction' : 'Correct this day') : null));
  const r = sheet(content); r.box.parentElement.dataset.daySheet = k;
}

/** The rota's own planned staffing for a site that day ("Upper Village day 3"), next to who is rostered: "D 3/3 · N 2/2". */
function plannedCover(info, site) {
  const gp = info.rotas.find(r => r.unitKind === 'gp'); if (!gp?.coverage) return null;
  const d = info.date.getDate(), bits = []; let short = false;
  for (const [type, word] of [['D', 'day'], ['N', 'night'], ['E', 'evening']]) {
    const row = Object.entries(gp.coverage).find(([k]) => k.toLowerCase() === `${site} ${word}`.toLowerCase()); if (!row || row[1][d] == null) continue;
    const want = row[1][d], have = (info.bySite[site] || []).filter(e => e.shift.type === type).length; if (!want && !have) continue;
    if (have < want) short = true; bits.push(`${type} ${have}/${want}`);
  }
  return bits.length ? { text: bits.join(' · '), short } : null;
}
// Swap helper: who is off on this date, and which of my days they could take
function swapHelper(date) {
  const s = S();
  const info = dayInfo(s, date);
  const candidates = info.off.filter(e => !isMe(s, e.person));
  const prevN = dayInfo(s, addDays(date, -1)).entries.filter(e => e.shift.type === 'N').map(e => personKeyOf(e.person));
  // a day that has started is history: nobody can cover it now, so say that instead of listing who was off (D13 follow-up)
  if (startOfDay(date) < startOfDay(new Date())) { sheet([h('h2', {}, `Cover for ${fmtDateShort(date)}`), h('p', { class: 'small muted' }, 'This day is in the past. To record what really happened, use “Correct this day” in the day sheet.')]); return; }
  const sw = XU.swapBlock(date, personSheet);
  sheet([h('h2', {}, `Cover for ${fmtDateShort(date)}`), h('div', { class: 'small muted', style: { margin: '6px 0 12px' } }, `GP colleagues who are off that day${info.mine ? ` (you: ${info.mine.code || 'off'})` : ''}. Night-before is flagged.`),
    sw,
    h('div', { class: 'title', style: { margin: '10px 0 4px' } }, 'Anyone who is off'),
    h('div', { class: 'list' }, ...candidates.map(e => h('div', { class: 'item clickable', onClick: () => personSheet(e.person) },
      h('div', { class: 'avatar' }, initials(e.person.name)), h('div', { class: 'grow' }, h('div', { class: 'name' }, e.person.name), h('div', { class: 'meta' }, [e.person.title, prevN.includes(personKeyOf(e.person)) ? '⚠ night before' : '', sharedShifts(s, personKeyOf(e.person)).length + ' shared shifts'].filter(Boolean).join(' · '))),
      telLink(e.person.mobile) ? h('a', { class: 'btn sm', href: telLink(e.person.mobile).wa, target: '_blank', onClick: ev => ev.stopPropagation() }, '💬') : null)))]);
}

// ---------------- next month's rota reminder ----------------
// From the 22nd, if no rota for next month is loaded, say so (the files arrive late in the month).
function rotaReminder(now = new Date()) {
  const s = S();
  if (now.getDate() < 22 || !Object.keys(s.rotas).length) return null;
  const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const have = Object.values(s.rotas).some(r => r.year === nm.getFullYear() && r.month === nm.getMonth() + 1);
  if (have) return null;
  const key = `mandarin.rotaNudge.${nm.getFullYear()}-${nm.getMonth() + 1}`;
  try { if (localStorage.getItem(key)) return null; } catch {}
  return { month: nm, key };
}
function rotaReminderCard() {
  const r = rotaReminder(); if (!r) return null;
  const folder = G.knownFolderIds()[`${S().settings.driveFolder}/Rotas`];
  return h('div', { class: 'banner' }, h('span', { class: 'grow' }, `${MONTHS[r.month.getMonth()]}'s rota isn't here yet. Drop the files in Drive › Rotas, share them from WhatsApp, or import them, and Mandarin picks them up.`),
    folder ? h('a', { class: 'btn sm', href: `https://drive.google.com/drive/folders/${folder}`, target: '_blank', rel: 'noopener' }, 'Open Rotas') : h('button', { class: 'btn sm', onClick: () => show('calendar') }, 'Import'),
    h('button', { class: 'btn sm ghost', 'aria-label': 'Dismiss', onClick: () => { try { localStorage.setItem(r.key, '1'); } catch {} render(); } }, '✕'));
}
// ───────── Customise: what shows and in which order (synced; the interface above is per device)
const czOpen = new Set();   // open sections stay open when a tap re-renders Settings
function customiseCard() {
  const c = CZ.custom(S()), set = (part, patch) => store.update(s => CZ.setCustom(s, part, patch));
  const sec = (title, sub, ...kids) => h('details', { class: 'cz-sec', open: czOpen.has(title), onToggle: (e) => { e.currentTarget.open ? czOpen.add(title) : czOpen.delete(title); } }, h('summary', {}, h('b', {}, title), h('small', {}, sub)), ...kids);
  const chip = (on, label, onClick, extra = {}) => h('button', { class: `chip ${on ? 'sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', onClick, ...extra }, label);
  const tabRow = ([id, label]) => { const hidden = c.tabs.hidden.includes(id), i = c.tabs.order.indexOf(id);
    return h('div', { class: 'cz-row' }, h('span', { class: 'grow' }, label), h('button', { class: 'btn sm ghost', 'aria-label': `Move ${label} up`, disabled: i === 0, onClick: () => set('tabs', { order: CZ.move(c.tabs.order, id, -1) }) }, '↑'), h('button', { class: 'btn sm ghost', 'aria-label': `Move ${label} down`, disabled: i === c.tabs.order.length - 1, onClick: () => set('tabs', { order: CZ.move(c.tabs.order, id, 1) }) }, '↓'),
      id === 'today' ? h('span', { class: 'tiny dim cz-fixed' }, 'always') : chip(!hidden, hidden ? 'Hidden' : 'Shown', () => set('tabs', { hidden: CZ.toggleIn(c.tabs.hidden, id) }))); };
    const ns = S().settings?.nurseStaffing || {}, seat = (k, id) => (ns[k] || {})[id] ?? (N.TYPICAL[k] || {})[id] ?? '';
  return h('div', { class: 'card cz' }, h('div', { class: 'title' }, 'Customise'), h('div', { class: 'tiny dim' }, 'Synced to all your devices.'),
    sec('Tabs', 'order, hide, start tab', ...[...c.tabs.order].map(id => tabRow(CZ.TABS.find(t => t[0] === id))), h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, 'Open on'), h('select', { 'aria-label': 'Open on', onChange: (e) => set('start', e.target.value) }, CZ.TABS.filter(([id]) => !c.tabs.hidden.includes(id)).map(([id, l]) => h('option', { value: id, selected: c.start === id }, l))))),
    sec('Today', 'hide or pin cards, how many stay open', h('div', { class: 'tiny dim' }, 'Tap to hide · ★ to pin to the top'), ...CZ.TODAY_CARDS.map(l => h('div', { class: 'cz-row' }, h('span', { class: 'grow' }, l), chip(c.today.pinned.includes(l), '★', () => set('today', { pinned: CZ.toggleIn(c.today.pinned, l) }), { 'aria-label': `Pin ${l}` }), chip(!c.today.hidden.includes(l), c.today.hidden.includes(l) ? 'Hidden' : 'Shown', () => set('today', { hidden: CZ.toggleIn(c.today.hidden, l) })))),
      h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, 'Cards open before "More for today"'), h('input', { type: 'number', min: 1, max: 12, value: c.today.top, 'aria-label': 'Cards open', class: 'cz-num', onChange: (e) => set('today', { top: +e.target.value }) }))),
    sec('Briefing', 'which lines the morning card shows', h('div', { class: 'chips' }, CZ.BRIEF_LINES.map(([id, l]) => id === 'shift' ? chip(true, `${l} (always)`, () => {}, { disabled: true }) : chip(!c.brief.off.includes(id), l, () => set('brief', { off: CZ.toggleIn(c.brief.off, id) }))))),
    sec('Commute', 'minutes to each site, for the dial and Tonight', ...Object.entries({ ...(S().rules?.commute || {}) }).map(([site, m]) => h('div', { class: 'cz-row' }, h('span', { class: 'grow small' }, site === 'default' ? 'Any other site' : site), h('input', { type: 'number', min: 0, max: 180, value: m, class: 'cz-num', 'aria-label': `Commute to ${site}`, onChange: (e) => store.update(s => ({ ...s, rules: { ...s.rules, commute: { ...(s.rules?.commute || {}), [site]: Math.max(0, Math.min(180, Math.round(+e.target.value || 0))) } } })) })))),
    sec('Nurse staffing', 'usual nurses per site', h('div', { class: 'tiny dim' }, 'How many floating nurses each site usually gets. 0 = closed (e.g. office clinics at night, paramedic-run on Fridays).'),
      h('table', { class: 'cz-staff' }, h('tr', {}, h('th'), ...N.SITES.map(x => h('th', {}, x.id))), ...[['day', 'Day'], ['fri', 'Friday day'], ['night', 'Night']].map(([k, l]) => h('tr', {}, h('th', {}, l), ...N.SITES.map(x => h('td', {}, h('input', { type: 'number', min: 0, max: 20, value: seat(k, x.id), placeholder: '–', 'aria-label': `${l} ${x.id}`, onChange: (e) => store.update(s => { const cur = { ...(s.settings?.nurseStaffing || {}) }, v = e.target.value === '' ? undefined : Math.max(0, Math.min(20, Math.round(+e.target.value)));
        const row = { ...(cur[k] || {}) }; if (v === undefined || v === (N.TYPICAL[k] || {})[x.id]) delete row[x.id]; else row[x.id] = v; cur[k] = row; return { ...s, settings: { ...s.settings, nurseStaffing: cur } }; }) })))))),
      h('button', { class: 'btn sm ghost', onClick: () => store.update(s => ({ ...s, settings: { ...s.settings, nurseStaffing: {} } })) }, 'Back to the usual numbers')),
    h('button', { class: 'btn sm ghost', style: { marginTop: '8px' }, onClick: () => { if (confirm('Put every Customise choice back to the default?')) store.update(s => ({ ...s, settings: { ...s.settings, custom: {} } })); } }, 'Reset Customise'));
}
function uiPicker() {
  const u = getUi(), opt = (id, name, note) => h('button', { class: `ui-opt ${u.ui === id ? 'sel' : ''}`, 'aria-pressed': u.ui === id ? 'true' : 'false', onClick: () => setUi({ ui: id }) }, h('span', { class: `ui-thumb ui-${id}` }, h('i'), h('i'), h('b', {}, 'Aa')), h('b', {}, name), h('small', {}, note));
  return h('div', { class: 'ui-pick' }, h('div', { class: 'title' }, 'Interface on this device'), h('div', { class: 'ui-opts' }, opt('arcade', 'Arcade', '8-bit, the family look'), opt('clean', 'Clean', 'Calm, rounded, dark'), opt('paper', 'Paper', 'Light, for daylight')),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'small grow' }, 'Text size'), h('div', { class: 'seg ui-size' }, [['small', 'S'], ['normal', 'M'], ['large', 'L']].map(([k, l]) => h('button', { class: u.size === k ? 'active' : '', 'aria-label': `Text size ${k}`, 'aria-pressed': String(u.size === k), onClick: () => setUi({ size: k }) }, l)))),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small grow' }, 'Wide-screen cockpit (Today, Calendar and Team side by side)'), h('input', { type: 'checkbox', 'aria-label': 'Wide-screen cockpit', checked: u.cockpit !== false, onChange: (e) => setUi({ cockpit: e.target.checked }) })));
}
/** Wide screens (27" monitor, Steam Deck docked) show Today, the month and the team side by side. */
const cockpitWide = () => window.innerWidth >= 1400 && getUi().cockpit !== false;
let wideWas = window.innerWidth >= 1400; addEventListener('resize', () => { const w = cockpitWide(); if (w !== wideWas && rt.view === 'today') render(); wideWas = w; });

// ---------------- search (people, days, codes, apps, goals) ----------------
/** "21/11", "21/11/26" → a real date, or null: 31/02 and 99/99 are rejected instead of rolling over (beta T09-09). */
function parseDayQuery(q, now = new Date()) {
  const dm = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(q); if (!dm) return null;
  const y = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : now.getFullYear(), d = new Date(y, +dm[2] - 1, +dm[1]);
  return d.getDate() === +dm[1] && d.getMonth() === +dm[2] - 1 && d.getFullYear() === y ? d : null;
}
/** A day word inside the query: today / tomorrow / yesterday / a weekday name (the next one, today included) → { date, word }. */
function dayWordIn(q, now = new Date()) {
  const t = startOfDay(now), m = /\b(today|tonight|tomorrow|tmrw|yesterday|sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|rs|rsday|urday)?\b/.exec(q); if (!m) return null;
  const w = m[1], idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w);
  const date = w === 'today' || w === 'tonight' ? t : w === 'tomorrow' || w === 'tmrw' ? addDays(t, 1) : w === 'yesterday' ? addDays(t, -1) : addDays(t, (idx - t.getDay() + 7) % 7);
  return { date, word: m[0] };
}
const UNIT_WORDS = { nurse: 'nurse', nurses: 'nurse', gp: 'gp', doctor: 'gp', doctors: 'gp', fsed: 'fsed', specialist: 'uv', specialists: 'uv', uv: 'uv', lv: 'lv' };
function openSearch() {
  document.querySelector('.search')?.remove();
  const s = S(), now = new Date();
  const input = h('input', { placeholder: 'People, a date (21/11), N2 tomorrow, an ID, a nurse…', autofocus: true, role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-res', 'aria-autocomplete': 'list', 'aria-label': 'Search' });
  const res = h('div', { class: 'res', id: 'search-res', role: 'listbox', 'aria-label': 'Results' });
  const wrap = h('div', { class: 'search', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search', onClick: (e) => { if (e.target === wrap) wrap.remove(); } }, h('div', { class: 'box' }, input, res));
  let items = [], hl = 0;
  // who works what on a day, by person key (doctors from dayInfo, nurses from their schedule); cached per day while the box is open
  const dayCache = new Map();
  const codesOn = (d) => { const k = keyOf(d); if (!dayCache.has(k)) { const m = new Map(); for (const e of dayInfo(s, d).entries) if (e.shift.kind === 'work') m.set(personKeyOf(e.person), e); try { for (const r of N.rowsFor(s, d)) m.set(r.key, { person: r.person, code: r.code, shift: r.shift }); } catch {} dayCache.set(k, m); } return dayCache.get(k); };
  // "D1 today · N2 Sat" — the useful cockpit meta for a person (beta T09-29)
  const personMeta = (p) => {
    const k = personKeyOf(p), today = codesOn(now).get(k), bits = [isMe(s, p) ? 'you' : '', p.title || UNIT_LABEL[p.units?.[0]] || ''];
    bits.push(today ? `${today.code} today` : 'off today');
    for (let i = 1; i <= 14; i++) { const d = addDays(startOfDay(now), i), e = codesOn(d).get(k); if (e) { bits.push(`${e.code} ${i === 1 ? 'tomorrow' : fmtDateShort(d)}`); break; } }
    return bits.filter(Boolean).join(' · ');
  };
  const openDay = (d) => { rt.rotaSel = d; rt.rotaMonth = new Date(d.getFullYear(), d.getMonth(), 1); show('calendar'); daySheet(d); };
  const paint = () => {
    res.replaceChildren(...items.map((it, i) => h('div', { class: `item ${i === hl ? 'hl' : ''}`, id: `sr-${i}`, role: 'option', 'aria-selected': i === hl ? 'true' : 'false', onClick: () => { wrap.remove(); it.run(); } }, h('div', { class: 'grow' }, h('div', { class: 'name' }, it.label), it.meta ? h('div', { class: 'meta' }, it.meta) : null))));
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    if (items[hl]) { input.setAttribute('aria-activedescendant', `sr-${hl}`); res.children[hl]?.scrollIntoView?.({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const build = (raw) => {
    const q = raw.trim().toLowerCase(); items = []; hl = 0;
    if (!q) { paint(); return; }
    const people = allPeople(s), seen = new Set(), addPerson = (p, meta) => { const k = personKeyOf(p); if (seen.has(k)) return; seen.add(k); items.push({ label: p.name, meta: meta ?? personMeta(p), run: () => personSheet(p) }); };
    // a date, or a day word ("tomorrow", "sat")
    const exact = parseDayQuery(q, now), dw = exact ? null : dayWordIn(q, now), day = exact || dw?.date || null;
    const rest = (dw ? q.replace(dw.word, '') : q).replace(/\b(who'?s|who is|on|at|works?|working)\b/g, ' ').trim();
    if (day && (exact || !rest)) items.push({ label: `${DAY_NAMES[day.getDay()]} ${fmtDate(day)}`, meta: dayInfo(s, day).mine?.shift.label || 'day', run: () => openDay(day) });
    // a shift code ("N2", "who's on D1 tomorrow"): everyone on it that day
    const code = /^[a-z]{1,3}\d{0,2}\+?$/i.test(rest) && rest.length <= 4 ? rest.toUpperCase() : '';
    if (code && !UNIT_WORDS[rest]) {
      const d = day || startOfDay(now), on = [...codesOn(d).values()].filter(e => String(e.code).toUpperCase() === code);
      if (on.length) {
        items.push({ label: `${code} ${dw?.word || (exact ? fmtDateShort(d) : 'today')}: ${on.length} ${on.length === 1 ? 'person' : 'people'}`, meta: on.slice(0, 4).map(e => firstName(e.person.name)).join(', ') + (on.length > 4 ? '…' : ''), run: () => openDay(d) });
        for (const e of on.slice(0, 8)) addPerson(e.person, `${e.code} ${dw?.word || (exact ? fmtDateShort(d) : 'today')} · ${e.shift.label || ''}`);
      }
    }
    // a unit or role word ("nurse", "fsed"), a name, a title or a staff ID
    const unit = UNIT_WORDS[rest];
    for (const p of people) {
      const nm = p.name.toLowerCase();
      if (unit ? p.units.includes(unit) || (unit === 'uv' && p.units.includes('lv')) : (rest && (nm.includes(rest) || (p.title || '').toLowerCase().includes(rest) || (p.id && String(p.id).includes(rest) && rest.length >= 3)))) addPerson(p);
      if (items.length > 40) break;
    }
    if (rest && rest.length >= 2) {
      // shift-log notes and corrections, by their words
      for (const [k, v] of Object.entries(s.shiftLog || {})) if (v?.note && v.note.toLowerCase().includes(rest)) items.push({ label: v.note.slice(0, 60), meta: `shift log · ${fmtDate(fromKey(k))}`, run: () => openDay(fromKey(k)) });
      for (const x of SW.list(s)) if (`${x.with} ${x.note} ${SW.KIND_LABEL[x.kind]}`.toLowerCase().includes(rest)) items.push({ label: `${SW.KIND_LABEL[x.kind]} · ${fmtDateShort(x.date)}`, meta: [x.with, x.note].filter(Boolean).join(' · '), run: () => openDay(x.date) });
      const pages = [['payslip', 'Career › Pay', () => go('career', 'pay')], ['licence', 'Career › Licences', () => go('career', 'creds')], ['cme', 'Career › Licences', () => go('career', 'creds')], ['cv', 'Career › CV', () => go('career', 'cv')], ['leave', 'Month › Plan leave', () => go('month', 'leave')], ['swap', 'Month › Swaps and covers', () => go('month', 'swaps')], ['labour', 'Month › Labour law', () => go('month')], ['labor', 'Month › Labour law', () => go('month')], ['log', 'Month › Shift log', () => go('month', 'log')]];
      for (const [w, l, run] of pages) if (w.startsWith(rest) || rest.startsWith(w)) items.push({ label: l, meta: 'open', run });
    }
    items = items.slice(0, 14);
    if (!items.length) items = [];
    paint();
    if (!items.length) res.replaceChildren(h('div', { class: 'item empty-res', role: 'option', 'aria-disabled': 'true' }, h('div', { class: 'meta' }, 'Nothing found. Try a name, 21/11, N2 tomorrow or an ID.')));
  };
  input.addEventListener('input', () => build(input.value));
  // arrow keys move the highlight, Enter opens the highlighted result (beta T09-10, T10-23)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!items.length) return; e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); }
    else if (e.key === 'Enter' && items[hl]) { e.preventDefault(); const it = items[hl]; wrap.remove(); it.run(); }
  });
  document.body.append(wrap); input.focus();
}

// ---------------- swaps: your own corrections on top of the imported rota ----------------
function swapSheet(date) {
  const s = S(); const k = keyOf(date);
  const info = dayInfo(s, date);
  const gp = info.rotas.find(r => r.unitKind === 'gp') || info.mine?.rota || null;
  const cur = s.swaps?.[k], raw = rawCode(info), now = cur ? (cur.kind === 'cancel' ? raw : cur.code || '') : raw;
  // codes from the parsed legend, grouped, with site and hours; leave is there, and the day's current code is always selectable (beta T02-06, T02-23)
  const groups = codeOptions(gp, [raw, cur?.code].filter(Boolean)), same = (c) => String(c).toUpperCase() === String(now).toUpperCase();
  const code = h('select', { 'aria-label': 'Your shift that day' }, h('option', { value: '', selected: !now }, 'Off (no shift)'), ...groups.map(g => h('optgroup', { label: g.group }, ...g.items.map(it => h('option', { value: it.code, selected: same(it.code) }, it.text)))));
  const people = allPeople(s).filter(p => p.units.includes('gp') && !isMe(s, p));
  const withSel = h('select', { 'aria-label': 'With' }, h('option', { value: '' }, '— nobody —'), ...people.map(p => h('option', { value: p.name, selected: cur?.with === p.name }, p.name)));
  const note = h('input', { placeholder: 'Note (optional)', maxlength: 200, value: cur?.note || '', 'aria-label': 'Note' });
  const kindOfCode = (c) => interpretCode(c || '', gp?.legend || {}, 'gp').kind;
  const leaveCode = groups.flatMap(g => g.items).find(it => kindOfCode(it.code) === 'leave')?.code || 'VL';
  const theirCode = () => { const p = gp?.people.find(x => x.name === withSel.value); return p ? String(p.days[date.getDate()] || '') : ''; };
  let kind = cur ? SW.kindOf(cur) : '';
  // the kind decides the shift where it can (beta T2-03/04/05): Cancelled and Covered for me → off, Leave → a leave code,
  // Swap → the colleague's rota code for that day, I covered → their code (the shift you worked for them)
  const follow = () => {
    if (kind === 'cancel' || kind === 'got') code.value = '';
    else if (kind === 'leave' && kindOfCode(code.value) !== 'leave') code.value = leaveCode;
    else if ((kind === 'swap' || kind === 'gave') && withSel.value) { const t = theirCode(); if (t && [...code.options].some(o => o.value === t)) code.value = t; }
    withLab.textContent = { swap: 'Swapped with', gave: 'You covered', got: 'Covered by' }[kind] || 'With (optional)';
    withField.hidden = !['swap', 'gave', 'got', 'fix', ''].includes(kind);
  };
  const kinds = h('div', { class: 'chips sw-kinds', role: 'radiogroup', 'aria-label': 'What happened' });
  const paintKinds = () => kinds.replaceChildren(...SW.KINDS.map(([kk, l, tip]) => h('button', { type: 'button', role: 'radio', 'aria-checked': kind === kk ? 'true' : 'false', class: `chip ${kind === kk ? 'sel' : ''}`, title: tip || l, onClick: () => { kind = kk; paintKinds(); follow(); } }, l)));
  const withLab = h('label', {}, 'With'), withField = h('div', { class: 'field' }, withLab, withSel);
  withSel.addEventListener('change', follow);
  const err = h('div', { class: 'tiny field-err', 'aria-live': 'polite' });
  const says = h('p', { class: 'small muted' }, h('b', {}, 'Rota: '), raw ? codeText(gp, raw) : 'off', cur ? [' · ', h('b', {}, 'your correction: '), cur.kind === 'cancel' ? 'cancelled' : cur.code ? codeText(gp, cur.code) : 'off'] : null, '. Record what actually happens. Imports never overwrite this, and covers keep a who-owes-whom count.');
  /** What is wrong with the record, in one sentence, or '' (kind and shift must agree; a swap must change something). */
  const problem = (rec) => {
    const kc = kindOfCode(rec.code);
    if (['swap', 'gave', 'got'].includes(rec.kind) && !rec.with) return 'Pick who it was with.';
    if (rec.kind === 'leave' && kc !== 'leave') return 'Leave needs a leave code (AL, SL, VL…).';
    if (rec.kind === 'gave' && kc !== 'work') return 'I covered: pick the shift you worked.';
    if (rec.kind === 'swap' && String(rec.code).toUpperCase() === raw.toUpperCase()) return 'A swap should change your shift: pick the one you work instead.';
    if (!rec.kind && String(rec.code).toUpperCase() === raw.toUpperCase() && !rec.with) return 'Nothing changes: pick what happened or a different shift.';
    return '';
  };
  const { close } = sheet([h('h2', {}, `Correct ${fmtDateShort(date)}`), says,
    h('div', { class: 'field' }, h('label', {}, 'What happened'), kinds),
    h('div', { class: 'field' }, h('label', {}, 'Your shift that day'), code),
    withField,
    h('div', { class: 'field' }, h('label', {}, 'Note'), note), err,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onClick: () => {
        const rec = { code: kind === 'cancel' ? '' : code.value, with: withSel.value, note: note.value.trim().slice(0, 200), at: Date.now() }; rec.kind = kind || SW.kindOf(rec);
        const why = problem(rec); if (why) { err.textContent = why; return; }
        const rest = restWarning(date, rec); if (rest && !err.dataset.ok) { err.textContent = `${rest} Save again to keep it.`; err.dataset.ok = '1'; return; }
        store.update(x => { const deleted = { ...(x.deleted || {}) }; delete deleted[`swap:${k}`]; return { ...x, swaps: { ...(x.swaps || {}), [k]: rec }, deleted }; });
        close(); toast('Saved', 'ok', { action: { label: 'Undo', run: () => store.update(x => store.revert(x, 'swaps', 'swap', k, cur)) } }); render();
      } }, 'Save'),
      cur ? h('button', { class: 'btn danger', onClick: () => { store.update(x => store.revert(x, 'swaps', 'swap', k, undefined)); close(); toast('Correction removed', 'ok', { action: { label: 'Undo', run: () => store.update(x => store.revert(x, 'swaps', 'swap', k, cur)) } }); render(); } }, 'Remove') : null)]);
  paintKinds(); follow();
}
/** Under 11 hours between this day's shift and the one before or after it (labour-law rest, beta T2-06): a sentence, or ''. */
function restWarning(date, rec) {
  const s = S(), trial = { ...s, swaps: { ...(s.swaps || {}), [keyOf(date)]: rec } };
  const w = L.windows(trial, addDays(date, -2), addDays(date, 3)).sort((a, b) => a.start - b.start), mine = w.findIndex(x => sameDay(x.date, date)); if (mine < 0) return '';
  for (const j of [mine - 1, mine + 1]) { const o = w[j]; if (!o) continue; const gap = (j < mine ? w[mine].start - o.end : o.start - w[mine].end) / 3600000; if (gap < 11) return `Only ${Math.max(0, Math.round(gap * 10) / 10)}h between this shift and the ${j < mine ? 'one before' : 'next'} (the law asks for rest between shifts).`; }
  return '';
}

function diagnosticsCard() {
  const s = S();
  const rows = [
    ['Google', G.isSignedIn() ? `signed in as ${G.accountEmail() || s.google.email || '?'}` : G.wasSignedIn() ? 'session expired — tap Sign in' : 'not signed in'],
    ['Session', G.isSignedIn() ? `${G.tokenMinutesLeft()} min left · renews on your next tap` : '—'],
    ['Last sync', s.google.lastSync ? `${new Date(s.google.lastSync).toLocaleString('en-GB')}${rt.syncMode ? ` · ${rt.syncMode}` : ''}${rt.lastSyncMs ? ` · ${(rt.lastSyncMs / 1000).toFixed(1)} s` : ''}` : 'never'],
    ['Drive requests', `${G.stats.requests} sent · ${G.stats.retries} retried · ${G.stats.errors} failed · ${G.stats.skippedWrites} unchanged writes skipped${G.stats.healed ? ` · ${G.stats.healed} duplicate file(s) tidied` : ''}`],
    ['Last Google error', G.stats.lastError ? `${G.stats.lastError} (${new Date(G.stats.lastErrorAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : 'none'],
    ['Unsaved to Drive', rt.saveDirty ? 'yes — saves on the next sync' : 'no'],
    ['This device', `${store.persistence.ok ? 'saved' : '⚠ ' + store.persistence.lastError} · ${Math.round(store.persistence.bytes / 1024)} KB${rt.storagePersisted ? ' · protected from clean-up' : ''}${rt.storageEst ? ` · ${Math.round(rt.storageEst.usage / 1048576)} of ${Math.round(rt.storageEst.quota / 1048576)} MB used` : ''}`],
    ['Sync issues', (rt.lastProblems || []).length ? rt.lastProblems.join(' · ') : 'none'],
    ['Queued calendar writes', String((s.outbox || []).length)],
    ['Rotas loaded', Object.keys(s.rotas).length ? Object.values(s.rotas).map(r => `${UNIT_LABEL[r.unitKind]} ${MONTHS[r.month - 1].slice(0, 3)}`).join(', ') : 'none'],
    ['Published to the hub', rt.publishedAt ? `status.json and shifts.json at ${new Date(rt.publishedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'not yet this session'],
    ['Read from the hub', rt.hub.at ? `${rt.hub.claude ? 'Claude inbox' : 'no Claude inbox'} · ${rt.hub.citrusPlan ? 'Citrus plan' : 'no Citrus plan'} · contact cards ${DIR.source() ? `from ${DIR.source()}` : 'not found'}` : 'not yet'],
    ['Work data', `${Object.keys(s.swaps || {}).length} corrections · ${Object.keys(s.posts || {}).length} nurse postings · ${Object.keys(s.shiftLog || {}).length} shift logs · ${Object.keys(s.jobs || {}).length} jobs · ${Object.keys(s.payslips || {}).length} payslips · ${Object.keys(s.creds || {}).length} licences`],
    ['Taken over from Citrus', s.migrated ? (s.migrated.from === 'skipped' ? 'skipped' : `${new Date(s.migrated.at).toLocaleDateString('en-GB')} · ${MIG.describe(s.migrated.counts || {})}`) : 'not yet'],
    ['Version', VERSION],
    ['Online', rt.online ? 'yes' : 'no'],
    ['Installed', window.matchMedia('(display-mode: standalone)').matches ? 'yes (home screen)' : 'browser tab'],
  ];
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Diagnostics'), h('div', { class: 'kv' }, ...rows.flatMap(([a, b]) => [h('b', {}, a), h('span', {}, b)])),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => refreshAll(true) }, 'Sync now'), h('button', { class: 'btn sm', onClick: async () => { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of regs) await r.unregister(); const ks = await caches.keys(); for (const k of ks) await caches.delete(k); location.reload(); } }, 'Reinstall app files')));
}
// ---------------- SETTINGS ----------------
const shiftAlarm = () => { const m = S().settings.alarmShift ?? 0; return m > 0 ? [m] : null; };
function alarmsCard() {
  const s = S(), sel = (key, opts, def) => { const el = h('select', { 'aria-label': 'Alarm before shifts', onChange: () => store.update(x => ({ ...x, settings: { ...x.settings, [key]: +el.value } })) }, opts.map(([v, l]) => h('option', { value: v }, l))); el.value = String(s.settings[key] ?? def); return el; };
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Shifts on your calendar'),
    h('div', { class: 'small muted' }, 'A web page cannot ring a closed phone, so Mandarin puts your shifts on a Google calendar of their own ("Mandarin Shifts") and your Calendar app rings the alarms. Or export them as an .ics file for any calendar app.'),
    G.isSignedIn() ? toggleRow('Mirror my shifts into "Mandarin Shifts"', !!s.settings.pushShifts, (on) => { store.update(x => ({ ...x, settings: { ...x.settings, pushShifts: on } })); if (on) refreshAll(true); }) : h('div', { class: 'tiny dim' }, 'Sign in with Google to mirror shifts.'),
    h('div', { class: 'field' }, h('label', {}, 'Alarm before each shift (mirror and .ics)'), sel('alarmShift', [[0, 'No alarm'], [60, '1 hour'], [90, '90 minutes'], [120, '2 hours'], [180, '3 hours']], 0)),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onClick: () => exportIcs(startOfDay(new Date())) }, '📅 Export the next 2 months (.ics)')),
    s.settings.pushShifts && s.settings.shiftCalendarId === '' ? null : null);
}
/** Your shifts as an .ics file (no Google needed). */
function exportIcs(from) {
  const { text, count } = shiftsIcs(S(), from, 62, { alarmMin: S().settings.alarmShift || 0 });
  if (!count) return toast('No shifts in the loaded rotas from that day');
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/calendar' })), download: `mandarin-shifts-${keyOf(from)}.ics` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`${count} shift${count === 1 ? '' : 's'} exported`, 'ok');
}
function renderMore() {
  const s = S();
  // the look of the app comes first: it is what people open Settings for most
  const out = [h('h1', {}, 'Settings'), h('div', { class: 'card' }, uiPicker()), customiseCard()];
  const signed = G.isSignedIn();
  const cid = h('input', { type: 'text', value: s.settings.clientId, placeholder: '1234567890-xxxx.apps.googleusercontent.com', spellcheck: false, 'aria-label': 'OAuth client ID' });
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Google'),
    h('div', { class: 'small muted' }, 'Drive keeps Mandarin in step on all your devices and with your other apps (My Apps › hub › mandarin). Calendar shows your events next to your shifts.'),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } },
      signed ? h('button', { class: 'btn', onClick: () => { G.signOut(); saveWatch(null); render(); } }, 'Sign out') : h('button', { class: 'btn primary', onClick: async () => { try { if (cid.value.trim() !== s.settings.clientId) { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); await G.init(cid.value.trim()); } await G.signIn({ renew: G.wasSignedIn() }).catch(() => G.signIn()); toast('Signed in', 'ok'); refreshAll(true, { full: true }); } catch (e) { toast(e.message, 'err'); } } }, G.wasSignedIn() ? 'Reconnect Google' : 'Sign in with Google'),
      signed ? h('button', { class: 'btn', onClick: () => refreshAll(true) }, '↻ Sync now') : null),
    signed ? h('div', { class: 'small muted', style: { marginTop: '8px' } }, `${s.google.email || 'signed in'}${s.google.lastSync ? ` · last sync ${new Date(s.google.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`) : null,
    h('details', { class: 'adv' }, h('summary', { class: 'small' }, 'Advanced'), h('div', { class: 'field' }, h('label', {}, 'OAuth client ID (the one Google Cloud client all your apps share)'), cid, h('div', { class: 'tiny dim' }, 'Only the client ID, never the secret. This site must be in the client’s "Authorised JavaScript origins".')),
      h('button', { class: 'btn sm', onClick: async () => { store.update(x => ({ ...x, settings: { ...x.settings, clientId: cid.value.trim() } }), { remote: false }); try { await G.init(cid.value.trim()); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Save ID'),
      h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Drive folder'), h('input', { value: s.settings.driveFolder, 'aria-label': 'Drive folder', onChange: (e) => { const v = e.target.value.trim() || 'My Apps'; if (/[\/\\]/.test(v) || v.length > 60) { e.target.value = s.settings.driveFolder; return toast('One folder name only (no “/”)', 'err'); } if (v !== 'My Apps' && !confirm(`Your apps share one folder, “My Apps”. Use “${v}” for Mandarin anyway? Citrus will not see Mandarin's files there.`)) { e.target.value = s.settings.driveFolder; return; } store.update(x => ({ ...x, settings: { ...x.settings, driveFolder: v } })); } }), h('div', { class: 'tiny dim' }, 'Keep “My Apps”: every app reads the hub there. Rotas go in My Apps/Rotas; Mandarin keeps its files in My Apps/hub/mandarin/.')))));
  if (signed) {
    const cals = rt.calendars;
    out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Calendars to show'),
      cals.length ? h('div', {}, ...cals.map(c => toggleRow(`${c.name}${c.primary ? ' (primary)' : ''}`, s.settings.calendarIds.includes(c.id), (on) => store.update(x => ({ ...x, settings: { ...x.settings, calendarIds: on ? [...new Set([...x.settings.calendarIds, c.id])] : x.settings.calendarIds.filter(i => i !== c.id) } }), { silent: true })))) : h('div', { class: 'muted small' }, 'Sync to load calendars'),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: backupsSheet }, '⟲ Daily backups'), h('button', { class: 'btn sm', onClick: repairSheet }, '🩺 Check Drive'))));
  }
  // Me
  const people = mePeople(), byUnit = {}; for (const p of people) (byUnit[p.unit] ||= []).push(p);
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Me'),
    people.length ? h('div', { class: 'field' }, h('label', { for: 'me-select' }, 'Which row is yours?'), h('select', { id: 'me-select', onChange: (e) => { const p = people.find(x => x.key === e.target.value); setMe(p || null); } },
      h('option', { value: '' }, '— choose —'), ...Object.entries(byUnit).map(([u, ps]) => h('optgroup', { label: UNIT_LABEL[u] || u }, ...ps.map(p => h('option', { value: p.key, selected: isMe(s, p) }, `${p.name}${p.title ? ' · ' + p.title : ''}${p.id ? ' · ' + p.id : ''}`))))),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onClick: () => mePicker() }, '🔎 Find my row'), s.me ? h('span', { class: 'tiny dim grow' }, `Now: ${s.me.name}${s.me.id ? ` · ID ${s.me.id}` : ''}`) : null)) : h('div', { class: 'muted small' }, Object.keys(s.rotas).length ? 'Only the nurses’ schedule is loaded: import the GP rota to pick your row.' : 'Import a rota first')));
  out.push(alarmsCard());
  if (family()) out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your apps'),
    h('div', { class: 'small muted' }, 'Mandarin owns everything from the rotas. It writes hub/mandarin/status.json (what Citrus shows: today, tomorrow, week hours, what is waiting) and shifts.json (your shifts and the roster for the next weeks, for Citrus, Clementine and Calamansi). It reads only the Claude inbox, Citrus’s plan and the contact cards, and never writes into another app’s files.'),
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('a', { class: 'btn sm', href: `${CITRUS_URL}?from=mandarin`, target: '_blank', rel: 'noopener' }, '🍊 Open Citrus'), signed ? h('button', { class: 'btn sm', onClick: () => publish().then(() => toast('Published', 'ok')).catch(e => toast(e.message, 'err')) }, 'Publish now') : null)));
  out.push(diagnosticsCard());
  out.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Backup and data'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onClick: downloadBackup }, '⬇ Backup'),
      (() => { const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; let j; try { j = JSON.parse(await f.text()); } catch { return toast(`${f.name} is not a backup file (it isn’t JSON)`, 'err'); } if (j?.app !== 'mandarin' && MIG.looksLikeCitrus(j)) { migrationOffered = false; offerMigration(j, f.name); return; } restoreSheet(j, { source: f.name }); } }); return h('span', {}, inp, h('button', { class: 'btn', title: 'A Mandarin backup, or a Citrus backup to bring your work over', onClick: () => inp.click() }, '⬆ Restore or import')); })(),
      preRestore() ? h('button', { class: 'btn', title: `Your data as it was before the restore on ${new Date(preRestore().at).toLocaleString('en-GB')}`, onClick: undoRestore }, '↶ Undo restore') : null,
      signed && family() ? h('button', { class: 'btn', onClick: migrateNow }, '🍊 Bring work over from Citrus') : null,
      h('button', { class: 'btn danger', onClick: eraseSheet }, 'Erase this device…')),
    h('div', { class: 'tiny dim', style: { marginTop: '10px' } }, `Mandarin ${VERSION} · Scheduler & Work · your data lives in this browser and your own Google Drive.`)));
  return out;
}
function downloadBackup() { const blob = new Blob([store.exportJSON()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `mandarin-backup-${keyOf(new Date())}.json` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
/** Mandarin's own keys on this origin. */
const ownKeys = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('mandarin.')) out.push(k); } } catch {} return out; };
function eraseSheet() {
  const signed = G.isSignedIn() || G.wasSignedIn();
  const { close } = sheet([h('h2', {}, 'Erase Mandarin on this device?'),
    h('p', { class: 'small' }, `This removes Mandarin's data from this browser only: rotas, corrections, postings, logs, career, settings and the interface choice (${ownKeys().length} saved items).`),
    h('p', { class: 'small muted' }, signed ? 'Your Google Drive copy is not touched. If you sign in again here, the next sync brings everything back from Drive.' : 'You are not using Google sync, so nothing else holds a copy: download a backup first if you may want it back.'),
    h('div', { class: 'row wrap sh-foot' },
      h('button', { class: 'btn', onClick: downloadBackup }, '⬇ Backup first'),
      h('button', { class: 'btn danger grow', onClick: () => { for (const k of ownKeys()) try { localStorage.removeItem(k); } catch {} close(); location.reload(); } }, 'Erase this device'),
      h('button', { class: 'btn ghost', onClick: () => close() }, 'Cancel'))]);
}
function toggleRow(label, on, cb) {
  const t = h('button', { class: `toggle ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, onClick: () => { on = !on; t.classList.toggle('on', on); t.setAttribute('aria-checked', on ? 'true' : 'false'); cb(on); } });
  return h('div', { class: 'switch' }, h('span', { class: 'small' }, label), t);
}

window.__mandarin = { refreshAll, publish, saveStateNow, pullState, store, G, rt, calendarCreate, VERSION };   // for the console and the tests
boot();
