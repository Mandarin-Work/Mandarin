// Proposals other apps send Mandarin (pure). The Claude inbox (My Apps/hub/claude/status.json, HUB.md contract v2) can propose
// work items: a nurse posting list, a swap, or a note about a nurse ("she can lead"). Nothing is applied without a tap;
// what you decided is remembered in state.inboxLog['app:id'] so the same proposal is never offered twice.
import { normalizeStatus, refOf } from './inbound.js';
import * as N from './nurses.js';
import { parsePostingList } from './nurse-board.js';
import { dayInfo } from './model.js';
import { interpretCode } from './rota-parser.js';
import { keyOf, fromKey } from './util.js';

export const TYPES = new Set(['posting', 'swap', 'nurse']);
/** Proposals for Mandarin from the given statuses ({app: status json}) that you have not decided on and are not stale. */
export function pending(s, statuses, now = new Date()) {
  const today = keyOf(now), out = [];
  for (const [name, raw] of Object.entries(statuses || {})) {
    const st = normalizeStatus(raw, name); if (!st) continue;
    for (const it of st.inbox || []) {
      if (!TYPES.has(it.type)) continue;
      const ref = refOf(st.app || name, it.id);
      if (s.inboxLog?.[ref]) continue;
      if (it.expires && it.expires < today) continue;
      if (it.date && it.date < today) continue;
      out.push({ ref, app: st.app || name, item: it, at: st.updatedAt || '' });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
const decided = (s, ref, extra) => ({ ...s, inboxLog: { ...(s.inboxLog || {}), [ref]: { status: 'accepted', at: Date.now(), ...extra } } });
/** Take a proposal in. → {state, placed?, missed?, name?} */
export function accept(s, p) {
  const { ref, app, item } = p;
  if (item.type === 'posting') {
    // names → that day's floating nurses with the same matcher as "Paste list"; "mine" = your own GP site that day
    const date = fromKey(item.date), mySite = N.siteId(dayInfo(s, date).mine?.shift?.site || ''), rows = N.rowsFor(s, date);
    const text = item.postings.map(x => `${/^mine$/i.test(x.site) ? (N.siteLabel(mySite) || '') : x.site}: ${x.nurse}`).join('\n');
    const res = parsePostingList(text, rows); let next = s;
    for (const hit of res.hits) next = N.setPost(next, date, hit.key, hit.site, { tip: true, from: item.from || app, pulled: hit.pulled });
    return { state: decided(next, ref, { type: 'posting', placed: res.hits.length, missed: res.unknown.length + res.offsite.length }), placed: res.hits.length, missed: [...res.unknown.map(u => u.text), ...res.offsite.map(o => o.name)] };
  }
  if (item.type === 'nurse') {
    const n = N.findNurse(s, item.nurse); if (!n) return { state: s, missed: [item.nurse] };
    return { state: decided(N.setCanLead(s, N.keyOfPerson(n), item.canLead), ref, { type: 'nurse' }), name: n.name };
  }
  if (item.type === 'swap') {
    const v = checkSwap(s, item); if (v.error) return { state: s, error: v.error };
    const swaps = { ...(s.swaps || {}), [item.date]: { code: item.code, with: item.with, note: item.note || item.title, kind: item.with ? 'swap' : 'fix', at: Date.now() } }, deleted = { ...(s.deleted || {}) }; delete deleted[`swap:${item.date}`];
    return { state: decided({ ...s, swaps, deleted }, ref, { type: 'swap' }) };
  }
  return { state: s };
}
/** A proposed swap must use a code your rota knows (or '' for off), on a day the rota covers: a typo never becomes a "working day" (beta T1-19).
 *  → {error} or {before, after} (labels for the confirmation). */
export function checkSwap(s, item) {
  const info = dayInfo(s, fromKey(item.date)), gp = info.rotas.find(r => r.unitKind === 'gp');
  if (!gp || !info.mine) return { error: `No GP rota with your row for ${item.date}` };
  const code = String(item.code || '').trim(), sh = code ? interpretCode(code, gp.legend, 'gp') : null;
  const known = !code || gp.legend[code] || Object.values(gp.legend).some(l => l.code === code) || sh.kind !== 'work' || !!sh.hours || gp.people.some(p => Object.values(p.days || {}).includes(code));
  if (!known) return { error: `“${code}” is not a code in your ${item.date.slice(0, 7)} rota` };
  const raw = String(info.mine.person.days[info.date.getDate()] || '');
  return { before: raw ? interpretCode(raw, gp.legend, 'gp').label || raw : 'off', after: code ? sh.label || code : 'off', withKnown: !item.with || gp.people.some(p => p.name === item.with) };
}
export const dismiss = (s, ref) => ({ ...s, inboxLog: { ...(s.inboxLog || {}), [ref]: { status: 'dismissed', at: Date.now() } } });
