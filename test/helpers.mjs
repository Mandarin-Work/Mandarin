// Shared bits for the browser tests: a static server for docs/, a page with a pinned clock, and the real rota files
// (test/data/*.xlsx, never committed: the tests skip themselves when they are missing).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
export const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs');
export const data = (f) => path.join(here, 'data', f);
export const hasData = () => ['main.xlsx', 'nurses.xlsx', 'fsed.xlsx', 'uv.xlsx'].every(f => fs.existsSync(data(f)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
export async function serve() {
  const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
  await new Promise(r => server.on('listening', r));
  return { server, url: `http://localhost:${server.address().port}/index.html` };
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export function checker() { let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); }; return { check, bad: () => bad }; }
/** A phone (or desktop) page with the clock pinned, collecting page errors. seed: state written before the app starts. */
export async function page(browser, { width = 390, height = 844, time = '2026-11-16T09:30:00+03:00', seed = null, mobile = width < 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage(), errors = [];
  if (time) await p.clock.install({ time: new Date(time) });
  // the CV preview is a sandboxed iframe: Playwright's own init scripts fail inside it, which is not an app error
  p.on('pageerror', e => { if (!/sandboxed|about:srcdoc/.test(e.message)) errors.push(e.message); });
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi|fonts|sandboxed|about:srcdoc/.test(m.text())) errors.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  if (seed) await p.addInitScript((s) => { if (!localStorage.getItem('mandarin.state.v1')) localStorage.setItem('mandarin.state.v1', JSON.stringify(s)); }, seed);
  return { p, ctx, errors };
}
// "me" is picked from the real file at run time, so no real name or staff ID is ever written in this repo:
// ME = the GP row with the most shifts (with hours) in the week of 16/11; AWAY = a row working a code with no hours on 16/11.
async function pickRows() {
  if (!hasData()) return { ME: { name: 'Dr Test Me', id: '1' }, AWAY: null };
  const { parseRotaFile, serializeRota, interpretCode } = await import('../docs/js/rota-parser.js');
  const b = fs.readFileSync(data('main.xlsx')), r = serializeRota(await parseRotaFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), 'main.xlsx'));
  const sh = (p, d) => interpretCode(p.days[d] || '', r.legend, 'gp');
  const rows = r.people.filter(p => p.id).map(p => ({ p, n: [16, 17, 18, 19, 20, 21, 22].filter(d => sh(p, d).kind === 'work' && sh(p, d).hours).length + (sh(p, 16).kind === 'work' && sh(p, 16).hours ? 3 : 0) }));
  const me = rows.sort((a, b) => b.n - a.n || a.p.id.localeCompare(b.p.id))[0].p, away = r.people.find(p => p.id && sh(p, 16).kind === 'work' && !sh(p, 16).hours);
  return { ME: { name: me.name, id: me.id }, AWAY: away ? { name: away.name, id: away.id } : null };
}
export const { ME, AWAY } = await pickRows();
export async function importAll(p) {
  await p.click('nav.tabs button[data-view=calendar]'); await sleep(200);
  await p.locator('#view-calendar input[type=file]').first().setInputFiles([data('main.xlsx'), data('nurses.xlsx'), data('fsed.xlsx'), data('uv.xlsx')]);
  await sleep(2500);
}
export { chromium };
