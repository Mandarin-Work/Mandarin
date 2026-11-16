// What Mandarin tells the other apps (pure, no DOM). Two small files in My Apps/hub/mandarin:
//  - status.json  (HUB.md contract v2): the one-line summary, today, next, metrics, pending items and deep links Citrus shows.
//  - shifts.json  your shifts for the coming weeks and the roster by rota key, so Citrus, Clementine and Calamansi can plan
//                 around work without parsing rotas themselves. Mandarin is the only app that owns rota data.
// Neither file carries pay, contracts, phone numbers or anything about patients.
import { dayInfo, myDay } from './model.js';
import { interpretCode } from './rota-parser.js';
import { keyOf, addDays, startOfDay, fromKey } from './util.js';
import * as L from './labor.js';
import * as SL from './shiftlog.js';
import * as K from './creds.js';
import * as N from './nurses.js';

export const SITE_URL = 'https://mandarin-work.github.io/Mandarin/';
export const CONTRACT = 2;
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const fn = (name) => String(name || '').replace(/^Dr\.?\s*/i, '').split(/\s+/)[0] || '';

/** One day of yours as the other apps see it. null = no rota for that day (unknown, never "off"). */
export function dayOut(s, date) {
  const info = dayInfo(s, date), mine = info.mine;
  if (!mine) return info.hasRota && s.me ? { date: keyOf(date), kind: 'unknown' } : null;
  const sh = mine.shift, out = { date: keyOf(date), kind: sh.kind, code: mine.code || '' };
  if (sh.kind === 'work') {
    Object.assign(out, { label: sh.label, type: sh.type || '', site: sh.site || '' });
    if (sh.hours) Object.assign(out, { start: hm(sh.hours.start), end: hm(sh.hours.end), overnight: !!sh.hours.overnight, minutes: sh.hours.durationMin || 0 });
    if (mine.mci) out.mci = true;
    const team = info.withMe.map(e => fn(e.person.name)).filter(Boolean); if (team.length) out.with = team.slice(0, 8);
  } else if (sh.kind === 'leave') out.label = sh.label;
  if (mine.swap) out.corrected = true;
  return out;
}

/** shifts.json: your days from 7 days back to 42 ahead, plus who works when (by rota key) for the same window. */
export function buildShifts(s, now = new Date()) {
  const from = addDays(startOfDay(now), -7), days = [];
  for (let i = 0; i < 50; i++) { const d = dayOut(s, addDays(from, i)); if (d) days.push(d); }
  const roster = {}, first = keyOf(from), last = keyOf(addDays(from, 49));
  for (const r of Object.values(s.rotas || {})) {
    for (const p of r.people || []) {
      const key = p.id ? `id:${p.id}` : `name:${String(p.name).toLowerCase()}`;
      for (const [d, code] of Object.entries(p.days || {})) {
        const k = `${r.year}-${String(r.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`; if (k < first || k > last || !code) continue;
        const row = (roster[key] ||= { name: p.name, unit: r.unitKind, days: {} }); row.days[k] = String(code).slice(0, 24);
      }
    }
  }
  const legend = {};
  for (const r of Object.values(s.rotas || {})) if (r.unitKind === 'gp') for (const code of Object.keys(r.legend || {})) { if (legend[code]) continue; const sh = interpretCode(code, r.legend, r.unitKind); if (sh.kind === 'work' && sh.hours) legend[code] = { label: sh.label, site: sh.site || '', type: sh.type || '', start: hm(sh.hours.start), end: hm(sh.hours.end) }; }
  return { app: 'mandarin', contract: CONTRACT, updatedAt: now.toISOString(), me: s.me ? { name: s.me.name, key: s.me.id ? `id:${s.me.id}` : `name:${String(s.me.name).toLowerCase()}` } : null, days, roster, legend };
}

/** "D1 Upper Village 08:00–20:00" */
const shiftWords = (d) => d.kind === 'work' ? `${d.code}${d.site ? ' ' + d.site.replace(/ office clinic.*$/i, ' clinic') : ''}${d.start ? ` ${d.start}–${d.end}` : ''}` : d.kind === 'leave' ? (d.label || 'leave') : 'off';

