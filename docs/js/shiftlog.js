// After-shift log (pure): a rating, a short note and a few counts after each shift. Counts only: never a patient's name,
// file number or anything that identifies a person. Stored as state.shiftLog[dateKey] = {rating, note, seen, transfers, referrals, at}.
import { myDay, dayInfo } from './model.js';
import { keyOf, fromKey, addDays, startOfDay } from './util.js';

export const COUNTS = [['seen', 'Patients seen'], ['transfers', 'Transfers'], ['referrals', 'Referrals']];
export const MAX_COUNT = 300;
export const FACES = ['😞', '😕', '😐', '🙂', '😄'];
const KEY_RE = /^\d{4}-\d\d-\d\d$/;
const int = (v) => { const n = Math.round(+v); return Number.isFinite(n) && n >= 0 ? Math.min(MAX_COUNT, n) : undefined; };

/** Notes are short and must not carry identifiers: long digit runs (file numbers, phones, IDs) are refused. */
export function checkNote(t) {
  const v = String(t ?? '').slice(0, 280);
  if (/\d{6,}/.test(v.replace(/[\s-]/g, ''))) return { ok: false, msg: 'Leave out file numbers, IDs and phone numbers: the log keeps counts only.' };
  return { ok: true, value: v.trim() };
}

/** Save (or change) the log for one shift. patch: {rating?, note?, seen?, transfers?, referrals?}. Bad values are ignored, not stored. */
export function logShift(s, key, patch) {
  if (!KEY_RE.test(key)) return s;
  const cur = s.shiftLog?.[key] || {}, next = { ...cur, key };
  if (patch.rating !== undefined) { const r = Math.round(+patch.rating); if (r >= 1 && r <= 5) next.rating = r; else if (patch.rating === null) delete next.rating; }
  if (patch.note !== undefined) { const c = checkNote(patch.note); if (c.ok) next.note = c.value; }
  for (const [k] of COUNTS) if (patch[k] !== undefined) { if (patch[k] === '' || patch[k] === null) delete next[k]; else { const n = int(patch[k]); if (n !== undefined) next[k] = n; } }
  if (patch.code) next.code = String(patch.code).slice(0, 12);
  if (patch.site) next.site = String(patch.site).slice(0, 60);
  next.at = Date.now();
  return { ...s, shiftLog: { ...(s.shiftLog || {}), [key]: next } };
}
export function clearLog(s, key) {
  const m = { ...(s.shiftLog || {}) }; delete m[key];
  return { ...s, shiftLog: m, deleted: { ...(s.deleted || {}), [`slog:${key}`]: Date.now() } };
}
export const logOf = (s, key) => s.shiftLog?.[key] || null;

/** The shift that ended most recently (and not more than `days` ago), keyed by the day it started on. */
function endedShifts(s, now, days) {
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(startOfDay(now), -i), md = myDay(s, d);
    if (md.today?.window && md.today.window.end <= now) out.push({ key: keyOf(d), date: d, entry: md.today, end: md.today.window.end });
  }
  return out;
}
/** Shifts that ended in the last `days` days without a rating. Newest first. */
export function unlogged(s, now = new Date(), days = 3) { return endedShifts(s, now, days).filter(x => !s.shiftLog?.[x.key]?.rating); }
/** The one shift to ask about now: ended within the last 20 hours and not rated yet. */
export function askNow(s, now = new Date()) { return unlogged(s, now, 1).find(x => now - x.end < 20 * 3600000) || null; }

/** Average rating of the month `now` is in (null with fewer than 1 rated shift). */
export function monthAverage(s, now = new Date()) {
  const p = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, r = Object.entries(s.shiftLog || {}).filter(([k, v]) => k.startsWith(p) && v?.rating).map(([, v]) => v.rating);
  return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10 : null;
}

/** A month in numbers: rated shifts, average, counts, by shift type and site, and which colleagues your better shifts had. */
export function monthStats(s, y, m) {
  const p = `${y}-${String(m).padStart(2, '0')}`, rows = Object.entries(s.shiftLog || {}).filter(([k, v]) => k.startsWith(p) && v).sort(([a], [b]) => a.localeCompare(b));
  const out = { logged: rows.length, rated: 0, avg: null, totals: { seen: 0, transfers: 0, referrals: 0 }, byType: {}, bySite: {}, withPeople: [], best: null, worst: null, notes: [] };
  const sum = [], people = new Map();
  for (const [k, v] of rows) {
    for (const [c] of COUNTS) if (Number.isFinite(v[c])) out.totals[c] += v[c];
    if (v.note) out.notes.push({ key: k, note: v.note, rating: v.rating || 0 });
    if (!v.rating) continue;
    out.rated++; sum.push(v.rating);
    const info = dayInfo(s, fromKey(k)), sh = info.mine?.shift, type = sh?.type || '?', site = sh?.site || v.site || '?';
    (out.byType[type] ||= []).push(v.rating); (out.bySite[site] ||= []).push(v.rating);
    for (const e of [...info.withMe, ...info.alsoAtSite]) { const key = e.person.id ? `id:${e.person.id}` : `name:${e.person.name.toLowerCase()}`; const x = people.get(key) || { key, name: e.person.name, r: [] }; x.r.push(v.rating); people.set(key, x); }
    if (!out.best || v.rating > out.best.rating) out.best = { key: k, rating: v.rating };
    if (!out.worst || v.rating < out.worst.rating) out.worst = { key: k, rating: v.rating };
  }
  const avg = (a) => Math.round(a.reduce((x, y2) => x + y2, 0) / a.length * 10) / 10;
  if (sum.length) out.avg = avg(sum);
  for (const o of [out.byType, out.bySite]) for (const k of Object.keys(o)) o[k] = { n: o[k].length, avg: avg(o[k]) };
  // colleagues with at least two rated shifts together, best first: "your shifts with Sara average 4.5"
  out.withPeople = [...people.values()].filter(x => x.r.length >= 2).map(x => ({ key: x.key, name: x.name, n: x.r.length, avg: avg(x.r) })).sort((a, b) => b.avg - a.avg || b.n - a.n).slice(0, 8);
  return out;
}
