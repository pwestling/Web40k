import type { FigureEntry } from "./library";

/** Words that say nothing about which unit a model is. */
const NOISE = new Set([
  "the",
  "of",
  "and",
  "a",
  "with",
  "v",
  "final",
  "stl",
  "obj",
  "glb",
  "gltf",
  "supported",
  "presupported",
  "pre",
  "support",
  "supports",
  "model",
  "mini",
  "miniature",
  "fixed",
  "print",
  "squad",
  "unit",
  "x",
]);

/** A name's meaningful words: lower case, singular, no numbers. */
export function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !NOISE.has(w))
    .map((w) => (w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * How well a library figure fits a unit, 0 to 1. A figure that has dressed a
 * unit of that name before is a sure match; otherwise the figure's name and
 * tags are compared word by word with the unit's.
 */
export function fit(entry: FigureEntry, unit: string): number {
  if (entry.kind !== "miniature") return 0;
  const name = unit.trim().toLowerCase();
  if (entry.units.some((u) => u.trim().toLowerCase() === name)) return 1;
  const want = new Set(words(unit));
  if (!want.size) return 0;
  const have = new Set([...words(entry.name), ...entry.tags.flatMap(words), ...entry.units.flatMap(words)]);
  let shared = 0;
  for (const w of want) if (have.has(w)) shared++;
  // Mostly about covering the unit's name; a figure named for many things counts a little less.
  return (0.8 * shared) / want.size + (0.15 * shared) / Math.max(have.size, 1);
}

/** Below this, a figure isn't suggested for a unit. */
const SUGGEST = 0.5;

/** Library figures for a unit, best first. */
export function suggestions(entries: FigureEntry[], unit: string, limit = 5): FigureEntry[] {
  return entries
    .map((e) => ({ e, s: fit(e, unit) }))
    .filter((x) => x.s >= SUGGEST)
    .sort((a, b) => b.s - a.s || b.e.addedAt - a.e.addedAt)
    .slice(0, limit)
    .map((x) => x.e);
}
