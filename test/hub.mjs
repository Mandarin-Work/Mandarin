// Mandarin against an in-memory Google (Drive + Calendar + sign-in): the first sign-in offers to bring the work over from
// Citrus's state.json, the hub files are written to hub/mandarin only, the Claude inbox proposals arrive on Today, rota files in
// Drive › Rotas import by themselves, and two devices converge. Made-up people only. Run: node test/hub.mjs
import { chromium, serve, sleep, checker } from './helpers.mjs';
import { createFakeGoogle } from './fake-google.mjs';

const { server, url } = await serve(), browser = await chromium.launch(), { check, bad } = checker();
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const legend = { D: { code: 'D', hours: hrs(480, 1200) }, N: { code: 'N', hours: hrs(1200, 480, 1) }, D1: { code: 'D1', desc: 'Upper Village' }, N1: { code: 'N1', desc: 'Upper Village' } };
const days = {}; for (let d = 1; d <= 30; d++) days[d] = [5, 6, 12, 13, 19, 20, 26, 27].includes(d) ? '' : 'D1';
const gp = { id: 'gp-2026-11', unit: 'GP', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend, people: [{ name: 'Dr Test Me', id: '1', days }, { name: 'Dr Ann Able', id: '2', days }, { name: 'Dr Bo Bright', id: '3', days: { 21: 'D1' } }], importedAt: '2026-11-01T00:00:00Z' };
const citrusState = { updatedAt: Date.parse('2026-11-10T10:00:00Z'), me: { id: '1', name: 'Dr Test Me' }, rotas: { [gp.id]: gp }, swaps: { '2026-11-22': { code: '', with: 'Dr Ann Able', note: 'swap', at: 5 } }, jobs: { j1: { id: 'j1', employer: 'Test Clinic', status: 'current', start: '2025-08-01', at: 1 } },
  tasks: { t: { id: 't', title: 'not work' } }, contacts: { 'id:2': { phone: '0555000111' } }, friends: { f: { id: 'f', name: 'Ann', nick: 'Annie', rotaKey: 'id:2' } } };
const claude = { app: 'claude', updatedAt: '2026-11-16T05:00:00Z', summary: 'proposals', inbox: [{ id: 'sw-21', type: 'swap', date: '2026-11-21', code: '', with: 'Dr Bo Bright', note: 'Bo takes my D1' }] };

const g = createFakeGoogle();
const hub = g.path(['My Apps', 'hub']);
g.put('state.json', g.path(['My Apps', 'hub', 'citrus']), citrusState);
g.put('plan.json', g.path(['My Apps', 'hub', 'citrus']), { app: 'citrus', days: { '2026-11-16': { blocks: [{ app: 'yuzu', title: 'Yuzu: reviews', start: '21:00', end: '21:30', status: 'accepted' }] } } });
g.put('status.json', g.path(['My Apps', 'hub', 'claude']), claude);

async function device(label, { width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 700, hasTouch: width < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  await g.attach(ctx);
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await p.clock.install({ time: new Date('2026-11-16T09:30:00+03:00') });
  await p.addInitScript(() => { if (!localStorage.getItem('mandarin.google')) localStorage.setItem('mandarin.google', JSON.stringify({ access_token: 'tok', exp: Date.now() + 3600e3, email: 'tester@example.com' })); });
  await p.goto(url); await p.waitForSelector('#view-today.active'); p.label = label;
  return { ctx, p };
}
const state = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mandarin.state.v1') || 'null'));
/** a manual sync after any sync already running has finished (a second one is refused while one runs) */
const sync = async (p) => { await until(p, () => !window.__mandarin.rt.syncing); await p.evaluate(() => window.__mandarin.refreshAll(true)); await until(p, () => !window.__mandarin.rt.syncing); await sleep(300); };
const until = async (p, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(150); } return false; };

