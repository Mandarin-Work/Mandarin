// CV builder and lessons from past jobs (pure).
// The CV is built from what Mandarin already knows (jobs, licences, CME) plus a few lines of your own (state.cv), as a
// self-contained printable page. Lessons: when you weigh an offer, past jobs you rated badly or would not repeat speak up.
import { jobList, ASPECTS } from './career.js';
import { credList, cmeProgress, KIND_LABEL, credState } from './creds.js';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (k) => /^\d{4}-\d\d/.test(k || '') ? `${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : '';
export const CV_FIELDS = [['name', 'Name'], ['title', 'Title (e.g. General Practitioner)'], ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['summary', 'Summary'], ['education', 'Education (one per line)'], ['skills', 'Skills (one per line)'], ['languages', 'Languages'], ['extra', 'Anything else (one per line)']];
const lines = (t) => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);

export const cleanCv = (x) => Object.fromEntries([...CV_FIELDS.map(([k]) => [k, String(x?.[k] ?? '').slice(0, k === 'summary' ? 800 : 1200)]), ['showPay', false], ['at', Date.now()]]);

/** Work history for the CV: main jobs newest first, with postings (sites) under them. Pay and ratings never appear. */
export function cvJobs(s) {
  const all = jobList(s), main = all.filter(j => !j.postingOf);
  return main.map(j => ({ employer: j.employer, role: j.role, city: j.city, from: ym(j.start), to: j.status === 'current' ? 'present' : ym(j.left || j.end), sites: all.filter(p => p.postingOf === j.id).map(p => p.site || p.employer).filter(Boolean) }));
}
/** The printable CV as one HTML document (no scripts, no outside files). */
export function cvHtml(s, now = new Date()) {
  const c = { ...cleanCv(s.cv || {}), ...(s.cv || {}) }, jobs = cvJobs(s), creds = credList(s).filter(x => credState(x, now).state !== 'expired'), cme = cmeProgress(s, now);
  const sec = (t, body) => body ? `<section><h2>${esc(t)}</h2>${body}</section>` : '';
  const ul = (a) => a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const exp = jobs.map(j => `<div class="job"><div class="jh"><b>${esc(j.role || 'Physician')}</b><span>${esc([j.from, j.to].filter(Boolean).join(' – '))}</span></div><div class="je">${esc([j.employer, j.city].filter(Boolean).join(', '))}</div>${j.sites.length ? `<div class="js">${esc(j.sites.join(' · '))}</div>` : ''}</div>`).join('');
  const lic = creds.map(x => `<li><b>${esc(x.name || KIND_LABEL[x.kind])}</b>${x.number ? ` · ${esc(x.number)}` : ''}${x.expires ? ` · valid to ${esc(ym(x.expires))}` : ''}</li>`).join('');
  const contact = [c.email, c.phone, c.city].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(c.name || 'CV')}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.45 "Source Sans 3",system-ui,sans-serif;color:#15182a;max-width:760px;margin:32px auto;padding:0 20px}h1{font-size:28px;margin:0}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a24b00;border-bottom:2px solid #f28a1b;padding-bottom:3px;margin:22px 0 8px}.sub{color:#566079;margin:2px 0 0}.job{margin:0 0 10px}.jh{display:flex;justify-content:space-between;gap:10px}.jh span,.je,.js{color:#566079}.js{font-size:13px}ul{margin:4px 0;padding-left:18px}@media print{body{margin:0}a{color:inherit}}</style></head>
<body><header><h1>${esc(c.name || '')}</h1>${c.title ? `<p class="sub">${esc(c.title)}</p>` : ''}${contact ? `<p class="sub">${contact}</p>` : ''}</header>
${sec('Profile', c.summary ? `<p>${esc(c.summary)}</p>` : '')}${sec('Experience', exp)}${sec('Licences and certificates', lic ? `<ul>${lic}</ul>` : '')}
${sec('Education', ul(lines(c.education)))}${sec('Continuing medical education', cme.last12 ? `<p>${cme.last12} CME hours in the last 12 months.</p>` : '')}${sec('Skills', ul(lines(c.skills)))}${sec('Languages', c.languages ? `<p>${esc(c.languages)}</p>` : '')}${sec('Other', ul(lines(c.extra)))}
</body></html>`;
}

const norm = (t) => String(t || '').toLowerCase().replace(/\b(co|company|group|est|ltd|llc|holding|for|the|and|services?|contracting|trading|medical|healthcare|health care|hospital)\b/g, ' ').replace(/[^a-z؀-ۿ]+/g, ' ').trim();
// words too common in employer names to mean "the same employer" on their own (T4-06: one shared "Saudi" or "King" was enough)
const COMMON = new Set(['saudi', 'arabia', 'arabian', 'king', 'prince', 'princess', 'royal', 'national', 'international', 'german', 'american', 'british', 'city', 'center', 'centre', 'clinic', 'clinics', 'polyclinic', 'general', 'specialist', 'specialized', 'specialty', 'care', 'complex', 'riyadh', 'jeddah', 'dammam', 'khobar', 'makkah', 'madinah', 'eastern', 'province', 'new', 'first', 'united', 'gulf']);
const words = (t) => norm(t).split(' ').filter(w => w.length > 2 && !COMMON.has(w));
/** 0–1: how much of the shorter name the other one shares, counting only distinctive words. */
const overlap = (a, b) => { if (!a || !b) return 0; if (norm(a) && norm(a) === norm(b)) return 1; const x = new Set(words(a)), y = words(b); if (!x.size || !y.length) return 0; return y.filter(w => x.has(w)).length / Math.min(x.size, new Set(y).size); };
const sameEmployer = (j, o) => Math.max(overlap(j.employer, o.employer), overlap(j.employerAr, o.employerAr || o.employer)) >= 0.6;
export function lessons(s, offer) {
  const out = [];
  for (const j of jobList(s)) {
    if (j.status === 'current' && !j.postingOf) continue;
    const same = sameEmployer(j, offer);
    const bad = (j.rating && j.rating <= 2) || j.again === 'no';
    if (same && bad) out.push({ level: 'warn', text: `You worked for ${j.employer}${j.site ? ` (${j.site})` : ''}${j.again === 'no' ? ' and said you would not go back' : ''}${j.rating ? `, rated ${j.rating}/5` : ''}.` });
    else if (same) out.push({ level: 'info', text: `You know ${j.employer}${j.rating ? `: rated ${j.rating}/5` : ''}.` });
    if (same) { const low = ASPECTS.filter(([k]) => j.aspects?.[k] && j.aspects[k] <= 2).map(([, l]) => l.toLowerCase()); if (low.length) out.push({ level: 'warn', text: `Last time the ${low.join(', ')} ${low.length > 1 ? 'were' : 'was'} poor. Ask about ${low.length > 1 ? 'them' : 'it'} before signing.` }); }
  }
  // patterns across every past job: what went wrong most often
  const lows = {}; for (const j of jobList(s)) for (const [k, l] of ASPECTS) if (j.aspects?.[k] && j.aspects[k] <= 2) lows[l] = (lows[l] || 0) + 1;
  const top = Object.entries(lows).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([l]) => l.toLowerCase());
  if (top.length) out.push({ level: 'info', text: `Across your past jobs the ${top.join(' and ')} went wrong more than once: check ${top.length > 1 ? 'them' : 'it'} in this offer.` });
  // warnings first, each sentence once (T4-07)
  const seen = new Set(); return out.filter(l => !seen.has(l.text) && seen.add(l.text)).sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1));
}
