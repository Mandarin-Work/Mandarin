// Month: one month of work at a glance. The report and the labour-law check, leave, every swap, cover and correction with
// who owes whom, and the after-shift log in numbers. Logic in plans.js, labor.js, swaplog.js and shiftlog.js.
import { h, toast, fromKey, fmtDateShort, MONTHS } from './util.js';
import { monthSummary } from './model.js';
import * as XU from './plans-ui.js';
import * as LU from './labor-ui.js';
import * as CHU from './changes-ui.js';
import * as SW from './swaplog.js';
import * as SL from './shiftlog.js';
import { logSheet } from './daily-ui.js';

let ctx = null, part = 'overview', month = null;
export function initMonth(c) { ctx = c; }
export function monthPart(p) { if (['overview', 'swaps', 'log'].includes(p)) part = p; }
const S = () => ctx.S();
const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, l));

export function renderMonth() {
  const now = new Date(); if (!month) month = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = month.getFullYear(), mo = month.getMonth() + 1, s = S();
  const head = h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('button', { class: 'btn icon', 'aria-label': 'Previous month', onClick: () => { month = new Date(y, mo - 2, 1); ctx.render(); } }, '‹'),
    h('h2', { class: 'grow', style: { textAlign: 'center', fontSize: '20px', margin: 0 } }, `${MONTHS[mo - 1]} ${y}`),
    h('button', { class: 'btn icon', 'aria-label': 'Next month', onClick: () => { month = new Date(y, mo, 1); ctx.render(); } }, '›'));
  const seg = h('div', { class: 'seg view-mode', role: 'tablist' }, [['overview', 'Overview'], ['swaps', 'Swaps & covers'], ['log', 'Shift log']].map(([k, l]) => h('button', { class: part === k ? 'active' : '', role: 'tab', 'aria-selected': part === k ? 'true' : 'false', onClick: () => { part = k; ctx.render(); } }, l)));
  const body = part === 'swaps' ? swaps(s, y, mo) : part === 'log' ? log(s, y, mo) : overview(s, y, mo);
  return [h('h1', {}, 'Month'), head, seg, ...[body].flat()];
}

