/**
 * Light / dark toggle: switches, persists, applies before first paint, labels itself.
 *   node tests/e2e/theme.mjs        (after npm run build)
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const URL_ = pathToFileURL(path.join(root, 'dist/index.html')).href;
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.fulfill({ status: 404, body: '' }); });
const state = () => page.evaluate(() => ({
  theme: document.documentElement.dataset.theme || 'dark',
  bg: getComputedStyle(document.body).backgroundColor,
  label: document.getElementById('themetog').getAttribute('aria-label'),
  pressed: document.getElementById('themetog').getAttribute('aria-pressed'),
}));

await page.goto(URL_);
await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0');
let s = await state();
check(s.theme === 'light' && s.bg === 'rgb(238, 240, 243)', `default is light (${s.bg})`);
check(s.label === 'Switch to dark mode' && s.pressed === 'true', 'toggle labelled "Switch to dark mode"');

await page.click('#themetog');
s = await state();
check(s.theme === 'dark' && s.bg === 'rgb(12, 13, 15)', `click switches to dark (${s.bg})`);
check(s.label === 'Switch to light mode' && s.pressed === 'false', 'toggle relabels to "Switch to light mode"');

// persisted, and applied before the app script runs (no flash of dark)
await page.addInitScript(() => {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive') window.__themeAtParse = document.documentElement.dataset.theme || 'dark';
  });
});
await page.reload();
await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0');
check((await state()).theme === 'dark', 'dark persists after reload');
check(await page.evaluate(() => window.__themeAtParse) === 'dark', 'chosen theme applied before first paint (set during parse)');

// every view renders without errors
for (const v of ['dash', 'fleet', 'actions', 'plan', 'console']) {
  await page.evaluate((view) => document.querySelector(`#vtab button[data-view="${view}"]`).click(), v);
  await page.waitForTimeout(120);
}
check((await state()).theme === 'dark', 'theme unchanged while switching views');

await page.click('#themetog');
await page.reload();
await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0');
check((await state()).theme === 'light', 'back to light persists after reload');
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nTHEME OK');
process.exitCode = failures ? 1 : 0;
