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
npm test && npm run test:e2e                          # sanity + parity on the new data
npm run build
```

The built-in snapshot is currently the STP export of **2026-11-11**. Unit tests with exact
expected values are pinned to a frozen copy of the 2026-09-23 snapshot
(`tests/fixtures/snapshot-2026-09-23.json`), so refreshing the data doesn't change them.
`tests/unit/current-snapshot.test.js` checks whichever snapshot is baked in:

* the engine reproduces it,
* it covers every plan location,
* the hub model reconciles.

The e2e parity test runs the original console on the *current* snapshot (its embedded data swapped
in), so it compares code rather than data.

Users can still load a newer export at runtime with **⇅ Data & handoff → Update snapshot**. Analysis runs in the browser and nothing is uploaded.

## Layout

```
data/                       reference data + baked snapshot (JSON, extracted from the original)
  static-plan.json            captive plan: 237 locations, requirements by day, trains, shops
  base2home.json              train base -> home terminal
  base2home-multi.json        colliding train bases -> candidate homes
  lcs-fleet.json              LCS-equipped units
  snapshot.json               analysed snapshot shown on open
  cn-network.json             CN rail network extracted from CN's weight-limitations map (230 lines)
  hubs.json                   hubs (repair shops) and the zones each one handles
src/
  core/                     pure logic: no DOM, runs in Node and the browser
    analyze.js                STP rows -> stations / dead / deadhead / fleet model
    pools.js, demand.js       shared-job pools; day-of-week demand basis
    network.js                CN network lines, capacity classes, distance-to-network
    hubs.js                   hub-and-spoke model: hub assignment, tactical cover, strategic transfers
    planEdit.js               captive-plan editing: derivations, day-of-week, train re-homing, diff
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
scripts/network/            PDF -> data/cn-network.json build (Python) + corridor names
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

## Light / dark mode

The sun/moon button in the header switches between **light** (the default) and **dark**. The choice
is remembered in this browser. A small script in `index.html` applies it before the first paint,
so the page never flashes the wrong theme.

How it's built:

* **Colours come from tokens.** Every colour in the stylesheets goes through tokens in
  `src/styles/tokens.css`, and light mode is a second token set (`:root[data-theme="light"]`).
  * The dark values are the original colours, so dark mode is pixel-identical to before. The only
    exceptions are native checkboxes, which now follow the theme.
  * The light palette is cool grey, with deeper status colours so they meet text contrast on white.
* **HTML built in JS uses the same variables.** Popups, KPI cards and badges take their colours
  from `THEME`, with tints written as `color-mix()`.
* **Map shapes keep their bright hex colours**, which read on both basemaps.
  * The CN network lines and the inbound-deadhead routes get deeper strokes in light mode.
  * The basemap swaps between Esri Dark Gray and Light Gray with the theme.

`tests/e2e/theme.mjs` checks the toggle, its labels, persistence, applying before first paint, and
the switch back.

## Session handoff (export / import everything)

**⇅ Data & handoff** in the header opens one dialog for both data and handoffs.

**Update snapshot.** Drop a new STP export here, as before. An uploaded snapshot is now saved in
this browser, so it survives a reload. The dialog shows where the current snapshot came from
(built in, uploaded or imported) and offers to go back to the built-in one.

**Export session file** writes everything you've changed into one JSON file. It's versioned
(`kind: "session"`), and you can add your name and a note.

| In the file | Detail |
|---|---|
| Captive-plan edits | including train re-homing |
| Manual locomotive assignments | |
| Planned deadheads and consists | merge keeps each unit in one consist (theirs win) |
| Action plans and resolved flags | console queue, Actions Required, hub transfers |
| Settings | theme and demand day |
| Snapshot | optional, on by default; stored losslessly |

**Import session file** shows a preview first: who exported it, when, the note, and what it
contains. It warns if the snapshot is older than yours. Then pick one:

* **Replace** — take that session exactly. Use this for a handoff.
* **Merge** — keep your assignments, deadheads, consists and action plans, add theirs (theirs win on conflicts), and
  use their plan and snapshot if they have them.

After applying, the whole console re-analyses, and everything persists across reloads, except the
demand day: like the toggle itself, it applies to the current visit. A file that isn't a session (for example a captive-plan export) is rejected with a
message saying where it belongs.

The format lives in `src/core/session.js`. It's covered by `tests/unit/session.test.js` (round
trip, lossless snapshot, replace/merge, validation) and by `tests/e2e/handoff.mjs`. That test
passes a session between two separate browsers: dispatcher A changes everything and exports;
dispatcher B imports, gets A's exact state, reloads, then merges.

## Manual locomotive assignments (at the terminal)

Open any terminal on the map and choose its **Assign** tab. It lists every unit counted toward
that terminal and how it got there: train home, sitting here, on the road, or manual.

* **Assign here.** Type a loco ID (the field autocompletes and checks status and location as you
  type) and add an optional note. This overrides the unit's train-based home: the unit counts
  toward this terminal, "on the road" if it is elsewhere. Only Available units under 4000 hp
  count, as everywhere else; any other unit is accepted but shown as "not counted".
