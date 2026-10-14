/**
 * The factory's rates, in one place: the user decides them at the M11 review. Everything here is
 * at v2's values for now (notes/M5-M11-plan.md §6, Q5).
 */
export const RATES = {
  /**
   * The packet source standing in for the packer: v2's centrifuge page feed (`build.mjs`): one
   * packet every `every` s for `burst` ticks, then `rest` empty ticks (8 packets per 11.7 s),
   * the first after `delay`. The v2 factory's packer makes ≈ 0.27 packets/s instead (M9).
   */
  source: { every: 0.9, delay: 0.5, burst: 8, rest: 5 },
  /**
   * The bead source standing in for the phone's dispenser (M10 builds the real one): v2
   * `phone.mjs`'s timing, from a hash instead of `Math.random`: a burst of 2–3 beads every
   * 2.6–3.6 s, one released per 0.9–1.25 s (≈ 0.8 beads/s, so ≈ 0.27 packets/s), the first burst at
   * 1.0 s, the first release at 1.8 s.
   */
  beads: { burstEvery: [2.6, 3.6], burst: [2, 3], release: [0.9, 1.25], firstBurst: 1.0, firstRelease: 1.8 },
  /**
   * The packer's tempo: everything speeds up by `per` for each bead waiting beyond the three
   * pockets, up to `max` (v2: 0.25 per bead, up to +0.8).
   */
  packerTempo: { per: 0.25, max: 0.8 },
  /** Packets the centrifuge holds before it spins up (v2: 6; 10 fills the tray). */
  HOLD: 6,
  /** The audio loop's speed, world units/s (v2: 32; one cleat gap = one render quantum). */
  loopSpeed: 32,
  /** Top belts, world units/s (v2 default: 14). */
  beltSpeed: 14,
  /** The crusher's drawer dumps after this many packets' flakes (v2: 10). */
  binDump: 10,
  /** Belt D (scanner → elevator), world units/s (v2 A: 28). */
  beltDSpeed: 28,
  /** The elevator's chain, world units/s (v2: 30; one cradle every 1.23 s at lift 210, ≈ 0.8/s). */
  elevatorSpeed: 30,
  /** The output scene's feed: one audio packet every `outputFeed` s (the line's ≈ 4 quanta: 2.28 s). */
  outputFeed: 2.28,
  /** The scanner scene's feed: one packet every `scannerFeed` s onto the loop (v2's scanner page: 2.2). */
  scannerFeed: 2.2,
  /** The crusher scene's feed: one garbage packet every `crusherFeed` s (v2's standalone page: 2.4). */
  crusherFeed: 2.4,
} as const;
