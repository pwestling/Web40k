import { inFootprint, segmentCrossesFootprint2D } from "../terrain";
import { legsOf, movedSoFar, movePath, pathLength } from "../path";
import type { GameState, TerrainPiece, Unit } from "../types";
import { inchesPerUnit } from "./runtime";
import type { GameSystem, TerrainCategoryDef } from "./schema";

/**
 * Terrain along a move (advisory): each model's straight path this phase,
 * from where it stood as the phase began to where it stands, against the
 * system's terrain categories, read for the unit's type (`movement`, else
 * `blocksMovement` and `slows`). A piece a model's path enters or crosses
 * (but didn't start in) blocks it; a piece it starts in, crosses or ends in
 * slows it.
 */

/** Whether the unit is of a type a terrain rule names: a keyword, or an ability named for it ("Jump 3"). */
function isType(unit: Unit, keyword: string): boolean {
  if (keyword === "*") return true;
  const k = keyword.toLowerCase();
  if ((unit.sheet?.keywords ?? []).some((w) => w.toLowerCase() === k)) return true;
  const word = new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return (unit.sheet?.abilities ?? []).some((a) => word.test(a.name.trim()));
}

/** How a terrain category treats this unit's moves. */
function moveRule(category: TerrainCategoryDef, unit: Unit): { blocks: boolean; slows: number } {
  const entry = category.movement?.find((e) => e.keywords.some((k) => isType(unit, k)));
  if (entry) return { blocks: !!entry.blocks, slows: entry.slows ?? 0 };
  return { blocks: !!category.blocksMovement, slows: category.slows ?? 0 };
}

interface TerrainOnMove {
  /** Pieces the move went into or through that this unit can't cross. */
  blocked: TerrainPiece[];
  /** The piece that costs it most movement, and how much (in the system's unit). */
  slowed: { by: number; piece: TerrainPiece } | null;
}

/** The terrain the unit's move this phase ran into. */
export function terrainOnMove(state: GameState, system: GameSystem, unit: Unit): TerrainOnMove {
  const out: TerrainOnMove = { blocked: [], slowed: null };
  const categories = new Map((system.terrain ?? []).map((c) => [c.id, c]));
  if (!categories.size) return out;
  for (const id of unit.modelIds) {
    const m = state.models[id];
    if (!m || m.destroyed) continue;
    const path = movePath(m);
    const from = path[0]!;
    if (pathLength(path) < 0.05) continue;
    for (const p of state.terrain) {
      const c = categories.get(p.category);
      if (!c) continue;
      const rule = moveRule(c, unit);
      if (!rule.blocks && !rule.slows) continue;
      const startIn = inFootprint(p, from);
      // Leg by leg: a move round a piece in legs (core/path.ts) doesn't go through it.
      const through =
        path.slice(1).some((q) => inFootprint(p, q)) ||
        legsOf(path).some(([a, b]) => segmentCrossesFootprint2D(p, a, b));
      if (rule.blocks && !startIn && through && !out.blocked.includes(p)) out.blocked.push(p);
      else if (rule.slows > (out.slowed?.by ?? 0) && (startIn || through))
        out.slowed = { by: rule.slows, piece: p };
    }
  }
  return out;
}

/**
 * The table warning for a move through terrain: a piece the unit can't
 * cross, or (for a unit given a move allowance by an action) a move further
 * than the allowance less what the terrain costs.
 */
export function terrainMoveWarning(state: GameState, system: GameSystem, unit: Unit): string | null {
  const { blocked, slowed } = terrainOnMove(state, system, unit);
  if (blocked.length)
    return `Moved through ${blocked.map((p) => p.name).join(", ")}: this unit can't cross it`;
  const allowance = unit.status?.allowance;
  if (!slowed || typeof allowance !== "number") return null;
  let moved = 0;
  for (const id of unit.modelIds) {
    const m = state.models[id];
    if (!m || m.destroyed) continue;
    moved = Math.max(moved, movedSoFar(m));
  }
  // Never below one unit of movement (FSD: at least 1 DU).
  const left = Math.max(
    allowance - slowed.by * inchesPerUnit(system),
    Math.min(allowance, inchesPerUnit(system)),
  );
  if (moved <= left + 0.05) return null;
  return `${slowed.piece.name} costs ${slowed.by} of its move: moved further than it allows`;
}
