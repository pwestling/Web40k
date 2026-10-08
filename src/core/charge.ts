import { baseSizeInches } from "./geometry";
import { modelHeight } from "./terrain";
import { phaseName } from "./content/turn";
import type { GameEvent } from "./actions";
import type { GameState, Model } from "./types";

const alive = (g: GameState, unitId: string) =>
  (g.units[unitId]?.modelIds ?? []).flatMap((id) => {
    const m = g.models[id];
    return m && !m.destroyed ? [m] : [];
  });

const centre = (models: Model[]): { x: number; y: number; z: number } => {
  const n = Math.max(1, models.length);
  return {
    x: models.reduce((a, m) => a + m.position.x, 0) / n,
    y: models.reduce((a, m) => a + m.position.y, 0) / n,
    z: Math.max(0, ...models.map((m) => (m.z ?? 0) + modelHeight(m))),
  };
};

/**
 * A charge move, if this event is one: a block's charge move, or a unit's
 * models moved in the Charge phase after a charge roll. Says how far it
 * came and, if it reached an enemy, which unit and which way it was struck.
 */
export function chargeFor(
  event: GameEvent,
  before: GameState,
  after: GameState,
): {
  unitId: string;
  at: { x: number; y: number; z: number };
  distance: number;
  gap: number;
  /** The charge roll, when the move went further than it (advisory: it stands, but isn't cheered). */
  over: number | null;
  target: { ids: string[]; dir: { x: number; y: number } } | null;
} | null {
  let unitId: string | undefined;
  let distance = 0;
  if (event.type === "unit/move" && event.how === "charge") {
    unitId = event.id;
    distance = Math.abs(event.distance ?? 0);
  } else if (event.type === "models/move" && event.moves.length) {
    const id = before.models[event.moves[0]!.id]?.unitId;
    const unit = id ? before.units[id] : undefined;
    if (!unit || typeof unit.status?.charge !== "number" || !/charge/i.test(phaseName(before) ?? ""))
      return null;
    if (!event.moves.every((m) => before.models[m.id]?.unitId === id)) return null;
    unitId = id;
    for (const m of event.moves) {
      const from = before.models[m.id]?.phaseStart ?? before.models[m.id]?.position;
      if (from) distance = Math.max(distance, Math.hypot(m.to.x - from.x, m.to.y - from.y));
    }
  }
  if (!unitId) return null;
  const roll = before.units[unitId]?.status?.charge;
  const over = typeof roll === "number" && distance > roll + 0.05 ? roll : null;
  const mine = alive(after, unitId);
  if (!mine.length) return null;
  const owner = mine[0]!.owner;
  const half = (m: Model) => Math.max(baseSizeInches(m.base).width, baseSizeInches(m.base).depth) / 2;
  // The nearest enemy model to any of the charging models, base edge to base edge.
  let gap = Infinity;
  let hit: Model | null = null;
  for (const e of Object.values(after.models)) {
    if (e.destroyed || e.owner === owner) continue;
    for (const m of mine) {
      const d = Math.hypot(e.position.x - m.position.x, e.position.y - m.position.y) - half(e) - half(m);
      if (d < gap) {
        gap = d;
        hit = e;
      }
    }
  }
  const at = centre(mine);
  if (!hit || !Number.isFinite(gap)) return null;
  if (gap > 1.05) return { unitId, at, distance, gap: Math.max(0, gap - 1), over, target: null };
  if (over !== null) return { unitId, at, distance, gap: 0, over, target: null };
  const struck = hit.unitId ? alive(after, hit.unitId) : [hit];
  const c = centre(struck);
  const len = Math.hypot(c.x - at.x, c.y - at.y) || 1;
  return {
    unitId,
    at,
    distance,
    gap: 0,
    over,
    target: { ids: struck.map((m) => m.id), dir: { x: (c.x - at.x) / len, y: (c.y - at.y) / len } },
  };
}
