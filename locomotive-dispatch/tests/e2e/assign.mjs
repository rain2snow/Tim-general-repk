/**
 * Manual locomotive assignments at a terminal, end to end (run after npm run build):
 * assign from the station popup's Assign tab -> counts update -> header chip -> Fleet tab list
 * -> persists across reload -> release / undo from the popup -> clear all.
 *   node tests/e2e/assign.mjs [screenshotDir]
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

// a real Available low/mid-HP unit not homed at Halifax, from the baked snapshot
const snap = JSON.parse(readFileSync(path.join(root, 'data/snapshot.json'), 'utf8'));
const TERM = 'HALIFAX|NS';
const unit = snap.fleet.find((f) => f.desig === 'Available' && !f.hhp && !/^(YBU|HBU|CALF)/.test(f.model) && f.home !== TERM && f.k !== TERM);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.fulfill({ status: 404, body: '' }); });
const load = async () => { await page.goto(URL_); await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0'); };
const station = (k) => page.evaluate((key) => { const s = window.dispatchApp.app.stationsByKey[key]; return { have: s.have, road: s.have_road, status: s.status }; }, k);
// after an action the popup closes (markers rebuild) and reopens; wait out Leaflet's fade
const settle = () => page.waitForTimeout(450);
const popupText = (sel) => page.evaluate((q) => { const els = document.querySelectorAll(q); return els.length ? els[els.length - 1].textContent : ''; }, sel);
const openTerminal = async (k) => {
  await page.evaluate((key) => { const m = window.dispatchApp.markers.markerByKey[key]; m._map.setView(m.getLatLng(), 7, { animate: false }); m.openPopup(); }, k);
  await page.waitForSelector('.station-popup .ptab[data-tab="assign"]');
};

await load();
const before = await station(TERM);
await openTerminal(TERM);
await page.click('.station-popup .ptab[data-tab="assign"]');
check(await page.isVisible('.station-popup .ppane[data-pane="assign"] .asg-add'), 'terminal popup has an Assign tab with an entry form');

// live validation
await page.fill('.asg-loco', 'NOPE123');
check((await page.textContent('.asg-msg')).includes('not in this snapshot'), 'unknown loco ID is flagged');
await page.fill('.asg-loco', unit.loco.toLowerCase());
check((await page.textContent('.asg-msg')).includes(unit.loco), `typing ${unit.loco} shows its status/location`);
await page.fill('.asg-notein', 'cover short — test');
if (shots) await page.screenshot({ path: shots + '/assign-form.png' });
await page.click('.asg-add button[type="submit"]');
await settle();

const after = await station(TERM);
check(after.have === before.have + 1 && after.road === before.road + 1, `Halifax on hand ${before.have}→${after.have} (on the road ${before.road}→${after.road})`);
check(await page.isVisible('.station-popup .ppane.on[data-pane="assign"]'), 'popup reopens on the Assign tab');
check((await popupText('.station-popup .asg-list')).includes(unit.loco + ' '), `${unit.loco} listed as counted here (manual)`);
check(await page.isVisible('#asgchip') && (await page.textContent('#asgchip')).trim() === '1 manual', 'header chip shows "1 manual"');
if (shots) await page.screenshot({ path: shots + '/assign-popup.png' });

// Fleet tab list + export
await page.click('#asgchip');
await page.waitForSelector('.asg-panel .asg-tbl');
const fleetTxt = await page.textContent('.asg-panel');
check(fleetTxt.includes(unit.loco) && fleetTxt.includes('HALIFAX') && fleetTxt.includes('cover short'), 'Fleet tab lists the assignment with its note');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-asg-act="export"]')]);
check(readFileSync(await dl.path(), 'utf8').includes(unit.loco + ','), 'assignments export to CSV');
if (shots) await page.screenshot({ path: shots + '/assign-fleet.png' });

// persists
await load();
check((await station(TERM)).have === after.have, 'assignment persists after reload');

// release a counted unit at another terminal, then undo it from the popup
const other = snap.stations.find((s) => s.required > 0 && s.k !== TERM && (s.have_units || []).length);
const o0 = await station(other.k);
await openTerminal(other.k);
await page.click('.station-popup .ptab[data-tab="assign"]');
await page.click('.station-popup .asg-list .asg-btn.ghost');           // Release
await settle();
check((await station(other.k)).have === o0.have - 1, `Release drops ${other.station} on hand ${o0.have}→${o0.have - 1}`);
check((await popupText('.station-popup .asg-list')).includes('released'), 'released unit stays listed (with Undo) at the terminal');
await page.click('.station-popup .asg-list .asg-row.nc .asg-btn');     // Undo on the released row
await settle();
check((await station(other.k)).have === o0.have, 'Undo restores it');

// clear all
await page.evaluate(() => document.querySelector('#vtab button[data-view="fleet"]').click());
page.once('dialog', (d) => d.accept());
await page.click('[data-asg-act="clear"]');
await page.waitForTimeout(200);
check((await station(TERM)).have === before.have && await page.isHidden('#asgchip'), 'Clear all restores automatic assignments');
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nASSIGN OK');
process.exitCode = failures ? 1 : 0;