* **Release** takes a unit out of the count at every terminal, including where it physically sits.
* **Undo** returns the unit to its automatic assignment.

Each change re-runs the analysis, so balances, hubs, the action queue and the dashboard update.
The popup then reopens on the Assign tab. Assignments are saved in this browser, and the header
shows an **N manual** chip. The Fleet tab's **Manual assignments** panel lists every override,
with status, location, target, whether it counts, note and time, plus Undo, Export CSV and
Clear all.

In the engine these are passed as `analyze(…, { assign: { locoId: stationKey | '' } })`; the
fleet record carries `manual`. They're covered by `tests/unit/assign.test.js` and the browser
flow in `tests/e2e/assign.mjs`.

## Manual deadheads and consists

Two more tabs on every terminal popup, next to **Assign**.

**Consists.** Build a locomotive consist by pairing units. Type loco IDs lead first (the field
autocompletes and warns about status and location). Reorder with ★ (make lead) and ◀, remove
with ✕. Give it an optional name and note, and optionally tie it to one of the terminal's jobs.

* Consist units count toward that terminal. They are on the road if they sit elsewhere, and
  only Available units under 4000 hp count, as everywhere else.
* A consist tied to a job puts its units on that job in the Trains tab, lead first. They fill
  the job's required types before any other unit.
* Each card shows the units, an approximate total HP (by model) and warnings: units at different
  locations, units not Available, a slug without a powered unit, a slug leading, or a unit
  missing from the snapshot.
* A unit belongs to one consist at a time; adding it to another moves it.
* **Edit**, **Deadhead…** and **Dissolve** are on each card.

**Deadhead.** Plan a move of one unit, or a whole consist at this terminal, to another terminal,
with an optional ETA and note. A planned deadhead:

* counts the unit at its destination (on the road until it arrives) and takes it off its origin;
* appears in the destination's Inbound tab and on the map as a dashed line, tagged manual;
* replaces any deadhead in the STP export for that unit.

Deadheading a consist moves the consist with it: it is now listed at the destination and is no
longer tied to a job. The tab also lists moves leaving and arriving here, each with **Cancel**.

Precedence for where a unit counts: planned deadhead, then manual assignment, then consist, then
its train-based home. Every change re-analyses the console and is saved in this browser. The
header chip counts all manual changes. The Fleet tab adds **Planned deadheads** and **Consists**
panels (Cancel / Dissolve, Export CSV, Cancel all / Dissolve all). Both are part of the session
handoff file.

In the engine: `analyze(…, { deadheads: { locoId: { to, eta, note } }, consists: [{ id, name, k,
job, units, note }] })`. Fleet records carry `dhTo` / `consist`, manual deadhead records carry
`manual`, and stations with consists get a `consists` summary. Without any, the output is
byte-identical to before. Covered by `tests/unit/ops.test.js` and `tests/e2e/ops.mjs`.

## Captive Plan tab (editable)

The **Captive Plan** tab lists all 237 plan locations, with search, a region filter and an "edited
only" toggle. Selecting a location opens an editor where you can change:

* its **jobs / trains**: the train IDs, plus the units each job needs by type (e.g. `2× GP9/GP38`).
  The location's requirement and its by-type breakdown are *derived* from the jobs, as in the
  source plan.
* the **requirement by day** (Sun–Sat). When the requirement changes, every day shifts by the
  same amount, so the busiest day keeps matching the requirement.
* **region, zone, captive-jobs count and coordinates.**

You can also **add new locations**. Warnings cover a busiest day that doesn't match the
requirement, missing coordinates, and train IDs already used at another location.

Edits build up as a **draft** until you press **Apply to console**. That re-runs the analysis on the
current snapshot, so the Console, Dashboard, hubs, actions and map all update. It also saves the
plan in this browser, and the header shows an **Edited plan** chip.

* **Export JSON** downloads the plan. Replace `data/static-plan.json` with it to make it the
  built-in plan for everyone.
* **Import JSON** loads a plan into the draft for review.
* **Reset to built-in** discards all edits.

How it works:

* **Train IDs home units.** A unit on a train is homed by its train base (the ID minus its last
  character: `L580311` → `L58031`). Adding a train ID to a location homes that train there, and
  removing one releases it. This is recorded in the plan as `meta.base2home_overrides`, and
  `analyze()` applies it, so an exported plan carries its own re-homing everywhere (app, CLI, build).
  Placeholder jobs such as `HUMP0` or `SPARE0` don't home anything. Shared jobs counted at another
  terminal are shown read-only.
* **Re-analysis is lossless.** Each fleet record in the snapshot keeps the raw STP fields the
  engine reads (`stp`), so `rowsFromFleet()` rebuilds the export exactly. Re-analysing the
  unedited plan reproduces the baked snapshot byte-for-byte (unit-tested). A CSV loaded with
  **Update snapshot** is analysed against the active (edited) plan.

`tests/unit/planEdit.test.js` covers the derivations, re-homing and re-analysis.
`tests/e2e/plan-editor.mjs` drives the whole flow in a browser: edit, apply, console updates,
export, reload persistence and reset.

