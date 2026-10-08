import type { Layout, TerrainPiece, Vec2 } from "../core";
import { makePiece } from "./wh40k/layout";

/** A layout's terrain entry that names a terrain template instead of listing its solids (PackageApp.layout). */
interface TemplateRef {
  template: string;
  id?: string;
  position: Vec2;
  facing?: number;
  category?: string;
}

const isRef = (p: unknown): p is TemplateRef =>
  typeof p === "object" && p !== null && typeof (p as TemplateRef).template === "string";

/**
 * A package game's layout as the app takes it: template entries made into
 * pieces (in the game's own category for that template, when it maps one),
 * and missing lists empty.
 */
export function expandLayout(layout: unknown, categories: Record<string, string> = {}): Layout {
  const l = (layout ?? {}) as {
    terrain?: unknown[];
    objectives?: Layout["objectives"];
    zones?: Layout["zones"];
  };
  return {
    terrain: (l.terrain ?? []).map((p, i) =>
      isRef(p)
        ? makePiece(
            p.template,
            p.id ?? `t${i}`,
            p.position,
            p.facing ?? 0,
            p.category ?? categories[p.template],
          )
        : (p as TerrainPiece),
    ),
    objectives: l.objectives ?? [],
    zones: l.zones ?? [],
  };
}
