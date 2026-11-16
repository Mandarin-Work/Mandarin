// Mandarin's own logic on a synthetic rota with made-up people: hub files, the Citrus migration, shift log, swaps and covers,
// team history, licences and CME, payslips, CV, .ics, the Claude inbox, the read-only contact cards, and old rotas' staffing rows.
// Run: node test/mandarin.mjs
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.location = { href: 'https://x/' };
globalThis.localStorage = { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), get length() { return mem.size; }, key: (i) => [...mem.keys()][i] };
const HUB = await import('../docs/js/hub.js'), MIG = await import('../docs/js/migrate.js'), SL = await import('../docs/js/shiftlog.js'), SW = await import('../docs/js/swaplog.js');
const T = await import('../docs/js/team.js'), K = await import('../docs/js/creds.js'), P = await import('../docs/js/payslips.js'), CV = await import('../docs/js/cv.js'), ICS = await import('../docs/js/ics.js');
const IN = await import('../docs/js/inbox.js'), DIR = await import('../docs/js/directory.js'), RP = await import('../docs/js/rota-parser.js'), ST = await import('../docs/js/store.js'), M = await import('../docs/js/model.js');
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };

const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const legend = { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' }, D2: { desc: 'Lower Village' } };
const mine = {}; for (let d = 1; d <= 30; d++) mine[d] = [5, 6, 12, 13, 19, 20, 26, 27].includes(d) ? '' : [3, 4, 10, 11].includes(d) ? 'N1' : 'D1';
const ann = {}; for (let d = 1; d <= 30; d++) ann[d] = mine[d] || 'D2';
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend, people: [{ name: 'Dr Test Me', id: '1', title: 'GP', mobile: '0501234567', days: mine }, { name: 'Dr Ann Able', id: '2', days: ann }, { name: 'Dr Bo Bright', id: '3', days: Object.fromEntries(Object.keys(mine).map(d => [d, 'D2'])) }], importedAt: '2026-11-01T00:00:00Z' };
const base = { me: { id: '1', name: 'Dr Test Me' }, rotas: { [gp.id]: gp }, settings: {}, swaps: {}, shiftLog: {}, favs: {}, deleted: {} };

