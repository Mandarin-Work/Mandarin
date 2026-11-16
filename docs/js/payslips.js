// Payslip tracker (pure). state.payslips['YYYY-MM'] = {basic, housing, transport, other, overtime, deductions, net, paidOn, note, at}.
// Each month is checked against the contract (current job) and the overtime the rota implies (labor.js checkMonth), so a
// short or late salary, or overtime that was worked but not paid, shows up as a plain sentence. Stays in your own Drive only.
import { currentJob, total } from './career.js';
import { checkMonth } from './labor.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (v) => { const n = Math.round((+String(v ?? '').replace(/[, ]/g, '') || 0) * 100) / 100; return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : 0; };
const FIELDS = ['basic', 'housing', 'transport', 'other', 'overtime', 'deductions', 'net'];
export const LABELS = { basic: 'Basic', housing: 'Housing', transport: 'Transport', other: 'Other allowances', overtime: 'Overtime paid', deductions: 'Deductions (GOSI, absences…)', net: 'Net received' };

export function cleanSlip(month, x) {
  const out = { month, at: Date.now() };
  for (const f of FIELDS) out[f] = money(x[f]);
  out.paidOn = /^\d{4}-\d\d-\d\d$/.test(x.paidOn || '') ? x.paidOn : '';
  out.note = String(x.note || '').slice(0, 200);
  return out;
}
export function slipErrors(month, x) {
  const e = {};
  if (!MONTH.test(month)) e.month = 'Pick a month';
  if (!(money(x.net) > 0)) e.net = 'Net pay above 0';
  const gross = money(x.basic) + money(x.housing) + money(x.transport) + money(x.other) + money(x.overtime);
  if (gross && money(x.net) > gross * 1.05) e.net = 'Net is more than the gross: check the numbers';
  return e;
}
export const saveSlip = (s, month, x) => ({ ...s, payslips: { ...(s.payslips || {}), [month]: cleanSlip(month, x) } });
export function deleteSlip(s, month) { const m = { ...(s.payslips || {}) }; delete m[month]; return { ...s, payslips: m, deleted: { ...(s.deleted || {}), [`pay:${month}`]: Date.now() } }; }
export const slipList = (s) => Object.values(s.payslips || {}).sort((a, b) => b.month.localeCompare(a.month));

/** A payslip against the contract and the rota. → {gross, expected, otExpected, otHours, lines:[{level, msg}]} */
export function checkSlip(s, slip) {
  const job = currentJob(s), gross = Math.round((slip.basic + slip.housing + slip.transport + slip.other + slip.overtime) * 100) / 100, lines = [];
  const [y, m] = slip.month.split('-').map(Number);
  let otExpected = null, otHours = 0;
  try { const lab = checkMonth(s, y, m); otHours = lab.totals.overtimeH || 0; otExpected = lab.totals.otPay; } catch {}
  if (job) {
    const fixed = total(job), paidFixed = slip.basic + slip.housing + slip.transport + slip.other;
    if (job.basic && slip.basic && slip.basic < job.basic - 1) lines.push({ level: 'warn', msg: `Basic ${slip.basic} is ${Math.round(job.basic - slip.basic)} less than the contract's ${job.basic}` });
    if (fixed && paidFixed && paidFixed < fixed - 1) lines.push({ level: 'warn', msg: `Fixed pay ${paidFixed} is below the contract package of ${fixed}` });
  }
  if (otExpected && otHours >= 1) {
    if (!slip.overtime) lines.push({ level: 'warn', msg: `The rota has ${otHours}h of overtime for this month (≈ ${otExpected}) but no overtime was paid` });
    else if (slip.overtime < otExpected * 0.9) lines.push({ level: 'info', msg: `Overtime paid ${slip.overtime}; the rota suggests ≈ ${otExpected} for ${otHours}h (often paid a month later)` });
  }
  if (slip.paidOn) { const due = new Date(y, m, 7); if (new Date(slip.paidOn) > due) lines.push({ level: 'info', msg: `Paid on ${slip.paidOn}, more than a week after the month ended` }); }
  if (!lines.length) lines.push({ level: 'ok', msg: job ? 'Matches your contract' : 'Add your current job in Career to check payslips against it' });
  return { gross, otExpected, otHours, lines };
}
/** The last 12 payslips: net per month, average, and the months still missing since the current job started. */
export function slipSummary(s, now = new Date()) {
  const list = slipList(s).slice(0, 12), job = currentJob(s), missing = [];
  if (job?.start) {
    for (let i = 1; i <= 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; if (k < job.start.slice(0, 7)) break; if (!s.payslips?.[k]) missing.push(k); }
  }
  const avg = list.length ? Math.round(list.reduce((t, x) => t + x.net, 0) / list.length) : 0;
  return { list, avg, missing: missing.slice(0, 6) };
}
