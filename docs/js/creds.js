// Licences, certificates and CME (pure). state.creds[id] = {kind, name, number, issued, expires, provider, at};
// state.cme[id] = {date, title, hours, cat, provider, credId, at}. Expiry dates drive the Today card, Citrus's pending list
// and the CV. Nothing here is legal advice: the CME target is yours to set (Settings › Career).
import { keyOf, fromKey, startOfDay, uid } from './util.js';

export const KINDS = [
  ['scfhs', 'SCFHS licence', 'Saudi Commission for Health Specialties registration / classification'],
  ['bls', 'BLS', 'Basic Life Support'], ['acls', 'ACLS', 'Advanced Cardiovascular Life Support'], ['pals', 'PALS', 'Paediatric Advanced Life Support'],
  ['atls', 'ATLS', 'Advanced Trauma Life Support'], ['iqama', 'Work permit', 'Residence / work permit'], ['malpractice', 'Malpractice insurance', ''],
  ['other', 'Other', ''],
];
export const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
const DATE = /^\d{4}-\d\d-\d\d$/;
const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const d = (v) => DATE.test(String(v || '')) ? String(v) : '';
const days = (k, now) => Math.round((fromKey(k) - startOfDay(now)) / 864e5);

export function cleanCred(c) {
  const kind = KIND_LABEL[c.kind] ? c.kind : 'other';
  return { id: c.id || uid(), kind, name: txt(c.name, 80) || KIND_LABEL[kind], number: txt(c.number, 40), issued: d(c.issued), expires: d(c.expires), provider: txt(c.provider, 80), note: txt(c.note, 200), at: Date.now() };
}
export function credErrors(c) {
  const e = {};
  if (!txt(c.name, 80) && !KIND_LABEL[c.kind]) e.name = 'Name it';
  if (c.issued && c.expires && c.expires < c.issued) e.expires = 'Expires before it was issued';
  return e;
}
export const saveCred = (s, c) => { const x = cleanCred(c); return { ...s, creds: { ...(s.creds || {}), [x.id]: x } }; };
export function deleteCred(s, id) { const m = { ...(s.creds || {}) }; delete m[id]; return { ...s, creds: m, deleted: { ...(s.deleted || {}), [`cred:${id}`]: Date.now() } }; }
export const credList = (s) => Object.values(s.creds || {}).sort((a, b) => (a.expires || '9999').localeCompare(b.expires || '9999'));

/** Status of one credential: expired | soon (≤ 60 days) | ok | none (no expiry). */
export function credState(c, now = new Date()) {
  if (!c.expires) return { state: 'none', days: null };
  const n = days(c.expires, now);
  return { state: n < 0 ? 'expired' : n <= 60 ? 'soon' : 'ok', days: n };
}
/** Credentials expiring within `within` days (or already expired up to 90 days ago), soonest first. */
export function dueSoon(s, now = new Date(), within = 60) {
  return credList(s).map(c => ({ ...c, ...credState(c, now) })).filter(c => c.days !== null && c.days <= within && c.days >= -90).sort((a, b) => a.days - b.days);
}

// ───────── CME
export const CME_CATS = [['1', 'Category 1 (accredited)'], ['2', 'Category 2'], ['self', 'Self-learning']];
export function cleanCme(x) {
  const hours = Math.round(Math.max(0, Math.min(200, +x.hours || 0)) * 4) / 4;
  return { id: x.id || uid(), date: d(x.date) || keyOf(new Date()), title: txt(x.title, 120), hours, cat: CME_CATS.some(([k]) => k === x.cat) ? x.cat : '1', provider: txt(x.provider, 80), at: Date.now() };
}
export const cmeErrors = (x) => { const e = {}; if (!txt(x.title, 120)) e.title = 'What was it?'; if (!(+x.hours > 0)) e.hours = 'Hours above 0'; if (+x.hours > 200) e.hours = 'At most 200 h'; return e; };
export const saveCme = (s, x) => { const c = cleanCme(x); return { ...s, cme: { ...(s.cme || {}), [c.id]: c } }; };
export function deleteCme(s, id) { const m = { ...(s.cme || {}) }; delete m[id]; return { ...s, cme: m, deleted: { ...(s.deleted || {}), [`cme:${id}`]: Date.now() } }; }
export const cmeList = (s) => Object.values(s.cme || {}).sort((a, b) => b.date.localeCompare(a.date));
/** Your yearly target (Settings › Career), default 30 hours a year. */
export const cmeTarget = (s) => { const t = +s.settings?.career?.cmeTarget; return t > 0 && t <= 500 ? t : 30; };
/** Hours in the 12 months up to `now` and in this calendar year, against the target. */
export function cmeProgress(s, now = new Date()) {
  const year = String(now.getFullYear()), from = keyOf(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1));
  const list = cmeList(s), last12 = list.filter(x => x.date >= from && x.date <= keyOf(now)), thisYear = list.filter(x => x.date.startsWith(year));
  const sum = (a) => Math.round(a.reduce((t, x) => t + x.hours, 0) * 4) / 4, target = cmeTarget(s);
  const byCat = {}; for (const x of last12) byCat[x.cat] = (byCat[x.cat] || 0) + x.hours;
  return { last12: sum(last12), thisYear: sum(thisYear), target, pct: Math.min(100, Math.round(sum(last12) / target * 100)), byCat, count: list.length };
}