await t('hub status.json: summary, today/next, week hours, metrics, deep links; nothing private', () => {
  const st = HUB.buildStatus(base, new Date(2026, 10, 9, 7, 30));
  assert.equal(st.app, 'mandarin'); assert.match(st.summary, /today D1 Upper Village 08:00–20:00/); assert.match(st.summary, /tomorrow N1/);
  assert.ok(st.metrics.some(m => m.key === 'week-hours' && m.goal === 48)); assert.ok(st.actions.every(a => /^https:\/\/mandarin-work\.github\.io\/Mandarin\//.test(a.url)));
  assert.ok(!/0501234567|salary|basic/i.test(JSON.stringify(st)), 'no phone numbers or pay'); assert.equal(st.today.done, false);
});
await t('hub shifts.json: my days (unknown is not off), roster by rota key, legend with hours', () => {
  const sh = HUB.buildShifts(base, new Date(2026, 10, 9, 12));
  const d9 = sh.days.find(d => d.date === '2026-11-09'); assert.equal(d9.code, 'D1'); assert.equal(d9.start, '08:00'); assert.deepEqual(d9.with, ['Ann']);
  assert.equal(sh.days.find(d => d.date === '2026-11-12').kind, 'off'); assert.ok(!sh.days.some(d => d.date >= '2026-12-01'), 'no December rota: those days are left out, not called off');
  assert.ok(sh.roster['id:2'].days['2026-11-09']); assert.equal(sh.legend.D1.site, 'Upper Village'); assert.ok(!JSON.stringify(sh).includes('0501234567'));
});
await t('migration: takes the work parts of Citrus, leaves Mind/social/media, maps day ratings on work days to shift ratings', () => {
  const citrus = { updatedAt: 5, me: { id: '1', name: 'Dr Test Me' }, rotas: { [gp.id]: gp }, swaps: { '2026-11-21': { code: '', with: 'Dr Ann Able', at: 3 } }, posts: { '2026-11-09:id:9': { site: 'UPV', at: 2 } },
    jobs: { j: { id: 'j', employer: 'Clinic', status: 'current', at: 1 } }, tasks: { x: { title: 'buy milk' } }, friends: { f: { name: 'Pal' } }, media: { m: { title: 'Book' } },
    dayLog: { '2026-11-09': { score: 4, note: 'busy', at: 9 }, '2026-11-12': { score: 2, at: 9 } }, inboxLog: { 'claude:p1': { status: 'accepted', type: 'posting', at: 1 }, 'claude:t1': { status: 'accepted', type: 'task' } },
    settings: { nurseStaffing: { day: { UPV: 4 } }, labor: { on: true }, custom: { tabs: {} } }, deleted: { 'swap:2026-11-02': Date.now(), 'task:z': Date.now() } };
  const { state, counts } = MIG.applyMigration(ST.mergeStates(base, {}), citrus);
  assert.equal(counts.rotas, 1); assert.ok(state.swaps['2026-11-21']); assert.ok(state.posts['2026-11-09:id:9']); assert.ok(state.jobs.j);
  assert.ok(!state.tasks && !state.friends && !state.media, 'Citrus-only data stays in Citrus'); assert.equal(state.shiftLog['2026-11-09'].rating, 4); assert.ok(!state.shiftLog['2026-11-12'], 'a day off is not a shift');
  assert.ok(state.inboxLog['claude:p1'] && !state.inboxLog['claude:t1']); assert.equal(state.settings.nurseStaffing.day.UPV, 4); assert.ok(!state.settings.custom);
  assert.ok(state.deleted['swap:2026-11-02'] && !state.deleted['task:z']); assert.equal(state.migrated.from, 'citrus'); assert.match(MIG.describe(counts), /1 rota · 1 correction/);
});
await t('migration twice is harmless and never loses a newer local edit', () => {
  const local = { ...ST.mergeStates(base, {}), swaps: { '2026-11-21': { code: 'D1', with: '', at: 99 } }, updatedAt: 100 };
  const citrus = { updatedAt: 5, rotas: { [gp.id]: gp }, swaps: { '2026-11-21': { code: '', with: 'Dr Ann Able', at: 3 } } };
  const a = MIG.applyMigration(local, citrus).state, b = MIG.applyMigration(a, citrus).state;
  assert.equal(b.swaps['2026-11-21'].code, 'D1'); assert.equal(Object.keys(b.rotas).length, 1);
});
await t('shift log: rating 1–5, counts 0–300, notes refuse IDs and file numbers; unlogged shifts; month stats with colleagues', () => {
  let s = SL.logShift(base, '2026-11-09', { rating: 4, seen: '23', transfers: 1, note: 'busy morning' });
  assert.equal(s.shiftLog['2026-11-09'].seen, 23); assert.equal(SL.logShift(s, '2026-11-09', { rating: 9 }).shiftLog['2026-11-09'].rating, 4);
  assert.equal(SL.checkNote('MRN 1234567 came back').ok, false); assert.equal(SL.logShift(s, '2026-11-09', { note: 'file 0501234567' }).shiftLog['2026-11-09'].note, 'busy morning');
  assert.equal(SL.logShift(s, '2026-11-09', { seen: 99999 }).shiftLog['2026-11-09'].seen, 300);
  s = SL.logShift(s, '2026-11-14', { rating: 5 });
  const un = SL.unlogged(s, new Date(2026, 10, 16, 21), 3).map(x => x.key); assert.deepEqual(un, ['2026-11-16', '2026-11-15'], 'shifts that ended and were not rated');
  assert.equal(SL.askNow(s, new Date(2026, 10, 16, 21))?.key, '2026-11-16');
  const st = SL.monthStats(s, 2026, 11); assert.equal(st.rated, 2); assert.equal(st.avg, 4.5); assert.equal(st.totals.seen, 23); assert.equal(st.withPeople[0].name, 'Dr Ann Able');
  assert.equal(SL.monthAverage(s, new Date(2026, 10, 20)), 4.5); assert.ok(!SL.clearLog(s, '2026-11-09').shiftLog['2026-11-09']);
});
await t('swaps and covers: kinds read from old records, who-owes-whom balance, month counts', () => {
  const s = { ...base, swaps: { '2026-11-07': { code: '', with: 'Dr Ann Able', kind: 'got', at: 1 }, '2026-11-14': { code: 'D1', with: 'Dr Ann Able', kind: 'gave', at: 1 }, '2026-11-15': { code: 'D1', with: 'Dr Ann Able', kind: 'gave', at: 1 }, '2026-11-21': { code: 'N1', with: 'Dr Bo Bright', at: 1 }, '2026-11-22': { code: 'VL', at: 1 } } };
  const l = SW.list(s); assert.equal(l[0].key, '2026-11-22'); assert.equal(l[0].kind, 'leave'); assert.equal(l.find(x => x.key === '2026-11-21').kind, 'swap'); assert.equal(l.find(x => x.key === '2026-11-14').raw, 'D1');
  const b = SW.balances(s), a = b.find(x => x.name === 'Dr Ann Able'); assert.equal(a.balance, 1); assert.equal(a.gave, 2);
  assert.deepEqual(SW.monthCounts(s, 2026, 11), { swap: 1, gave: 2, got: 1, leave: 1, cancel: 0, fix: 0 });
});
await t('team: history from dayInfo (a swap changes who you were with), favourites, tomorrow’s team the evening before', () => {
  const s = T.toggleFav(base, 'id:2'), h = T.history(s, new Date(2026, 10, 9));
  assert.equal(h[0].key, 'id:2'); assert.ok(h[0].fav && h[0].n > 10); assert.ok(!h.some(x => x.key === 'id:3'), 'Bo is at another site');
  assert.equal(T.nextWith(s, 'id:2', new Date(2026, 10, 20), 3)[0].key, '2026-11-21');
  const tt = T.tomorrowTeam(s, new Date(2026, 10, 8, 19)); assert.equal(tt.date.getDate(), 9); assert.equal(tt.favs[0].name, 'Dr Ann Able');
  assert.equal(T.tomorrowTeam(s, new Date(2026, 10, 8, 10)), null, 'not before 16:00');
  const tn = T.tomorrowTeam(s, new Date(2026, 10, 10, 11)); assert.ok(tn.tonight, 'the morning of a night shows tonight');
  assert.ok(!T.isFav(T.toggleFav(s, 'id:2'), 'id:2'));
  const sw = { ...s, swaps: { '2026-11-09': { code: '', with: '', at: 1 } } }; assert.ok(T.history(sw, new Date(2026, 10, 1))[0].n < h[0].n);
});
await t('licences: expiry states, due-soon list, cleaned input; CME progress against your own target', () => {
  let s = K.saveCred(base, { kind: 'bls', expires: '2026-12-01' }); s = K.saveCred(s, { kind: 'scfhs', name: 'SCFHS', expires: '2026-10-01' }); s = K.saveCred(s, { kind: 'acls', expires: '2028-01-01' });
  const due = K.dueSoon(s, new Date(2026, 10, 16), 60); assert.deepEqual(due.map(c => c.kind), ['scfhs', 'bls']); assert.equal(due[0].state, 'expired');
  assert.ok(K.credErrors({ kind: 'bls', issued: '2026-05-01', expires: '2026-01-01' }).expires);
  s = K.saveCme(s, { title: 'ACLS course', hours: 8, date: '2026-06-01' }); s = K.saveCme(s, { title: 'Old', hours: 5, date: '2025-01-01' });
  const p = K.cmeProgress(s, new Date(2026, 10, 16)); assert.equal(p.last12, 8); assert.equal(p.target, 30); assert.equal(K.cmeProgress({ ...s, settings: { career: { cmeTarget: 16 } } }, new Date(2026, 10, 16)).pct, 50);
  assert.ok(K.cmeErrors({ title: '', hours: 0 }).title);
});
await t('payslips: checked against the contract and the rota overtime; missing months listed', () => {
  const s = { ...base, jobs: { j: { id: 'j', employer: 'Clinic', status: 'current', start: '2026-08-01', basic: 10000, housing: 2500, transport: 1000, other: 0, hoursWeek: 48, leave: 30 } }, settings: { labor: { on: true } } };
  const s2 = P.saveSlip(s, '2026-10', { basic: 9000, housing: 2500, transport: 1000, net: 12000 }), c = P.checkSlip(s2, s2.payslips['2026-10']);
  assert.ok(c.lines.some(l => l.level === 'warn' && /Basic 9000/.test(l.msg)));
  const ok = P.checkSlip(P.saveSlip(s, '2026-09', { basic: 10000, housing: 2500, transport: 1000, net: 13000 }), { month: '2026-09', basic: 10000, housing: 2500, transport: 1000, other: 0, overtime: 0, net: 13000 });
  assert.ok(!ok.lines.some(l => /Basic/.test(l.msg)));
  assert.ok(P.slipErrors('2026-10', { basic: 100, net: 5000 }).net, 'net above gross is caught'); assert.ok(P.slipErrors('x', { net: 1 }).month);
  assert.deepEqual(P.slipSummary(s2, new Date(2026, 10, 16)).missing, ['2026-09', '2026-08']);
});
await t('CV: jobs, postings and valid licences, no pay or ratings, HTML escaped; lessons from past jobs speak up', () => {
  const s = { ...base, cv: { name: 'Test <Me>', title: 'GP', education: 'MBBS\nInternship' }, jobs: { a: { id: 'a', employer: 'Tamarind Contracting Co', status: 'past', start: '2024-01-01', end: '2024-06-01', basic: 9999, rating: 1, again: 'no', aspects: { food: 1, housing: 2 } }, b: { id: 'b', employer: 'Clinic', role: 'GP', status: 'current', start: '2025-08-01', basic: 12345 } }, creds: { c: { id: 'c', kind: 'bls', name: 'BLS', expires: '2027-01-01' }, d: { id: 'd', kind: 'acls', name: 'ACLS', expires: '2020-01-01' } } };
  const html = CV.cvHtml(s, new Date(2026, 10, 16)); assert.ok(html.includes('Test &lt;Me&gt;')); assert.ok(html.includes('Tamarind') && html.includes('present')); assert.ok(!/9999|12345/.test(html)); assert.ok(html.includes('BLS') && !html.includes('ACLS'));
  assert.ok(!/<script/i.test(html));
  const l = CV.lessons(s, { employer: 'Tamarind Group' }); assert.ok(l.some(x => x.level === 'warn' && /would not go back/.test(x.text))); assert.ok(l.some(x => /food, living quarters/.test(x.text)));
  assert.equal(CV.lessons(s, { employer: 'Brand New Hospital' }).filter(x => x.level === 'warn').length, 0);
});
await t('.ics: one event per shift with stable UIDs, folded lines, optional alarm', () => {
  const { text, count } = ICS.shiftsIcs(base, new Date(2026, 10, 1), 30, { alarmMin: 60 });
  assert.equal(count, 22); assert.ok(text.includes('UID:mandarin-2026-11-09@')); assert.ok(text.includes('TRIGGER:-PT60M')); assert.ok(text.split('\r\n').every(l => l.length <= 75)); assert.ok(text.startsWith('BEGIN:VCALENDAR'));
});
await t('Claude inbox: posting/swap/nurse only, decided ones never offered again, past dates dropped', () => {
  const claude = { app: 'claude', updatedAt: '2026-11-16T05:00:00Z', inbox: [{ id: 's1', type: 'swap', date: '2026-11-21', code: 'D1', with: 'Dr Bo Bright' }, { id: 't1', type: 'task', title: 'Not for Mandarin' }, { id: 'old', type: 'swap', date: '2026-11-01', code: '' }] };
  const p = IN.pending(base, { claude }, new Date(2026, 10, 16)); assert.deepEqual(p.map(x => x.item.id), ['s1']);
  const r = IN.accept(base, p[0]); assert.equal(r.state.swaps['2026-11-21'].with, 'Dr Bo Bright'); assert.equal(r.state.swaps['2026-11-21'].kind, 'swap');
  assert.equal(IN.pending(r.state, { claude }, new Date(2026, 10, 16)).length, 0); assert.equal(IN.pending(IN.dismiss(base, 'claude:s1'), { claude }, new Date(2026, 10, 16)).length, 0);
});
await t('contact cards are read only, from Clementine or Citrus; reach links prefer the card’s number', () => {
  DIR.ingest({ contacts: { 'id:2': { phone: '0555555555', insta: '@ann' } }, friends: { f: { rotaKey: 'id:2', nick: 'Annie' } } }, 'citrus');
  assert.equal(DIR.contactOf('id:2').nick, 'Annie'); assert.ok(DIR.contactOf('id:2').friend); const r = DIR.reach('id:2', '0500000000'); assert.equal(r.tel, 'tel:+966555555555'); assert.match(r.insta, /instagram\.com\/ann/);
  assert.equal(DIR.reach('id:3', '0500000000').tel, 'tel:+966500000000'); assert.equal(DIR.source(), 'citrus');
});
await t('old rotas: planned-staffing rows move to rota.coverage on load and never show as people', () => {
  const r = { ...gp, people: [...gp.people, { name: 'Upper Village day', id: '', days: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, String(i % 4)])) }] };
  const c = RP.splitCoverage(r); assert.equal(c.people.length, 3); assert.equal(c.coverage['Upper Village day'][2], 1); assert.equal(RP.splitCoverage(gp), gp, 'nothing to move: same object');
  const clean = ST.sanitize({ rotas: { [r.id]: r } }); assert.equal(clean.rotas[r.id].people.length, 3);
});
await t('a working day without hours (Riyadh Season) is work with no window: myDay reports it as noHours', () => {
  const g2 = { ...gp, people: [{ ...gp.people[0], days: { 9: 'Riyadh Season' } }] }, md = M.myDay({ ...base, rotas: { [g2.id]: g2 } }, new Date(2026, 10, 9));
  assert.equal(md.today, null); assert.equal(md.noHours.code, 'Riyadh Season');
  assert.doesNotThrow(() => HUB.buildStatus({ ...base, rotas: { [g2.id]: g2 } }, new Date(2026, 10, 9, 9)));
});
await t('store: new collections merge record by record with tombstones', () => {
  const a = { ...base, updatedAt: 1, payslips: { '2026-10': { net: 1, at: 1 } }, creds: { c: { name: 'BLS', at: 5 } }, favs: { 'id:2': { at: 1 } } };
  const b = { ...base, updatedAt: 2, payslips: { '2026-09': { net: 2, at: 2 } }, creds: {}, deleted: { 'cred:c': 9 }, favs: {} };
  const m = ST.mergeStates(a, b); assert.ok(m.payslips['2026-10'] && m.payslips['2026-09']); assert.ok(!m.creds.c, 'deleted on the other device'); assert.ok(m.favs['id:2'], 'a fav with no tombstone survives');
});