function overview(s, y, mo) {
  if (!s.me) return h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Pick your row in Settings › Me to see your month.'));
  const loaded = Object.values(s.rotas).some(r => r.year === y && r.month === mo && r.unitKind === 'gp');
  const left = [], right = [];
  if (!loaded) left.push(h('div', { class: 'card' }, h('div', { class: 'small muted' }, `No GP rota for ${MONTHS[mo - 1]} ${y} yet. Leave you plan still shows here once the rota arrives.`)));
  const report = loaded ? XU.monthCard(y, mo) : null;
  if (report) left.push(report);
  else if (loaded) { const m = monthSummary(s, y, mo); left.push(h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your month'), h('div', { class: 'grid2' }, stat(m.work, 'shifts'), stat(m.nights, 'nights'), stat(`${m.hours}h`, 'rostered'), stat(m.off, 'days off')))); }
  if (loaded) { const lc = LU.laborCard(y, mo); if (lc) left.push(lc); }
  const c = SW.monthCounts(s, y, mo), n = Object.values(c).reduce((a, b) => a + b, 0), st = SL.monthStats(s, y, mo);
  if (!report) right.push(h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Leave'), h('button', { class: 'btn sm primary', onClick: () => XU.leaveSheet() }, '🌴 Plan leave')), h('div', { class: 'small muted' }, 'Finds the windows that cost the fewest shifts, checks the notice and the labour-law rest, and pencils the days in (you can undo).')));
  right.push(h('button', { class: 'card clickable mo-tile', onClick: () => { part = 'swaps'; ctx.render(); } }, h('div', { class: 'title' }, 'Swaps & covers'), h('div', { class: 'small' }, n ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${SW.KIND_LABEL[k].toLowerCase()}`).join(' · ') : 'None this month')));
  right.push(h('button', { class: 'card clickable mo-tile', onClick: () => { part = 'log'; ctx.render(); } }, h('div', { class: 'title' }, 'Shift log'), h('div', { class: 'small' }, st.rated ? `${st.rated} shifts rated · average ${st.avg}/5 ${SL.FACES[Math.round(st.avg) - 1] || ''}` : 'Nothing logged this month')));
  const uc = CHU.updatesCard(); if (uc) right.push(uc);
  return [h('div', { class: 'cols' }, h('div', {}, ...left), h('div', {}, ...right))];
}

function swaps(s, y, mo) {
  const p = `${y}-${String(mo).padStart(2, '0')}`, all = SW.list(s), mine = all.filter(x => x.key.startsWith(p)), bal = SW.balances(s);
  const row = (x) => h('button', { class: 'item clickable sw-row', onClick: () => ctx.openDay(x.date) }, h('span', { class: `chip sw-k ${x.kind}` }, SW.KIND_LABEL[x.kind]),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, fmtDateShort(x.date), x.raw !== null ? h('span', { class: 'dim' }, ` · rota ${x.raw || 'off'} → ${x.code || 'off'}`) : h('span', { class: 'dim' }, ` · ${x.code || 'off'}`)), x.with || x.note ? h('div', { class: 'meta' }, [x.with, x.note].filter(Boolean).join(' · ')) : null));
  const balCard = bal.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Who owes whom'), h('div', { class: 'list' }, bal.slice(0, 12).map(b => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, b.name), h('div', { class: 'meta' }, [b.gave ? `you covered ${b.gave}` : '', b.got ? `they covered ${b.got}` : '', b.swaps ? `${b.swaps} swap${b.swaps > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '))),
    b.balance ? h('span', { class: `chip ${b.balance > 0 ? 'sel' : 'warnc'}` }, b.balance > 0 ? `owes you ${b.balance}` : `you owe ${-b.balance}`) : h('span', { class: 'chip' }, 'even')))), h('div', { class: 'tiny dim' }, 'Counts come from "What happened" when you correct a day: I covered, Covered for me, Swap.')) : null;
  return [h('div', { class: 'cols' }, h('div', {}, h('div', { class: 'card' }, h('div', { class: 'title' }, `${MONTHS[mo - 1]}: ${mine.length} correction${mine.length === 1 ? '' : 's'}`),
      mine.length ? h('div', { class: 'list' }, mine.map(row)) : h('div', { class: 'small muted' }, 'No swaps, covers or corrections this month. Open a day in the calendar and tap “Correct this day”.'))),
    h('div', {}, balCard, all.length > mine.length ? h('details', { class: 'card' }, h('summary', { class: 'title' }, `All months (${all.length})`), h('div', { class: 'list' }, all.slice(0, 80).map(row))) : null))];
}

function log(s, y, mo) {
  const st = SL.monthStats(s, y, mo), p = `${y}-${String(mo).padStart(2, '0')}`, todo = SL.unlogged(s, new Date(), 7).filter(x => x.key.startsWith(p));
  const bars = (o, lab) => { const e = Object.entries(o); if (!e.length) return null; return h('div', { class: 'card' }, h('div', { class: 'title' }, lab), e.sort((a, b) => b[1].avg - a[1].avg).map(([k, v]) => h('div', { class: 'sl-bar' }, h('span', { class: 'grow small' }, k === 'N' ? 'Nights' : k === 'D' ? 'Days' : k === 'E' ? 'Evenings' : k), h('span', { class: 'bar' }, h('i', { style: { width: `${v.avg / 5 * 100}%` } })), h('b', { class: 'small' }, `${v.avg}`), h('span', { class: 'tiny dim' }, ` ×${v.n}`)))); };
  const head = h('div', { class: 'card' }, h('div', { class: 'title' }, 'Shift log'), h('div', { class: 'grid2' }, stat(st.rated ? `${st.avg}/5` : '–', `average of ${st.rated} rated`), stat(st.totals.seen || '–', 'patients seen'), stat(st.totals.transfers || '–', 'transfers'), stat(st.totals.referrals || '–', 'referrals')),
    todo.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, todo.map(x => h('button', { class: 'chip', onClick: () => logSheet(x.key) }, `＋ ${fmtDateShort(x.date)} ${x.entry.code}`))) : null,
    h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'Counts only: no names, file numbers or anything that identifies a patient.'));
  const ppl = st.withPeople.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Your best-rated shifts were with'), st.withPeople.map(x => h('div', { class: 'sl-bar' }, h('span', { class: 'grow small' }, x.name.replace(/^Dr\.?\s*/i, '')), h('span', { class: 'bar' }, h('i', { style: { width: `${x.avg / 5 * 100}%` } })), h('b', { class: 'small' }, `${x.avg}`), h('span', { class: 'tiny dim' }, ` ×${x.n}`))), h('div', { class: 'tiny dim' }, 'Colleagues with two or more rated shifts together this month.')) : null;
  const notes = st.notes.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, 'Notes'), st.notes.map(n => h('button', { class: 'item clickable', onClick: () => logSheet(n.key) }, h('span', {}, n.rating ? SL.FACES[n.rating - 1] : '·'), h('div', { class: 'grow' }, h('div', { class: 'meta' }, fmtDateShort(fromKey(n.key))), h('div', { class: 'small' }, n.note))))) : null;
  if (!st.logged && !todo.length) return h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Nothing logged this month'), h('div', { class: 'small muted' }, 'After each shift, Today asks how it went: one tap, with optional counts and a note.'));
  return [h('div', { class: 'cols' }, h('div', {}, head, bars(st.byType, 'By shift'), bars(st.bySite, 'By site')), h('div', {}, ppl, notes))];
}
