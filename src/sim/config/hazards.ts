/**
 * Hazards in the water other than the ground: fishing gear. APPROX
 * (illustrative): submarines have caught trawls many times; a bottom or
 * pelagic trawl's warps and doors hold far more than a boat's thrust at low
 * speed, and the usual way out is to go astern until it slips off.
 */
export const SNAG = {
  /** Drag of a held net on going ahead: F = quadratic·u² + linear·u [N] with u [m/s]. */
  quadratic: 4.0e5,
  linear: 1.5e5,
  /** Going astern faster than this [m/s] for `release` seconds slips the net off. */
  asternSpeed: 0.2,
  release: 12,
  /** After the boat is free, that trawl cannot catch it again for this long [s] (it is torn, or hauled to be mended). */
  clearTime: 600,
  /** Length of a trawl's mouth along the tow [m]: the boat is caught inside it. */
  mouthLength: 40,
} as const;
