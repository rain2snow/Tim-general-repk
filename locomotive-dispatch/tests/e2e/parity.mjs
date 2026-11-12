/**
 * Behavioural parity: drives the original single-file console (reference/dispatch.original.html)
 * and the rebuilt one (dist/index.html) through every view and compares what they render.
 *
 *   npm run test:e2e
 *
 * Network is stubbed: Leaflet for the original is served from node_modules (same 1.9.4),
 * tiles/fonts are answered empty, so the comparison is deterministic and offline.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGINAL = pathToFileURL(path.join(root, 'reference/dispatch.original.html')).href;
const REBUILT = pathToFileURL(path.join(root, 'dist/index.html')).href;
const leafletJs = readFileSync(path.join(root, 'node_modules/leaflet/dist/leaflet.js'));
const leafletCss = readFileSync(path.join(root, 'node_modules/leaflet/dist/leaflet.css'));

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** For lists whose order intentionally changed, compare as sorted lines. */
const sortedLines = (s) => String(s ?? '').split('\n').map(norm).filter(Boolean).sort().join('\n');

async function open(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:') || u.startsWith('data:')) return route.continue();
    if (u.includes('leaflet') && u.endsWith('.js')) return route.fulfill({ body: leafletJs, contentType: 'application/javascript' });
    if (u.includes('leaflet') && u.endsWith('.css')) return route.fulfill({ body: leafletCss, contentType: 'text/css' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('c-all').textContent !== '0');
  await page.waitForTimeout(300);
  return { page, errors };
}

const TEXT_IDS = ['snapdate', 'netcount', 't-short', 't-even', 't-surp', 't-dead', 'n-short', 'n-even', 'n-surp',
  'n-shared', 'n-free', 'n-insp', 'n-dead', 'n-dh', 'n-shop', 'c-all', 'c-route', 'c-swap', 'c-retask'];

async function consoleState(page) {
  return page.evaluate((ids) => ({
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id).textContent])),
    queue: [...document.querySelectorAll('#queue .item')].map((el) => el.innerText),
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    // the rail layer intentionally changed (schematic corridors -> CN network): exclude it here
    paths: document.querySelectorAll('.leaflet-overlay-pane path').length -
      /* global layers */ (window.dispatchApp ? window.dispatchApp.markers.layers : layers).tracks.getLayers().length,
    rail: document.querySelectorAll('.cn-rail').length,
  }), TEXT_IDS);
}

/** Popup HTML for every station / dead / deadhead marker. */
async function popups(page, isRebuilt) {
  return page.evaluate((rebuilt) => {
    /* global markerByKey, layers */
    const stations = rebuilt ? window.dispatchApp.markers.markerByKey : markerByKey;
    const lyr = rebuilt ? window.dispatchApp.markers.layers : layers;
    const content = (m) => { const c = m.getPopup().getContent(); return typeof c === 'function' ? c(m) : c; };
    const out = {};
    for (const k of Object.keys(stations).sort()) out['station:' + k] = content(stations[k]);
    for (const name of ['dead', 'deadhead', 'shop']) {
      lyr[name].getLayers().filter((m) => m.getPopup && m.getPopup()).forEach((m, i) => { out[name + ':' + i] = content(m); });
    }
    return out;
  }, isRebuilt);
}

async function clickView(page, view) {
  await page.click(`#vtab button[data-view="${view}"]`);
  await page.waitForTimeout(150);
}

async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  return readFileSync(await dl.path(), 'utf8');
}

async function dashboardState(page) {
  await clickView(page, 'dash');
  const out = await page.evaluate(() => ({
    kpis: document.getElementById('kpis').innerText,
    rows: document.querySelectorAll('#dbody tr').length,
    foot: document.getElementById('dashfoot').textContent,
    offplan: document.getElementById('offplan').textContent,
    offplanRows: [...document.querySelectorAll('#offplan tbody tr')].map((r) => r.textContent).join('\n'),
  }));
  out.kpiDetail = {};
  for (const id of ['req', 'have', 'net', 'short', 'free', 'shop', 'dead', 'hbo']) {
    await page.click(`.kpi[data-kpi="${id}"]`);
    out.kpiDetail[id] = await page.evaluate(() => document.getElementById('kpi-detail').innerText);
  }
  // expand every tree level and capture what becomes visible
  out.expanded = await page.evaluate(() => {
    document.querySelectorAll('#dbody tr').forEach((tr) => { tr.style.display = ''; });
    return document.getElementById('dbody').innerText;
  });
  out.csv = await download(page, '#dashexport');
  return out;
}

