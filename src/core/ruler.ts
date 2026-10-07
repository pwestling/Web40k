import { baseSizeInches } from "./geometry";
import { modelDistance } from "./terrain";
import type { GameState, Model, Ruler, Vec2 } from "./types";

const radius = (m: Model) => {
  const { width, depth } = baseSizeInches(m.base);
  return Math.min(width, depth) / 2;
};

/**
 * A ruler's length in inches: base to base between models (counting height),
 * from a model's base edge to a point, or point to point.
 */
export function rulerLength(
  state: GameState,
  r: Pick<Ruler, "from" | "to" | "fromModel" | "toModel">,
): number {
  const a = r.fromModel ? state.models[r.fromModel] : undefined;
  const b = r.toModel ? state.models[r.toModel] : undefined;
  if (a && b) return modelDistance(a, b);
  const p: Vec2 = a ? a.position : r.from;
  const q: Vec2 = b ? b.position : r.to;
  const d = Math.hypot(q.x - p.x, q.y - p.y) - (a ? radius(a) : 0) - (b ? radius(b) : 0);
  return Math.max(0, d);
}

/** The model whose base is under a point, if any. */
export function modelAt(state: GameState, p: Vec2): Model | undefined {
  return Object.values(state.models).find(
    (m) => !m.destroyed && Math.hypot(m.position.x - p.x, m.position.y - p.y) <= radius(m) + 0.1,
  );
}
