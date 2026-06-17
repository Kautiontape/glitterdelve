/* Climb-engine invariant checks. Run: node climb-selftest.js
   Exits non-zero on any failure. Mirrors selftest.js for the climb mode.
   Model: bottom light raised only by lenses; gems decay only in the dark and
   pile up in the light; harvest funds building; reach the Source (row 0) to win. */
import { makeClimbRules, CLIMB_TOOLS } from './rules.js';
import {
  createClimbState, tickClimb, stepGravityClimb, decayDark, resolveClimb, stepSwappersClimb,
  stepSpawnClimb, placeClimb, removeClimb, bombClimb, costOf, isLit, lightCeiling, EMPTY,
} from './climb-engine.js';
import { allMatches } from './engine.js';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function approx(name, a, b) { ok(`${name} (${a} === ${b})`, a === b); }
function clearGrid(s) { const R = s.rules; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; } }

console.log('Glitterdelve CLIMB self-test\n');

/* 1. ruleset shape */
{
  const R = makeClimbRules();
  approx('climb has 6 tools', R.tools.length, 6);
  ok('bomb is a free action', R.tools[0].id === 'bomb' && R.tools[0].kind === 'action' && R.costs.bomb === 0);
  ok('lens (amp) does not block fall and is fragile', !R.tools.find((t) => t.id === 'amp').blocksFall && R.tools.find((t) => t.id === 'amp').fragile === true);
  ok('slope diverts every gem (always)', R.tools.find((t) => t.id === 'slope').always === true);
  ok('shaft is fully visible (rows == view)', R.rows === R.view);
  ok('overrides apply (rows)', makeClimbRules({ rows: 40 }).rows === 40);
}

/* 2. createClimbState: deterministic shape, no free matches, grant set, base light */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 7);
  ok('grid is rows x cols', s.grid.length === R.rows && s.grid[0].length === R.cols);
  ok('life grid mirrors the gem grid', s.life.length === R.rows && s.life[5].length === R.cols);
  ok('starting energy is the grant', s.energy === R.startGrant);
  ok('total harvested starts at 0', s.harvested === 0);
  approx('light base sits baseReach above the floor', lightCeiling(s), R.rows - R.baseReach);
  ok('pre-fill leaves no free matches', allMatches(s).size === 0);
  let gems = 0; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) if (s.grid[y][x] !== EMPTY) gems++;
  ok('pre-fill placed some gems', gems > 0);
}

/* 3. light: a base band at the bottom; a fed Lens raises the ceiling full-width */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const base = R.rows - R.baseReach;
  approx('ceiling starts at the base band', lightCeiling(s), base);
  ok('a cell at the ceiling is lit', isLit(s, 3, base));
  ok('a cell one row above is dark', !isLit(s, 3, base - 1));
  s.pieces.get('amp').set('3,' + base, true); // lens fed by the lit cell below it
  approx('lens raises the ceiling by lensReach', lightCeiling(s), Math.max(0, base - R.lensReach));
  ok('the lens lights ALL columns (full width)', isLit(s, 0, base - 1) && isLit(s, 8, base - 1));
  // chain a second lens off the first
  s.pieces.get('amp').set('5,' + (base - R.lensReach), true);
  approx('a chained lens raises it again', lightCeiling(s), Math.max(0, base - 2 * R.lensReach));
}

/* 4. gravity: gems fall one row carrying life (no loss); walls hold; gems pile up */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  clearGrid(s);
  s.grid[8][2] = 0; s.life[8][2] = 5;
  stepGravityClimb(s);
  ok('gem fell one row', s.grid[9][2] === 0 && s.grid[8][2] === EMPTY);
  approx('falling alone does not burn life', s.life[9][2], 5);

  // a Wall holds a gem in place
  const s2 = createClimbState(R, 1);
  clearGrid(s2);
  s2.grid[8][2] = 0; s2.life[8][2] = 5;
  s2.pieces.get('dam').set('2,9', true); // wall on the seam below (2,8)
  stepGravityClimb(s2);
  ok('wall holds the gem', s2.grid[8][2] === 0 && s2.grid[9][2] === EMPTY);

  // gems pile up on the floor (no drain)
  const s3 = createClimbState(R, 1);
  clearGrid(s3);
  const fy = R.rows - 1;
  s3.grid[fy][2] = 0; s3.life[fy][2] = 5;
  s3.grid[fy - 1][2] = 1; s3.life[fy - 1][2] = 5;
  stepGravityClimb(s3);
  ok('floor gem stays (no drain)', s3.grid[fy][2] === 0);
  ok('the next gem stacks on top', s3.grid[fy - 1][2] === 1);
}

