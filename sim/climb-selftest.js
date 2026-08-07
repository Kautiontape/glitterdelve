/* Climb-engine invariant checks. Run: node climb-selftest.js
   Exits non-zero on any failure.
   Model: routing-as-matcher; per-column three-tier light (bright safe+scores /
   dim buildable+decays / dark invisible); falling gems never decay, resting
   gems settle then crack; lenses raise one column's bright light; reach the
   Source (a column's bright ceiling = 0) to win. */
import { makeClimbRules } from './rules.js';
import {
  createClimbState, tickClimb, stepGravityClimb, decayClimb, resolveClimb, stepConveyors,
  stepFloorDrain, stepSpawnClimb, placeClimb, removeClimb, adjustClimb, bombClimb, costOf,
  brightCeiling, dimCeiling, zoneAt, isBright, isBuildable, frontier, litColumns, EMPTY,
} from './climb-engine.js';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function approx(name, a, b) { ok(`${name} (${a} === ${b})`, a === b); }
function clearGrid(s) { const R = s.rules; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) { s.grid[y][x] = EMPTY; s.rest[y][x] = 0; } }
function put(s, x, y, c) { s.grid[y][x] = c; s.rest[y][x] = 0; }

console.log('Glitterdelve CLIMB self-test\n');

/* 1. ruleset shape */
{
  const R = makeClimbRules();
  approx('climb has 6 tools', R.tools.length, 6);
  ok('bomb is a free action', R.tools[0].id === 'bomb' && R.tools[0].kind === 'action' && R.costs.bomb === 0);
  ok('ramp is a solid wedge', R.tools.find((t) => t.id === 'ramp').wedge === true);
  ok('sorter is a colour filter (not a solid wedge)', R.tools.find((t) => t.id === 'sorter').sorter === true && !R.tools.find((t) => t.id === 'sorter').wedge);
  ok('conveyor is a carry tag', R.tools.find((t) => t.id === 'conveyor').conveyor === true);
  ok('lens relays light and does not block fall', R.tools.find((t) => t.id === 'amp').extendsLight && !R.tools.find((t) => t.id === 'amp').blocksFall);
  ok('there is no manual matcher (no swapper)', !R.tools.find((t) => t.id === 'swap'));
  ok('overrides apply (rows)', makeClimbRules({ rows: 40 }).rows === 40);
}

/* 2. createClimbState */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 7);
  ok('grid is rows x cols', s.grid.length === R.rows && s.grid[0].length === R.cols);
  ok('rest grid mirrors the gem grid', s.rest.length === R.rows && s.rest[5].length === R.cols);
  ok('starting energy is the grant', s.energy === R.startGrant);
  ok('total harvested starts at 0', s.harvested === 0);
  let gems = 0; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) if (s.grid[y][x] !== EMPTY) gems++;
  ok('the shaft starts empty (initDensity 0)', gems === 0);
}

/* 3. light is PER COLUMN: base band; a fed lens raises only its own column */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const base = R.rows - R.baseReach;
  approx('a column starts bright at the base band', brightCeiling(s, 3), base);
  ok('a cell at the base ceiling is bright', isBright(s, 3, base));
  ok('a cell one row above is not bright', !isBright(s, 3, base - 1));
  ok('dim sits dimBand above bright', dimCeiling(s, 3) === base - R.dimBand);
  ok('zoneAt reads bright/dim/dark', zoneAt(s, 3, base) === 'bright' && zoneAt(s, 3, base - 1) === 'dim' && zoneAt(s, 3, 0) === 'dark');
  // a lens fed by the bright cell below it raises THIS column only
  s.pieces.get('amp').set('3,' + base, true); s.lightGen++;
  approx('lens raises its own column', brightCeiling(s, 3), Math.max(0, base - R.lensReach));
  approx('a neighbour column is unchanged', brightCeiling(s, 4), base);
  // chain a second lens up the same column
  s.pieces.get('amp').set('3,' + (base - R.lensReach), true); s.lightGen++;
  approx('a chained lens raises it again', brightCeiling(s, 3), Math.max(0, base - 2 * R.lensReach));
}

