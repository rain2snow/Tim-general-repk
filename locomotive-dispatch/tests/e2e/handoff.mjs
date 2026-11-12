/**
 * Session handoff between two separate browsers (isolated storage), end to end:
 * dispatcher A changes everything and exports a session file; dispatcher B imports it (Replace),
 * gets A's exact state, keeps it across a reload, and a Merge import keeps B's own changes.
 *   node tests/e2e/handoff.mjs [screenshotDir]      (after npm run build)
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const URL_ = pathToFileURL(path.join(root, 'dist/index.html')).href;
const shots = process.argv[2];
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const snap = JSON.parse(readFileSync(path.join(root, 'data/snapshot.json'), 'utf8'));
const avail = snap.fleet.filter((f) => f.desig === 'Available' && !f.hhp && !/^(YBU|HBU|CALF)/.test(f.model) && f.home !== 'HALIFAX|NS' && f.k !== 'HALIFAX|NS');
const [UNIT_A, UNIT_B] = [avail[0].loco, avail[1].loco];

const browser = await chromium.launch();
async function dispatcher() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', (r) => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.fulfill({ status: 404, body: '' }); });
  page.load = async () => { await page.goto(URL_); await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0'); };
  await page.load();
  return page;
}
const state = (page) => page.evaluate(() => {
  const a = window.dispatchApp.app;
  const q = [...document.querySelectorAll('#queue .qta')].map((t) => t.value).filter(Boolean);
  return {
    theme: document.documentElement.dataset.theme || 'dark', dow: a.dow,
    brantReq: a.stationsByKey['BRANTFORD|ON'].required, halHave: a.stationsByKey['HALIFAX|NS'].have,
    assignments: Object.keys(a.assignments).sort(), plan: a.store.get('short:EDMONTON|AB'), done: a.store.get('short:EDMONTON|AB:done'),
    planEdited: !!a.planEdited, snapshot: a.data.meta.snapshot, source: a.snapshotSource, queuePlans: q.length,
  };
});
const assign = (page, loco, k) => page.evaluate(([l, key]) => document.dispatchEvent(new CustomEvent('dispatch:assign', { detail: { loco: l, k: key, note: 'handoff test', station: key } })), [loco, k]);

/* ---------------- dispatcher A: make changes and export ---------------- */
const A = await dispatcher();
await A.click('#themetog');                                                   // dark
await A.click('#dowToggle'); await A.click('#dowDays button[data-d="2"]');   // Tuesday
// captive plan: Brantford job 2 -> 1
await A.click('#vtab button[data-view="plan"]');
await A.fill('#pl-q', 'BRANTFORD'); await A.click('#pl-table tr[data-k="BRANTFORD|ON"]');
await A.fill('.pe-ty input[data-f="count"]', '1'); await A.press('.pe-ty input[data-f="count"]', 'Tab');
await A.click('[data-act="apply"]'); await A.waitForTimeout(250);
await assign(A, UNIT_A, 'HALIFAX|NS'); await A.waitForTimeout(250);
// action plan + resolved flag (stored the same way the queue / Actions Required tab store them)
await A.evaluate(() => { const s = window.dispatchApp.app.store; s.set('short:EDMONTON|AB', 'send 2 SD40 from Clover Bar'); s.set('short:EDMONTON|AB:done', '1'); });
const a = await state(A);
check(a.theme === 'dark' && a.dow === 2 && a.brantReq === 1 && a.assignments.includes(UNIT_A), 'A: changes made (dark, Tuesday, Brantford 1, manual assignment, action plan)');

await A.click('#reloadbtn');
check((await A.textContent('#ltitle')).includes('Data & handoff'), 'A: "Data & handoff" opens');
const sumA = await A.textContent('#ho-summary');
check(/1 location/.test(sumA) && /1 manual assignment/.test(sumA) && /1 action plan \(1 resolved\)/.test(sumA) && /dark mode/.test(sumA) && /Tue demand/.test(sumA),
  `A: export summary lists everything — "${sumA.replace(/\s+/g, ' ').trim()}"`);
