/* Climb-engine invariant checks. Run: node climb-selftest.js
   Exits non-zero on any failure. Mirrors selftest.js for the climb mode. */
import { makeClimbRules, CLIMB_TOOLS } from './rules.js';
import {
  createClimbState, tickClimb, stepGravityClimb, resolveClimb, stepSwappersClimb,
  stepSpawnClimb, placeClimb, removeClimb, bombClimb, costOf, isLit, litCeiling, EMPTY,
} from './climb-engine.js';
import { allMatches } from './engine.js';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function approx(name, a, b) { ok(`${name} (${a} === ${b})`, a === b); }

console.log('Glitterdelve CLIMB self-test\n');

/* 1. ruleset shape */
{
  const R = makeClimbRules();
  approx('climb has 6 tools', R.tools.length, 6);
  ok('bomb is a free action', R.tools[0].id === 'bomb' && R.tools[0].kind === 'action' && R.costs.bomb === 0);
  ok('lens (amp) does not block fall and is fragile', !R.tools.find((t) => t.id === 'amp').blocksFall && R.tools.find((t) => t.id === 'amp').fragile === true);
  ok('slope diverts every gem (always)', R.tools.find((t) => t.id === 'slope').always === true);
  ok('overrides apply (rows)', makeClimbRules({ rows: 40 }).rows === 40);
}

/* 2. createClimbState: deterministic shape, no free matches, frontier + grant set */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 7);
  ok('grid is rows x cols', s.grid.length === R.rows && s.grid[0].length === R.cols);
  ok('life grid mirrors the gem grid', s.life.length === R.rows && s.life[5].length === R.cols);
  ok('starting energy is the grant', s.energy === R.startGrant);
  ok('total harvested starts at 0', s.harvested === 0);
  approx('frontier starts baseReach above the floor', s.frontier, R.rows - 1 - (R.baseReach - 1));
  ok('pre-fill leaves no free matches', allMatches(s).size === 0);
  let gems = 0; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) if (s.grid[y][x] !== EMPTY) gems++;
  ok('pre-fill placed some gems', gems > 0);
  ok('every gem has positive life', (() => { for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) { if (s.grid[y][x] !== EMPTY && s.life[y][x] < 1) return false; } return true; })());
}

/* 3. frontier light: bottom band + a lens pushes the lit ceiling upward */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const x = 3, f = s.frontier;
  ok('cell at the frontier is lit', isLit(s, x, f));
  ok('cell one row above the frontier is dark', !isLit(s, x, f - 1));
  approx('litCeiling equals the frontier with no lenses', litCeiling(s, x), f);
  s.pieces.get('amp').set(x + ',' + f, true); // direct placement (placeClimb arrives in Task 7)
  approx('lens raises the lit ceiling by lensReach', litCeiling(s, x), Math.max(0, f - R.lensReach));
  ok('a cell within the lens relay is now lit', isLit(s, x, f - 1));
  ok('a neighbouring column is unaffected', litCeiling(s, x + 1) === f);
}

/* 4. gravity: gems fall one row, burn one life per step, break at 0; walls hold;
      the Glitterdelve floor drains rested gems for 0 energy */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  // clear a column to test in isolation
  for (let y = 0; y < R.rows; y++) { s.grid[y][2] = EMPTY; s.life[y][2] = 0; }
  s.grid[10][2] = 0; s.life[10][2] = 3;
  stepGravityClimb(s);
  ok('gem fell one row', s.grid[11][2] === 0 && s.grid[10][2] === EMPTY);
  approx('one life burned by the fall', s.life[11][2], 2);

  // a gem with life 1 breaks on its next fall-step (lost to the dark)
  const s2 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) { s2.grid[y][2] = EMPTY; s2.life[y][2] = 0; }
  s2.grid[10][2] = 0; s2.life[10][2] = 1;
  const lostBefore = s2.lost;
  stepGravityClimb(s2);
  ok('a 1-life gem breaks when it falls', s2.grid[10][2] === EMPTY && s2.grid[11][2] === EMPTY);
  approx('break increments lost', s2.lost, lostBefore + 1);

  // a Wall holds a gem in place (no fall, no life loss)
  const s3 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) { s3.grid[y][2] = EMPTY; s3.life[y][2] = 0; }
  s3.grid[10][2] = 0; s3.life[10][2] = 3;
  s3.pieces.get('dam').set('2,11', true); // wall on the seam below (2,10)
  stepGravityClimb(s3);
  ok('wall holds the gem', s3.grid[10][2] === 0);
  approx('held gem loses no life', s3.life[10][2], 3);

  // floor drain: a gem resting on the bottom row is consumed for 0 energy
  const s4 = createClimbState(R, 1);
  const fy = R.rows - 1;
  for (let y = 0; y < R.rows; y++) { s4.grid[y][2] = EMPTY; s4.life[y][2] = 0; } // isolate the column (no gem falls in behind it)
  s4.grid[fy][2] = 0; s4.life[fy][2] = 5;
  const harvestBefore = s4.harvested;
  stepGravityClimb(s4);
  ok('floor drains the bottom-row gem', s4.grid[fy][2] === EMPTY);
  approx('floor drain yields no energy', s4.harvested, harvestBefore);
}

