// Every tab and the main sheets render at phone and desktop sizes with the real November files, with no page errors and no
// stray "undefined" / "NaN" / "null" on screen. Run: node test/smoke.mjs
import { chromium, serve, page, importAll, hasData, sleep, checker, ME } from './helpers.mjs';
import fs from 'node:fs'; import path from 'node:path';
if (!hasData()) { console.log('no test/data — skipped'); process.exit(0); }
const shots = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'shots/smoke'); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(shots, { recursive: true });
const { server, url } = await serve(), browser = await chromium.launch(), { check, bad } = checker();
const TABS = ['today', 'calendar', 'team', 'nurses', 'month', 'career', 'more'];
for (const [w, hgt, time] of [[390, 844, '2026-11-16T09:30:00+03:00'], [320, 640, '2026-11-17T02:30:00+03:00'], [1500, 900, '2026-11-16T19:30:00+03:00']]) {
  console.log(`${w}px at ${time.slice(11, 16)}`);
  const { p, ctx, errors } = await page(browser, { width: w, height: hgt, time, seed: { me: ME } });
  await p.goto(url); await sleep(500);
  await importAll(p);
  for (const t of TABS) {
    if (t === 'more') await p.click('#btnMore'); else await p.click(`nav.tabs button[data-view=${t}]`);
    await sleep(350);
    const txt = await p.locator(`#view-${t}`).innerText();
    check(txt.length > 40, `${t} renders (${txt.length} chars)`);
    check(!/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/.test(txt), `${t}: no undefined / NaN / null`);
    check(!/This screen hit a problem/.test(txt), `${t}: no crash card`);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(over <= 1, `${t}: no sideways scroll (${over}px)`);
    await p.screenshot({ path: `${shots}/${w}-${t}.png`, fullPage: true });
  }
  // sub-tabs
  for (const [tab, seg] of [['month', 'Swaps & covers'], ['month', 'Shift log'], ['career', 'Pay'], ['career', 'Licences'], ['career', 'Next job'], ['career', 'CV'], ['team', 'Who I work with']]) {
    await p.click(`nav.tabs button[data-view=${tab}]`); await sleep(150); await p.click(`#view-${tab} .seg button:has-text("${seg}")`); await sleep(300);
    const txt = await p.locator(`#view-${tab}`).innerText(); check(!/\bundefined\b|\bNaN\b|This screen hit a problem/.test(txt) && txt.length > 30, `${tab} › ${seg} renders`);
    await p.screenshot({ path: `${shots}/${w}-${tab}-${seg.replace(/\W+/g, '-')}.png`, fullPage: true });
  }
  // a day sheet
  await p.click('nav.tabs button[data-view=calendar]'); await sleep(200); await p.click('#view-calendar .cal .day:not(.pad) >> nth=15'); await sleep(400);
  const sh = await p.locator('.sheet').innerText(); check(sh.length > 40 && !/\bundefined\b|\bNaN\b/.test(sh), 'day sheet renders');
  await p.screenshot({ path: `${shots}/${w}-daysheet.png` });
  await p.keyboard.press('Escape'); await sleep(150);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close(); server.close();
if (bad()) { console.log(`${bad()} smoke check(s) FAILED`); process.exit(1); }