/* 5. decay: gems lose life only in the dark; lit gems are safe; break at 0 */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  const s = createClimbState(R, 1);
  clearGrid(s);
  s.grid[3][2] = 0; s.life[3][2] = 2;       // row 3 is dark (above the ceiling)
  s.grid[base + 1][4] = 0; s.life[base + 1][4] = 2; // inside the light
  decayDark(s);
  approx('a dark gem loses one life', s.life[3][2], 1);
  approx('a lit gem keeps its life', s.life[base + 1][4], 2);
  const lostBefore = s.lost;
  decayDark(s); // dark gem 1 -> 0 -> breaks
  ok('a dark gem breaks at 0 life', s.grid[3][2] === EMPTY);
  approx('break increments lost', s.lost, lostBefore + 1);
  ok('the lit gem still survives', s.grid[base + 1][4] === 0);
}

/* 6. Slope diverts EVERY gem; Splitter alternates; a falling gem breaks a Lens */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  clearGrid(s);
  s.pieces.get('slope').set('2,10', { dir: 1, flip: false });
  s.grid[9][2] = 0; s.life[9][2] = 9;
  stepGravityClimb(s); stepGravityClimb(s);
  let onCol3 = false; for (let y = 0; y < R.rows; y++) if (s.grid[y][3] === 0) onCol3 = true;
  ok('slope diverts the gem sideways', onCol3);
  s.grid[9][2] = 1; s.life[9][2] = 9;
  stepGravityClimb(s); stepGravityClimb(s);
  let secondOnCol3 = false; for (let y = 0; y < R.rows; y++) if (s.grid[y][3] === 1) secondOnCol3 = true;
  ok('slope diverts the next gem too (every gem)', secondOnCol3);

  const s2 = createClimbState(R, 1);
  clearGrid(s2);
  s2.pieces.get('split').set('5,10', { dir: 1, flip: false });
  s2.grid[10][5] = 0; s2.life[10][5] = 9;
  stepGravityClimb(s2); // flip false -> straight to (5,11)
  const straight = s2.grid[11][5] === 0;
  s2.grid[10][5] = 1; s2.life[10][5] = 9;
  stepGravityClimb(s2); // flip true -> divert to col 6
  let diverted = false; for (let y = 0; y < R.rows; y++) if (s2.grid[y][6] === 1) diverted = true;
  ok('splitter passes one straight then diverts the next', straight && diverted);

  const s3 = createClimbState(R, 1);
  clearGrid(s3);
  s3.pieces.get('amp').set('4,11', true);
  s3.grid[10][4] = 0; s3.life[10][4] = 9;
  stepGravityClimb(s3);
  ok('falling gem breaks the lens', !s3.pieces.get('amp').has('4,11'));
  ok('gem passed through the broken lens', s3.grid[11][4] === 0);
}