/* 4. gravity: fall one row, walls hold, gems pile; ramp deflects in one step;
      sorter routes by colour; a gem entering a lens cell breaks it */
{
  const R = makeClimbRules();
  // plain fall + pile
  const s = createClimbState(R, 1); clearGrid(s);
  put(s, 2, 8, 0); stepGravityClimb(s);
  ok('gem fell one row', s.grid[9][2] === 0 && s.grid[8][2] === EMPTY);
  const s2 = createClimbState(R, 1); clearGrid(s2);
  put(s2, 2, 8, 0); s2.pieces.get('dam').set('2,9', true);
  stepGravityClimb(s2);
  ok('wall holds the gem', s2.grid[8][2] === 0 && s2.grid[9][2] === EMPTY);
  const s3 = createClimbState(R, 1); clearGrid(s3);
  const fy = R.rows - 1; put(s3, 2, fy, 0); put(s3, 2, fy - 1, 1);
  stepGravityClimb(s3);
  ok('gems pile up (floor stays, next stacks)', s3.grid[fy][2] === 0 && s3.grid[fy - 1][2] === 1);

  // ramp deflects a gem from directly above in ONE step (the old slope stall, fixed)
  const sr = createClimbState(R, 1); clearGrid(sr);
  sr.pieces.get('ramp').set('2,10', { dir: 1 });
  put(sr, 2, 9, 0); stepGravityClimb(sr);
  ok('ramp deflects the gem sideways in one step', sr.grid[10][3] === 0 && sr.grid[10][2] === EMPTY);
  put(sr, 2, 9, 1); // second gem
  // first gem has moved on; clear its spot so the deflect target is free
  sr.grid[10][3] = EMPTY;
  stepGravityClimb(sr);
  ok('ramp deflects EVERY gem', sr.grid[10][3] === 1);

  // sorter (colour filter): target colour falls straight through; others kicked aside
  const ss = createClimbState(R, 1); clearGrid(ss);
  ss.pieces.get('sorter').set('5,10', { tc: 0, dir: 1 });
  put(ss, 5, 9, 0); stepGravityClimb(ss);
  ok('sorter passes the target colour straight down', ss.grid[10][5] === 0);
  put(ss, 5, 9, 1); stepGravityClimb(ss);
  ok('sorter kicks other colours aside', ss.grid[10][6] === 1);

  // a lens is sturdy: a gem falls straight through it and it survives
  const sl = createClimbState(R, 1); clearGrid(sl);
  sl.pieces.get('amp').set('4,11', true); sl.lightGen++;
  put(sl, 4, 10, 0); stepGravityClimb(sl);
  ok('lens survives a falling gem (sturdy)', sl.pieces.get('amp').has('4,11'));
  ok('gem fell straight through the lens', sl.grid[11][4] === 0);
}

/* 5. decay = the settle beat: falling never decays; bright is safe; a resting
      gem in dim cracks after settle+crack and shatters */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  // falling gem (unsupported) never decays
  const sf = createClimbState(R, 1); clearGrid(sf);
  put(sf, 2, 5, 0); // row 5 dark, nothing below -> falling
  for (let i = 0; i < 5; i++) decayClimb(sf);
  ok('a falling gem never decays', sf.grid[5][2] === 0);

  // bright resting gem is safe forever
  const sb = createClimbState(R, 1); clearGrid(sb);
  put(sb, 4, R.rows - 1, 0); // on the floor, bright
  for (let i = 0; i < 20; i++) decayClimb(sb);
  ok('a bright resting gem is safe', sb.grid[R.rows - 1][4] === 0);

  // dim resting gem: survives settle+crack ticks, shatters on the next, lost++
  const sd = createClimbState(R, 1); clearGrid(sd);
  const y = base - 1; // dim
  sd.pieces.get('dam').set('2,' + (y + 1), true); // wall holds it in the dim
  put(sd, 2, y, 0);
  ok('the held gem is in the dim', zoneAt(sd, 2, y) === 'dim');
  const limit = R.settle + R.crack;
  for (let i = 0; i < limit; i++) decayClimb(sd);
  ok('a dim gem survives the settle+crack window', sd.grid[y][2] === 0);
  const lost0 = sd.lost;
  decayClimb(sd);
  ok('then it shatters', sd.grid[y][2] === EMPTY);
  approx('shatter increments lost', sd.lost, lost0 + 1);
}

/* 6. conveyor carries a resting gem one cell toward its arrow */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1); clearGrid(s);
  put(s, 2, 11, 9 % R.ncol);          // support below
  put(s, 2, 10, 0);                   // the gem to carry
  s.pieces.get('conveyor').set('2,10', { dir: 1 });
  stepConveyors(s);
  ok('conveyor carried the gem sideways', s.grid[10][3] === 0 && s.grid[10][2] === EMPTY);
}

/* 6b. floor drain: an overfull column (pile pokes above bright) is relieved from
       the bottom by the delve; a column that fits in the light is left alone */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  // a contiguous pile from the floor up into the dim (one row above bright) -> overfull
  const so = createClimbState(R, 1); clearGrid(so);
  for (let y = base - 1; y < R.rows; y++) put(so, 3, y, (y % R.ncol)); // top at base-1 (dim)
  const before = so.drained;
  stepFloorDrain(so);
  ok('overfull column is relieved at the floor', so.grid[R.rows - 1][3] === EMPTY && so.drained === before + 1);
  // a pile that fits inside the bright band is left alone
  const sk = createClimbState(R, 1); clearGrid(sk);
  for (let y = base; y < R.rows; y++) put(sk, 5, y, (y % R.ncol)); // top exactly at bright ceiling
  stepFloorDrain(sk);
  ok('a column that fits the light is not drained', sk.grid[R.rows - 1][5] !== EMPTY);
}