await t('beta T5: one clock — an edit on a device whose clock is behind still wins; tombstones too', () => {
  const ahead = Date.now() + 600000;
  ST.replaceState({ ...base, swaps: { '2026-11-28': { code: 'D1', note: 'A', at: ahead } }, deleted: {} });
  ST.update(s => ({ ...s, swaps: { ...s.swaps, '2026-11-28': { ...s.swaps['2026-11-28'], note: 'C later', at: Date.now() } } }));
  assert.ok(ST.get().swaps['2026-11-28'].at > ahead, 'the later edit is stamped past everything seen');
  const remote = { ...base, updatedAt: ahead, swaps: { '2026-11-28': { code: 'D1', note: 'A', at: ahead } } };
  assert.equal(ST.mergeStates(ST.get(), remote).swaps['2026-11-28'].note, 'C later');
  ST.update(s => { const m = { ...s.swaps }; delete m['2026-11-28']; return { ...s, swaps: m, deleted: ST.tombstone(s, 'swap:2026-11-28') }; });
  assert.ok(!ST.mergeStates(ST.get(), remote).swaps['2026-11-28'], 'a delete on the slow device holds');
});
await t('beta T5: Replace and Undo hold after a sync (tombstones for what went away)', () => {
  const t0 = Date.now();
  ST.replaceState({ ...base, swaps: { a: { code: 'D1', at: t0 }, b: { code: 'D2', at: t0 } }, deleted: {} });
  const other = ST.get(), before = ST.get();
  ST.replaceState({ ...base, swaps: { a: { code: 'D1', at: t0 } } }, { bump: true, exact: before });
  assert.ok(!ST.mergeStates(ST.get(), other).swaps.b, 'a record the backup did not have stays gone');
  const cur = ST.get(); ST.replaceState(before, { bump: true, exact: cur });
  assert.ok(ST.mergeStates(ST.get(), cur).swaps.b, 'Undo brings it back for good');
});
await t('beta T5: imports — Citrus backups are spotted, foreign keys dropped, no Drive folder carried over', async () => {
  assert.ok(MIG.looksLikeCitrus({ rotas: {}, contacts: {} }) && MIG.looksLikeCitrus({ rotas: {} }) && !MIG.looksLikeCitrus({ app: 'mandarin', rotas: {} }));
  const BC = await import('../docs/js/backup-check.js');
  const r = BC.checkBackup({ app: 'mandarin', rotas: {}, swaps: {}, contacts: { x: { phone: '1' } }, memos: {} });
  assert.ok(r.ok && !('contacts' in r.state) && !('memos' in r.state));
  const w = MIG.workPart({ rotas: { [gp.id]: gp }, settings: { driveFolder: 'Citrus Maxima', clientId: 'x' }, inboxLog: { 'claude:sw-dis': { status: 'dismissed', at: 1 } }, deleted: { 'slog:2026-11-10:bio': 5 } });
  assert.ok(!('driveFolder' in (w.part.settings || {})) && !('clientId' in (w.part.settings || {})));
  assert.ok(w.part.inboxLog?.['claude:sw-dis'], 'a dismissed proposal stays dismissed'); assert.ok(!w.part.deleted?.['slog:2026-11-10:bio'], 'Citrus study-log tombstones stay out');
});
await t('beta T5: shifts.json roster carries legend codes or the kind of day, never free text', () => {
  const g2 = { ...gp, people: [...gp.people, { name: 'Dr Free Text', id: '9', days: { 9: 'END OF CONTRACT', 10: 'D1' } }] };
  const sh = HUB.buildShifts({ ...base, rotas: { [g2.id]: g2 } }, new Date(2026, 10, 9, 12));
  assert.equal(sh.roster['id:9'].days['2026-11-10'], 'D1'); assert.ok(!/CONTRACT/.test(JSON.stringify(sh)));
  const st = HUB.buildStatus(base, new Date(2026, 10, 4, 9, 30)); assert.match(st.summary, /today N1/); assert.ok(st.actions.length <= 6 && st.actions.some(a => a.id === 'leave'));
});
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
