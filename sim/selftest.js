/* Engine invariant checks ported from demo.html's rules. Run: node selftest.js
   Exits non-zero on any failure. These guard against regressions when you
   refactor the engine or add tools. */
import { makeRules, DEFAULT_RULES } from './rules.js';
import {
  createState, tick, stepGravity, resolveBoard, place, allMatches,
  lightReach, isLit, ignite, H,
} from './engine.js';
import { runGame } from './runner.js';
import { optimize, evaluateBuild, candidatePlacements, fullAlphabet, pruneBuild } from './optimize.js';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function approx(name, a, b) { ok(`${name} (${a} === ${b})`, a === b); }

const R = makeRules();
const A = R.anchor;

console.log('Glitterdelve engine self-test\n');

/* 1. determinism: same seed twice -> identical metrics */
{
  const g1 = runGame({ strategyId: 'greedyCut', seed: 42, maxTicks: 400 });
  const g2 = runGame({ strategyId: 'greedyCut', seed: 42, maxTicks: 400 });
  ok('determinism: identical collected', g1.metrics.collected === g2.metrics.collected);
  ok('determinism: identical lostToDark', g1.metrics.lostToDark === g2.metrics.lostToDark);
  const scores = new Set();
  for (let seed = 1; seed <= 8; seed++) scores.add(runGame({ strategyId: 'greedyCut', seed, maxTicks: 400 }).metrics.collected);
  ok('seed influences outcome (>1 distinct result across 8 seeds)', scores.size > 1);
}

/* 2. spawnColor never hands a free match: fresh board has zero standing matches */
{
  const s = createState(R, 7);
  ok('fresh board has no free matches', allMatches(s).size === 0);
}

/* 3. anchor heartbeat scores even with no player input */
{
  const g = runGame({ strategyId: 'noop', seed: 1, maxTicks: 300 });
  ok('noop still collects via anchor floor', g.metrics.collected > 0);
}

/* 4. a Wall blocks a gem from falling through its seam (in the lit anchor col) */
{
  const s = createState(R, 1);
  for (let y = 0; y < R.rows; y++) s.grid[y][A] = H.EMPTY; // clear the anchor column
  s.grid[5][A] = 2;
  place(s, 'dam', { x: A, y: 6 }); // seam below cell (A,5)
  stepGravity(s);
  approx('wall holds the gem at row 5', s.grid[5][A], 2);
  approx('cell below the wall stays empty', s.grid[6][A], H.EMPTY);
}

/* 5. a Lens extends a charged column's light reach and blocks fall */
{
  const s = createState(R, 1);
  const c = A + 2;
  ignite(s, c); // charge it (baseReach => depth 3)
  approx('base reach before lens', lightReach(s, c).depth, R.baseReach - 1);
  place(s, 'amp', { x: c, y: 3 }); // relay at seam above (c,3)
  approx('lens relays light deeper', lightReach(s, c).depth, Math.min(R.rows - 1, 2 + R.ampReach));
}

/* 6. a Sorter swaps only when the swap makes a match */
{
  // build a horizontal A,A on the right; swapping brings a third A across the seam
  const s = createState(R, 1);
  const y = 8, x = 3; // seam between (2,y) and (3,y)
  for (let xx = 0; xx < R.cols; xx++) s.grid[y][xx] = H.EMPTY;
  s.grid[y][2] = 0; // left of seam: color 0
  s.grid[y][3] = 1; // right of seam: color 1
  s.grid[y][4] = 0;
  s.grid[y][5] = 0; // 4,5 are color 0 -> swap puts 0 at x=3 making 3,4,5 a run
  place(s, 'swap', { x, y });
  const swapTool = R.tools.find((t) => t.id === 'swap');
  swapTool.tick(s, s.pieces.get('swap'), H);
  approx('sorter performed the match-making swap', s.grid[y][3], 0);

  // negative: no possible match -> revert
  const s2 = createState(R, 1);
  for (let xx = 0; xx < R.cols; xx++) s2.grid[y][xx] = H.EMPTY;
  s2.grid[y][2] = 0; s2.grid[y][3] = 1;
  place(s2, 'swap', { x, y });
  swapTool.tick(s2, s2.pieces.get('swap'), H);
  ok('sorter reverts when no match results', s2.grid[y][2] === 0 && s2.grid[y][3] === 1);
}