async function fleetState(page) {
  await clickView(page, 'fleet');
  const out = { head: await page.evaluate(() => document.getElementById('fleetbox').querySelector('.fl-grid').textContent), drill: {} };
  const cats = await page.evaluate(() => [...document.querySelectorAll('.fl-row')].map((r) => r.dataset.fcat));
  for (const c of cats) {
    await page.click(`.fl-row[data-fcat="${c}"]`);
    out.drill[c] = await page.evaluate(() => document.getElementById('fl-detail').textContent);
    await page.click(`.fl-row[data-fcat="${c}"]`);
  }
  return out;
}

async function actionsState(page) {
  await clickView(page, 'actions');
  return {
    html: await page.evaluate(() => document.getElementById('actreq').textContent),
    csv: await download(page, '#actexport'),
  };
}

async function planInteraction(page) {
  // type a plan + resolve the first card of each category, then read counts + queue flags
  await clickView(page, 'actions');
  await page.evaluate(() => {
    ['dead', 'short', 'insp'].forEach((cat) => {
      const c = document.querySelector('.acard.' + cat);
      if (!c) return;
      const ta = c.querySelector('textarea');
      ta.value = 'plan for ' + c.dataset.id; ta.dispatchEvent(new Event('input'));
      const cb = c.querySelector('.done input'); cb.checked = true; cb.dispatchEvent(new Event('change'));
    });
  });
  await page.waitForTimeout(1300);
  const chips = await page.evaluate(() => document.querySelector('.act-sum').textContent);
  await clickView(page, 'console');
  await page.waitForTimeout(200);
  return { chips, queue: await page.evaluate(() => [...document.querySelectorAll('#queue .item')].map((el) => el.innerText)),
    ticks: await page.evaluate(() => document.querySelectorAll('.mk-plan').length) };
}

async function dowStates(page) {
  const out = {};
  await clickView(page, 'console');
  await page.click('#dowToggle');
  for (let d = 0; d < 7; d++) {
    await page.click(`#dowDays button[data-d="${d}"]`);
    await page.waitForTimeout(80);
    out[d] = await consoleState(page);
  }
  await page.click('#dowToggle'); // back to peak
  out.peak = await consoleState(page);
  return out;
}

async function searchState(page) {
  await page.fill('#locoq', 'CN47');
  return page.evaluate(() => document.getElementById('locores').innerText);
}

/** STP CSV regenerated from the baked snapshot, for the "Update snapshot" upload path. */
async function writeSampleCsv() {
  const { loadData, rowsFromSnapshot } = await import('../fixtures/snapshotRows.js');
  const rows = rowsFromSnapshot(loadData('snapshot.json'));
  const cols = [...Object.keys(rows[0]), 'Event Time'];
  const q = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => q(c === 'Event Time' ? '2026-09-23 06:00' : r[c] ?? '')).join(','))].join('\r\n');
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'stp-')), 'STP_Locomotives.csv');
  writeFileSync(file, csv);
  return file;
}

async function uploadState(browser, url, csvFile) {
  const { page, errors } = await open(browser, url);
  await page.click('#reloadbtn');
  await page.setInputFiles('#stpfile', csvFile);
  await page.waitForSelector('#loader.hidden', { state: 'attached' });
  await page.waitForTimeout(500);
  const state = { console: await consoleState(page), dashboard: (await dashboardState(page)).kpis, errors };
  await page.close();
  return state;
}

async function collect(browser, url, rebuilt, csvFile) {
  const { page, errors } = await open(browser, url);
  const state = {
    console: await consoleState(page),
    popups: await popups(page, rebuilt),
    search: await searchState(page),
    dashboard: await dashboardState(page),
    fleet: await fleetState(page),
    actions: await actionsState(page),
    dow: await dowStates(page),
    plans: await planInteraction(page),
  };
  await page.close();
  const up = await uploadState(browser, url, csvFile);
  state.upload = { console: up.console, kpis: up.dashboard };
  state.errors = [...errors, ...up.errors];
  return state;
}

/** Recursively diff, normalising whitespace. */
function diff(a, b, at = '', out = []) {
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], at ? at + '.' + k : k, out);
  } else if (norm(a) !== norm(b)) out.push(at);
  return out;
}