/* 7. resolve: a BRIGHT run scores (super-linear, × the spree multiplier);
      dim/dark runs clear but score nothing */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  const y = base + 1; // bright
  const mk = (n, c) => { const s = createClimbState(R, 1); clearGrid(s); for (let i = 0; i < n; i++) put(s, 1 + i, y, c); return s; };
  let s = mk(3, 0); let h = s.harvested; resolveClimb(s, 1);
  approx('a bright triple scores 4', s.harvested, h + 4);
  s = mk(4, 1); h = s.harvested; resolveClimb(s, 1); approx('a bright quad scores 10', s.harvested, h + 10);
  s = mk(5, 2); h = s.harvested; resolveClimb(s, 1); approx('a bright quint scores 24', s.harvested, h + 24);
  s = mk(3, 3); h = s.harvested; resolveClimb(s, 2); approx('the spree multiplier multiplies the score', s.harvested, h + 8);

  const sd = createClimbState(R, 1); clearGrid(sd);
  const dy = 2; for (const x of [2, 3, 4]) put(sd, x, dy, 4);
  const hd = sd.harvested; const changed = resolveClimb(sd, 1);
  ok('a dark run clears', sd.grid[dy][2] === EMPTY && changed.changed);
  approx('a dark run scores nothing', sd.harvested, hd);
}

/* 8. economy, gating, refund, adjust, bomb, determinism, and the win */
{
  const R = makeClimbRules();
  const base = R.rows - R.baseReach;
  // cost gating + refund
  const se = createClimbState(R, 3); se.energy = 5;
  ok('cannot afford a Lens (cost 8)', placeClimb(se, 'amp', { x: 4, y: base }) === false);
  ok('can afford a Ramp (cost 2)', placeClimb(se, 'ramp', { x: 4, y: base }) === true);
  approx('ramp deducted 2 energy', se.energy, 3);
  ok('remove refunds the cost', removeClimb(se, 'ramp', { x: 4, y: base }) === true && se.energy === 5);

  // build gating: dark is not buildable, dim/bright is
  const sg = createClimbState(R, 4);
  ok('cannot build in the dark', isBuildable(sg, 4, 0) === false && placeClimb(sg, 'ramp', { x: 4, y: 0 }) === false);
  ok('can build in the dim', isBuildable(sg, 4, base - 1) === true && placeClimb(sg, 'ramp', { x: 4, y: base - 1 }) === true);

  // adjust: ramp flips, sorter cycles colour
  const sa = createClimbState(R, 5);
  placeClimb(sa, 'ramp', { x: 2, y: base, dir: 1 });
  adjustClimb(sa, 'ramp', { x: 2, y: base });
  ok('adjust flips a ramp', sa.pieces.get('ramp').get('2,' + base).dir === -1);
  placeClimb(sa, 'sorter', { x: 6, y: base, tc: 0 });
  adjustClimb(sa, 'sorter', { x: 6, y: base });
  ok('adjust cycles a sorter colour', sa.pieces.get('sorter').get('6,' + base).tc === 1);

  // bomb is free
  const sb = createClimbState(R, 6); put(sb, 4, base + 1, 0); const eb = sb.energy;
  ok('bomb destroys a gem for free', bombClimb(sb, 4, base + 1) === true && sb.grid[base + 1][4] === EMPTY && sb.energy === eb);
  ok('costOf reads the table', costOf(sb, 'sorter') === 5 && costOf(sb, 'bomb') === 0);

  // determinism + the base is CALM: overflow drains, it does not flood into death
  const a = createClimbState(R, 99), b = createClimbState(R, 99);
  for (let i = 0; i < 250; i++) { tickClimb(a); tickClimb(b); }
  ok('tick is deterministic (harvested)', a.harvested === b.harvested);
  ok('tick is deterministic (drained)', a.drained === b.drained);
  ok('tick is deterministic (frontier)', frontier(a) === frontier(b));
  ok('the base drains overflow (self-clearing)', a.drained > 0);
  ok('a no-build base does NOT flood into death', a.lost === 0);

  // win: lighting EVERY column to the Source (the whole shaft) wins
  const sw = createClimbState(R, 5); clearGrid(sw);
  for (let x = 0; x < R.cols; x++) for (let s2 = base; s2 > 0; s2 -= R.lensReach) sw.pieces.get('amp').set(x + ',' + s2, true);
  sw.lightGen++;
  approx('one column lit to the Source', brightCeiling(sw, 4), 0);
  approx('all columns lit', litColumns(sw), R.cols);
  // a single lit column is NOT a win
  const sw1 = createClimbState(R, 6); clearGrid(sw1);
  for (let s2 = base; s2 > 0; s2 -= R.lensReach) sw1.pieces.get('amp').set('4,' + s2, true);
  sw1.lightGen++;
  tickClimb(sw1);
  ok('one lit column is NOT a win', sw1.won === false);
  tickClimb(sw);
  ok('lighting the whole shaft wins', sw.won === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
