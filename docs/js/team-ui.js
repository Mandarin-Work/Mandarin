// Team: everyone in your schedules (directory and roster grid, from people-ui.js) and who you work with: how often, when next,
// and your favourite colleagues. Logic in team.js.
import { h, relDay, fmtDateShort } from './util.js';
import * as PU from './people-ui.js';
import * as T from './team.js';
import { allPeople } from './model.js';

let ctx = null, part = 'people';
export function initTeam(c) { ctx = c; }
export function teamPart(p) { if (['people', 'with'].includes(p)) part = p; }
const S = () => ctx.S();
const bare = (n) => String(n || '').replace(/^Dr\.?\s*/i, '');

export function renderTeam({ compact = false } = {}) {
  if (compact) { const c = withCard(true); return c ? [c] : []; }
  const seg = h('div', { class: 'seg view-mode', role: 'tablist' }, [['people', 'Everyone'], ['with', 'Who I work with']].map(([k, l]) => h('button', { class: part === k ? 'active' : '', role: 'tab', 'aria-selected': part === k ? 'true' : 'false', onClick: () => { part = k; ctx.render(); } }, l)));
  return [h('h1', {}, 'Team'), seg, ...[part === 'with' ? withView() : PU.renderDirectory()].flat()];
}
function personByKey(key) { return allPeople(S()).find(p => p.key === key); }
function row(x) {
  const p = personByKey(x.key) || { name: x.name, id: x.key.startsWith('id:') ? x.key.slice(3) : '' };
  return h('div', { class: 'item clickable tw-row', onClick: () => ctx.personSheet(p) },
    h('button', { class: `fav-star ${x.fav ? 'on' : ''}`, 'aria-pressed': x.fav ? 'true' : 'false', 'aria-label': `${x.fav ? 'Unstar' : 'Star'} ${x.name}`, onClick: (e) => { e.stopPropagation(); ctx.update(s => T.toggleFav(s, x.key)); } }, x.fav ? '⭐' : '☆'),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, bare(x.name)), h('div', { class: 'meta' }, [`${x.n} shift${x.n === 1 ? '' : 's'} together`, x.nights ? `${x.nights} night${x.nights === 1 ? '' : 's'}` : '', x.site ? `mostly ${x.site.replace(/ office clinic.*/i, ' clinic')}` : ''].filter(Boolean).join(' · '))),
    x.next ? h('span', { class: 'chip' }, `next ${relDay(x.next) === fmtDateShort(x.next) ? fmtDateShort(x.next) : relDay(x.next).toLowerCase()}`) : h('span', { class: 'tiny dim' }, 'none coming'));
}
function withCard(compact) {
  const s = S(); if (!s.me) return null;
  const list = T.history(s); if (!list.length) return null;
  const favs = list.filter(x => x.fav), top = compact ? [...favs, ...list.filter(x => !x.fav)].slice(0, 6) : list;
  return h('div', { class: 'card tw-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, compact ? 'Who you work with' : `Colleagues you share shifts with (${list.length})`), compact ? h('button', { class: 'btn sm ghost', onClick: () => { part = 'with'; ctx.go('team'); } }, 'All') : null),
    h('div', { class: 'list' }, top.map(row)),
    !compact && !favs.length ? h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'Tap ☆ to star the colleagues you like working with: they lead every list, show on Today, and the evening before a shift Mandarin tells you when they are on.') : null);
}
function withView() {
  const s = S();
  if (!s.me) return h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Pick your row in Settings › Me first.'));
  const card = withCard(false); if (!card) return h('div', { class: 'card' }, h('div', { class: 'empty' }, 'Import the GP rota to see who you work with.'), h('div', { class: 'row', style: { justifyContent: 'center' } }, ctx.importButton('Import rota files')));
  const coming = T.favShifts(s, new Date(), 28);
  return [h('div', { class: 'cols' }, h('div', {}, card), h('div', {}, coming.length ? h('div', { class: 'card' }, h('div', { class: 'title' }, '⭐ Coming shifts with your favourites'), h('div', { class: 'list' }, coming.map(d => h('button', { class: 'item clickable', onClick: () => ctx.openDay(d.date) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, `${relDay(d.date)} · ${d.code}`), h('div', { class: 'meta' }, d.favs.map(p => bare(p.name).split(' ')[0]).join(', '))), h('span', { class: 'chip' }, d.site.replace(/ office clinic.*/i, ' clinic')))))) : null))];
}
