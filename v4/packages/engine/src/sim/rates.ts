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
  /** The scanner scene's feed: one packet every `scannerFeed` s onto the loop (v2's scanner page: 2.2). */
  scannerFeed: 2.2,
  /** The crusher scene's feed: one garbage packet every `crusherFeed` s (v2's standalone page: 2.4). */
  crusherFeed: 2.4,
} as const;
