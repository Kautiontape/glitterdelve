/* Seedable PRNG so every simulation is reproducible.
   mulberry32: tiny, fast, good enough for game RNG. Returns a function -> [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Combine integers into a uint32 seed (FNV-1a style). Used to derive an
   independent RNG stream (e.g. the agent's) from a game seed. */
export function hashSeed(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
