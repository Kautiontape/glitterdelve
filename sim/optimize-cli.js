#!/usr/bin/env node
/* =====================================================================
   BUILD OPTIMIZER CLI

   Search for the best static whole-board layout (no cutting) and report the
   points it acquires, averaged over X seeds of T ticks.

   Examples:
     node optimize-cli.js                          # all 3 (pipeline), defaults
     node optimize-cli.js --quick                  # fast, smaller search
     node optimize-cli.js -m greedy -t 1000 -n 24
     node optimize-cli.js --colspan 4 --maxpieces 16 --json best.json
     node optimize-cli.js -w collected=1,lostToDark=-0.2

   The winning layout is printed as a lattice and (with --json) saved as a
   staticBuild recipe you can replay in the web viewer.
   ===================================================================== */
import fs from 'node:fs';
import { optimize, layoutToRecipe } from './optimize.js';
import { OBJECTIVE_PRESETS, DEFAULT_WEIGHTS } from './runner.js';
import { makeRules } from './rules.js';

function parseKV(spec) { const o = {}; for (const p of spec.split(',')) { const [k, v] = p.split('='); if (k) o[k.trim()] = Number(v); } return o; }
function parseArgs(argv) {
  const a = { method: 'all', ticks: 1000, seeds: 16, weights: null, rules: {}, json: null, optSeed: 1,
    colspan: 2, maxpieces: 8, beam: 3, racing: 3, saIters: 300, gaPop: 30, gaGens: 15, quick: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i], next = () => argv[++i];
    if (t === '-h' || t === '--help') a.help = true;
    else if (t === '-m' || t === '--method') a.method = next();
    else if (t === '-t' || t === '--ticks') a.ticks = parseInt(next(), 10);
    else if (t === '-n' || t === '--seeds') a.seeds = parseInt(next(), 10);
    else if (t === '-w' || t === '--weights') a.weights = parseKV(next());
    else if (t === '-o' || t === '--objective') a.weights = OBJECTIVE_PRESETS[next()] || a.weights;
    else if (t === '-r' || t === '--rules') a.rules = JSON.parse(fs.readFileSync(next(), 'utf8'));
    else if (t === '--colspan') a.colspan = parseInt(next(), 10);
    else if (t === '--maxpieces') a.maxpieces = parseInt(next(), 10);
    else if (t === '--beam') a.beam = parseInt(next(), 10);
    else if (t === '--racing') a.racing = parseInt(next(), 10);
    else if (t === '--sa-iters') a.saIters = parseInt(next(), 10);
    else if (t === '--ga-pop') a.gaPop = parseInt(next(), 10);
    else if (t === '--ga-gens') a.gaGens = parseInt(next(), 10);
    else if (t === '--opt-seed') a.optSeed = parseInt(next(), 10);
    else if (t === '--json') a.json = next();
    else if (t === '--quick') a.quick = true;
  }
  return a;
}
function help() {
  console.log(`Glitterdelve build optimizer

  -m, --method all|pattern|greedy|sa|ga   pattern=dense full-board tiling; all runs every method [all]
  -t, --ticks N                   ticks per run (the horizon) [1000]
  -n, --seeds N                   seeds averaged per build (common random numbers) [16]
  -w, --weights k=v,...           objective weights (costs negative) [collected=1]
  -o, --objective NAME            preset: ${Object.keys(OBJECTIVE_PRESETS).join(', ')}
  -r, --rules file.json           scalar rule overrides
      --colspan N                 columns each side of anchor to consider [2]
      --maxpieces N               max pieces greedy will add [8]
      --beam N                    greedy beam width [3]
      --racing N                  cheap seeds used to shortlist proposals [3]
      --sa-iters N / --ga-pop N / --ga-gens N    polish budgets
      --opt-seed N                optimizer RNG seed (reproducible search) [1]
      --quick                     fast preset (small search)
      --json out.json             save results + a replayable recipe of the winner
  -h, --help`);
}

/* render a layout as a lattice: cells hold forks; seams hold walls/lenses/sorters */
function renderLayoutAscii(layout, rules) {
  const W = rules.cols * 2 + 1, Hh = rules.rows * 2 + 1;
  const grid = Array.from({ length: Hh }, () => new Array(W).fill(' '));
  for (let y = 0; y < rules.rows; y++) for (let x = 0; x < rules.cols; x++) grid[y * 2 + 1][x * 2 + 1] = '·';
  for (const p of layout) {
    if (p.tool === 'split') grid[p.y * 2 + 1][p.x * 2 + 1] = p.dir < 0 ? '◄' : '►';
    else if (p.tool === 'dam') grid[p.y * 2][p.x * 2 + 1] = '═';
    else if (p.tool === 'amp') grid[p.y * 2][p.x * 2 + 1] = '≣';
    else if (p.tool === 'swap') grid[p.y * 2 + 1][p.x * 2] = '║';
  }
  // anchor marker on the top border
  const head = new Array(W).fill(' '); head[rules.anchor * 2 + 1] = '▼';
  return head.join('') + '\n' + grid.map((r) => r.join('')).join('\n');
}
function fmt(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }

