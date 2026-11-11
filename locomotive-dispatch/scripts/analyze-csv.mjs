#!/usr/bin/env node
/**
 * Re-bake the built-in snapshot from an STP export, using the same engine as the browser.
 *
 *   npm run analyze -- path/to/STP_Locomotives.csv            # writes data/snapshot.json
 *   npm run analyze -- path/to/STP_Locomotives.csv --out x.json --day 2
 *   npm run analyze -- path/to/STP_Locomotives.csv --summary  # print a summary only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCSV, analyze, isStpExport, computeKpis } from '../src/core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = (f) => JSON.parse(readFileSync(path.join(root, 'data', f), 'utf8'));

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--day');
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!csvPath) {
  console.error('usage: npm run analyze -- <STP_Locomotives.csv> [--out data/snapshot.json] [--day 0-6] [--summary]');
  process.exit(2);
}

const rows = parseCSV(readFileSync(csvPath, 'utf8'));
if (!isStpExport(rows)) { console.error(`${csvPath} does not look like an STP export (no 'Loco ID' column).`); process.exit(1); }
const day = flag('--day') != null ? +flag('--day') : null;
const out = analyze(rows, data('static-plan.json'), data('base2home.json'), {
  multiHome: data('base2home-multi.json'), lcs: data('lcs-fleet.json'), day,
});
const k = computeKpis(out);
const short = out.stations.filter((s) => s.status === 'short').length;
console.log(`snapshot ${out.meta.snapshot}: ${rows.length} units · ${out.stations.length} plan locations · ` +
  `required ${k.totReq} / on hand ${k.totHave} (${k.totNet >= 0 ? '+' : ''}${k.totNet}) · ${short} short · ` +
  `${out.dead.length} dead · ${out.deadhead.length} inbound deadhead`);
if (args.includes('--summary')) process.exit(0);
const dest = flag('--out') || path.join(root, 'data', 'snapshot.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${path.relative(process.cwd(), dest)} — run \`npm run build\` to bake it into dist/index.html`);
