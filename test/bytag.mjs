// Folders found by tag (claude/drive-layout.md): after Citrus moves the folders into Citrus/…, Mandarin finds them by
// appProperties.citrusApp, reads and writes there, and never creates My Apps again. On an old, untagged Drive it uses
// My Apps/hub/mandarin and My Apps/Rotas and tags them. status.json says drive.byTag. Made-up data only. Run: node test/bytag.mjs
import { chromium, serve, sleep, checker } from './helpers.mjs';
import { createFakeGoogle } from './fake-google.mjs';

const { server, url } = await serve(), browser = await chromium.launch(), { check, bad } = checker();
const tag = (g, id, t) => { const f = g.files.get(id); f.appProperties = { ...(f.appProperties || {}), citrusApp: t }; };
const until = async (p, fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(150); } return false; };
async function device(g) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  await g.attach(ctx);
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  await p.clock.install({ time: new Date('2026-11-17T08:00:00+03:00') });
  await p.addInitScript(() => { localStorage.setItem('mandarin.google', JSON.stringify({ access_token: 'tok', exp: Date.now() + 3600e3, email: 'tester@example.com' }));
    localStorage.setItem('mandarin.state.v1', JSON.stringify({ app: 'mandarin', updatedAt: 1, migrated: { from: 'skipped', at: 1 }, google: { connected: true } })); });
  await p.goto(url); await p.waitForSelector('#view-today.active');
  await until(p, () => !window.__mandarin.rt.syncing); await p.evaluate(() => window.__mandarin.refreshAll(true)); await until(p, () => !window.__mandarin.rt.syncing); await sleep(500);
  await p.evaluate(() => window.__mandarin.publish?.()); await sleep(800);
  return { ctx, p };
}

console.log('a Drive already moved into Citrus/…');
{
  const g = createFakeGoogle();
  const me = g.path(['Citrus', 'Work', 'Mandarin']), rotas = g.path(['Citrus', 'Work', 'Rotas']), citrus = g.path(['Citrus', '00 Hub', 'Citrus']), claude = g.path(['Citrus', '00 Hub', 'Claude']);
  tag(g, me, 'mandarin'); tag(g, rotas, 'rotas'); tag(g, citrus, 'citrus'); tag(g, claude, 'claude');
  g.put('plan.json', citrus, { app: 'citrus', days: { '2026-11-17': { blocks: [{ app: 'yuzu', title: 'Yuzu: reviews', start: '21:00', end: '21:30', status: 'accepted' }] } } });
  g.put('status.json', claude, { app: 'claude', updatedAt: '2026-11-17T04:00:00Z', inbox: [] });
  const { p, ctx } = await device(g);
  const st = g.readJsonAt(['Citrus', 'Work', 'Mandarin'], 'status.json');
  check(st?.drive?.byTag === true, 'status.json is written in the tagged folder and says drive.byTag');
  check(!!g.readJsonAt(['Citrus', 'Work', 'Mandarin'], 'state.json'), 'state.json goes to the tagged folder');
  check(!g.path(['My Apps'], false), `no My Apps folder is created (tree:\n${g.tree().join('\n')})`);
  check(await p.evaluate(() => !!window.__mandarin.rt.hub?.citrusPlan), 'plan.json is read from the tagged Citrus folder');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await ctx.close();
}

console.log('an old, untagged Drive');
{
  const g = createFakeGoogle();
  const old = g.path(['My Apps', 'hub', 'mandarin']);
  const { p, ctx } = await device(g);
  check(g.files.get(old).appProperties?.citrusApp === 'mandarin', 'the old My Apps/hub/mandarin folder is used and tagged');
  const rotas = g.path(['My Apps', 'Rotas'], false);
  check(!!rotas && g.files.get(rotas).appProperties?.citrusApp === 'rotas', 'My Apps/Rotas is used and tagged');
  check(g.readJsonAt(['My Apps', 'hub', 'mandarin'], 'status.json')?.drive?.byTag === true, 'status.json says drive.byTag');
  const twins = [...g.files.values()].filter(f => f.name === 'mandarin' && !f.trashed).length;
  check(twins === 1, 'one Mandarin folder only');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await ctx.close();
}
await browser.close(); server.close();
if (bad()) { console.log(`${bad()} FAILED`); process.exit(1); } else console.log('all passed');