/* 7. harvest: lit runs score (energy only, no light move); dark runs score nothing */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  const s = createClimbState(R, 1);
  clearGrid(s);
  const y = base + 1; // inside the light
  for (const x of [2, 3, 4]) { s.grid[y][x] = 0; s.life[y][x] = 9; }
  const e0 = s.energy, h0 = s.harvested, c0 = lightCeiling(s);
  const changed = resolveClimb(s);
  ok('resolve reports a change', changed === true);
  ok('lit triple cleared', s.grid[y][2] === EMPTY && s.grid[y][4] === EMPTY);
  approx('triple awards 3 energy', s.harvested, h0 + 3);
  approx('energy balance grows by the award', s.energy, e0 + 3);
  approx('harvest does NOT move the light', lightCeiling(s), c0);

  const sq = createClimbState(R, 1); clearGrid(sq);
  for (const x of [1, 2, 3, 4]) { sq.grid[y][x] = 1; sq.life[y][x] = 9; }
  const hq = sq.harvested; resolveClimb(sq);
  approx('quad awards 6 energy', sq.harvested, hq + 6);
  const s5 = createClimbState(R, 1); clearGrid(s5);
  for (const x of [1, 2, 3, 4, 5]) { s5.grid[y][x] = 2; s5.life[y][x] = 9; }
  const h5 = s5.harvested; resolveClimb(s5);
  approx('quint awards 12 energy', s5.harvested, h5 + 12);

  const sd = createClimbState(R, 1); clearGrid(sd);
  const dy = 2; // above the ceiling => dark
  for (const x of [2, 3, 4]) { sd.grid[dy][x] = 3; sd.life[dy][x] = 9; }
  const hd = sd.harvested;
  resolveClimb(sd);
  ok('dark run clears', sd.grid[dy][2] === EMPTY);
  approx('dark run scores no energy', sd.harvested, hd);
}

/* 8. swapper, spawn, economy, tick determinism, and the win condition */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  // Swapper: seam between (2,y) and (3,y); swapping brings a third 0 across
  const s = createClimbState(R, 1);
  clearGrid(s);
  const y = base + 1;
  s.grid[y][2] = 0; s.grid[y][3] = 1; s.grid[y][4] = 0; s.grid[y][5] = 0;
  for (const x of [2, 3, 4, 5]) s.life[y][x] = 9;
  s.pieces.get('swap').set('3,' + y, true);
  stepSwappersClimb(s);
  ok('swapper performed the match-making swap', s.grid[y][3] === 0);
  approx('swapper carried life across the seam', s.life[y][3], 9);

  // spawn curtain
  const ss = createClimbState(R, 2);
  for (let x = 0; x < R.cols; x++) { ss.grid[0][x] = EMPTY; ss.life[0][x] = 0; }
  stepSpawnClimb(ss);
  let emitted = 0; for (let x = 0; x < R.cols; x++) if (ss.grid[0][x] !== EMPTY) emitted++;
  ok('spawn curtain emits some gems at the top', emitted > 0);

  // economy: cost gating
  const se = createClimbState(R, 3);
  se.energy = 5;
  ok('cannot afford a Lens (cost 9)', placeClimb(se, 'amp', { x: 4, y: base }) === false);
  ok('can afford a Wall (cost 3)', placeClimb(se, 'dam', { x: 4, y: 10 }) === true);
  approx('wall deducted 3 energy', se.energy, 2);
  approx('spent tracked', se.spent, 3);
  ok('remove deletes the piece', removeClimb(se, 'dam', { x: 4, y: 10 }) === true);
  se.grid[12][4] = 0; se.life[12][4] = 5;
  const eb = se.energy;
  ok('bomb destroys a gem', bombClimb(se, 4, 12) === true && se.grid[12][4] === EMPTY);
  approx('bomb is free', se.energy, eb);
  ok('costOf reads the table', costOf(se, 'swap') === 6 && costOf(se, 'bomb') === 0);

  // tick determinism
  const a = createClimbState(R, 99), b = createClimbState(R, 99);
  for (let i = 0; i < 120; i++) { tickClimb(a); tickClimb(b); }
  ok('tick is deterministic (harvested)', a.harvested === b.harvested);
  ok('tick is deterministic (lost)', a.lost === b.lost);
  ok('tick is deterministic (ceiling)', lightCeiling(a) === lightCeiling(b));
  ok('a no-build game loses gems to decay', a.lost > 0);

  // win: a lens chain pushes the light to the Source (row 0)
  const sw = createClimbState(R, 5);
  clearGrid(sw); // no gems to break the chain while we verify
  for (let s2 = base; s2 > 0; s2 -= R.lensReach) sw.pieces.get('amp').set('4,' + s2, true);
  approx('lens chain reaches the Source', lightCeiling(sw), 0);
  tickClimb(sw);
  ok('reaching the Source wins', sw.won === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
