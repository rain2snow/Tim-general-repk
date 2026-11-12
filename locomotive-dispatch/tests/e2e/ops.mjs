/**
 * Manual deadheads + consists, end to end (run after npm run build):
 * build a consist on a job from the terminal popup -> Trains tab / summary -> deadhead a unit and a
 * consist to Halifax -> counts, inbound list, dashed map line, header chip, Fleet tab panels ->
 * persists across reload -> included in the session handoff export -> cancel / dissolve.
 *   node tests/e2e/ops.mjs [screenshotDir]
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
const counted = (s) => (s.have_units || []).filter((u) => !u[5]).map((u) => u[0]);
const T = snap.stations.find((s) => s.k === 'BRANTFORD|ON' && s.trains.length && counted(s).length >= 2)
  || snap.stations.find((s) => s.trains.length && counted(s).length >= 3);
const DEST = 'HALIFAX|NS';
const [U1, U2, U3] = counted(T);
const JOB = T.trains[0].ids.join(' / ');

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) => { const u = r.request().url(); return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.fulfill({ status: 404, body: '' }); });
const load = async () => { await page.goto(URL_); await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0'); };
const station = (k) => page.evaluate((key) => { const s = window.dispatchApp.app.stationsByKey[key]; return { have: s.have, road: s.have_road, consists: s.consists || [], inbound: (s.inbound || []).map((d) => d.loco), trains: s.trains }; }, k);
const settle = () => page.waitForTimeout(450);
const popupText = (sel) => page.evaluate((q) => { const els = document.querySelectorAll(q); return els.length ? els[els.length - 1].textContent : ''; }, sel);
const openTerminal = async (k) => {
  await page.evaluate((key) => { const m = window.dispatchApp.markers.markerByKey[key]; m._map.setView(m.getLatLng(), 7, { animate: false }); m.openPopup(); }, k);
  await page.waitForSelector('.station-popup .ptab[data-tab="consists"]');
};
const tab = async (name) => { await page.click(`.station-popup .ptab[data-tab="${name}"]`); await page.waitForSelector(`.station-popup .ppane.on[data-pane="${name}"]`); };

await load();
const t0 = await station(T.k), d0 = await station(DEST);

// ---- build a consist: U2 lead, U1 trailing, on the terminal's first job
await openTerminal(T.k);
await tab('consists');
await page.fill('.cs-form input[name="name"]', 'TEST-1');
await page.selectOption('.cs-form select[name="job"]', JOB);
await page.fill('.cs-add', U1); await page.press('.cs-add', 'Enter');
await page.fill('.cs-add', U2); await page.click('.cs-form [data-cs="add"]');
check((await page.textContent('.cs-chips')).includes(U1) && (await page.textContent('.cs-chips')).includes(U2), 'builder shows both units as chips');
await page.click('.cs-chips [data-cs-lead="1"]');                                  // make U2 lead
check((await page.textContent('.cs-chips .cs-chip:first-child')).includes(U2), `${U2} moved to lead`);
await page.fill('.cs-add', 'NOPE1'); await page.press('.cs-add', 'Enter');
check((await page.textContent('.cs-msg')).includes('not in this snapshot'), 'unknown unit is rejected');
if (shots) await page.screenshot({ path: shots + '/consist-builder.png' });
await settle();   // the popup auto-pans as it grows
await page.click('.cs-form button[type="submit"]');
await settle();

let t1 = await station(T.k);
check(t1.consists.length === 1 && t1.consists[0].units[0].loco === U2 && t1.consists[0].units[0].lead, 'consist saved with the chosen lead');
check(t1.have === t0.have, `on-hand unchanged at ${T.station} (${t0.have})`);
const onJob = t1.trains[0].units.filter((u) => u.consist).map((u) => u.loco);
check(onJob[0] === U2 && onJob.includes(U1), `consist units are on job ${JOB}`);
check(await page.isVisible('.station-popup .ppane.on[data-pane="consists"]'), 'popup reopens on the Consists tab');
check(/≈ [\d,]+ hp/.test(await popupText('.station-popup .cs-card')), 'consist card shows approximate HP');
check((await page.textContent('#asgchip')).trim() === '1 manual', 'header chip counts the consist');
if (shots) await page.screenshot({ path: shots + '/consist-card.png' });

// ---- deadhead a single unit (U3, or the lead of the consist if the terminal has only two)
const SOLO = U3 || U1;
await tab('deadhead');
await page.fill('.dh-form .dh-loco', SOLO);
check((await page.textContent('.dh-msg')).includes(SOLO), 'typing a unit shows its status');
await page.fill('.dh-form .dh-to', 'nowhere zz');
await page.click('.dh-form button[type="submit"]');
check((await page.textContent('.dh-msg')).includes('destination'), 'unknown destination is rejected');
await page.fill('.dh-form .dh-to', 'Halifax NS');
await page.fill('.dh-form input[name="eta"]', '11/13 14:00');
await page.fill('.dh-form input[name="note"]', 'cover Halifax');
await page.click('.dh-form button[type="submit"]');
await settle();

let t2 = await station(T.k), d2 = await station(DEST);
check(t2.have === t0.have - 1, `${T.station} on hand ${t0.have}→${t2.have}`);
check(d2.have === d0.have + 1 && d2.road === d0.road + 1 && d2.inbound.includes(SOLO), `Halifax on hand ${d0.have}→${d2.have}, ${SOLO} inbound`);
check(await page.evaluate(() => document.querySelectorAll('path.route-manual').length) >= 1, 'manual deadhead drawn on the map (dashed line)');
check((await popupText('.station-popup .ppane[data-pane="deadhead"]')).includes(SOLO), 'deadhead listed as leaving this terminal');

// ---- deadhead the whole consist (a unit already moved alone is simply re-planned with it)
await tab('consists');
await page.click('.station-popup .cs-card [data-cs="dh"]');
check(await page.isVisible('.station-popup .ppane.on[data-pane="deadhead"]') && (await page.inputValue('.dh-form select[name="consist"]')) === t1.consists[0].id, 'Deadhead… on a consist card preselects it');
await page.fill('.dh-form .dh-to', 'HALIFAX|NS');
await page.click('.dh-form button[type="submit"]');
await settle();
const d3 = await station(DEST), t3 = await station(T.k), moved = new Set([SOLO, U1, U2]).size;
check(d3.have === d0.have + moved && [U1, U2].every((u) => d3.inbound.includes(u)), `consist deadheaded: Halifax on hand ${d0.have}→${d3.have}, ${U2} + ${U1} inbound`);
check(d3.consists.length === 1 && t3.consists.length === 0, 'the consist moved with them (now listed at Halifax)');
if (shots) { await page.evaluate(() => window.dispatchApp.markers.markerByKey['HALIFAX|NS']._map.closePopup()); await page.screenshot({ path: shots + '/deadhead-map.png' }); }

// ---- Fleet tab panels
await page.click('#asgchip');
await page.waitForSelector('[data-ops="dh"] .asg-tbl');
const dhTxt = await page.textContent('[data-ops="dh"]');
check(dhTxt.includes(SOLO) && dhTxt.includes(U2) && dhTxt.includes('HALIFAX'), 'Fleet tab lists the planned deadheads');
check((await page.textContent('[data-ops="cs"]')).includes('TEST-1'), 'Fleet tab lists the consist');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ops="dh"] [data-ops-act="export"]')]);
check(readFileSync(await dl.path(), 'utf8').includes(SOLO), 'deadheads export to CSV');
if (shots) await page.screenshot({ path: shots + '/ops-fleet.png' });

// ---- persists + handoff
const before = await page.evaluate(() => ({ dh: Object.keys(window.dispatchApp.app.deadheads).length, cs: window.dispatchApp.app.consists.length }));
await load();
const after = await page.evaluate(() => ({ dh: Object.keys(window.dispatchApp.app.deadheads).length, cs: window.dispatchApp.app.consists.length }));
check(after.dh === before.dh && after.cs === before.cs, `deadheads (${after.dh}) and consists (${after.cs}) persist after reload`);
check((await station(DEST)).inbound.includes(SOLO), 'counts are re-applied on load');
await page.click('#reloadbtn');
const [sf] = await Promise.all([page.waitForEvent('download'), page.click('#ho-export')]);
const sess = JSON.parse(readFileSync(await sf.path(), 'utf8'));
check(Object.keys(sess.deadheads).includes(SOLO) && sess.consists.length === after.cs && sess.consists[0].units[0] === U2, 'session handoff file includes deadheads and consists');
await page.keyboard.press('Escape');
await load();

// ---- cancel + dissolve from the Fleet tab
await page.click('#asgchip');
await page.waitForSelector('[data-ops="dh"] [data-ops-act="clear"]');
page.once('dialog', (d) => d.accept());
await page.click('[data-ops="dh"] [data-ops-act="clear"]');
await page.waitForTimeout(200);
if (await page.isVisible('[data-ops="cs"] [data-ops-act="clear"]')) { page.once('dialog', (d) => d.accept()); await page.click('[data-ops="cs"] [data-ops-act="clear"]'); await page.waitForTimeout(200); }
const end = await station(T.k), endD = await station(DEST);
check(end.have === t0.have && endD.have === d0.have, 'cancel all / dissolve all restores the counts');

check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall ops checks passed');
process.exit(failures ? 1 : 0);
