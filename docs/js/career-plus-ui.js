// Career › Pay, Licences and CV. Logic in payslips.js, creds.js and cv.js.
import { h, toast, keyOf, fromKey, MONTHS } from './util.js';
import * as P from './payslips.js';
import * as K from './creds.js';
import * as CV from './cv.js';
import { currentJob, total } from './career.js';
import { revert } from './store.js';

let ctx = null;
export function initCareerPlus(c) { ctx = c; }
const S = () => ctx.S();
let fid = 0;
const field = (label, input, err = null) => { const id = input.id || (input.id = `cp-${++fid}`); return h('div', { class: 'field' }, h('label', { for: id }, label), input, err); };
const ymLabel = (k) => { const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const fd = (k) => { if (!k) return ''; const d = fromKey(k); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
const sar = (n) => `${Math.round(n).toLocaleString('en-GB')} SAR`;
const errBox = () => h('div', { class: 'tiny field-err', 'aria-live': 'polite' });
const PREFIX = { payslips: 'pay', creds: 'cred', cme: 'cme' };
const undo = (msg, before, key, coll) => toast(msg, 'ok', { action: { label: 'Undo', run: () => ctx.update(x => revert(x, coll, PREFIX[coll], key, before)) } });

// ───────── Pay
export function renderPay() {
  const s = S(), sum = P.slipSummary(s), job = currentJob(s);
  const head = h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Payslips'), h('button', { class: 'btn sm primary', onClick: () => slipSheet() }, '＋ Add a month')),
    h('div', { class: 'small muted' }, job ? `Each month is checked against your ${job.employer} contract (${sar(total(job))} a month) and the overtime your rota shows.` : 'Add your current job under Jobs to check payslips against the contract.'),
    sum.list.length ? h('div', { class: 'grid2', style: { marginTop: '8px' } }, h('div', { class: 'stat' }, h('b', {}, sar(sum.avg)), h('span', {}, `average net, last ${sum.list.length}`)), h('div', { class: 'stat' }, h('b', {}, String(sum.missing.length || '–')), h('span', {}, 'months not entered'))) : null,
    sum.missing.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, sum.missing.map(m => h('button', { class: 'chip', onClick: () => slipSheet(m) }, `＋ ${ymLabel(m)}`))) : null);
  const rows = sum.list.map(sl => { const c = P.checkSlip(s, sl), worst = c.lines.find(l => l.level === 'warn') ? 'warn' : c.lines.find(l => l.level === 'info') ? 'info' : 'ok';
    return h('div', { class: `card pay-row ${worst}` }, h('div', { class: 'row' }, h('b', { class: 'grow' }, ymLabel(sl.month)), h('span', { class: 'small' }, h('b', {}, sar(sl.net)), h('span', { class: 'dim' }, ` net · ${sar(c.gross)} gross`)), h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${ymLabel(sl.month)}`, onClick: () => slipSheet(sl.month) }, '✎')),
      c.lines.map(l => h('div', { class: `small pay-l ${l.level}` }, l.level === 'warn' ? '⚠ ' : l.level === 'ok' ? '✓ ' : '· ', l.msg))); });
  return [head, ...rows];
}
function slipSheet(month = '') {
  const s = S(), now = new Date(), def = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, cur = s.payslips?.[def] || {}, job = currentJob(s);
  const v = { ...(job && !cur.at ? { basic: job.basic, housing: job.housing, transport: job.transport, other: job.other } : {}), ...cur }, errs = {};
  const mon = h('input', { type: 'month', value: def, max: `${now.getFullYear() + 1}-12` });
  const inp = (k) => { errs[k] = errBox(); return field(P.LABELS[k], h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: v[k] ?? '', placeholder: '0', onInput: (e) => { v[k] = e.target.value; } }), errs[k]); };
  errs.month = errBox();
  const paid = h('input', { type: 'date', value: cur.paidOn || '', onInput: (e) => { v.paidOn = e.target.value; } }), note = h('input', { value: cur.note || '', maxlength: 200, placeholder: 'Optional', onInput: (e) => { v.note = e.target.value; } });
  const box = ctx.sheet([h('h2', {}, month ? `Payslip · ${ymLabel(month)}` : 'Add a payslip'), h('div', { class: 'small muted' }, 'Stays in your own Drive; never sent to the hub.'),
    field('Month', mon, errs.month), h('div', { class: 'grid2' }, ...['basic', 'housing', 'transport', 'other', 'overtime', 'deductions'].map(inp)), inp('net'),
    h('div', { class: 'grid2' }, field('Paid on', paid), field('Note', note)),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => {
      const m = mon.value, e = P.slipErrors(m, v); for (const [k, el] of Object.entries(errs)) el.textContent = e[k] || '';
      if (Object.keys(e).length) return toast('Fix the highlighted field first', 'err');
      const before = S().payslips?.[m]; ctx.update(x => { let y = P.saveSlip(x, m, v); if (month && month !== m) y = P.deleteSlip(y, month); return y; }); box.close(); toast(`Saved ${ymLabel(m)}`, 'ok'); if (before && !month) undo(`Replaced ${ymLabel(m)}`, before, m, 'payslips');
    } }, 'Save'), cur.at ? h('button', { class: 'btn ghost danger', onClick: () => { const before = cur; ctx.update(x => P.deleteSlip(x, def)); box.close(); undo(`${ymLabel(def)} removed`, before, def, 'payslips'); } }, 'Remove') : null)]);
}

// ───────── Licences, certificates and CME
export function renderCreds() {
  const s = S(), now = new Date(), list = K.credList(s), cme = K.cmeProgress(s, now);
  const credRows = list.map(c => { const st = K.credState(c, now), word = st.state === 'none' ? 'no expiry' : st.state === 'expired' ? `expired ${fd(c.expires)}` : `to ${fd(c.expires)}${st.days <= 60 ? ` · in ${st.days} d` : ''}`;
    return h('button', { class: `item clickable cred ${st.state}`, onClick: () => credSheet(c) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, c.name), h('div', { class: 'meta' }, [K.KIND_LABEL[c.kind] !== c.name ? K.KIND_LABEL[c.kind] : '', c.number, c.provider].filter(Boolean).join(' · '))), h('span', { class: `chip ${st.state === 'expired' ? 'late' : st.state === 'soon' ? 'warnc' : ''}` }, word)); });
  const missing = ['scfhs', 'bls', 'acls'].filter(k => !list.some(c => c.kind === k));
  const credCard = h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'Licences and certificates'), h('button', { class: 'btn sm primary', onClick: () => credSheet() }, '＋ Add')),
    list.length ? h('div', { class: 'list' }, credRows) : h('div', { class: 'small muted' }, 'Your SCFHS licence, BLS and ACLS, with their expiry dates. Mandarin warns 60 days ahead, on Today and in Citrus.'),
    missing.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, missing.map(k => h('button', { class: 'chip', onClick: () => credSheet({ kind: k }) }, `＋ ${K.KIND_LABEL[k]}`))) : null);
  const cmeCard = h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, 'CME hours'), h('button', { class: 'btn sm primary', onClick: () => cmeSheet() }, '＋ Log')),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', { class: 'big-n' }, String(cme.last12)), h('span', { class: 'small muted' }, ` of ${cme.target} h in the last 12 months · ${cme.thisYear} h in ${now.getFullYear()}`)), h('button', { class: 'btn sm ghost', 'aria-label': 'CME target', onClick: targetSheet }, '⚙')),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': cme.pct, 'aria-label': 'CME hours toward your target' }, h('i', { style: { width: `${cme.pct}%` } })),
    h('div', { class: 'list', style: { marginTop: '8px' } }, K.cmeList(s).slice(0, 12).map(x => h('button', { class: 'item clickable', onClick: () => cmeSheet(x) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, x.title), h('div', { class: 'meta' }, [fd(x.date), K.CME_CATS.find(([k]) => k === x.cat)?.[1], x.provider].filter(Boolean).join(' · '))), h('b', {}, `${x.hours} h`)))),
    !cme.count ? h('div', { class: 'small muted' }, 'Log courses, conferences and modules as you do them. The target is yours to set (⚙).') : null);
  return [h('div', { class: 'cols' }, h('div', {}, credCard), h('div', {}, cmeCard))];
}
function credSheet(c = {}) {
  const v = { kind: 'scfhs', ...c }, errs = { name: errBox(), expires: errBox() };
  const kind = h('select', { onChange: (e) => { v.kind = e.target.value; if (!name.value) name.placeholder = K.KIND_LABEL[v.kind]; } }, K.KINDS.map(([k, l]) => h('option', { value: k, selected: v.kind === k }, l)));
  const name = h('input', { value: c.name || '', placeholder: K.KIND_LABEL[v.kind], maxlength: 80, onInput: (e) => { v.name = e.target.value; } });
  const num = h('input', { value: c.number || '', maxlength: 40, placeholder: 'Licence or certificate number', onInput: (e) => { v.number = e.target.value; } });
  const iss = h('input', { type: 'date', value: c.issued || '', onInput: (e) => { v.issued = e.target.value; } }), exp = h('input', { type: 'date', value: c.expires || '', onInput: (e) => { v.expires = e.target.value; } });
  const prov = h('input', { value: c.provider || '', maxlength: 80, placeholder: 'e.g. SCFHS, AHA, SHA', onInput: (e) => { v.provider = e.target.value; } });
  const box = ctx.sheet([h('h2', {}, c.id ? c.name : 'Add a licence or certificate'), field('Kind', kind), field('Name', name, errs.name), field('Number', num), h('div', { class: 'grid2' }, field('Issued', iss), field('Expires', exp, errs.expires)), field('Issued by', prov),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { const e = K.credErrors(v); for (const [k, el] of Object.entries(errs)) el.textContent = e[k] || ''; if (Object.keys(e).length) return toast('Fix the highlighted field first', 'err'); ctx.update(x => K.saveCred(x, v)); box.close(); toast('Saved', 'ok'); } }, 'Save'),
      c.id ? h('button', { class: 'btn ghost danger', onClick: () => { const before = S().creds?.[c.id]; ctx.update(x => K.deleteCred(x, c.id)); box.close(); undo(`${c.name} removed`, before, c.id, 'creds'); } }, 'Remove') : null)]);
}
function cmeSheet(x = {}) {
  const v = { date: keyOf(new Date()), cat: '1', ...x }, errs = { title: errBox(), hours: errBox() };
  const box = ctx.sheet([h('h2', {}, x.id ? 'CME activity' : 'Log CME'),
    field('What', h('input', { value: x.title || '', maxlength: 120, placeholder: 'Course, conference, module', onInput: (e) => { v.title = e.target.value; } }), errs.title),
    h('div', { class: 'grid2' }, field('Date', h('input', { type: 'date', value: v.date, onInput: (e) => { v.date = e.target.value; } })), field('Hours', h('input', { type: 'number', inputmode: 'decimal', min: 0.25, max: 200, step: 0.25, value: x.hours ?? '', onInput: (e) => { v.hours = e.target.value; } }), errs.hours)),
    h('div', { class: 'grid2' }, field('Category', h('select', { onChange: (e) => { v.cat = e.target.value; } }, K.CME_CATS.map(([k, l]) => h('option', { value: k, selected: v.cat === k }, l)))), field('Provider', h('input', { value: x.provider || '', maxlength: 80, onInput: (e) => { v.provider = e.target.value; } }))),
    h('div', { class: 'row wrap sh-foot' }, h('button', { class: 'btn primary grow', onClick: () => { const e = K.cmeErrors(v); for (const [k, el] of Object.entries(errs)) el.textContent = e[k] || ''; if (Object.keys(e).length) return toast('Fix the highlighted field first', 'err'); ctx.update(st => K.saveCme(st, v)); box.close(); toast(`${+v.hours} h logged`, 'ok'); } }, 'Save'),
      x.id ? h('button', { class: 'btn ghost danger', onClick: () => { const before = S().cme?.[x.id]; ctx.update(st => K.deleteCme(st, x.id)); box.close(); undo('Removed', before, x.id, 'cme'); } }, 'Remove') : null)]);
}
function targetSheet() {
  const s = S(), i = h('input', { type: 'number', min: 1, max: 500, value: K.cmeTarget(s), inputmode: 'numeric' }), err = errBox();
  const box = ctx.sheet([h('h2', {}, 'CME target'), h('div', { class: 'small muted' }, 'Hours you aim for in any 12 months. Check your own classification’s requirement with SCFHS; Mandarin does not assume one.'), field('Hours per 12 months', i, err),
    h('button', { class: 'btn primary', onClick: () => { const n = Math.round(+i.value); if (!(n >= 1 && n <= 500)) { err.textContent = 'Between 1 and 500'; return; } ctx.update(x => ({ ...x, settings: { ...x.settings, career: { ...(x.settings?.career || {}), cmeTarget: n } } })); box.close(); toast(`Target ${n} h`, 'ok'); } }, 'Save')]);
}

// ───────── CV
export function renderCv() {
  const s = S(), c = { ...CV.cleanCv(s.cv || {}), ...(s.cv || {}) }, jobs = CV.cvJobs(s), filled = CV.CV_FIELDS.filter(([k]) => c[k]).length;
  return [h('div', { class: 'card' }, h('div', { class: 'title' }, 'CV'), h('div', { class: 'small muted' }, 'Built from your jobs, licences and CME, plus the lines you write here. Pay, ratings and notes never appear on it.'),
    h('div', { class: 'small', style: { margin: '8px 0' } }, `${jobs.length} job${jobs.length === 1 ? '' : 's'} · ${K.credList(s).length} licences · ${filled} of ${CV.CV_FIELDS.length} lines filled`),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onClick: cvSheet }, '✎ Edit my lines'), h('button', { class: 'btn primary', onClick: openCv }, 'Open printable CV'), h('button', { class: 'btn', onClick: downloadCv }, '⬇ Download'))),
    h('div', { class: 'card cv-prev' }, h('iframe', { title: 'CV preview', class: 'cv-frame', sandbox: '', srcdoc: CV.cvHtml(s) }))];
}
function cvSheet() {
  const s = S(), c = { ...(s.cv || {}) }, v = { ...c };
  const box = ctx.sheet([h('h2', {}, 'Your CV lines'), ...CV.CV_FIELDS.map(([k, l]) => { const multi = /summary|education|skills|extra/.test(k), el = h(multi ? 'textarea' : 'input', { rows: multi ? 3 : null, value: multi ? null : c[k] || '', maxlength: k === 'summary' ? 800 : 1200, onInput: (e) => { v[k] = e.target.value; } }, multi ? c[k] || '' : null); return field(l, el); }),
    h('button', { class: 'btn primary', onClick: () => { ctx.update(x => ({ ...x, cv: CV.cleanCv(v) })); box.close(); toast('CV saved', 'ok'); } }, 'Save')]);
}
function cvBlob() { return new Blob([CV.cvHtml(S())], { type: 'text/html' }); }
function openCv() { const url = URL.createObjectURL(cvBlob()), w = window.open(url, '_blank', 'noopener'); if (!w) downloadCv(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
function downloadCv() { const a = h('a', { href: URL.createObjectURL(cvBlob()), download: `CV-${(S().cv?.name || 'mandarin').replace(/[^\w]+/g, '-')}.html` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

// ───────── Today: a licence close to expiry
export function credsTodayCard(now = new Date()) {
  const due = K.dueSoon(S(), now, 60); if (!due.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Licences'), due.slice(0, 3).map(c => h('div', { class: `small ${c.days < 0 ? 'late' : ''}` }, `${c.name}: ${c.days < 0 ? `expired ${-c.days} days ago` : c.days === 0 ? 'expires today' : `expires in ${c.days} days (${fd(c.expires)})`}`)),
    h('button', { class: 'btn sm ghost', onClick: () => ctx.go('career', 'creds') }, 'Open Licences'));
}
