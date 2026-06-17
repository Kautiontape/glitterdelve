/* =====================================================================
   GLITTERDELVE CLIMB ENGINE (demo 2) — headless, deterministic.
   Bottom-anchored rising light, per-fall-step decay, energy economy.
   Reuses the pure helpers from engine.js; engine.js/demo.html untouched.
   ===================================================================== */
import { mulberry32 } from './rng.js';
import { matchesAt, allMatches, spawnColor, inBounds, canRest, EMPTY } from './engine.js';

export { EMPTY, inBounds };

// Filled in by later tasks:
export function createClimbState() { throw new Error('not implemented'); }
export function tickClimb() { throw new Error('not implemented'); }
export function stepGravityClimb() { throw new Error('not implemented'); }
export function resolveClimb() { throw new Error('not implemented'); }
export function stepSwappersClimb() { throw new Error('not implemented'); }
export function stepSpawnClimb() { throw new Error('not implemented'); }
export function placeClimb() { throw new Error('not implemented'); }
export function removeClimb() { throw new Error('not implemented'); }
export function bombClimb() { throw new Error('not implemented'); }
export function costOf() { throw new Error('not implemented'); }
export function isLit() { throw new Error('not implemented'); }
export function litCeiling() { throw new Error('not implemented'); }