/* 7. a Fork diverts: across two single-gem drops one goes straight, one sideways */
{
  const s = createState(R, 1);
  const c = A; // anchor: infinite light, and A+1 is lit too
  for (let y = 0; y < R.rows; y++) { s.grid[y][c] = H.EMPTY; s.grid[y][c + 1] = H.EMPTY; }
  place(s, 'split', { x: c, y: 2, dir: +1 }); // push toward c+1
  s.grid[2][c] = 3;
  stepGravity(s); // flip false -> straight: lands at (c,3); flip now true
  const straightLanded = s.grid[3][c] === 3;
  s.grid[2][c] = 4;
  stepGravity(s); // flip true -> divert toward c+1
  let diverted = false;
  for (let y = 0; y < R.rows; y++) if (s.grid[y][c + 1] === 4) diverted = true;
  ok('fork lands one gem straight, alternates the next sideways', straightLanded && diverted);
}

/* 8. a lit match ignites the neighbour column further from centre */
{
  const s = createState(R, 1);
  const y = 1; // well inside the light
  s.grid[y][A - 1] = 5; s.grid[y][A] = 5; s.grid[y][A + 1] = 5; // triple across centre
  const before = s.litCols[A + 2];
  resolveBoard(s);
  ok('lit match ignites outward neighbour (A+2)', !before && s.litCols[A + 2] === true);
}

/* 9. optimizer: deterministic, and finds a build that beats the no-build baseline */
{
  const cfg = { greedy: { maxPieces: 3, beamWidth: 2, racingSeeds: 2, colSpan: 1, maxRow: 6 } };
  const o1 = optimize({ method: 'greedy', ticks: 250, numSeeds: 4, optimizerSeed: 7, cfg });
  const o2 = optimize({ method: 'greedy', ticks: 250, numSeeds: 4, optimizerSeed: 7, cfg });
  ok('optimizer is deterministic (same opt-seed -> same score)', o1.best.confirm.mean === o2.best.confirm.mean);
  ok('optimizer beats the no-build baseline', o1.best.confirm.mean > o1.baseline.mean);
  // a hand build of sorters by the anchor should also clear the baseline
  const hand = [{ tool: 'swap', x: A, y: 1 }, { tool: 'swap', x: A, y: 2 }, { tool: 'swap', x: A, y: 3 }];
  const hb = evaluateBuild(hand, { seeds: [1, 2, 3, 4], ticks: 400 });
  const base = evaluateBuild([], { seeds: [1, 2, 3, 4], ticks: 400 });
  ok('a sorter build scores >= empty board', hb.mean >= base.mean);
}

/* 10. GA gene pool covers the COMPLETE allele alphabet (full gamut) */
{
  const alpha = fullAlphabet(R); // search tools = lens, sorter, fork (no walls)
  approx('alphabet total = 117 lenses + 112 sorters + 252 forks', alpha.total, 117 + 112 + 252);
  ok('default candidate pool equals the full alphabet (complete coverage)', candidatePlacements(R).length === alpha.total);
}

/* 11. prune removes dead pieces without losing points */
{
  // a useful sorter pair + a guaranteed-dead piece (a wall in a far dark column)
  const useful = [{ tool: 'swap', x: A, y: 1 }, { tool: 'swap', x: A, y: 2 }];
  const padded = useful.concat([{ tool: 'dam', x: 0, y: 12 }]); // dead: col 0 stays dark
  const ev = { seeds: [1, 2, 3, 4], ticks: 400 };
  const before = evaluateBuild(padded, ev).collectedMean;
  const pr = pruneBuild(padded, ev);
  ok('prune drops the dead piece', pr.layout.length < padded.length);
  ok('prune keeps the score (within tolerance)', pr.collectedMean >= before - 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
