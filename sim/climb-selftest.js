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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
