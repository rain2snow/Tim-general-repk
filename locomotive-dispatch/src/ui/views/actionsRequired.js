/** Actions Required view: worklist grouped region -> zone -> category, with plan entry + CSV export. */
import { esc } from '../../core/html.js';
import { reqText, findDonors } from '../../core/planning.js';
import { actionId } from '../../core/store.js';
import { nearestShop } from '../../core/geo.js';
import {
  buildWorklists, regionZoneOf, deadUnitShop, inspectionCover, shortFamily, worklistIds, openCount,
  actionsCsv, ACTION_CATEGORIES, ACTION_REGION_ORDER,
} from '../../core/actionsRequired.js';
import { $, $$, byId, downloadText, flashSaved } from '../dom.js';
import { app, emit } from '../state.js';
import { locateStation, locateDead } from './navigation.js';

const loLink = (key, label) => '<span class="lo" data-key="' + key + '">' + esc(label) + '</span>';
const loDead = (loco, label) => '<span class="lo" data-dead="' + loco + '">' + esc(label) + '</span>';
const pill = (color, txt) => '<span class="pill" style="color:' + color + '">' + txt + '</span>';
const shopLabel = (sh) => '<b>' + esc(sh.name) + ' (' + esc(sh.code) + ')</b>';

function card(cls, id, top, where, sugg) {
  const sol = app.store.get(id) || '', done = app.store.get(id + ':done') === '1';
  return '<div class="acard ' + cls + (done ? ' done' : '') + '" data-id="' + id + '">' +
    '<div class="info"><div class="top">' + top + '</div>' +
    '<div class="where">' + where + '</div>' +
    '<div class="sugg"><span class="lbl">Suggested action</span>' + sugg + '</div></div>' +
    '<div class="sol"><div class="slbl"><span>Your solution</span>' +
    '<label class="done"><input type="checkbox" ' + (done ? 'checked' : '') + '> resolved</label></div>' +
    '<textarea placeholder="Enter your plan…">' + esc(sol) + '</textarea>' +
    '<span class="saved">saved</span></div></div>';
}

