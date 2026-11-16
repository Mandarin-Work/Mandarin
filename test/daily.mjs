// Briefing and wind-down on a synthetic rota. Run: node test/daily.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as D from '../docs/js/daily.js'; import { mergeStates } from '../docs/js/store.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const days = {}; for (let d = 1; d <= 30; d++) days[d] = [3, 4, 10, 11, 17, 18, 24, 25].includes(d) ? 'N1' : [5, 6, 12, 13, 19, 20, 26, 27].includes(d) ? '' : 'D1';
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' } }, people: [{ name: 'Dr Me', id: '1', days }, { name: 'Dr Ann', id: '2', days: Object.fromEntries(Object.keys(days).map(d => [d, 'D1'])) }] };
const s0 = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, settings: {}, favs: { 'id:2': { at: 1 } }, creds: { c: { id: 'c', kind: 'bls', name: 'BLS', expires: '2026-11-20' } } };
await t('briefing: shift, colleagues, favourites, week load and licences; no home or tasks lines (those are Citrus\'s)', () => {
  const b = D.briefing(s0, new Date(2026, 10, 9, 7)), txt = b.map(x => x.text).join(' | '); assert.match(b[0].text, /Day · Upper Village|Upper Village/); assert.ok(b[0].text.includes('08:00–20:00')); assert.match(txt, /With you: Ann/); assert.match(txt, /Favourites on with you: Ann/); assert.match(txt, /rostered this week/); assert.match(txt, /BLS expires in 11 days/);
  assert.ok(!/Due at home|task due/.test(txt)); assert.ok(!/undefined|null|NaN/.test(txt));
});
await t('briefing on a day off says so and is not empty', () => { assert.match(D.briefing(s0, new Date(2026, 10, 6, 9))[0].text, /Day off/); assert.match(D.briefing(s0, new Date(2026, 10, 5, 9))[0].text, /after a night/); });
await t('a working day with no hours in the legend (Riyadh Season) is work, never "Day off", and never crashes', () => {
  const g2 = { ...gp, people: [{ name: 'Dr Me', id: '1', days: { 9: 'Riyadh Season' } }] }, s1 = { ...s0, rotas: { gp: g2 } };
  const b = D.briefing(s1, new Date(2026, 10, 9, 7)); assert.match(b[0].text, /Riyadh Season: a working day/); const w = D.windDown(s1, new Date(2026, 10, 8, 21)); assert.ok(!w.work); assert.match(w.label, /no hours in the rota/);
});
await t('wind-down: sleep time = shift start − getting-ready time − sleep target; days off need no alarm', () => {
  const w = D.windDown(s0, new Date(2026, 10, 9, 21)); assert.ok(w.work && w.night, 'the 10th is a night shift'); assert.equal(w.wake, 20 * 60 - 90); assert.equal(w.bed, 20 * 60 - 90 - 8 * 60); const e = D.windDown(s0, new Date(2026, 10, 13, 21)); assert.ok(e.work && !e.night); assert.equal(e.wake, 8 * 60 - 90); assert.equal(e.bed, 1350); assert.ok(e.bedPrevDay, 'asleep before midnight is the evening before');
  const off = D.windDown(s0, new Date(2026, 10, 4, 21)); assert.ok(!off.work); assert.match(off.label, /no alarm/);
  const n = D.windDown({ ...s0, settings: { day: { sleepH: 7, prepMin: 60 } } }, new Date(2026, 10, 2, 21)); assert.ok(n.night); assert.equal(n.wake, 20 * 60 - 60); assert.match(n.notes.join(), /Night shift/);
});
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
