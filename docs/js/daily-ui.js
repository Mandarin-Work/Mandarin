// Today cards for work: the briefing (morning), Tonight (sleep before the next shift), the after-shift log, and
// tomorrow's team (the evening before a shift). The pure logic lives in daily.js, shiftlog.js and team.js.
import { h, toast, startOfDay, fromKey, fmtTime, DAY_SHORT, DAY_NAMES, MONTHS } from './util.js';
import * as D from './daily.js';
import * as SL from './shiftlog.js';
import * as T from './team.js';
let ctx = null;
export function initDaily(c) { ctx = c; }
const S = () => ctx.S(), field = (l, input) => { const id = input.id || (input.id = 'df-' + Math.random().toString(36).slice(2, 8)); return h('div', { class: 'field' }, h('label', { for: id }, l), input); };
const hm = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const fd = (k) => { const d = fromKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const fn = (p) => String(p.name || '').replace(/^Dr\.?\s*/i, '').split(' ')[0];

export function todayCards(now = new Date()) {
  const s = S(), out = [], hr = now.getHours(), onShift = D.onShiftNow(s, now);
  const b = D.briefing(s, now); if (b.length) out.push({ el: briefCard(b, hr >= D.NIGHT_ENDS && hr < 14, now), score: hr < D.NIGHT_ENDS ? 30 : hr < 12 ? 95 : hr < 18 ? 60 : 35, label: hr < 5 ? 'Overnight' : 'Briefing' });
  // Tonight is for the evening and the small hours, and steps back while a shift is running: you can't act on it then (beta T01-11)
  if (hr >= 18 || hr < D.NIGHT_ENDS) { const w = windCard(now, onShift); if (w) out.push({ el: w, score: onShift ? 28 : 90, label: 'Tonight' }); }
  const ask = SL.askNow(s, now); if (ask) out.push({ el: logCard(ask), score: now - ask.end < 3 * 3600000 ? 97 : 75, label: 'Shift log' });
  const tt = T.tomorrowTeam(s, now); if (tt) out.push({ el: teamCard(tt), score: tt.tonight ? 85 : 88, label: 'Tomorrow’s team' });
  return out.filter(x => x.el);
}

function briefCard(lines, open, now) {
  const hr = now.getHours(), text = () => D.briefingText(lines, now);
  const share = h('div', { class: 'row brief-acts' }, navigator.share ? h('button', { class: 'btn sm ghost', onClick: () => navigator.share({ title: 'Today', text: text() }).catch(() => {}) }, 'Share') : null, h('button', { class: 'btn sm ghost', onClick: async () => { try { await navigator.clipboard.writeText(text()); toast('Copied', 'ok'); } catch { toast('Could not copy', 'err'); } } }, 'Copy'));
  return h('details', { class: 'card brief2', open: open ? '' : null }, h('summary', {}, h('span', { class: 'title' }, hr < 5 ? 'Overnight' : hr < 12 ? 'Your morning' : 'Your day'), h('span', { class: 'tiny dim' }, `${lines.length} thing${lines.length === 1 ? '' : 's'}`)),
    lines.map(l => h('div', { class: 'row ch-line' }, h('span', { class: 'ch-ic sm' }, l.icon), h('div', { class: 'grow small' }, l.text))), share);
}
const dur = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;
function windCard(now, onShift) {
  const s = S(), w = D.windDown(s, now);
  if (!w.label) return null;
  const head = h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Tonight'), h('button', { class: 'btn sm ghost', 'aria-label': 'Sleep settings', onClick: sleepSheet }, '⚙'));
  // on shift: one quiet line instead of sleep advice you can't follow yet
  if (onShift) return h('div', { class: 'card wind' }, head, h('div', { class: 'small muted' }, `On shift until ${hm(onShift.getHours() * 60 + onShift.getMinutes())}. Your sleep plan shows when it ends.`));
  const plan = !w.work ? h('div', { class: 'small' }, `${w.dayWord}: ${w.label}`)
    : [h('div', { class: 'small' }, `${w.dayWord}: ${w.label}`),
      h('div', { class: `cr-key soon wind-key ${w.sleepNow ? 'now' : ''}` }, h('div', { class: 'grow' },
        h('b', {}, w.sleepNow ? `Sleep now: ${dur(w.sleepMin)} possible` : `${w.night ? 'Sleep until' : 'Be asleep by'} ${w.night ? hm(w.wake) : hm(w.bed)}`),
        h('div', { class: 'tiny dim' }, w.sleepNow ? `Up at ${hm(w.wake)} to be ready for ${hm(w.start)}` : `${w.sleepH}h of sleep, up at ${hm(w.wake)} to be ready for ${hm(w.start)}`)),
        !w.night && !w.sleepNow && w.minutesToBed > 0 && w.minutesToBed < 720 ? h('span', { class: 'chip' }, `in ${dur(w.minutesToBed)}`) : null)];
  return h('div', { class: 'card wind' }, head, plan, w.notes.map(n => h('div', { class: 'tiny dim wind-note' }, n)));
}
function sleepSheet() {
  const c = D.daySettings(S()), v = { sleepH: c.sleepH, prepMin: c.prepMin }, msgs = {}, save = h('button', { class: 'btn primary', onClick: () => {
    const r = Object.fromEntries(Object.keys(v).map(k => [k, D.checkSetting(k, v[k])])); if (!Object.values(r).every(x => x.ok)) return toast('Fix the highlighted value first', 'err');
    ctx.update(x => ({ ...x, settings: { ...x.settings, day: { sleepH: r.sleepH.value, prepMin: r.prepMin.value } } })); box.close(); ctx.render(); toast(`Saved · ${r.sleepH.value}h sleep, ${r.prepMin.value} min to get ready`, 'ok'); } }, 'Save');
  const check = () => { let ok = true; for (const k of Object.keys(v)) { const r = D.checkSetting(k, v[k]); ok &&= r.ok; msgs[k].textContent = r.ok ? '' : r.msg; msgs[k].previousElementSibling.setAttribute('aria-invalid', r.ok ? 'false' : 'true'); } save.disabled = !ok; };
  // labels are tied to their inputs (for/id) and every bad value says why, instead of being swapped silently (beta T01-10)
  const F = (k, label, unit, step) => { const [mn, mx] = D.SLEEP_LIMITS[k], id = `sl-${k}`; msgs[k] = h('div', { class: 'tiny field-err', id: `${id}-err`, 'aria-live': 'polite' });
    return h('div', { class: 'field' }, h('label', { for: id }, label, h('span', { class: 'dim' }, ` (${mn}–${mx} ${unit})`)), h('input', { id, type: 'number', inputmode: 'decimal', min: mn, max: mx, step, value: v[k], 'aria-describedby': `${id}-err`, onInput: (e) => { v[k] = e.target.value; check(); } }), msgs[k]); };
  const box = ctx.sheet([h('h2', {}, 'Sleep'), F('sleepH', 'Hours of sleep you aim for', 'h', 0.5), F('prepMin', 'Minutes to get ready before a shift', 'min', 5), h('div', { class: 'tiny dim' }, 'Bedtime = shift start − getting ready − sleep.'), save]);
}


// ───────── after-shift log: one tap for how it went, optional counts and a note
// Shifts rated from a card in this session keep their row, so a mis-tap can be changed (the old day rating's rule, beta T01-13).
const ratedHere = new Set();
export function faces(key, onDone) {
  const cur = SL.logOf(S(), key)?.rating || 0;
  return h('div', { class: 'rate-faces', role: 'group', 'aria-label': 'How was the shift?' }, SL.FACES.map((f, i) => h('button', { type: 'button', class: `rate-f ${cur === i + 1 ? 'sel' : ''}`, 'aria-label': `${i + 1} of 5`, 'aria-pressed': cur === i + 1 ? 'true' : 'false',
    onClick: () => { const before = SL.logOf(S(), key); ratedHere.add(key); ctx.update(x => SL.logShift(x, key, { rating: i + 1 })); toast(cur ? `Changed to ${f}` : `Saved ${f}`, 'ok', { action: { label: 'Undo', run: () => ctx.update(x => before ? { ...x, shiftLog: { ...x.shiftLog, [key]: before } } : SL.clearLog(x, key)) } }); onDone?.(); } }, f)));
}
function logCard(ask) {
  const e = ask.entry, label = `${e.code} · ${e.shift.label}`;
  return h('div', { class: 'card slog-card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'How was the shift?'), h('span', { class: 'tiny dim' }, `${fd(ask.key)} · ${label}`)),
    faces(ask.key), h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm ghost', onClick: () => logSheet(ask.key) }, '＋ Counts and a note'), h('span', { class: 'tiny dim grow', style: { textAlign: 'right' } }, 'Counts only, never patient details')));
}
/** The full log for one shift: rating, counts, note. */
export function logSheet(key) {
  const s = S(), cur = SL.logOf(s, key) || {}, v = { ...cur };
  const err = h('div', { class: 'tiny field-err', 'aria-live': 'polite' });
  const num = (k, l) => { const i = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: SL.MAX_COUNT, value: cur[k] ?? '', placeholder: '–', onInput: (e) => { v[k] = e.target.value; } }); return field(l, i); };
  const note = h('textarea', { rows: 3, maxlength: 280, placeholder: 'What made it good or hard? (no names, file numbers or IDs)', onInput: (e) => { v.note = e.target.value; const c = SL.checkNote(v.note); err.textContent = c.ok ? '' : c.msg; } }, cur.note || '');
  const day = fromKey(key);
  const box = ctx.sheet([h('h2', {}, `Shift log · ${DAY_NAMES[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`),
    h('div', { class: 'small muted' }, 'Counts and a feeling, kept in your own Drive. Never a patient’s name, file number or any detail that identifies someone.'),
    h('div', { class: 'field' }, h('label', {}, 'How was it?'), faces(key)),
    h('div', { class: 'grid3' }, ...SL.COUNTS.map(([k, l]) => num(k, l))),
    field('Note', note), err,
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { const c = SL.checkNote(v.note); if (!c.ok) { err.textContent = c.msg; note.focus(); return; } ctx.update(x => SL.logShift(x, key, { note: v.note ?? '', seen: v.seen, transfers: v.transfers, referrals: v.referrals })); box.close(); toast('Shift log saved', 'ok'); } }, 'Save'),
      cur.at ? h('button', { class: 'btn ghost danger', onClick: () => { ctx.update(x => SL.clearLog(x, key)); box.close(); toast('Log removed', 'ok', { action: { label: 'Undo', run: () => ctx.update(x => ({ ...x, shiftLog: { ...x.shiftLog, [key]: cur } })) } }); } }, 'Remove') : null)]);
}

