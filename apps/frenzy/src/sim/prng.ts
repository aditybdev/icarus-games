/**
 * Deterministic PRNG (mulberry32). The 32-bit state lives inside the sim
 * state so replays of the same seed + input sequence are bit-identical.
 * Pure module — no DOM access.
 */

export interface RngHolder {
  rngState: number;
}

export function nextRandom(holder: RngHolder): number {
  let t = (holder.rngState = (holder.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
