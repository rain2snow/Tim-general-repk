/**
 * Hub <-> line point swap plans, end to end (run after npm run build):
 * "Plan swap" on an inspection action -> editor auto-fills (due units out, fit units back) ->
 * edit sides / live net + warnings -> save -> counts, inbound "swap" tags, queue + hub list,
 * terminal popup, Fleet tab panel (edit stays on Fleet, CSV) -> persists -> in the handoff file ->
 * cancel restores the counts.
 *   node tests/e2e/swaps.mjs [screenshotDir]
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.fulfill({ status: 404, body: '' }); });
const load = async () => { await page.goto(URL_); await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0'); };
const station = (k) => page.evaluate((key) => { const s = window.dispatchApp.app.stationsByKey[key]; return { have: s.have, inbound: (s.inbound || []).map((d) => [d.loco, d.swap || '']) }; }, k);
const swaps = () => page.evaluate(() => window.dispatchApp.app.swaps);
const expandHubs = () => page.evaluate(() => document.querySelectorAll('#queue .hubgrp.collapsed .hubh').forEach((h) => h.click()));
const chipLocos = (side) => page.$$eval(`#swapdlg .swp-chips[data-side="${side}"] .swp-chip b`, (bs) => bs.map((b) => b.textContent));

await load();
await expandHubs();
const btn = await page.$('#queue .qswap[data-swap-new]');
check(!!btn, 'inspection actions at line points offer "⇄ Plan swap"');
const POINT = await btn.getAttribute('data-swap-new');
const s0 = await station(POINT);
await btn.click();
await page.waitForSelector('#swapdlg.show');
check((await page.inputValue('#swapdlg select[name="point"]')) === POINT, `editor opens on the line point (${POINT})`);
const BASE = await page.inputValue('#swapdlg select[name="base"]');
const out0 = await chipLocos('toHub'), back0 = await chipLocos('toPoint');
check(out0.length > 0, `auto-fill sends the due units to the shop: ${out0.join(', ')}`);
check(back0.length > 0, `auto-fill brings fit units back from ${BASE}: ${back0.join(', ')}`);
const evenTxt = await page.textContent('#swapdlg .swp-net');
if (shots) await page.screenshot({ path: shots + '/swap-editor.png' });

// remove a replacement -> the line point loses power (warning); add one back from the candidates
await page.click(`#swapdlg .swp-chips[data-side="toPoint"] [data-sw="del"][data-loco="${back0[0]}"]`);
check(/loses/.test(await page.textContent('#swapdlg .swp-card')), 'removing a replacement warns that the line point loses a unit');
await page.click(`#swapdlg .swp-cand[data-side="toPoint"][data-loco="${back0[0]}"]`);
check((await page.textContent('#swapdlg .swp-net')) === evenTxt, `adding it back restores "${evenTxt}"`);
await page.fill('#swapdlg input[name="eta"]', '11/14 06:00');
await page.fill('#swapdlg input[name="note"]', 'inspection swap');
await page.click('#swapdlg [data-sw="save"]');
await page.waitForTimeout(300);

const w = (await swaps())[0];
check(!(await page.isVisible('#swapdlg.show')) && w && w.id === 'W1' && w.point === POINT && w.base === BASE, 'plan W1 saved, editor closed');
const s1 = await station(POINT), b1 = await station(BASE);
const net = evenTxt === 'even swap' ? 0 : null;
if (net === 0) check(s1.have === s0.have, `even swap: ${POINT} on hand stays ${s0.have}`);
check(back0.every((l) => s1.inbound.some(([x, sw]) => x === l && sw === 'W1')), 'replacements are inbound to the line point, tagged W1');
check(out0.every((l) => b1.inbound.some(([x, sw]) => x === l && sw === 'W1')), 'due units are inbound to the hub terminal, tagged W1');
await expandHubs();
check(await page.isVisible(`#queue .qswap.has[data-swap-edit="W1"]`), 'queue inspection action now shows "⇄ In swap W1"');
check((await page.textContent('#queue .swplist')).includes('W1'), 'hub group lists the swap plan');
check((await page.textContent('#asgchip')).trim() === '1 manual', 'header chip counts the plan');
if (shots) await page.screenshot({ path: shots + '/swap-queue.png' });

// terminal popup
await page.evaluate((key) => { const m = window.dispatchApp.markers.markerByKey[key]; m._map.setView(m.getLatLng(), 7, { animate: false }); m.openPopup(); }, POINT);
await page.waitForSelector('.station-popup .ptab[data-tab="deadhead"]');
await page.click('.station-popup .ptab[data-tab="deadhead"]');
check((await page.textContent('.station-popup .ppane[data-pane="deadhead"]')).includes('W1'), 'line point popup lists the swap plan');
check((await page.textContent('.station-popup .ppane[data-pane="inbound"]')).includes('swap W1'), 'Inbound tab tags the replacements "swap W1"');
await page.click('.station-popup [data-swap-act="edit"]');
await page.waitForSelector('#swapdlg.show');
check((await chipLocos('toHub')).join() === out0.join(), 'Edit from the popup opens the saved plan');
await page.click('#swapdlg [data-sw="close"]');

// Fleet tab
await page.click('#asgchip');
await page.waitForSelector('[data-ops="sw"] .asg-tbl');
check((await page.textContent('[data-ops="sw"]')).includes('W1'), 'Fleet tab lists swap plans');
await page.click('[data-ops="sw"] [data-sw-edit="W1"]');
await page.waitForSelector('#swapdlg.show');
await page.fill('#swapdlg input[name="note"]', 'inspection swap — edited');
await page.click('#swapdlg [data-sw="save"]');
await page.waitForTimeout(300);
check(await page.isVisible('[data-ops="sw"]') && (await swaps())[0].note.includes('edited'), 'editing from the Fleet tab saves and stays on the Fleet tab');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ops="sw"] [data-ops-act="export"]')]);
check(readFileSync(await dl.path(), 'utf8').includes('W1,'), 'swap plans export to CSV');
if (shots) await page.screenshot({ path: shots + '/swap-fleet.png' });

// persists + handoff
await load();
check((await swaps()).length === 1 && (await station(POINT)).inbound.some(([, sw]) => sw === 'W1'), 'plan persists and is re-applied after reload');
await page.click('#reloadbtn');
const [sf] = await Promise.all([page.waitForEvent('download'), page.click('#ho-export')]);
check(JSON.parse(readFileSync(await sf.path(), 'utf8')).swaps[0].id === 'W1', 'session handoff file includes swap plans');
await load();

// cancel the plan from the editor
await expandHubs();
await page.click('#queue .swplist [data-swap-edit="W1"]');
await page.waitForSelector('#swapdlg.show');
page.once('dialog', (d) => d.accept());
await page.click('#swapdlg [data-sw="delete"]');
await page.waitForTimeout(300);
const s2 = await station(POINT);
check((await swaps()).length === 0 && s2.have === s0.have && !s2.inbound.some(([, sw]) => sw), 'cancelling the plan restores the counts');

check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall swap checks passed');
process.exit(failures ? 1 : 0);