const args = parseArgs(process.argv.slice(2));
if (args.help) { help(); process.exit(0); }
if (args.quick) { args.ticks = Math.min(args.ticks, 600); args.seeds = Math.min(args.seeds, 8); args.colspan = Math.min(args.colspan, 2); args.maxpieces = Math.min(args.maxpieces, 6); args.saIters = 120; args.gaPop = 16; args.gaGens = 8; }

const weights = args.weights || DEFAULT_WEIGHTS;
const rules = makeRules(args.rules);
console.log(`\nGlitterdelve build optimizer — method=${args.method}  ${args.seeds} seeds × ${args.ticks} ticks  weights=${JSON.stringify(weights)}`);
console.log(`search box: ±${args.colspan} cols around anchor, up to ${args.maxpieces} pieces\n`);

let lastLine = '';
const t0 = Date.now();
const out = optimize({
  method: args.method, ticks: args.ticks, numSeeds: args.seeds, weights,
  rulesOverride: args.rules, optimizerSeed: args.optSeed,
  cfg: {
    greedy: { maxPieces: args.maxpieces, beamWidth: args.beam, racingSeeds: args.racing, colSpan: args.colspan },
    sa: { iters: args.saIters, colSpan: args.colspan },
    ga: { popSize: args.gaPop, gens: args.gaGens, colSpan: args.colspan },
    pattern: { samples: args.quick ? 40 : 60, refine: args.quick ? 25 : 40 },
  },
  onProgress: (info) => {
    const tag = info.step ? `step ${info.step}` : info.iter != null ? `iter ${info.iter}` : info.gen ? `gen ${info.gen}` : '';
    const line = `  [${info.method}] ${tag}  best ${fmt(info.bestMean)}  evals ${info.evals}`;
    if (line === lastLine) return;
    lastLine = line;
    if (process.stdout.isTTY) process.stdout.write('\r' + line.padEnd(60));
    else console.log(line);
  },
});
const dt = ((Date.now() - t0) / 1000).toFixed(1);
if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(62) + '\r');
else console.log('');

console.log(`baseline (no build): ${fmt(out.baseline.mean)} ± ${fmt(out.baseline.std)}`);
console.log(`gene pool: ${out.coverage.poolSize}/${out.coverage.fullAlphabet} alleles ${out.coverage.complete ? '(complete)' : '(INCOMPLETE)'}\n`);
const order = Object.keys(out.results);
console.log(`  ${'method'.padEnd(8)} ${'points'.padStart(8)}  ${'± std'.padStart(6)}   ${'lit'.padStart(6)}   pieces   evals`);
for (const m of order) {
  const cf = out.results[m].best.confirm;
  console.log(`  ${m.padEnd(8)} ${fmt(cf.mean).padStart(8)}  ${fmt(cf.std).padStart(6)}   ${(cf.litMean.toFixed(1) + '/' + rules.cols).padStart(6)}   ${String(out.results[m].best.layout.length).padStart(3)}      ${out.results[m].evals}`);
}
const b = out.best;
const gain = b.confirm.mean - out.baseline.mean;
console.log(`\nBEST: ${b.method} → ${fmt(b.confirm.mean)} ± ${fmt(b.confirm.std)} points · lit ${b.confirm.litMean.toFixed(1)}/${rules.cols} · lost ${b.confirm.lostMean.toFixed(0)}  (+${fmt(gain)}, ${((b.confirm.mean / out.baseline.mean - 1) * 100).toFixed(0)}% over baseline)  in ${dt}s`);
const ess = b.pruned || { layout: b.layout };
const essPts = b.prunedConfirm ? b.prunedConfirm.collectedMean : b.confirm.collectedMean;
console.log(`essential after prune: ${ess.layout.length} pieces (was ${b.layout.length}) for ${fmt(essPts)} pts`);
console.log(`▼=anchor  ═=Wall  ≣=Lens  ║=Sorter  ►◄=Fork\n`);
console.log(renderLayoutAscii(ess.layout, rules));
console.log('\nlayout (essential):', JSON.stringify(ess.layout));

if (args.json) {
  const recipe = layoutToRecipe(ess.layout, { rulesOverride: args.rules, seed: out.params.seeds[0], ticks: args.ticks });
  fs.writeFileSync(args.json, JSON.stringify({ params: out.params, baseline: out.baseline,
    results: Object.fromEntries(order.map((m) => [m, { mean: out.results[m].best.mean, std: out.results[m].best.std, layout: out.results[m].best.layout, history: out.results[m].history }])),
    best: { method: b.method, mean: b.confirm.mean, std: b.confirm.std, layout: b.layout }, recipe }, null, 2));
  console.log(`\nWrote ${args.json} (replay the winner via the web viewer's "load recipe")`);
}
