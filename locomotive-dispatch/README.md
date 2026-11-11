# Locomotive Maintenance Dispatch

CN / IC fleet dispatch console: low/mid-HP captive-plan balance by location, dead-unit shop routing,
inspection swaps, re-task suggestions and a dispatcher worklist, all on one map.

This is a modular rebuild of the single-file `dispatch.html` from the locomotive planning project
(kept unchanged in [`reference/dispatch.original.html`](reference/dispatch.original.html)). The build
still produces **one self-contained HTML file** that you can open from disk or email, as before.

## Quick start

```bash
npm install
npm run dev        # local dev server with hot reload
npm run build      # -> dist/index.html (single file, data + JS + CSS inlined)
npm test           # unit tests (engine, planning, exports)
npm run test:e2e   # builds, then checks parity against the original in headless Chromium
```

To refresh the built-in snapshot from a new STP export (same engine the browser uses):

```bash
npm run analyze -- ~/Downloads/STP_Locomotives.csv   # rewrites data/snapshot.json
npm run build
```

Users can still load a newer export at runtime with **⬆ Update snapshot**. Analysis runs in the browser and nothing is uploaded.

## Layout

```
data/                       reference data + baked snapshot (JSON, extracted from the original)
  static-plan.json            captive plan: 237 locations, requirements by day, trains, shops
  base2home.json              train base -> home terminal
  base2home-multi.json        colliding train bases -> candidate homes
  lcs-fleet.json              LCS-equipped units
  snapshot.json               analysed snapshot shown on open
src/
  core/                     pure logic: no DOM, runs in Node and the browser
    analyze.js                STP rows -> stations / dead / deadhead / fleet model
    pools.js, demand.js       shared-job pools; day-of-week demand basis
    planning.js               donors, re-task candidates, loco index
    queue.js                  console action queue
    actionsRequired.js        Actions Required worklists + CSV
    balance.js                dashboard KPIs, region/zone tree + CSV
    fleet.js, offplan.js      fleet status partition; off-plan train assignments
    store.js                  dispatcher plans (localStorage) + plan state
    csv.js, dates.js, keys.js, families.js, geo.js, search.js, html.js, constants.js
    index.js                  public engine API
  ui/                       rendering + interaction
    app.js                    composition root: wires modules once, re-renders on data change
    state.js, dom.js          shared state + event bus; DOM helpers
    map/                      Leaflet map, basemap probing, popups
    console/                  layer toggles, tiles/counts, demand toggle, queue, panels
    views/                    navigation, dashboard/, fleet, actions required, off-plan
    search.js, loader.js      loco search; STP CSV upload
  styles/                   original stylesheet split by feature (import order = cascade order)
  main.js                   entry: styles + data -> startApp()
scripts/analyze-csv.mjs     CLI re-bake of data/snapshot.json
tests/unit/                 Vitest: engine regression against the real snapshot + rules + planning
tests/e2e/parity.mjs        Playwright: original vs rebuilt, every view, popups, exports, uploads
```

**Dependency direction:** `ui -> core`, never the reverse. Everything in `core/` is testable without
a browser. UI modules talk through `state.js` (`app` + `on/emit('plans')`), not globals.

## How status is read

* **Requirement** is the shared-job-adjusted unit count, including active M schedules and excluding
  HHP, CALF and slugs. It is peak by default, or a single day when the day-of-week toggle is on.
* **On hand** counts Available units under 4000 hp, excluding YBU/HBU slugs. A captive unit out on
  its train counts at its home terminal.
* **Shared pools**: stations linked by shared jobs are combined. The deficit or surplus is shown once,
  at the pool's primary station.
* **Dead** means LD / DM / DIT (low/mid HP only), routed to the assigned shop or the nearest one.
  **Deadhead** means DH units with their destination and ETA.

## Verification

* `tests/unit/analyze.snapshot.test.js` rebuilds an STP export from the baked snapshot and checks
  the engine reproduces all 237 station balances, rosters, trains, pools, dead and deadhead
  routing, and home assignments exactly, for peak and each day of the week.
* `tests/e2e/parity.mjs` compares the original and rebuilt pages: 19 counters, all 179 popups,
  8 KPI drill-downs, the fully expanded balance tree, 12 fleet drill-downs, Actions Required,
  both CSV exports (byte-for-byte), 7 demand days, plan entry, and the CSV upload path.

## Behaviour changes vs the original

These are deliberate fixes, and the parity test asserts them:

1. **Re-task actions appear in the console queue on load.** The original computed them in a later
   `<script>` than its first render, so they only showed up after changing the demand day.
2. **Console queue flags refresh** (✓ DONE / ● PLAN) when a plan is resolved in Actions Required.
   The original's refresh could not reach the queue renderer, which was nested inside `boot()`.
3. **Off-plan tables list in-service (LN) units first**, as intended. The original's
   `opOrder[op] || 9` treated LN's order `0` as missing.
4. Station popups read the plan-in-place state when opened, so they are never stale. Typing a plan
   in the console queue keeps focus through the auto-refresh.
5. Leaflet is bundled from npm instead of loaded from a CDN, so the file works offline. Map tiles
   still need a network connection, and the console works without them.