## Hub-and-spoke dispatch

Dispatching is organised around **hubs, which are the repair shops**. Each hub handles the plan zones
it sits in. `data/hubs.json` is editable and sets which shops form each hub and which zones it owns:

* Co-located shops form one hub: Symington and Transcona in Winnipeg, Kirk Yard and Woodcrest in Chicago.
* A hub always owns the zone its shop sits in.
* A zone owned by two hubs is split by the nearest shop. This applies to LAKE (Duluth / Stevens
  Point) and IOWA (Chicago / Waterloo).
* Stations with no zone go to the nearest hub.

`src/core/hubs.js` builds the model, counting shared pools once at their primary station. The
console **Action queue** has two modes:

* **Tactical (by hub).** A collapsible **Region (East / West / South) → Hub → actions** tree. Each hub
  sits in one region, set by `region` in `hubs.json` or by the majority region of its stations.
  * Regions open expanded and hubs open folded, so the queue starts as an overview. Each hub
    header shows its status and its short / overdue / dead counts. Expand a hub to work its actions.
  * Choosing a type filter (Route / Station / Re-task) opens the matching hubs.
  * Within a region, hubs that can't cover themselves come first, then hubs with overdue
    inspections. Each action carries a hub-level
  instruction:
  * Shortages: an *allocated* in-hub cover, such as "Cover in hub: 2 from SMITH (SD40)". Each
    donor's spare units are drawn down only once. Any remainder is marked *escalated to Strategic*.
  * Inspections (overdue or due within 3 days): swap the unit into the hub's shop.
  * Dead units: noted with whether their assigned shop is in this hub.
  * Re-tasks: on-site, with no movement needed.
* **Strategic (system).** The system balance (units short, covered in hub, needing transfer, spare)
  and a balance row per hub after it covers itself. It also shows shop load (units in shop plus
  dead units inbound) and suggested **transfers between hubs**, from residual surplus to residual
  deficit, nearest first. Transfers take a plan and a resolved flag like any other action.

The two modes always reconcile: the units the tactical plan leaves uncovered equal the strategic
deficit. Both follow the day-of-week demand toggle. `tests/unit/hubs.test.js` covers assignment,
pool handling, cover allocation, reconciliation, and transfers.

## CN rail network layer

The **CN rail network** map layer is extracted from CN's own *Weight Limitations System Map* (rev. 7/2016),
kept in [`reference/cn-weight-limitations-system-map-2016-07.pdf`](reference/cn-weight-limitations-system-map-2016-07.pdf).
The PDF is vector, so `scripts/network/build_cn_network.py` reads its line work directly:

1. **Extract** the rail strokes. Each stroke's legend colour gives its maximum gross weight class:
   286k, 272k, 268k, 263k, under 263k, or CN track rights on other railroads.
2. **Georeference** the drawing: Lambert conformal conic + affine, a cubic correction, then a
   thin-plate warp. The fit matches plan stations to the drawn lines, with four anchors in sparse
   areas. On 20 well-surveyed cities that are *not* used in the fit, the median error is 2.0 km
   (max 10.6 km), about the width of a drawn line on the source map.
3. **Zoom insets.** Most of the insets are schematic diagrams, so an inset is used only if its
   stations fit and its lines meet the main map where they leave the circle. Today that is
   Vancouver and Quebec.
4. **Chain, simplify, and name.** Each line gets a corridor name, from
   `scripts/network/corridors.json`.

The result, `data/cn-network.json`, has 230 lines covering about 30,700 route-km. On the map,
heavier lines are brighter and solid, and lower weight limits are dashed. Hovering a segment shows its
corridor and weight limit. The legend under the layer toggle shows route-km per class.

To rebuild after a new edition of the map:
`pip install pymupdf scipy numpy`, then
`python3 scripts/network/build_cn_network.py <map.pdf> data/static-plan.json scripts/network/corridors.json data/cn-network.json`.

Some plan terminals sit off the 2016 network on purpose. For example, Kitchener's Guelph sub was not
CN-operated then. `tests/unit/network.test.js` checks the source and accuracy metadata, the capacity
classes, total route-km, proximity to plan terminals, that every shop is reached, and that the
network runs through 11 key cities.

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
5. The rail corridor layer draws CN's network extracted from its weight-limitations system map
   (with weight capacity), instead of the original's nearest-neighbour links between stations.
6. Station popups are wide (up to 620 px, never wider than the screen). They have a fixed summary
   (balance band and key stats) and tabs for Trains, Units here (grouped by status, all units
   listed), In shop, Inspections, On the road, Inbound and Shared. Each tab scrolls in a capped area,
   and the last tab used is remembered. The parity test checks that every word and number of each
   original popup is still present.
7. The console action queue is organised hub-and-spoke (Tactical by hub / Strategic system view)
   instead of one flat list; every original action is still there, with an added hub-level hint.
8. Leaflet is bundled from npm instead of loaded from a CDN, so the file works offline. Map tiles
   still need a network connection, and the console works without them.