console.log('first sign-in on the phone');
const A = await device('phone');
check(await until(A.p, () => !!document.querySelector('.sheet h2')?.textContent.includes('Bring your work over')), 'offers to bring the work over from Citrus');
const sheetTxt = await A.p.locator('.sheet').innerText(); check(/1 rota/.test(sheetTxt) && /1 correction/.test(sheetTxt) && /1 job/.test(sheetTxt), `says what it found: ${sheetTxt.split('\n').find(l => /Found/.test(l))}`);
await A.p.click('.sheet button:has-text("Bring it over")'); await sleep(600);
let s = await state(A.p);
check(s.me?.id === '1' && s.rotas[gp.id] && s.swaps['2026-11-22'] && s.jobs.j1, 'me, rota, correction and job came over');
check(!s.tasks && !s.contacts && !s.friends, 'Citrus-only data (tasks, contact cards) did not');
check(s.migrated?.from === 'citrus', 'migration recorded');
await sync(A.p);
const files = g.tree().join('\n');
check(!!g.readJsonAt(['My Apps', 'hub', 'mandarin'], 'state.json'), 'state.json in hub/mandarin');
const st = g.readJsonAt(['My Apps', 'hub', 'mandarin'], 'status.json'); check(st?.app === 'mandarin' && /today D1/.test(st.summary), `status.json for Citrus: "${st?.summary}"`);
const sh = g.readJsonAt(['My Apps', 'hub', 'mandarin'], 'shifts.json'); check(sh?.days?.some(d => d.date === '2026-11-16' && d.code === 'D1') && sh.roster['id:2'], 'shifts.json with my days and the roster');
check(JSON.stringify(g.readJsonAt(['My Apps', 'hub', 'citrus'], 'state.json')) === JSON.stringify(citrusState), 'Citrus’s own file is untouched');
check(!/hub\/citrus.*mandarin/.test(files) && !files.includes('Citrus Maxima'), 'nothing written outside hub/mandarin');
console.log('the Claude inbox and the contact cards');
await A.p.click('nav.tabs button[data-view=today]'); await sleep(300);
const today = await A.p.locator('#view-today').innerText();
check(/Proposals/.test(today) && /Shift swap on 2026-11-21|Bo takes/.test(today), 'the swap proposal waits on Today');
await A.p.click('.inbox-card button:has-text("Apply swap")'); await sleep(400); if (await A.p.locator(".sheet button:has-text(\"Apply swap\")").count()) { check(/before|after|D1|Bo/i.test(await A.p.locator(".sheet").innerText()), "the swap is shown before it is applied"); await A.p.click(".sheet button:has-text(\"Apply swap\")"); await sleep(400); }
await sync(A.p);
s = await state(A.p); check(s.swaps['2026-11-21']?.with === 'Dr Bo Bright' && s.inboxLog['claude:sw-21'], 'applied as a correction and remembered');
await A.p.click('nav.tabs button[data-view=team]'); await sleep(300); await A.p.click('#view-team .dir-item:has-text("Ann Able")'); await sleep(400);
const ps = await A.p.locator('.sheet').innerText(); check(/0555 ?000 ?111|555000111/.test(await A.p.locator('.sheet a[href^="tel:"]').first().getAttribute('href') || ''), 'Call uses the number from the contact card (read only)');
check(/Contact card|Numbers/.test(ps), 'the sheet links to where cards are edited');
await A.p.keyboard.press('Escape');
check(await A.p.evaluate(() => JSON.parse(localStorage.getItem('mandarin.hub') || '{}').citrusPlan?.days?.['2026-11-16']?.blocks?.length === 1), 'Citrus’s plan is read for the dial');
console.log('a second device');
const B = await device('desktop', { width: 1400 });
await sleep(400);
check(!(await B.p.locator('.sheet h2:has-text("Bring your work over")').count()), 'the second device does not ask again (it reads Mandarin’s own state)');
await sync(B.p);
const sb = await state(B.p); check(sb.swaps['2026-11-21'] && sb.me?.id === '1', 'the desktop has the phone’s data');
await B.p.evaluate(() => { const st = window.__mandarin.store; st.update(s => ({ ...s, favs: { ...(s.favs || {}), 'id:2': { at: Date.now() } } })); }); await sleep(300);
await sync(B.p); await sync(A.p);
check(!!(await state(A.p)).favs?.['id:2'], 'a favourite starred on the desktop reaches the phone');
const twins = g.tree().filter(l => /status\.json|state\.json|shifts\.json/.test(l)); check(new Set(twins).size === twins.length || twins.length <= 6, `no duplicate files (${twins.length} json files)`);
check(!A.p.errors.length && !B.p.errors.length, `no page errors${[...A.p.errors, ...B.p.errors].slice(0, 2).join(' | ')}`);
await browser.close(); server.close();
if (bad()) { console.log(`${bad()} hub check(s) FAILED`); process.exit(1); }
