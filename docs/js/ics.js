// Your shifts as a calendar file (.ics, pure): works offline and without Google, for any calendar app.
// Each shift is one event with a stable UID, so importing the file again updates instead of duplicating.
import { myDay } from './model.js';
import { keyOf, addDays } from './util.js';

const z = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}T${z(d.getUTCHours())}${z(d.getUTCMinutes())}00Z`;
const esc = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// lines longer than 75 octets are folded (RFC 5545)
// counted in UTF-8 octets, never splitting a character (Arabic names, "·": T2-18)
const enc = new TextEncoder(), octets = (t) => enc.encode(t).length;
const fold = (l) => { const out = []; let cur = '', n = 0, max = 75; for (const ch of l) { const w = octets(ch); if (n + w > max) { out.push(cur); cur = ' '; n = 1; max = 75; } cur += ch; n += w; } out.push(cur); return out.join('\r\n'); };
const ymd = (d) => `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`;

/** Shifts from `from` for `days` days. alarmMin > 0 adds a reminder before each. */
export function shiftsIcs(s, from, days = 62, { alarmMin = 0, withTeam = true } = {}) {
  const now = new Date(), lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mandarin//Shifts//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mandarin shifts'];
  let n = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i), md = myDay(s, d), t = md.today, uid = `UID:mandarin-${keyOf(d)}@mandarin-work.github.io`, mine = md.info.mine;
    // leave and no-hours postings are all-day events; a day corrected to off sends a cancellation, so importing again removes the old shift (T2-10)
    const allDay = !t?.window && (md.noHours || mine?.shift.kind === 'leave') ? (md.noHours || mine) : null;
    if (!t?.window && !allDay) {
      if (s.swaps?.[keyOf(d)]) { lines.push('BEGIN:VEVENT', uid, `DTSTAMP:${stamp(now)}`, `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(addDays(d, 1))}`, 'SUMMARY:Off (corrected)', 'STATUS:CANCELLED', 'END:VEVENT'); n++; }
      continue;
    }
    if (allDay) {
      lines.push('BEGIN:VEVENT', uid, `DTSTAMP:${stamp(now)}`, `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(addDays(d, 1))}`, fold(`SUMMARY:${esc(allDay.shift.kind === 'leave' ? (allDay.shift.label || 'Leave') : `${allDay.code} · ${allDay.shift.label || 'work, no set hours'}`)}`), 'TRANSP:TRANSPARENT', 'END:VEVENT'); n++;
      continue;
    }
    const team = withTeam ? md.info.withMe.map(e => e.person.name.replace(/^Dr\.?\s*/i, '')).join(', ') : '';
    lines.push('BEGIN:VEVENT', uid, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(t.window.start)}`, `DTEND:${stamp(t.window.end)}`,
      fold(`SUMMARY:${esc(`${t.code} · ${t.shift.label}`)}`), t.shift.site ? fold(`LOCATION:${esc(t.shift.site)}`) : null, team ? fold(`DESCRIPTION:${esc(`With: ${team}`)}`) : null);
    if (alarmMin > 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Shift', `TRIGGER:-PT${Math.round(alarmMin)}M`, 'END:VALARM');
    lines.push('END:VEVENT'); n++;
  }
  lines.push('END:VCALENDAR');
  return { text: lines.filter(Boolean).join('\r\n') + '\r\n', count: n };
}