/** status.json for Citrus (HUB.md v2). `extra`: things only the app knows at run time (pending inbox count…). */
export function buildStatus(s, now = new Date(), extra = {}) {
  const today = dayOut(s, startOfDay(now)), tmr = dayOut(s, addDays(startOfDay(now), 1)), md = myDay(s, startOfDay(now));
  const tail = md.overnightTail && now < md.overnightTail.window.end ? md.overnightTail : null;
  const bits = [];
  if (tail) bits.push(`on ${tail.code} until ${hm(tail.window.end.getHours() * 60 + tail.window.end.getMinutes())}`);
  if (today) bits.push(`today ${shiftWords(today)}`); else if (!s.me) bits.push('pick your row in Mandarin'); else bits.push('no rota for today');
  if (tmr) bits.push(`tomorrow ${shiftWords(tmr)}`);
  // this Sunday–Saturday week against the weekly limit
  const ws = addDays(startOfDay(now), -startOfDay(now).getDay()), we = addDays(ws, 7); let mins = 0;
  for (const w of L.windows(s, ws, we)) mins += Math.max(0, Math.min(w.end, we) - Math.max(w.start, ws)) / 60000;
  const cap = L.settings(s).weeklyH || 48, weekH = Math.round(mins / 6) / 10;
  // nights this month, shifts left this month
  let nights = 0, left = 0; const y = now.getFullYear(), m = now.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) { const x = dayOut(s, new Date(y, m, d)); if (x?.kind === 'work') { if (x.type === 'N') nights++; if (x.date >= keyOf(now)) left++; } }
  const pending = [], inbox = [];
  const unlogged = SL.unlogged(s, now, 3); if (unlogged.length) pending.push(`${unlogged.length} shift${unlogged.length > 1 ? 's' : ''} to log`);
  for (const c of K.dueSoon(s, now, 45)) pending.push(`${c.name} ${c.days < 0 ? 'expired' : `expires in ${c.days} d`}`);
  if (extra.unposted) pending.push(`${extra.unposted} nurses not posted for tomorrow`);
  if (extra.inbox) pending.push(`${extra.inbox} proposal${extra.inbox > 1 ? 's' : ''} waiting in Mandarin`);
  if (extra.nextMonthMissing) pending.push(`${extra.nextMonthMissing} rota not loaded yet`);
  const next = tail ? { title: `Finish ${tail.code}`, minutes: Math.max(0, Math.round((tail.window.end - now) / 60000)) }
    : today?.kind === 'work' && md.today && now < md.today.window.end ? { title: `${today.code} ${today.site || ''}`.trim(), minutes: today.minutes || 0, at: md.today.window.start.toISOString() }
    : tmr?.kind === 'work' ? { title: `Tomorrow ${tmr.code} ${tmr.site || ''}`.trim(), minutes: tmr.minutes || 0 } : null;
  const metrics = [
    { key: 'week-hours', label: 'Rostered this week', value: weekH, goal: cap, unit: 'h', date: keyOf(now) },
    { key: 'nights-month', label: 'Nights this month', value: nights, unit: 'nights', date: keyOf(now) },
    { key: 'shifts-left', label: 'Shifts left this month', value: left, unit: 'shifts', date: keyOf(now) },
  ];
  const avg = SL.monthAverage(s, now); if (avg) metrics.push({ key: 'shift-rating', label: 'Shift rating (month)', value: avg, goal: 5, unit: '/5', date: keyOf(now) });
  const base = SITE_URL;
  const actions = [
    { id: 'today', label: 'Today at work', url: `${base}#today`, icon: '🍊' },
    { id: 'calendar', label: 'Calendar', url: `${base}#calendar`, icon: '📅' },
    { id: 'nurses', label: 'Post nurses', url: `${base}#nurses`, icon: '💉', minutes: 5 },
    { id: 'log', label: 'Log last shift', url: `${base}#log`, icon: '📝', minutes: 2 },
  ];
  const doneToday = !today || today.kind !== 'work' || (md.today && now >= md.today.window.end && !!s.shiftLog?.[keyOf(now)]);
  return {
    app: 'mandarin', title: 'Mandarin', icon: '🍊', color: '#ff8a1f', url: base, contract: CONTRACT,
    updatedAt: now.toISOString(),
    summary: bits.join(' · ').slice(0, 140),
    today: { date: keyOf(now), done: !!doneToday },
    next, metrics, pending: pending.slice(0, 10), inbox, actions,
    extra: { weekHours: weekH, weekCap: cap, today, tomorrow: tmr, nurses: N.nurseRotas(s).length > 0 },
  };
}
