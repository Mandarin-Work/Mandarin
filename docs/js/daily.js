// Today at work: morning briefing, evening wind-down (sleep before the next shift). Pure functions (no DOM).
// The after-shift log lives in shiftlog.js; study planning and mood belong to Citrus.
import { briefOn } from './custom.js';
import { keyOf, fromKey, addDays, startOfDay } from './util.js';
import { dayInfo, myDay } from './model.js';
import * as N from './nurses.js';
import * as T from './team.js';
import { dueSoon, WARN_DAYS, dueWords } from './creds.js';
import * as L from './labor.js';
import { currentJob, upcoming } from './career.js';
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const fn = (p) => p.name.replace(/^Dr\.?\s*/i, '').split(' ')[0];

export const DAY_DEFAULTS = { sleepH: 8, prepMin: 90 };
export const SLEEP_LIMITS = { sleepH: [4, 12], prepMin: [15, 240] };
export const daySettings = (s) => ({ ...DAY_DEFAULTS, ...(s.settings?.day || {}) });
/** A settings value the sheet can save, or null with the reason (no silent replacement, beta T01-10). */
export function checkSetting(k, raw) {
  const [lo, hi] = SLEEP_LIMITS[k], v = String(raw ?? '').trim() === '' ? NaN : +raw;
  if (!Number.isFinite(v)) return { ok: false, msg: `Enter a number from ${lo} to ${hi}` };
  if (v < lo || v > hi) return { ok: false, msg: `Must be ${lo}–${hi}` };
  return { ok: true, value: k === 'sleepH' ? Math.round(v * 2) / 2 : Math.round(v) };
}
/** "Day · Upper Village, 08:00–20:00" — but never the hours twice when the rota label already has them (beta T01-25). */
export const shiftLabel = (sh) => /\d\d?:\d\d/.test(sh.label) ? sh.label : `${sh.label}, ${hm(sh.hours.start)}–${hm(sh.hours.end)}`;
/** Before this hour the night is still "tonight": a 02:00 check plans for today's shift, not tomorrow's (beta T01-06). */
export const NIGHT_ENDS = 4;
/** Am I on a shift right now (today's, or the tail of last night's)? Returns its end, or null. */
export function onShiftNow(s, now = new Date()) {
  const md = myDay(s, startOfDay(now)), live = (w) => w && now >= w.start && now < w.end;
  if (live(md.today?.window)) return md.today.window.end; if (live(md.overnightTail?.window)) return md.overnightTail.window.end; return null;
}

