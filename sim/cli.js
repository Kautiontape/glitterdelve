#!/usr/bin/env node
/* =====================================================================
   GLITTERDELVE SIM CLI

   Run big batches of games across strategies/seeds, print a ranked table,
   optionally dump full results (incl. noted-game replay recipes) to JSON.

   Examples:
     node cli.js                                  # defaults: 3 strategies, 50 games
     node cli.js -s greedyCut,noop -g 200 -t 2000
     node cli.js -s autoSorters,greedyCut --seeds 1-500
     node cli.js -w collected=1,lostToDark=-0.5   # custom objective weights
     node cli.js -o survival                       # a named objective preset
     node cli.js --rules myrules.json --json out.json
     node cli.js --list                            # list strategies & presets
   ===================================================================== */
import fs from 'node:fs';
import { runBatch, OBJECTIVE_PRESETS, DEFAULT_WEIGHTS } from './runner.js';
import { STRATEGIES } from './strategies.js';

function parseSeeds(spec) {
  const out = [];
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (part.trim()) out.push(+part);
  }
  return out;
}
function parseKV(spec) {
  const o = {};
  for (const pair of spec.split(',')) {
    const [k, v] = pair.split('=');
    if (k) o[k.trim()] = Number(v);
  }
  return o;
}
function parseArgs(argv) {
  const a = { strategies: null, games: 50, seeds: null, ticks: 1500, weights: null, rules: {}, json: null, top: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--list') a.list = true;
    else if (t === '--strategies' || t === '-s') a.strategies = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (t === '--games' || t === '-g') a.games = parseInt(next(), 10);
    else if (t === '--seeds') a.seeds = parseSeeds(next());
    else if (t === '--ticks' || t === '-t') a.ticks = parseInt(next(), 10);
    else if (t === '--weights' || t === '-w') a.weights = parseKV(next());
    else if (t === '--objective' || t === '-o') a.weights = OBJECTIVE_PRESETS[next()] || a.weights;
    else if (t === '--rules' || t === '-r') a.rules = JSON.parse(fs.readFileSync(next(), 'utf8'));
    else if (t === '--json') a.json = next();
    else if (t === '--top') a.top = parseInt(next(), 10);
  }
  return a;
}

function help() {
  console.log(`Glitterdelve simulation CLI

  -s, --strategies a,b,c   strategies to run (default: noop,greedyCut,autoSorters)
  -g, --games N            number of games per strategy (seeds 1..N)  [50]
      --seeds 1-100,200    explicit seed list/ranges (overrides --games)
  -t, --ticks N            ticks per game  [1500]
  -w, --weights k=v,...    objective weights (costs are negative)
  -o, --objective NAME     objective preset: ${Object.keys(OBJECTIVE_PRESETS).join(', ')}
  -r, --rules file.json    scalar rule overrides (cols,rows,ncol,baseReach,anchor,ampReach,...)
      --json out.json      write full results + noted replay recipes
      --top N              show only the top N strategies
      --list               list available strategies and presets
  -h, --help               this help`);
}

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padStart(n) : s.padEnd(n);
}
function fmt(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }

function printTable(batch, top) {
  const rows = top ? batch.perStrategy.slice(0, top) : batch.perStrategy;
  const W = { rank: 4, name: 16, score: 10, coll: 16, lost: 11, lit: 8, pieces: 8 };
  console.log(
    pad('#', W.rank) + pad('strategy', W.name) + pad('score', W.score, true) +
    '  ' + pad('collected µ(min–max)', W.coll) + pad('lost µ', W.lost, true) +
    pad('lit µ', W.lit, true) + pad('pieces', W.pieces, true)
  );
  console.log('-'.repeat(W.rank + W.name + W.score + 2 + W.coll + W.lost + W.lit + W.pieces));
  rows.forEach((s, i) => {
    const a = s.agg;
    const coll = `${fmt(a.collected.mean)} (${a.collected.min}–${a.collected.max})`;
    console.log(
      pad(i + 1, W.rank) + pad(s.label, W.name) + pad(fmt(a.score.mean), W.score, true) +
      '  ' + pad(coll, W.coll) + pad(fmt(a.lostToDark.mean), W.lost, true) +
      pad(fmt(a.litFinal.mean), W.lit, true) + pad(fmt(a.piecesTotal.mean), W.pieces, true)
    );
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { help(); process.exit(0); }
if (args.list) {
  console.log('Strategies:');
  for (const id in STRATEGIES) console.log(`  ${pad(id, 14)} ${STRATEGIES[id].label} — ${STRATEGIES[id].note || ''}`);
  console.log('\nObjective presets:');
  for (const p in OBJECTIVE_PRESETS) console.log(`  ${pad(p, 14)} ${JSON.stringify(OBJECTIVE_PRESETS[p])}`);
  process.exit(0);
}

const ids = args.strategies || ['noop', 'greedyCut', 'autoSorters'];
for (const id of ids) if (!STRATEGIES[id]) { console.error(`Unknown strategy: ${id}. Try --list.`); process.exit(1); }
const seeds = args.seeds || Array.from({ length: args.games }, (_, i) => i + 1);
const weights = args.weights || DEFAULT_WEIGHTS;
const strategies = ids.map((id) => ({ id, label: id, config: {} }));

const t0 = Date.now();
const batch = runBatch({ rulesOverride: args.rules, strategies, seeds, maxTicks: args.ticks, weights, keepNoted: !!args.json });
const dt = Date.now() - t0;

console.log(`\nGlitterdelve — ${strategies.length} strategies × ${seeds.length} seeds × ${args.ticks} ticks  (${dt} ms)`);
console.log(`objective weights: ${JSON.stringify(weights)}\n`);
printTable(batch, args.top);

if (args.json) {
  fs.writeFileSync(args.json, JSON.stringify(batch, null, 2));
  console.log(`\nWrote ${args.json}`);
}
