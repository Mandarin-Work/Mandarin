// Your corrections, swaps and covers as a history (pure). A correction lives in state.swaps[dateKey] = {code, with, note, kind, at}.
// kind: 'swap' (you traded shifts with someone) · 'gave' (you covered someone's shift: they owe you one) ·
//       'got' (someone covered yours: you owe them) · 'leave' · 'cancel' (shift cancelled) · 'fix' (the rota was wrong).
// Older records have no kind: it is read from the record (a colleague → swap, a leave code → leave, else fix).
import { interpretCode } from './rota-parser.js';
import { dayInfo } from './model.js';
import { fromKey, keyOf } from './util.js';

export const KINDS = [['swap', 'Swap', 'You traded shifts'], ['gave', 'I covered', 'You worked their shift: they owe you one'], ['got', 'Covered for me', 'They worked yours: you owe them'], ['leave', 'Leave', ''], ['cancel', 'Cancelled', 'The shift did not happen'], ['fix', 'Rota fix', 'The rota had it wrong']];
export const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
export function kindOf(x) {
  if (x?.kind && KIND_LABEL[x.kind]) return x.kind;
  if (interpretCode(x?.code || '', {}, 'gp').kind === 'leave') return 'leave';
  return x?.with ? 'swap' : 'fix';
}
/** Every correction, newest first: [{key, date, kind, code, raw, with, note}]. `raw` is what the rota said (when it is loaded). */
export function list(s) {
  return Object.entries(s.swaps || {}).filter(([k, v]) => /^\d{4}-\d\d-\d\d$/.test(k) && v).map(([key, v]) => {
    const date = fromKey(key), info = dayInfo(s, date), raw = info.mine ? String(info.mine.person.days[date.getDate()] || '') : null;
    return { key, date, kind: kindOf(v), code: v.code || '', raw, with: v.with || '', note: v.note || '', at: v.at || 0 };
  }).sort((a, b) => b.key.localeCompare(a.key));
}
/** Who owes whom: + they owe you (you covered them), − you owe them. Only colleagues with a non-zero balance or any swap. */
export function balances(s) {
  const by = new Map();
  for (const x of list(s)) {
    if (!x.with) continue;
    const b = by.get(x.with) || { name: x.with, gave: 0, got: 0, swaps: 0, last: null };
    if (x.kind === 'gave') b.gave++; else if (x.kind === 'got') b.got++; else if (x.kind === 'swap') b.swaps++;
    if (!b.last || x.key > keyOf(b.last)) b.last = x.date;
    by.set(x.with, b);
  }
  return [...by.values()].map(b => ({ ...b, balance: b.gave - b.got })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || b.swaps - a.swaps);
}
/** Counts for the month: {swap, gave, got, leave, cancel, fix} */
export function monthCounts(s, y, m) {
  const p = `${y}-${String(m).padStart(2, '0')}`, out = { swap: 0, gave: 0, got: 0, leave: 0, cancel: 0, fix: 0 };
  for (const x of list(s)) if (x.key.startsWith(p)) out[x.kind]++;
  return out;
}