/* 5. Slope diverts EVERY gem; Splitter alternates; a falling gem breaks a Lens */
{
  const R = makeClimbRules();
  // Slope: two gems dropped through the same cell both go sideways
  const s = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) for (const x of [2, 3]) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; }
  s.pieces.get('slope').set('2,10', { dir: 1, flip: false });
  s.grid[9][2] = 0; s.life[9][2] = 9;
  stepGravityClimb(s); // gem at (2,9) -> falls to slope cell (2,10)
  stepGravityClimb(s); // at the slope -> diverts to col 3
  let onCol3 = false; for (let y = 0; y < R.rows; y++) if (s.grid[y][3] === 0) onCol3 = true;
  ok('slope diverts the gem sideways', onCol3);
  // a second gem through the same slope ALSO diverts (always)
  s.grid[9][2] = 1; s.life[9][2] = 9;
  stepGravityClimb(s); stepGravityClimb(s);
  let secondOnCol3 = false; for (let y = 0; y < R.rows; y++) if (s.grid[y][3] === 1) secondOnCol3 = true;
  ok('slope diverts the next gem too (every gem)', secondOnCol3);

  // Splitter: one straight, the next sideways
  const s2 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) for (const x of [5, 6]) { s2.grid[y][x] = EMPTY; s2.life[y][x] = 0; }
  s2.pieces.get('split').set('5,10', { dir: 1, flip: false });
  s2.grid[10][5] = 0; s2.life[10][5] = 9;
  stepGravityClimb(s2); // flip false -> straight to (5,11)
  const straight = s2.grid[11][5] === 0;
  s2.grid[10][5] = 1; s2.life[10][5] = 9;
  stepGravityClimb(s2); // flip now true -> divert to col 6
  let diverted = false; for (let y = 0; y < R.rows; y++) if (s2.grid[y][6] === 1) diverted = true;
  ok('splitter passes one straight then diverts the next', straight && diverted);

  // Lens fragility: a gem falling onto a lens seam removes the lens
  const s3 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) { s3.grid[y][4] = EMPTY; s3.life[y][4] = 0; }
  s3.pieces.get('amp').set('4,11', true); // lens seam below cell (4,10)
  s3.grid[10][4] = 0; s3.life[10][4] = 9;
  stepGravityClimb(s3);
  ok('falling gem breaks the lens', !s3.pieces.get('amp').has('4,11'));
  ok('gem passed through the broken lens', s3.grid[11][4] === 0);
}