const browser = await chromium.launch();
try {
  const csvFile = await writeSampleCsv();
  const [orig, rebuilt] = await Promise.all([collect(browser, ORIGINAL, false, csvFile), collect(browser, REBUILT, true, csvFile)]);
  // Intentional change: off-plan tables now sort LN first (the original's `opOrder[op]||9`
  // treated LN's 0 as missing). Compare those tables order-insensitively.
  for (const s of [orig, rebuilt]) {
    s.dashboard.offplan = sortedLines(s.dashboard.offplanRows);
    delete s.dashboard.offplanRows;
  }
  // Intentional fix 1: the original computed re-task candidates in a later <script> than its first
  // boot(), so on load its console queue silently omitted re-task actions (they only appeared after a
  // demand-day change). Check the rebuilt queue = original queue + re-task items, then drop them.
  const isRetask = (t) => /Re-task to cover/.test(t);
  const fix1 = [];
  // (later stages run after demand-day changes, where the original recomputes re-task too)
  for (const [o, r] of [[orig.console, rebuilt.console]]) {
    const extra = r.queue.filter(isRetask).length;
    fix1.push(extra);
    if (o.queue.some(isRetask) || !extra) { console.error('expected re-task items only in rebuilt queue'); process.exitCode = 1; }
    r.queue = r.queue.filter((t) => !isRetask(t));
  }
  if (+rebuilt.console['c-all'] !== +orig.console['c-all'] + fix1[0] || +rebuilt.console['c-retask'] !== fix1[0] || +orig.console['c-retask'] !== 0) {
    console.error('re-task counter mismatch'); process.exitCode = 1;
  }
  for (const k of ['c-all', 'c-retask']) delete orig.console[k], delete rebuilt.console[k];
  // Intentional change 3: rail corridors now draw the CN network (one polyline per line).
  const railLines = JSON.parse(readFileSync(path.join(root, 'data/cn-network.json'), 'utf8')).lines.length;
  if (rebuilt.console.rail !== railLines || orig.console.rail !== 0) {
    console.error(`expected ${railLines} CN rail lines in rebuilt map, got ${rebuilt.console.rail}`); process.exitCode = 1;
  }
  // Intentional fix 2: the original never repainted the console queue after a plan was resolved in
  // the Actions Required view (refreshPlanMarks could not see the nested renderQueue). Rebuilt shows
  // the flags; require exactly the 3 resolved items to be flagged, then compare without flags.
  const flags = rebuilt.plans.queue.filter((t) => /\u2713 DONE/.test(t)).length;
  if (flags !== 3) { console.error('expected 3 DONE flags in rebuilt queue, got ' + flags); process.exitCode = 1; }
  for (const s of [orig, rebuilt]) s.plans.queue = s.plans.queue.map((t) => t.replace(/\u2713 DONE|\u25cf PLAN/g, ''));
  for (const st of [orig, rebuilt]) { delete st.console.rail; Object.values(st.dow).forEach((d) => delete d.rail); delete st.upload.console.rail; }
  const errs = rebuilt.errors;
  delete orig.errors; delete rebuilt.errors;
  const d = diff(orig, rebuilt);
  const popupCount = Object.keys(rebuilt.popups).length;
  console.log(`compared: ${TEXT_IDS.length} console counters, ${popupCount} map popups, 8 KPI drill-downs, ` +
    `${Object.keys(rebuilt.fleet.drill).length} fleet drill-downs, Actions Required, both CSV exports, 7 demand days, plan entry, STP CSV upload`);
  console.log(`intentional changes verified: +${fix1[0]} re-task actions in console queue on load; DONE flags refresh after resolving; ${railLines} CN rail lines`);
  console.log(`markers ${orig.console.markers}/${rebuilt.console.markers}  paths ${orig.console.paths}/${rebuilt.console.paths}  queue items ${rebuilt.console.queue.length}`);
  if (errs.length) { console.error('page errors in rebuilt app:', errs); process.exitCode = 1; }
  if (d.length) {
    console.error(`\n${d.length} difference(s):`);
    for (const p of d.slice(0, 40)) {
      const get = (o) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
      const A = norm(get(orig)), B = norm(get(rebuilt));
      let i = 0; while (i < A.length && A[i] === B[i]) i++;
      console.error(` - ${p}\n     original: …${A.slice(Math.max(0, i - 60), i + 120)}\n     rebuilt:  …${B.slice(Math.max(0, i - 60), i + 120)}`);
    }
    process.exitCode = 1;
  } else console.log('PARITY OK — rebuilt console matches the original');
} finally {
  await browser.close();
}
