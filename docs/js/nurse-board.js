// Nurses board logic (no DOM): short unambiguous names, who can tell you the postings, marks for the 7-day strip,
// and reading a pasted posting list (the team leader's WhatsApp message) into tips. Used by people-ui.js.
import * as N from './nurses.js';
import { contactOf } from './directory.js';
import { keyOf } from './util.js';

const clean = (n) => String(n || '').replace(/^Dr\.?\s*/i, '').replace(/\([^)]*\)/g, ' ').replace(/\s+-\s*\w+$/, '').trim();
const words = (n) => clean(n).split(/\s+/).filter(Boolean);
/**
 * "Fatima K.", "Al Nizar", "Dina": the first name, or the first two words when the first is a tiny prefix ("Al"),
 * plus a surname initial (then the whole surname) only where two people would read the same. `extra` = names that also count
 * as clashes (e.g. friends you call "Fatima") without getting a name back.
 */
export function shortNurseNames(names, extra = []) {
  const w = names.map(words), base = w.map(x => x.length > 1 && x[0].length <= 2 ? `${x[0]} ${x[1]}` : (x[0] || '')), out = [...base];
  const taken = new Set(extra.map(e => words(e)[0]?.toLowerCase()).filter(Boolean));
  for (let pass = 0; pass < 3; pass++) {
    const seen = new Map(); out.forEach((n, i) => seen.set(n.toLowerCase(), [...(seen.get(n.toLowerCase()) || []), i]));
    let clash = false;
    for (const [n, idx] of seen) if (idx.length > 1 || (pass === 0 && taken.has(n))) {
      clash = clash || idx.length > 1;
      for (const i of idx) { const x = w[i], last = x[x.length - 1] || ''; if (x.length < 2) continue; out[i] = pass === 0 ? `${base[i]} ${last[0]}.` : pass === 1 ? `${base[i]} ${last}` : x.join(' '); }
    }
    if (!clash) break;
  }
  return out;
}

/** People who actually know where the construction-clinic nurses go: the head nurse and the team leaders of the floating groups.
 *  FSED / Aqua Arabia leaders are fixed at their place and do not know the postings, so they are never offered. */
export function heardSources(s) {
  const l = N.nurses(s).filter(n => n.group === 'head' || n.group === 'leaders' || ((n.leader || N.canLead(s, N.keyOfPerson(n))) && N.isFloater(n.group)));   // + nurses you marked "can lead"
  const short = shortNurseNames(l.map(n => n.name));
  // the name YOU use for them wins: a friend's nickname (e.g. a nickname you gave the team leader) is how the source chip reads
  const nick = { get: (k) => contactOf(k).nick || undefined, has: (k) => !!contactOf(k).nick };
  return l.map((n, i) => ({ key: N.keyOfPerson(n), name: nick.get(N.keyOfPerson(n)) || short[i], leader: !!n.leader })).sort((a, b) => b.leader - a.leader);
}
/** The source of the most recent tip you typed (not a guess): the next tip probably comes from the same person. */
export function lastSource(s) {
  let best = null; for (const x of Object.values(s.posts || {})) if (x.tip && !x.guess && x.from && x.from !== 'last time' && (!best || (x.at || 0) > (best.at || 0))) best = x;
  return best ? best.from : null;
}

/** Per-day marks for the board's day strip: how many confirmed, heard, guessed and still open, and whether the schedule covers the day. */
export function dayMarks(s, dates) {
  return dates.map(date => {
    if (!N.nurseRotaFor(s, date)) return { date, key: keyOf(date), hasRota: false, posted: 0, heard: 0, guessed: 0, open: 0 };
    const rows = N.rowsFor(s, date).filter(r => (N.isFloater(r.group) || r.pulledFrom) && r.group !== 'head');
    const posted = rows.filter(r => r.post).length, heard = rows.filter(r => !r.post && r.tip && !r.tip.guess).length, guessed = rows.filter(r => !r.post && r.tip?.guess).length;
    return { date, key: keyOf(date), hasRota: true, posted, heard, guessed, open: rows.length - posted };
  });
}

// ───────── pasted posting list → tips
// office clinics first, so "upper office" is never read as Upper Village; "upper", "UV", "low village" are the villages (beta T3-08)
const SITE_RE = [['UPO', /\b(upo|upper\s*office(\s*clinic)?)\b/i], ['LPO', /\b(lpo|lower\s*office(\s*clinic)?)\b/i], ['UPV', /\b(upv|uv|upper(\s*vill?age?)?)\b/i], ['LPV', /\b(lpv|lv|low(er)?(\s*vill?age?)?)\b/i]];
// headings for the fixed posts: the nurses there stay at their usual post (not an error, not "no nurse by that name")
const FIXED_RE = /\b(fsed|free\s*standing|aqua(\s*arabia)?|six\s*flags|sf\s*clinic|((upper|lower)\s*)?plat(eau|ue)|nairiya)\b/i;
// a line copied from WhatsApp: "[16/11/2026, 19:02:11] Name TL: …" or "16/11/26, 7:02 pm - Name: …" (beta T3-05)
const WA_PREFIX = /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?\]?\s*(-\s*)?([^:]{1,40}):\s*/i;
const siteIn = (t) => SITE_RE.find(([, re]) => re.test(t))?.[0] || '';
const stripSites = (t) => SITE_RE.reduce((a, [, re]) => a.replace(new RegExp(re.source, 'gi'), ' '), t);
const toks = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(x => x.length >= 2);
const NOISE = new Set(['day', 'night', 'shift', 'am', 'pm', 'and', 'sn', 'rn', 'tl', 'hn', 'fa', 'clinic', 'office', 'today', 'tomorrow', 'tonight', 'posting', 'postings', 'nurse', 'nurses', 'the', 'at', 'to', 'in', 'is', 'are', 'for', 'with', 'off', 'float', 'floating',
  // honorifics and greetings common in the nurses' groups (beta T3-06, T3-09)
  'ma', 'maam', 'mam', 'madam', 'sir', 'sis', 'kuya', 'ate', 'ms', 'mr', 'mrs', 'dr', 'good', 'morning', 'evening', 'po', 'please', 'pls', 'thanks', 'thank', 'you', 'hi', 'hello', 'team', 'everyone', 'all', 'here', 'list', 'our', 'only', 'will', 'be']);
