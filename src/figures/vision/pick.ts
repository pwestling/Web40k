import type { FigureEntry } from "../library";
import { fit } from "../match";

/** At most this many figures go with a photo: every thumbnail costs time and tokens. */
export const MAX_FIGURES = 48;

/**
 * The library figures worth showing the model for these units: those whose
 * names or history fit a unit first, then the newest, up to `max`.
 */
export function figuresFor(library: FigureEntry[], units: string[], max = MAX_FIGURES): FigureEntry[] {
  const minis = library.filter((e) => e.kind === "miniature");
  if (minis.length <= max) return minis;
  const score = (e: FigureEntry) => Math.max(0, ...units.map((u) => fit(e, u)));
  return minis
    .map((e) => ({ e, s: score(e) }))
    .sort((a, b) => b.s - a.s || b.e.addedAt - a.e.addedAt)
    .slice(0, max)
    .map((x) => x.e);
}