/** What the day holds, in the order you would want to know it. */
export function briefing(s, now = new Date()) {
  const out = [], day = startOfDay(now), md = myDay(s, day), info = md.info, mine = info.mine, key = keyOf(day);
  if (md.today) { const w = md.today.shift; out.push({ icon: w.type === 'N' ? '🌙' : '🩺', text: `${shiftLabel(w)} (${Math.round(w.hours.durationMin / 60 * 10) / 10}h)${md.today.mci ? ' · MCI 2nd' : ''}` }); }
  else if (mine?.shift.kind === 'leave') out.push({ icon: '🌴', text: 'On leave today' });
  else if (md.noHours) out.push({ icon: '🩺', text: `${md.noHours.shift.label || md.noHours.code}: a working day with no hours in the rota` });
  else if (info.hasRota && mine) out.push({ icon: '☕', text: md.afterNight ? 'Off after a night, rest first' : 'Day off' });
  if (md.afterNight) { const e = md.overnightTail.window.end, t = hm(e.getHours() * 60 + e.getMinutes()); out.push({ icon: '🌙', text: now < e ? `Your night ends at ${t}` : `Your night ended at ${t}: rest first` }); }   // past tense once it is over (beta T1-13)
  if (info.withMe?.length) out.push({ icon: '👥', text: `With you: ${info.withMe.slice(0, 4).map(e => fn(e.person)).join(', ')}${info.withMe.length > 4 ? ` +${info.withMe.length - 4}` : ''}` });
  // During last night's tail (after midnight) the nurses with you are last night's, not tonight's (beta T04-07)
  if (md.overnightTail && now < md.overnightTail.window.end && N.nurseRotas(s).length) { const y = addDays(day, -1), t = nurseLine(N.workingWithMe(s, y, dayInfo(s, y).mine)); if (t) out.push({ icon: '💉', text: `Now: ${t.text}` }); }
  if (md.today && N.nurseRotas(s).length) { const t = nurseLine(N.workingWithMe(s, day, mine)); if (t) out.push({ icon: '💉', text: t.text }); if (t?.head) out.push({ icon: '🧭', text: t.head }); }
  if (md.today) { const fav = info.withMe.filter(e => T.isFav(s, T.pkey(e.person))).map(e => fn(e.person)); if (fav.length) out.push({ icon: '⭐', text: `Favourites on with you: ${fav.join(', ')}` }); }
  if (info.mci?.length && md.today && !md.today.mci) out.push({ icon: '🚨', text: `MCI 2nd today: ${info.mci.slice(0, 2).map(e => fn(e.person)).join(', ')}` });
  const cfg = L.settings(s), wk = new Date(day); wk.setDate(wk.getDate() - wk.getDay()); let mins = 0; for (const w of L.windows(s, wk, addDays(wk, 7))) { const a = Math.max(w.start, wk), b = Math.min(w.end, addDays(wk, 7)); if (b > a) mins += (b - a) / 60000; }
  // a week that runs into a month with no rota is "so far", never "N h before overtime" (beta T1-14)
  const unloaded = Array.from({ length: 7 }, (_, i) => addDays(wk, i)).filter(d => !dayInfo(s, d).hasRota).map(d => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]);
  const cap = cfg.weeklyH || L.LAW.weeklyH, h = Math.round(mins / 6) / 10; if (mins) out.push({ icon: '⏱', text: `${h}h rostered this week${h > cap ? `, ${Math.round((h - cap) * 10) / 10}h over the ${cap}h limit` : unloaded.length ? ` so far (${[...new Set(unloaded)].join(', ')} not loaded)` : `, ${Math.round((cap - h) * 10) / 10}h before overtime`}` });
  const job = currentJob(s); if (job) for (const k of upcoming(job, day, 14)) out.push({ icon: '📄', text: `${k.label} in ${k.days} days` });
  for (const c of dueSoon(s, day, WARN_DAYS)) out.push({ icon: '🪪', text: `${c.name} ${dueWords(c.days)}` });
  const ce = N.contractEnds(s, day, 7); if (ce.length) out.push({ icon: '📄', text: `Nurse contract ending: ${ce.slice(0, 2).map(c => fn(c)).join(', ')}` });
  // Settings › Customise › Briefing switches lines off; the shift line always stays
  const ID_OF = { '👥': 'team', '⭐': 'team', '🚨': 'team', '💉': 'nurses', '🧭': 'nurses', '⏱': 'hours', '📄': 'contract', '🪪': 'contract' };
  return out.filter(l => !ID_OF[l.icon] || briefOn(s, ID_OF[l.icon]));
}

/** One honest nurse line from nurses.workingWithMe (D03): "likely" only with posting history behind it; otherwise its shared summary. */
export function nurseLine(w) {
  if (!w?.hasNurses) return null; const names = (a) => a.slice(0, 3).map(r => fn(r.person)).join(', ') + (a.length > 3 ? ` +${a.length - 3}` : '');
  const heard = (w.tipped || []).filter(r => !r.guess), guessed = (w.tipped || []).filter(r => r.guess), likely = w.likely || [];
  const text = w.confirmed.length ? `Nurses posted with you: ${names(w.confirmed)}`
    : heard.length ? `Nurses heard to be with you: ${names(heard)}`
    : likely.length ? `Nurses likely with you: ${names(likely)}`
    : guessed.length ? `Nurses, guessed from last time: ${names(guessed)}`
    : w.summary ? `Nurses: ${w.summary}` : '';
  const head = w.head?.length ? `Head nurse on today: ${w.head.map(r => fn(r.person)).join(', ')}` : '';
  return text || head ? { text: text || head, head: text ? head : '' } : null;
}
/** What Copy / Share sends: the date, then exactly the lines on the card (beta T01-14). */
export function briefingText(lines, now = new Date()) {
  const d = startOfDay(now), title = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
  return [title, ...lines.map(l => `${l.icon} ${l.text}`)].join('\n');
}

