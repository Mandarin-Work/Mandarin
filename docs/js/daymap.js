// One day as busy intervals (pure): the shift with commute and getting ready, sleep (pulled forward before an early start,
// recovery after a night, a nap before the first night), calendar events and the blocks Citrus planned. Drawn by the day dial.
// Taken from Citrus's planner when Mandarin split off; the planner itself stays in Citrus.
import { myDay, isNurseRota } from './model.js';
import { keyOf, addDays, startOfDay, fmtMin } from './util.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const PLANNER_DEFAULTS = { after12h: 'light', windDownMin: 60, breakMin: 15, napBeforeNight: true, recoveryWeekHours: 48 };
const R = (rules) => ({ ...PLANNER_DEFAULTS, ...(rules || {}) });
const floor15 = (m) => Math.floor(m / 15) * 15;
const memo = (cache, k, f) => { if (!cache) return f(); if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const myDayC = (state, date, cache) => memo(cache, 'my:' + keyOf(date), () => myDay(state, date));

// Shift hours, with a safe guess when the legend has none (an unknown code is still a working day).
function hoursOf(shift) {
  const h = shift?.hours;
  if (!h) return { start: 8 * 60, end: 17 * 60, overnight: false, durationMin: 540, guessed: true };
  return { ...h, durationMin: h.durationMin || (h.overnight ? h.end + 1440 - h.start : h.end - h.start) };
}
const isLong = (shift) => hoursOf(shift).durationMin >= 10 * 60;

// ---- what kind of day this is for a doctor ----
// mode: unknown | free | recovery | day | long-day | post-night | night-first | between-nights
export function dayProfile(state, date, cache = null) {
  return memo(cache, 'prof:' + keyOf(date), () => {
    const rules = R(state.rules);
    const md = myDayC(state, date, cache);
    const today = md.today, th = today ? hoursOf(today.shift) : null;
    const nightTonight = !!th?.overnight, afterNight = !!md.overnightTail;
    // A month with no doctors' rota (while other months have one) is unknown, not free: don't fill it with study.
    const hasDocRota = Object.values(state.rotas || {}).some(r => !isNurseRota(r));
    if (hasDocRota && !md.info.rotas.some(r => !isNurseRota(r))) return { mode: 'unknown', label: `no ${MONTHS[date.getMonth()]} rota yet`, weekMin: 0 };
    // last 7 days of work, and the run of long shifts that ended yesterday
    let weekMin = 0, longRun = 0, running = true;
    for (let i = 1; i <= 7; i++) {
      const t = myDayC(state, addDays(date, -i), cache).today;
      if (t) weekMin += hoursOf(t.shift).durationMin;
      if (running) { if (t && isLong(t.shift)) longRun++; else if (!(i === 1 && afterNight)) running = false; }
    }
    const prev = myDayC(state, addDays(date, -1), cache);
    let mode;
    if (nightTonight) mode = afterNight ? 'between-nights' : 'night-first';
    else if (today) mode = isLong(today.shift) ? 'long-day' : 'day';
    else if (afterNight) mode = 'post-night';
    else if ((prev.today || prev.afterNight) && (weekMin > rules.recoveryWeekHours * 60 || longRun >= 3)) mode = 'recovery';
    else mode = 'free';
    if (mode === 'long-day' && rules.after12h === 'normal') mode = 'day';
    const h = Math.round(weekMin / 60);
    const label = {
      free: 'free day', day: `around your ${today?.shift.label.split(' · ')[0].toLowerCase()} shift`,
      'long-day': rules.after12h === 'rest' ? 'after a 12h shift — evening kept for rest' : 'after a 12h shift — one light item, last hour before bed kept free',
      'post-night': 'after your night — slept until mid-afternoon, kept light',
      'night-first': 'first night tonight — light morning, nap in the afternoon',
      'between-nights': 'between nights — only habit-sized items',
      recovery: longRun >= 3 && weekMin <= rules.recoveryWeekHours * 60 ? `recovery day after ${longRun} long shifts in a row` : `recovery day after a ${h}h week`,
    }[mode];
    return { mode, label, weekMin, longRun, nightTonight, afterNight, today, hours: th };
  });
}

// ---- busy intervals for one day (minutes from local midnight, may exceed 1440 for overnight) ----
export function dayBusy(state, date, events = [], planBlocks = [], cache = null) {
  const rules = R(state.rules);
  const { today, overnightTail, afterNight } = myDayC(state, date, cache);
  const profile = dayProfile(state, date, cache);
  const busy = [];
  const add = (s, e, label, kind, extra = {}) => { if (e > s) busy.push({ start: s, end: e, label, kind, ...extra }); };

  // overnight shift ending this morning + recovery sleep until mid-afternoon
  if (overnightTail) {
    const endMin = hoursOf(overnightTail.shift).end;
    const home = endMin + commuteFor(rules, overnightTail.shift.site) + rules.postShiftBufferMin;
    add(0, home, `${overnightTail.shift.label} (ends ${fmtMin(endMin)})`, 'shift');
    add(home, Math.max(home, rules.postNightRecoveryUntil), 'Recovery sleep after night', 'sleep');
  }
  let leave = null;
  if (today) {
    const h = hoursOf(today.shift);
    const commute = commuteFor(rules, today.shift.site);
    leave = h.start - commute - rules.preShiftBufferMin;
    const e = h.overnight ? 1440 : h.end + commute + rules.postShiftBufferMin;
    add(Math.max(0, leave), Math.min(1440, e), today.shift.label, 'shift');
  }
  // lights-out: an early start tomorrow pulls bedtime forward (wake − sleep lands before midnight)
  const tomorrow = myDayC(state, addDays(date, 1), cache);
  let lightsOut = rules.sleepStart;
  if (tomorrow.today && !hoursOf(tomorrow.today.shift).overnight) {
    const wake = hoursOf(tomorrow.today.shift).start - commuteFor(rules, tomorrow.today.shift.site) - rules.preShiftBufferMin;
    const bed = wake - Math.round(rules.sleepHours * 60);
    if (bed < 0) lightsOut = Math.min(rules.sleepStart, bed + 1440);
  }
  const nightTonight = !!(today && hoursOf(today.shift).overnight);
  if (!nightTonight) {
    add(lightsOut, 1440, 'Sleep', 'sleep');
    // wind-down: after work the last hour stays free; on a day off half of it
    const wd = today || afterNight ? rules.windDownMin : Math.round(rules.windDownMin / 2);
    add(lightsOut - wd, lightsOut, 'Wind down', 'sleep', { rest: 'winddown' });
  }
  if (!overnightTail) add(0, rules.wakeMin, 'Sleep', 'sleep');

  // doctor rest windows (kind 'sleep' so the dial draws them as rest; `rest` tells the Plan view what they are)
  const rest = [];
  if (profile.mode === 'night-first' && rules.napBeforeNight && leave != null) {
    const napEnd = floor15(leave - 60), napStart = Math.max(13 * 60, napEnd - 210);
    if (napEnd - napStart >= 60) { rest.push({ start: napStart, end: napEnd, label: 'Nap before night', rest: 'nap' }); rest.push({ start: napEnd, end: leave, label: 'Wake up and eat before the night', rest: 'eat' }); }
  }
  if (profile.mode === 'between-nights' && leave != null) rest.push({ start: Math.max(rules.postNightRecoveryUntil, floor15(leave - 60)), end: leave, label: 'Rest and eat before the night', rest: 'eat' });
  if (profile.mode === 'recovery') rest.push({ start: rules.earliestPlan, end: Math.max(rules.earliestPlan, 11 * 60), label: 'Slow morning — recovery', rest: 'recovery' });
  for (const r of rest) add(r.start, r.end, r.label, 'sleep', { rest: r.rest });


  // calendar events
  for (const ev of events) {
    if (ev.allDay) continue;
    const s0 = startOfDay(date).getTime();
    const s = Math.max(0, Math.round((ev.start - s0) / 60000)), e = Math.min(1440, Math.round((ev.end - s0) / 60000));
    if (e > 0 && s < 1440) add(s, e, ev.title, 'event');
  }
  // blocks Citrus planned for this day (read from hub/citrus/plan.json; Mandarin never edits them)
  for (const p of planBlocks || []) if (Number.isFinite(p.start) && Number.isFinite(p.end)) add(p.start, p.end, p.title, 'plan', { app: p.app, color: p.color });

  busy.sort((a, b) => a.start - b.start);
  return { busy, today, overnightTail, afterNight, profile, lightsOut, leave, rest };
}

export function commuteFor(rules, site) {
  return rules.commute?.[site] ?? rules.commute?.default ?? 30;
}

