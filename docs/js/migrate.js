// Taking over the work parts of Citrus (pure). Mandarin reads My Apps/hub/citrus/state.json (or a Citrus backup file) and copies
// what it now owns: who you are, the rotas, corrections and swaps, nurse postings and heard tips, schedule-update briefs, career,
// the proposals you already decided on, and the work settings. It never writes into Citrus's file; Citrus drops its copies once
// Mandarin is live. Running it twice is harmless: the copy is merged record by record, newest edit wins.
import { mergeStates, sanitize } from './store.js';
import { interpretCode } from './rota-parser.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const TAKE = ['rotas', 'swaps', 'posts', 'rotaChanges', 'jobs', 'offers'];
const TOMB = /^(rota|drive|swap|post|rchg|job|offer):/;   // not slog: in Citrus that is the study log (beta T5-20)
const SETTINGS = ['nurseStaffing', 'nurseLeads', 'labor', 'day', 'alarmShift', 'calendarIds'];   // never driveFolder or clientId: an old Citrus value made a second tree outside My Apps (beta T5-05)
const RULES = ['sleepStart', 'sleepHours', 'wakeMin', 'postNightRecoveryUntil', 'preShiftBufferMin', 'postShiftBufferMin', 'commute'];
const INBOX_TYPES = new Set(['posting', 'swap', 'nurse']);

/** The work part of a Citrus state, shaped as a Mandarin state. → {part, counts} (part is null when there is nothing to take). */
export function workPart(citrus) {
  if (!isObj(citrus) || !isObj(citrus.rotas)) return { part: null, counts: {} };
  const c = sanitize(citrus), part = { updatedAt: +c.updatedAt || 0, stamps: {}, deleted: {}, settings: {}, rules: {} }, counts = {};
  for (const k of TAKE) if (isObj(c[k])) { part[k] = c[k]; counts[k] = Object.keys(c[k]).length; }
  if (isObj(c.me) && (c.me.id || c.me.name)) { part.me = { name: String(c.me.name || ''), id: String(c.me.id || '') }; if (c.stamps?.me) part.stamps.me = c.stamps.me; }
  for (const [k, t] of Object.entries(c.deleted || {})) if (TOMB.test(k)) part.deleted[k] = t;
  for (const k of SETTINGS) if (c.settings?.[k] !== undefined) { part.settings[k] = c.settings[k]; if (c.stamps?.[`set:${k}`]) part.stamps[`set:${k}`] = c.stamps[`set:${k}`]; }
  for (const k of RULES) if (c.rules?.[k] !== undefined) { part.rules[k] = c.rules[k]; if (c.stamps?.[`rule:${k}`]) part.stamps[`rule:${k}`] = c.stamps[`rule:${k}`]; }
  // proposals you already took or dismissed in Citrus (postings, swaps, nurse notes) are not offered again
  const inbox = Object.fromEntries(Object.entries(c.inboxLog || {}).filter(([k, v]) => isObj(v) && (INBOX_TYPES.has(v.type) || (v.status === 'dismissed' && /^claude:/.test(k)))));   // a proposal dismissed in Citrus must not come back here (T5-08)
  if (Object.keys(inbox).length) { part.inboxLog = inbox; counts.inboxLog = Object.keys(inbox).length; }
  // "How was today?" on a day you worked becomes that shift's rating (the mood itself stays Citrus's)
  const log = {};
  for (const [k, v] of Object.entries(c.dayLog || {})) {
    if (!isObj(v) || !(v.score >= 1 && v.score <= 5) || !/^\d{4}-\d\d-\d\d$/.test(k)) continue;
    const [y, m, d] = k.split('-').map(Number), r = Object.values(c.rotas).find(x => x.unitKind === 'gp' && x.year === y && x.month === m), me = part.me;
    const row = r && me ? r.people.find(p => (me.id && String(p.id) === me.id) || String(p.name).toLowerCase() === me.name.toLowerCase()) : null;
    const code = row?.days?.[d] || '', sh = code ? interpretCode(code, r.legend, 'gp') : null;
    if (sh?.kind === 'work') log[k] = { key: k, rating: v.score, note: String(v.note || '').slice(0, 200), code, from: 'citrus', at: v.at || 0 };
  }
  if (Object.keys(log).length) { part.shiftLog = log; counts.shiftLog = Object.keys(log).length; }
  return { part: Object.keys(counts).length || part.me ? part : null, counts };
}

/** Merge the work part into this device's state. Local edits that are newer win; nothing local is lost. */
export function applyMigration(local, citrus, { source = 'citrus' } = {}) {
  const { part, counts } = workPart(citrus);
  if (!part) return { state: local, counts, changed: false };
  const merged = mergeStates(local, { ...local, ...part, settings: { ...(local.settings || {}), ...part.settings }, rules: { ...(local.rules || {}), ...part.rules }, stamps: { ...(local.stamps || {}), ...part.stamps }, deleted: { ...(local.deleted || {}), ...part.deleted }, updatedAt: Math.max(local.updatedAt || 0, part.updatedAt) });
  // a fresh device: "me" comes from Citrus even though this copy has a newer (empty) edit time
  if (!merged.me && part.me) merged.me = part.me;
  merged.migrated = { from: source, at: Date.now(), counts };
  return { state: merged, counts, changed: true };
}
/** "43 rotas · 12 corrections · 30 postings" for the confirmation and the toast. */
export function describe(counts) {
  const W = { rotas: ['rota', 'rotas'], swaps: ['correction', 'corrections'], posts: ['nurse posting', 'nurse postings'], rotaChanges: ['schedule update', 'schedule updates'], jobs: ['job', 'jobs'], offers: ['offer', 'offers'], inboxLog: ['decided proposal', 'decided proposals'], shiftLog: ['shift rating', 'shift ratings'] };
  return Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${W[k] ? W[k][n === 1 ? 0 : 1] : k}`).join(' · ') || 'nothing work-related';
}

const CITRUS_ONLY = ['tasks', 'goals', 'plan', 'contacts', 'friends', 'memos', 'media', 'notes', 'dayLog', 'habits', 'aims', 'study', 'chores', 'birthdays'];
/** A backup that is not Mandarin's own: anything without app:"mandarin" that holds a Citrus-only key, or has no app at all
 *  (a lean Citrus backup with no tasks was restored as Mandarin's and pulled contacts and mood notes in: beta T5-06). */
export function looksLikeCitrus(j) { return isObj(j) && j.app !== 'mandarin' && (!j.app || j.app === 'citrus' || CITRUS_ONLY.some(k => k in j)); }
