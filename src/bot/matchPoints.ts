import type { ImportedRoster } from "../systems/wh40k/roster";

/** A roster's points as its units add them up, else the list's own total. */
export function pointsOf(roster: ImportedRoster): number {
  return roster.units.reduce((a, u) => a + (u.sheet.points ?? 0), 0) || (roster.points ?? 0);
}

/**
 * The computer's sample army cut down to about `target` points (PX re-check of #56, "Match my points"):
 * its units in list order, each kept while the total stays within a tenth over the target, and always at
 * least its cheapest. An army with no points, or already no bigger, comes back as it is.
 */
export function matchPoints(sample: ImportedRoster, target: number): ImportedRoster {
  const cost = (u: ImportedRoster["units"][number]) => u.sheet.points ?? 0;
  if (!target || pointsOf(sample) <= target * 1.1 || !sample.units.some(cost)) return sample;
  let total = 0;
  const units = sample.units.filter((u) => {
    if (total + cost(u) > target * 1.1) return false;
    total += cost(u);
    return true;
  });
  if (!units.length) units.push(sample.units.reduce((a, u) => (cost(u) < cost(a) ? u : a)));
  return { ...sample, units, points: units.reduce((a, u) => a + cost(u), 0) };
}
