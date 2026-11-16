// Who you work with (pure): history across every loaded rota (your corrections included), favourite colleagues,
// and the evening-before look at tomorrow's team. Uses dayInfo, so a swap you recorded changes who you were with.
import { dayInfo, myDay, shiftWindow } from './model.js';
import { overlapModel } from './board.js';
import { keyOf, addDays, startOfDay } from './util.js';

export const pkey = (p) => p.id ? `id:${p.id}` : `name:${String(p.name).toLowerCase()}`;
export const isFav = (s, key) => !!s.favs?.[key];
export function toggleFav(s, key) {
  const m = { ...(s.favs || {}) };
  if (m[key]) { delete m[key]; return { ...s, favs: m, deleted: { ...(s.deleted || {}), [`fav:${key}`]: Date.now() } }; }
  m[key] = { at: Date.now() }; const del = { ...(s.deleted || {}) }; delete del[`fav:${key}`];
  return { ...s, favs: m, deleted: del };
}

/** Every day of every loaded month where you work, with the colleagues who share at least half of your shift at your site. */
function myWorkDays(s) {
  const months = new Set(Object.values(s.rotas || {}).filter(r => r.unitKind === 'gp').map(r => `${r.year}-${r.month}`)), out = [];
  for (const mk of months) {
    const [y, m] = mk.split('-').map(Number), n = new Date(y, m, 0).getDate();
    for (let d = 1; d <= n; d++) {
      const date = new Date(y, m - 1, d), info = dayInfo(s, date);
      if (!info.mine || info.mine.shift.kind !== 'work') continue;
      const ov = overlapModel(info.mine, [...info.withMe, ...info.alsoAtSite]);
      const people = (ov?.rows || []).filter(r => r.pct >= 0.5).map(r => r.entry.person);
      const w = shiftWindow(date, info.mine.shift);
      out.push({ date, key: keyOf(date), end: w ? w.end : addDays(date, 1), code: info.mine.code, site: info.mine.shift.site || '', type: info.mine.shift.type || '', people });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

/** Colleagues by how often you share a shift: [{key, name, n, past, next (Date|null), last (Date|null), nights, fav}] most first. */
export function history(s, now = new Date()) {
  const by = new Map();
  for (const d of myWorkDays(s)) for (const p of d.people) {
    const k = pkey(p), x = by.get(k) || { key: k, name: p.name, n: 0, past: 0, nights: 0, last: null, next: null, sites: {} };
    x.n++; if (d.type === 'N') x.nights++; x.sites[d.site] = (x.sites[d.site] || 0) + 1;
    if (d.end <= now) { x.past++; x.last = d.date; } else if (!x.next) x.next = d.date;   // a shift together that has ended is past, even today (beta T3-13)
    by.set(k, x);
  }
  return [...by.values()].map(x => ({ ...x, fav: isFav(s, x.key), site: Object.entries(x.sites).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }))
    .sort((a, b) => (b.fav - a.fav) || b.n - a.n || a.name.localeCompare(b.name));
}
/** The next shifts you share with one colleague (up to `max`). */
export function nextWith(s, key, now = new Date(), max = 6) {
  return myWorkDays(s).filter(d => d.end > now && d.people.some(p => pkey(p) === key)).slice(0, max);
}
/** Every day you share a shift with one colleague (date keys), past and coming: the one definition all screens use (beta T3-04). */
export const daysWith = (s, key) => new Set(myWorkDays(s).filter(d => d.people.some(p => pkey(p) === key)).map(d => d.key));
/** Your coming shifts with a favourite on them: the good news line. */
export function favShifts(s, now = new Date(), days = 14) {
  const t = keyOf(now), end = keyOf(addDays(startOfDay(now), days));
  return myWorkDays(s).filter(d => d.key >= t && d.key <= end).map(d => ({ ...d, favs: d.people.filter(p => isFav(s, pkey(p))) })).filter(d => d.favs.length);
}

/**
 * The evening before a shift (from 16:00), or the morning before a night: who you will be with.
 * → {date, entry, doctors:[{person, sameShift, from, to}], favs:[person], specialists:[entry], alone} or null.
 */
export function tomorrowTeam(s, now = new Date()) {
  const hr = now.getHours(), today = startOfDay(now), mdT = myDay(s, today);
  // a night tonight that has not started: show it in the day; otherwise tomorrow's shift from 16:00
  let date = null, md = null;
  if (mdT.today && mdT.today.shift.type === 'N' && now < mdT.today.window.start && hr >= 9) { date = today; md = mdT; }
  else if (hr >= 16) { const t = addDays(today, 1), m = myDay(s, t); if (m.today) { date = t; md = m; } }
  if (!date) return null;
  const info = md.info, mine = info.mine, ov = overlapModel(mine, [...info.withMe, ...info.alsoAtSite]);
  const same = new Set(info.withMe.map(e => pkey(e.person)));
  const doctors = (ov?.rows || []).filter(r => r.pct >= 0.25).map(r => ({ person: r.entry.person, sameShift: same.has(pkey(r.entry.person)), pct: r.pct, code: r.entry.code }));
  const site = mine.shift.site || '', kind = /upper/i.test(site) ? 'uv' : /lower/i.test(site) ? 'lv' : '';
  const specOv = (list) => (overlapModel(mine, list)?.rows || []).map(r => r.entry);
  let specialists = kind ? specOv(info[kind]) : []; if (!specialists.length) specialists = specOv(info.fsed);
  return { date, entry: md.today, doctors, favs: doctors.filter(d => isFav(s, pkey(d.person))).map(d => d.person), specialists, alone: !doctors.length, tonight: date === today };
}