/** One card per worklist item, tagged with region/zone/category. */
function buildItems(w) {
  const data = app.data, items = [];
  const add = (k, cat, html) => { const z = regionZoneOf(app.stationsByKey, k); items.push({ region: z.region, zone: z.zone, cat, html }); };

  w.dead.forEach((d) => {
    const { assigned, shop } = deadUnitShop(data.shops, d);
    const sugg = 'Route to ' + (shop ? shopLabel(shop) : 'a capable shop') +
      (assigned ? '' : ' <span style="color:var(--dim)">(no shop assigned — nearest capable)</span>') +
      (d.etr ? ' · ETR ' + esc(d.etr) : '') + (d.dest ? ' · routed dest ' + esc(d.dest) : '') + '.';
    const top = '<span class="loco">' + loDead(d.loco, d.loco) + '</span><span class="model">' + esc(d.model) + '</span>' + pill('var(--dead)', esc(d.op || 'DEAD'));
    const where = 'Dead in transit at <b>' + esc(d.rawloc || d.lockey) + '</b>' + (d.notes ? ' — ' + esc(d.notes) : '');
    add(d.lockey, 'dead', card('dead', actionId.dead(d.loco), top, where, sugg));
  });

  w.shorts.forEach((s) => {
    const fam = shortFamily(s), dn = findDonors(data.stations, s, fam).slice(0, 2);
    const sugg = 'Need <b>' + s.shortfall + '</b> unit' + (s.shortfall > 1 ? 's' : '') + ' (' + esc(reqText(s)) + '). ' +
      (dn.length
        ? 'Nearest surplus: ' + dn.map((x) => loLink(x.k, x.station + ' ' + x.state) + ' (+' + x.surplus + (x.fam && fam ? ', has ' + fam : '') + ')').join(' or ') + '. Pull ' + s.shortfall + ' to cover.'
        : 'No surplus donor nearby — consider a shop release or reassignment.');
    const top = '<span class="loco">' + loLink(s.k, s.station) + '</span><span class="model">' + esc(s.state) + ' · ' + esc(s.zone || s.region || '') + '</span>' + pill('var(--red)', 'SHORT ' + s.shortfall);
    const where = 'Required <b>' + s.required + '</b> · on hand <b>' + s.have + '</b> (' + s.have_here + ' here, ' + s.have_road + ' road)';
    add(s.k, 'short', card('short', actionId.short(s.k), top, where, sugg));
  });

  w.insps.forEach(({ s, u }) => {
    const { fam, localSpare, localSurplus, donor } = inspectionCover(data.stations, s, u);
    const shop = s.lat != null ? nearestShop(data.shops, s.lat, s.lng) : null;
    const cover = localSpare ? 'on-hand spare <b>' + esc(localSpare.loco) + '</b>'
      : localSurplus ? 'on-hand surplus power'
        : donor ? 'a ' + (fam || 'unit') + ' from ' + loLink(donor.k, donor.station + ' ' + donor.state) : 'an available unit';
    const sugg = 'Swap out <b>' + esc(u.loco) + '</b> and send to ' + (shop ? shopLabel(shop) : 'the nearest shop') +
      ' for ' + esc(u.insp || 'inspection') + '. Cover the assignment with ' + cover + '.';
    const due = u.days < 0 ? pill('var(--red)', 'OVERDUE ' + -u.days + 'd') : pill('var(--amber)', 'DUE ' + u.days + 'd');
    const top = '<span class="loco">' + loLink(s.k, u.loco) + '</span><span class="model">' + esc(u.model) + '</span>' + due + pill('var(--dim)', esc(u.op || ''));
    const where = 'At <b>' + esc(s.station) + ' ' + esc(s.state) + '</b> · ' + esc(u.insp || 'inspection') + ' forecast';
    add(s.k, 'insp', card('insp', actionId.insp(u.loco, s.k), top, where, sugg));
  });

  w.retask.forEach((c) => {
    const { s, u, home } = c;
    const sugg = 'Pull <b>' + esc(u.loco) + '</b> (' + esc(c.fam) + ') onto ' + esc(s.station) + '’s captive job (' + esc(reqText(s)) + '). ' +
      'It is physically here but assigned to ' + loLink(home.k, home.station + ' ' + home.state) + ', which is ' + esc(home.status) + ' (+' + c.slack + '). ' +
      'Re-tasking the unit on-site covers the shortfall with no extra move.';
    const top = '<span class="loco">' + loLink(s.k, u.loco) + '</span><span class="model">' + esc(u.model) + ' · ' + esc(c.fam) + '</span>' + pill('var(--cyan)', 'RE-TASK');
    const where = 'At <b>' + esc(s.station) + ' ' + esc(s.state) + '</b> (short ' + s.shortfall + ') · unit homed at <b>' + esc(home.station) + '</b> (' + esc(home.status) + ' +' + c.slack + ')';
    add(s.k, 'retask', card('retask', actionId.retask(u.loco, s.k), top, where, sugg));
  });
  return items;
}