await A.fill('#ho-by', 'Dispatcher A'); await A.fill('#ho-note', 'Night shift handoff');
if (shots) await A.screenshot({ path: shots + '/handoff-export.png' });
const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#ho-export')]);
const file = await dl.path();
const bundle = JSON.parse(readFileSync(file, 'utf8'));
check(bundle.kind === 'session' && bundle.by === 'Dispatcher A' && bundle.snapshot && bundle.snapshot.fleet.length === snap.fleet.length, `A: exported ${dl.suggestedFilename()} (with snapshot)`);

/* ---------------- dispatcher B: fresh browser, import (Replace) ---------------- */
const B = await dispatcher();
const b0 = await state(B);
check(b0.theme === 'light' && !b0.planEdited && !b0.assignments.length && !b0.plan, 'B: starts clean (light, built-in plan, no changes)');
await B.click('#reloadbtn');
await B.setInputFiles('#ho-file', file);
await B.waitForSelector('.ho-card');
const prev = await B.textContent('.ho-card');
check(prev.includes('Dispatcher A') && prev.includes('Night shift handoff') && /1 manual assignment/.test(prev), 'B: import preview shows who / note / contents');
if (shots) await B.screenshot({ path: shots + '/handoff-import.png' });
await B.click('[data-ho="apply"]'); await B.waitForTimeout(300);
const b1 = await state(B);
const same = (k) => JSON.stringify(b1[k]) === JSON.stringify(a[k]);
check(['theme', 'dow', 'brantReq', 'halHave', 'assignments', 'plan', 'done', 'planEdited', 'snapshot'].every(same),
  `B: has A's exact state (theme ${b1.theme}, day ${b1.dow}, Brantford ${b1.brantReq}, Halifax ${b1.halHave}, ${b1.assignments.length} assignment, plan "${b1.plan}")`);
check(await B.isVisible('#planchip') && await B.isVisible('#asgchip'), 'B: header shows "Edited plan" and "1 manual" chips');
check(await B.evaluate(() => document.getElementById('dowToggle').classList.contains('on')), 'B: demand toggle shows Tuesday');

await B.load();
const b2 = await state(B);
check(['theme', 'dow', 'brantReq', 'assignments', 'plan', 'snapshot'].filter((k) => k !== 'dow').every((k) => JSON.stringify(b2[k]) === JSON.stringify(a[k])) && b2.source === 'import',
  'B: everything persists after reload (snapshot kept as "import")');

/* ---------------- merge keeps B's own changes ---------------- */
await assign(B, UNIT_B, 'HALIFAX|NS'); await B.waitForTimeout(200);
await B.evaluate(() => { const s = window.dispatchApp.app.store; s.set('short:EDMONTON|AB', ''); });
await B.click('#reloadbtn');
await B.setInputFiles('#ho-file', file);
await B.waitForSelector('.ho-card');
await B.check('input[name="ho-mode"][value="merge"]');
await B.click('[data-ho="apply"]'); await B.waitForTimeout(300);
const b3 = await state(B);
check(b3.assignments.includes(UNIT_A) && b3.assignments.includes(UNIT_B), `B: Merge keeps B's own assignment (${UNIT_B}) and adds A's (${UNIT_A})`);
check(b3.plan === a.plan, 'B: Merge restores A\'s action plan text');

/* ---------------- bad file ---------------- */
await B.setInputFiles('#ho-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
await B.waitForSelector('.ho-err');
check((await B.textContent('.ho-err')).includes('Not a dispatch session file'), 'B: a non-session file is rejected with a clear message');

check(!A.errors.length && !B.errors.length, 'no page errors' + ([...A.errors, ...B.errors].length ? ': ' + [...A.errors, ...B.errors].join('; ') : ''));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nHANDOFF OK');
process.exitCode = failures ? 1 : 0;