// ───────── tomorrow's team: the evening before a shift (or the morning of a night), who you will be with
function teamCard(t) {
  const e = t.entry, s = S(), when = t.tonight ? 'Tonight' : 'Tomorrow', w = e.window;
  const pill = (p, sub, cls = '') => h('button', { class: `tm-pill ${cls}`, onClick: () => ctx.personSheet(p) }, T.isFav(s, T.pkey(p)) ? '⭐ ' : '', fn(p), sub ? h('small', {}, sub) : null);
  const docs = t.doctors.map(d => pill(d.person, d.sameShift ? '' : d.code, d.sameShift ? 'same' : ''));
  return h('div', { class: 'card tmr-team' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${when}’s team`), h('span', { class: 'tiny dim' }, `${e.code} · ${fmtTime(w.start)}–${fmtTime(w.end)}${e.shift.site ? ' · ' + e.shift.site : ''}`)),
    t.favs.length ? h('div', { class: 'small tmr-fav' }, `⭐ ${t.favs.map(fn).join(', ')} ${t.favs.length > 1 ? 'are' : 'is'} on with you`) : null,
    h('div', { class: 'tm-line' }, h('span', { class: 'tm-lab' }, 'Doctors'), h('div', { class: 'tm-pills' }, docs.length ? docs : h('span', { class: 'tm-alone' }, `Alone at ${e.shift.site || 'your site'}`))),
    t.specialists.length ? h('div', { class: 'tm-line' }, h('span', { class: 'tm-lab' }, 'Specialist'), h('div', { class: 'tm-pills' }, t.specialists.slice(0, 2).map(x => pill(x.person, x.code)))) : null,
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm ghost', onClick: () => ctx.openDay(startOfDay(w.start)) }, 'Open the day')));
}