function groupedHtml(items) {
  const RB = {};
  items.forEach((it) => { const R = (RB[it.region] = RB[it.region] || {}); const Z = (R[it.zone] = R[it.zone] || {}); (Z[it.cat] = Z[it.cat] || []).push(it.html); });
  const rank = (r) => { const i = ACTION_REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  const regions = Object.keys(RB).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (!regions.length) return '<div class="act-empty">No actions required — every captive requirement is covered and nothing is awaiting a shop.</div>';
  return regions.map((R) => {
    const zones = RB[R];
    let rCount = 0;
    const zoneHtml = Object.keys(zones).sort().map((Z) => {
      const cats = zones[Z];
      let zCount = 0;
      const inner = ACTION_CATEGORIES.filter((c) => cats[c.k] && cats[c.k].length).map((c) => {
        zCount += cats[c.k].length;
        return '<div class="catlabel"><span class="d" style="background:' + c.c + '"></span>' + c.l + ' <b>' + cats[c.k].length + '</b></div>' + cats[c.k].join('');
      }).join('');
      rCount += zCount;
      return '<div class="act-zone collapsed" data-zone="' + esc(Z) + '"><div class="zh"><span class="tw">▾</span><h4>' + esc(Z) + '</h4><span class="cnt">' + zCount + '</span></div><div class="zbody">' + inner + '</div></div>';
    }).join('');
    return '<div class="act-region collapsed" data-region="' + esc(R) + '"><div class="rh"><span class="tw">▾</span><h3>' + esc(R) + '</h3><span class="cnt">' + rCount + ' item' + (rCount !== 1 ? 's' : '') + '</span></div><div class="rbody">' + zoneHtml + '</div></div>';
  }).join('');
}

const chip = (key, color, open, total, label, extra) =>
  '<span class="chip ' + (extra || '') + '" data-sec="' + key + '"><span class="d" style="background:' + color + '"></span><b>' + open + '</b> ' + label +
  (open < total ? ' <span class="done-mini">(' + (total - open) + ' done)</span>' : '') + '</span>';

/** Re-count open/done per category chip, region and zone after a resolved toggle. */
function updateOpenCounts(el) {
  ['dead', 'short', 'retask', 'insp'].forEach((key) => {
    const total = $$('.acard.' + key, el).length, done = $$('.acard.' + key + '.done', el).length;
    const ch = $('.act-sum .chip[data-sec="' + key + '"]', el);
    if (!ch) return;
    const b = $('b', ch); if (b) b.textContent = total - done;
    let dm = $('.done-mini', ch);
    if (done > 0) { if (!dm) { dm = document.createElement('span'); dm.className = 'done-mini'; ch.appendChild(dm); } dm.textContent = '(' + done + ' done)'; }
    else if (dm) dm.parentNode.removeChild(dm);
  });
  $$('.act-region', el).forEach((R) => {
    const total = $$('.acard', R).length, done = $$('.acard.done', R).length, c = $('.rh > .cnt', R);
    if (c) c.textContent = total - done + ' open' + (done > 0 ? ' · ' + done + ' done' : '');
  });
  $$('.act-zone', el).forEach((Z) => {
    const total = $$('.acard', Z).length, done = $$('.acard.done', Z).length, c = $('.zh > .cnt', Z);
    if (c) c.textContent = total - done + (done > 0 ? ' · ' + done + ' done' : '');
  });
}

export function buildActionsRequired() {
  const el = byId('actreq');
  if (!el) return;
  const w = buildWorklists(app.data, app.locoIndex, app.retask);
  const ids = worklistIds(w);
  const open = (k) => openCount(app.store, ids[k]);
  const snapshot = (app.data.meta && app.data.meta.snapshot) || '';

  el.innerHTML =
    '<div class="act-h"><h2>Actions Required</h2><span class="sub">snapshot ' + esc(snapshot) + ' — grouped by region &rarr; zone &rarr; category; expand a zone to work the items</span>' +
    '<button id="actexport" class="actexport" title="Download all actions, plans and status as CSV">Export CSV</button></div>' +
    '<div class="act-sum">' +
    chip('dead', 'var(--dead)', open('dead'), w.dead.length, 'dead → shop') +
    chip('short', 'var(--red)', open('short'), w.shorts.length, 'short locations') +
    chip('retask', 'var(--cyan)', open('retask'), w.retask.length, 're-task', 'retask') +
    chip('insp', 'var(--amber)', open('insp'), w.insps.length, 'inspection swaps') +
    '</div>' + groupedHtml(buildItems(w));

  $$('.act-region>.rh, .act-zone>.zh', el).forEach((sh) => sh.addEventListener('click', (ev) => {
    if (ev.target.closest('.lo')) return;
    sh.parentNode.classList.toggle('collapsed');
  }));
  $('#actexport', el).addEventListener('click', () => {
    try { downloadText(actionsCsv(w, app.store, snapshot), 'actions_required_' + (String(snapshot || 'export').replace(/[^0-9A-Za-z-]/g, '') || 'export') + '.csv'); }
    catch (e) { alert('Export failed: ' + e.message); }
  });
  $$('.acard', el).forEach((c) => {
    const id = c.dataset.id, ta = $('textarea', c), cb = $('.done input', c), saved = $('.saved', c), timer = {};
    ta.addEventListener('input', () => { app.store.set(id, ta.value); flashSaved(saved, timer, () => emit('plans')); });
    cb.addEventListener('change', () => {
      app.store.set(id + ':done', cb.checked ? '1' : '');
      c.classList.toggle('done', cb.checked);
      updateOpenCounts(el);
      emit('plans');
    });
  });
  $$('.lo', el).forEach((lk) => lk.addEventListener('click', () => {
    if (lk.dataset.dead) locateDead(lk.dataset.dead);
    else if (lk.dataset.key) locateStation(lk.dataset.key);
  }));
  updateOpenCounts(el);
  emit('plans');
}