/** Edit distance of two short words (for one-letter typos in names). */
function dist(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
/**
 * Reads a message like "UPV: Ann, Beth\nLower Village\n1. Cara\n2. Dina (N)" against the floating nurses of that day.
 * A line with only a site starts a block; a line with a site and names assigns those names. A name matches a nurse when its words start
 * her name's words (3+ letters) and point at exactly one nurse. Returns hits (one per nurse, the last mention wins), and what it could not place.
 */
export function parsePostingList(text, rows) {
  const cand = rows.filter(r => r.choices?.length).map(r => ({ r, t: toks(clean(r.person.name)) }));
  // nurses on a fixed post that day (FSED, Aqua…): matched only when no floater fits; the list wins — she is "pulled out" to that site
  const fixedCand = rows.filter(r => r.fixed && !r.choices?.length).map(r => ({ r, t: toks(clean(r.person.name)) }));
  const hits = new Map(), unknown = [], offsite = [], fuzzy = [], moved = [], fixedSeen = []; let cur = '', sender = '';
  for (const raw0 of String(text || '').split(/\r?\n/)) {
    const wa = WA_PREFIX.exec(raw0); if (wa) sender = sender || wa[5].trim();
    const raw = wa ? raw0.slice(wa[0].length) : raw0;
    const line = raw.replace(/'/g, '').replace(/^\s*[\d]+[.)]\s*|^\s*[-•*]\s*/, '').trim(); if (!line) continue;
    if (FIXED_RE.test(line) && !siteIn(line.replace(FIXED_RE, ' '))) { cur = 'FIXED'; const rest0 = line.replace(FIXED_RE, ' ').replace(/[:=-]/g, ' '); if (!toks(rest0).filter(w => !NOISE.has(w)).length) continue; }
    const site = cur === 'FIXED' && !siteIn(line) ? 'FIXED' : siteIn(line), rest = stripSites(line).replace(FIXED_RE, ' ').replace(/\([^)]*\)/g, ' ');
    const parts = rest.split(/[,;/&+]|\band\b/i).map(x => toks(x).filter(w => !NOISE.has(w))).filter(x => x.length);
    if (site && !parts.length) { cur = site; continue; }
    if (!site && !parts.length) continue;
    const at = site || cur;
    for (const p of parts) {
      const fits = (c) => p.every(w => w.length >= 3 ? c.t.some(t => t.startsWith(w)) : c.t.includes(w)) && p.some(w => w.length >= 3);
      // a nurse at a fixed post (FSED, Aqua…) under such a heading is simply at her usual place
      if (at === 'FIXED') { const f = [...fixedCand, ...cand].filter(fits); if (f.length === 1) fixedSeen.push(f[0].r.person.name); else unknown.push({ text: p.join(' '), why: f.length ? `${f.length} nurses match` : 'not on shift at a fixed post' }); continue; }
      let m = cand.filter(fits);
      // one-letter typos ("Edita", "Jasmine"): only when nothing matches exactly, and shown as a guess to check (beta T3-07)
      if (!m.length) { const near = cand.filter(c => p.every(w => w.length < 4 ? c.t.includes(w) : c.t.some(t => dist(w, t.slice(0, Math.max(w.length, Math.min(t.length, w.length + 1)))) <= (w.length >= 6 ? 2 : 1) || dist(w, t) <= (w.length >= 6 ? 2 : 1)))); if (near.length === 1) { m = near; fuzzy.push({ text: p.join(' '), name: near[0].r.person.name }); } }
      if (!m.length && at) { const f = fixedCand.filter(fits); if (f.length === 1) { const r = f[0].r; hits.set(r.key, { key: r.key, name: r.person.name, site: at, row: r, pulled: r.fixed }); continue; } }
      const label = p.join(' ');
      if (m.length !== 1) { unknown.push({ text: label, why: m.length ? `${m.length} nurses match` : 'no nurse on shift by that name' }); continue; }
      if (!at) { unknown.push({ text: label, why: 'no site before it' }); continue; }
      const r = m[0].r; if (!r.choices.includes(at)) { offsite.push({ key: r.key, name: r.person.name, site: at, row: r }); continue; }
      const was = hits.get(r.key); if (was && was.site !== at) moved.push({ name: r.person.name, from: was.site, to: at });   // listed twice: the last one wins, and it says so
      hits.set(r.key, { key: r.key, name: r.person.name, site: at, row: r });
    }
  }
  return { hits: [...hits.values()], unknown, offsite, fuzzy, moved, fixed: fixedSeen, sender };
}