/** Tonight: when to sleep for the next shift, using your sleep target and getting-ready time.
 *  "Next" is tomorrow in the evening, but today in the small hours (02:00 before an 08:00 start, beta T01-06).
 *  Times are minutes of the shift's day; `bed` < 0 in the raw maths means the evening before. */
export function windDown(s, now = new Date()) {
  const cfg = daySettings(s), todayMd = myDay(s, startOfDay(now));
  // tonight's own shift has not started yet (19:00 before a 20:00 night): that is the shift to get ready for, not tomorrow (beta T1-04)
  if (!(now.getHours() < NIGHT_ENDS) && todayMd.today && now < todayMd.today.window.start) {
    const sh0 = todayMd.today.shift, mins = Math.round((todayMd.today.window.start - now) / 60000);
    return { work: true, before: true, dayWord: 'Tonight', label: shiftLabel(sh0), night: true, start: sh0.hours.start, wake: sh0.hours.start - cfg.prepMin, bed: 0, minutesToBed: -1, sleepNow: false, sleepMin: 0, startsIn: mins, sleepH: cfg.sleepH,
      notes: [`Starts in ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ''}${mins % 60}m. Eat before you go; a short nap now still helps.`] };
  }
  const early = now.getHours() < NIGHT_ENDS, day = early ? startOfDay(now) : addDays(startOfDay(now), 1), md = myDay(s, day), sh = md.today?.shift;
  const dayWord = early ? 'Today' : 'Tomorrow';
  if (!sh) return { work: false, dayWord, label: md.info.mine?.shift.kind === 'leave' ? 'On leave, no alarm needed' : md.noHours ? `${md.noHours.shift.label || md.noHours.code} (no hours in the rota: set your own alarm)` : md.info.hasRota && md.info.mine ? 'Day off, no alarm needed' : '', notes: [] };
  const start = sh.hours.start, wake = start - cfg.prepMin, night = sh.type === 'N' || start >= 17 * 60, bed = wake - cfg.sleepH * 60;
  // minutes from now until bedtime, counted on one clock: the evening before the shift's day is −1440…0 (beta T01-09)
  const nowMin = now.getHours() * 60 + now.getMinutes() - (early ? 0 : 1440), toBed = bed - nowMin, toWake = wake - nowMin;
  // past bedtime already (small hours, or a late evening before an early start): say how much sleep is still possible
  const sleepNow = !night && toBed <= 0 && toWake > 0;
  // the evening before a night: sleep normally tonight, nap in the afternoon before the start (beta T1-20)
  const napEnd = start - cfg.prepMin, napStart = Math.max(13 * 60, napEnd - 180);
  const notes = []; if (night) notes.push(!early ? `Sleep as usual tonight. Tomorrow, nap about ${hm(napStart)}–${hm(napEnd)} and eat a proper meal before you start.` : 'Night shift: sleep in the morning, keep the room dark, and eat a proper meal before you start.'); else if (start <= 8 * 60 && !sleepNow) notes.push('Early start: get things ready tonight.');
  return { work: true, dayWord, label: shiftLabel(sh), night, nightEve: night && !early, napStart, napEnd, start, wake, bed: ((bed % 1440) + 1440) % 1440, bedPrevDay: bed < 0, minutesToBed: Math.round(toBed), sleepNow, sleepMin: sleepNow ? Math.round(toWake) : 0, notes, sleepH: cfg.sleepH };
}

