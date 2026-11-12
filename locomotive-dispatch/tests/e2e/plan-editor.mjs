/**
 * Captive Plan tab end-to-end: edit -> apply -> console reflects it -> persists across reload ->
 * train-ID re-homing -> export -> reset. Runs against dist/index.html (npm run build first).
 *
 *   node tests/e2e/plan-editor.mjs [screenshotDir]
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) => {
  const u = r.request().url();
  return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.fulfill({ status: 404, body: '' });
});
const station = (k) => page.evaluate((key) => { const s = window.dispatchApp.app.stationsByKey[key]; return s && { required: s.required, have: s.have, road: s.have_road, status: s.status }; }, k);
const open = async () => { await page.goto(URL_); await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0'); };

await open();
const before = await station('BRANTFORD|ON');
const halBefore = await station('HALIFAX|NS');
await page.click('#vtab button[data-view="plan"]');
check(await page.locator('#pl-table tbody tr').count() === 237, 'plan tab lists all 237 locations');
check(await page.isHidden('#planchip'), 'header shows no "Edited plan" chip on the built-in plan');

// 1) Brantford: drop its job requirement from 2 to 1
await page.fill('#pl-q', 'BRANTFORD');
await page.click('#pl-table tr[data-k="BRANTFORD|ON"]');
check((await page.textContent('.pe-req .big')).trim() === String(before.required), `editor shows Brantford requirement ${before.required}`);
await page.fill('.pe-ty input[data-f="count"]', '1');
await page.press('.pe-ty input[data-f="count"]', 'Tab');
check((await page.textContent('.pe-req .big')).trim() === '1', 'requirement re-derives to 1 from the job');
check((await page.textContent('#pl-bar')).includes('1 unsaved change'), 'draft shows 1 unsaved change');
if (shots) await page.screenshot({ path: shots + '/plan-edit.png' });

// 2) Halifax: add a job for unhomed train Y542111 (base Y54211 -> BLE908 at Moncton)
await page.fill('#pl-q', 'HALIFAX');
await page.click('#pl-table tr[data-k="HALIFAX|NS"]');
await page.click('[data-act="add-train"]');
const ids = page.locator('.pe-ids').last();
await ids.fill('Y542111');
await ids.press('Tab');
await page.click('[data-act="apply"]');
await page.waitForTimeout(300);

const after = await station('BRANTFORD|ON');
check(after.required === 1 && after.status !== before.status, `console re-analysed: Brantford required ${before.required}→${after.required}, ${before.status}→${after.status}`);
const hal = await station('HALIFAX|NS');
check(hal.road === halBefore.road + 1, `train ID re-homing: Halifax units on trains ${halBefore.road}→${hal.road} (BLE908 on Y54211)`);
check(await page.evaluate(() => window.dispatchApp.app.locoIndex.BLE908.home) === 'HALIFAX|NS', 'BLE908 now homed at Halifax');
check(await page.isVisible('#planchip'), 'header shows "Edited plan" chip');
check((await page.textContent('#pl-bar')).includes('2 locations differ from built-in'), 'status bar: 2 locations differ from built-in');

// 3) export carries the edit and the re-homing override
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
const exported = JSON.parse(readFileSync(await dl.path(), 'utf8'));
check(exported.plan.find((s) => s.k === 'BRANTFORD|ON').required === 1, 'export contains the edited Brantford');
check(exported.meta.base2home_overrides && exported.meta.base2home_overrides.Y54211 === 'HALIFAX|NS', 'export carries the train re-homing override');

// 4) persists across reload
await open();
check((await station('BRANTFORD|ON')).required === 1, 'edit persists after reload');
check(await page.isVisible('#planchip'), 'chip persists after reload');

// 5) reset to built-in
await page.click('#vtab button[data-view="plan"]');
page.once('dialog', (d) => d.accept());
await page.click('[data-act="reset"]');
await page.waitForTimeout(300);
const reset = await station('BRANTFORD|ON');
check(reset.required === before.required && reset.status === before.status, 'reset restores the built-in plan');
check(await page.isHidden('#planchip'), 'chip hidden after reset');
await open();
check((await station('BRANTFORD|ON')).required === before.required, 'reset persists after reload');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nPLAN EDITOR OK');
process.exitCode = failures ? 1 : 0;