/* 6. resolve: a lit run scores per the table, awards energy, raises the frontier;
      a dark run clears but scores nothing; reaching the top wins */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const y = R.rows - 2; // inside the lit band (>= frontier)
  for (let x = 0; x < R.cols; x++) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; }
  s.grid[y][2] = 0; s.grid[y][3] = 0; s.grid[y][4] = 0; // a lit horizontal triple
  for (const x of [2, 3, 4]) s.life[y][x] = 9;
  const f0 = s.frontier, e0 = s.energy, h0 = s.harvested;
  const changed = resolveClimb(s);
  ok('resolve reports a change', changed === true);
  ok('lit triple cleared', s.grid[y][2] === EMPTY && s.grid[y][4] === EMPTY);
  approx('triple awards 3 energy', s.harvested, h0 + 3);
  approx('energy balance grows by the award', s.energy, e0 + 3);
  approx('frontier rose by one row', s.frontier, f0 - 1);

  // a quad scores 6, a quint scores 12
  const sq = createClimbState(R, 1);
  const yy = R.rows - 2;
  for (let x = 0; x < R.cols; x++) { sq.grid[yy][x] = EMPTY; sq.life[yy][x] = 0; }
  for (const x of [1, 2, 3, 4]) { sq.grid[yy][x] = 1; sq.life[yy][x] = 9; }
  const hq = sq.harvested; resolveClimb(sq);
  approx('quad awards 6 energy', sq.harvested, hq + 6);
  const s5 = createClimbState(R, 1);
  for (let x = 0; x < R.cols; x++) { s5.grid[yy][x] = EMPTY; s5.life[yy][x] = 0; }
  for (const x of [1, 2, 3, 4, 5]) { s5.grid[yy][x] = 2; s5.life[yy][x] = 9; }
  const h5 = s5.harvested; resolveClimb(s5);
  approx('quint awards 12 energy', s5.harvested, h5 + 12);

  // a dark run (above the lit ceiling) clears but scores nothing
  const sd = createClimbState(R, 1);
  const dy = 2; // near the top, well above the frontier => dark
  for (let x = 0; x < R.cols; x++) { sd.grid[dy][x] = EMPTY; sd.life[dy][x] = 0; }
  for (const x of [2, 3, 4]) { sd.grid[dy][x] = 3; sd.life[dy][x] = 9; }
  const hd = sd.harvested, fd = sd.frontier;
  resolveClimb(sd);
  ok('dark run clears', sd.grid[dy][2] === EMPTY);
  approx('dark run scores no energy', sd.harvested, hd);
  approx('dark run does not raise the frontier', sd.frontier, fd);

  // reaching the top wins
  const sw = createClimbState(R, 1);
  sw.frontier = 1;
  const wy = R.rows - 2;
  for (let x = 0; x < R.cols; x++) { sw.grid[wy][x] = EMPTY; sw.life[wy][x] = 0; }
  for (const x of [2, 3, 4]) { sw.grid[wy][x] = 4; sw.life[wy][x] = 9; }
  resolveClimb(sw);
  ok('frontier hit 0 sets won', sw.frontier === 0 && sw.won === true);
}

/* 7. swapper makes a match-creating swap (and carries life); spawn curtain;
      economy place/remove/bomb with cost gating; full tick is deterministic */
{
  const R = makeClimbRules();
  // Swapper: seam between (2,y) and (3,y); left=0,right=1, with 0s at 4,5 ->
  // swapping 0 across the seam makes 3,4,5 a run of color 0
  const s = createClimbState(R, 1);
  const y = R.rows - 2;
  for (let x = 0; x < R.cols; x++) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; }
  s.grid[y][2] = 0; s.grid[y][3] = 1; s.grid[y][4] = 0; s.grid[y][5] = 0;
  for (const x of [2, 3, 4, 5]) s.life[y][x] = 9;
  s.pieces.get('swap').set('3,' + y, true);
  stepSwappersClimb(s);
  ok('swapper performed the match-making swap', s.grid[y][3] === 0);
  approx('swapper carried life across the seam', s.life[y][3], 9);

  // spawn curtain: emits into empty top cells (seeded)
  const ss = createClimbState(R, 2);
  for (let x = 0; x < R.cols; x++) { ss.grid[0][x] = EMPTY; ss.life[0][x] = 0; }
  stepSpawnClimb(ss);
  let emitted = 0; for (let x = 0; x < R.cols; x++) if (ss.grid[0][x] !== EMPTY) emitted++;
  ok('spawn curtain emits some gems at the top', emitted > 0);
  ok('emitted gems have life', (() => { for (let x = 0; x < R.cols; x++) if (ss.grid[0][x] !== EMPTY && ss.life[0][x] < 1) return false; return true; })());

  // economy: cost gating
  const se = createClimbState(R, 3);
  se.energy = 5;
  ok('cannot afford a Lens (cost 9)', placeClimb(se, 'amp', { x: 4, y: se.frontier }) === false);
  ok('can afford a Wall (cost 3)', placeClimb(se, 'dam', { x: 4, y: 10 }) === true);
  approx('wall deducted 3 energy', se.energy, 2);
  approx('spent tracked', se.spent, 3);
  ok('remove deletes the piece', removeClimb(se, 'dam', { x: 4, y: 10 }) === true);
  // bomb: free, destroys a gem
  se.grid[12][4] = 0; se.life[12][4] = 5;
  const eb = se.energy;
  ok('bomb destroys a gem', bombClimb(se, 4, 12) === true && se.grid[12][4] === EMPTY);
  approx('bomb is free', se.energy, eb);
  ok('costOf reads the table', costOf(se, 'swap') === 6 && costOf(se, 'bomb') === 0);

  // full tick determinism
  const a = createClimbState(R, 99), b = createClimbState(R, 99);
  for (let i = 0; i < 120; i++) { tickClimb(a); tickClimb(b); }
  ok('tick is deterministic (harvested)', a.harvested === b.harvested);
  ok('tick is deterministic (lost)', a.lost === b.lost);
  ok('tick is deterministic (frontier)', a.frontier === b.frontier);
  ok('a no-build game still loses gems to decay', a.lost > 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
