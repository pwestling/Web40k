import {
  blockFrame,
  rankCount,
  systemOf,
  undoneSeqs,
  unitStrength,
  baseSizeInches,
  type GameRecord,
  type GameState,
  type Unit,
  type Vec2,
} from "../core";
import { systemModule } from "../systems";
import { aliveModels, unitDistance } from "../systems/wh40k/rules";

/**
 * Movement a block has used this phase: the sum of its moves, wheels, turns
 * and reforms since the phase began, read from the log (undone ones skipped).
 */
export function blockMoveUsed(record: GameRecord, unitId: string, uptoSeq = Infinity): number {
  const undone = undoneSeqs(record, uptoSeq);
  let used = 0;
  for (const { seq, event } of record.events) {
    if (seq > uptoSeq) break;
    if (undone.has(seq) || event.type === "undo") continue;
    if (event.type.startsWith("turn/")) used = 0;
    else if ((event.type === "unit/move" || event.type === "unit/form") && event.id === unitId)
      used += Math.abs(event.distance ?? 0);
  }
  return used;
}

const constant = (game: GameState, id: string, fallback: number) =>
  systemOf(game).constants?.[id] ?? fallback;

export interface MoveBudget {
  /** Movement characteristic, and what a march allows. */
  move: number | null;
  march: number | null;
  /** Nearest enemy that isn't fleeing, for the march check. */
  nearestEnemy: number;
  marchBlock: number;
}

/** A unit's move and march, and how near the closest enemy (not fleeing) is. */
export function moveBudget(game: GameState, unit: Unit): MoveBudget {
  const mine = aliveModels(game, unit);
  const m = Number.parseFloat(mine[0]?.profile?.chars.M ?? "");
  const move = Number.isFinite(m) ? m : null;
  const nearestEnemy = Math.min(
    Infinity,
    ...Object.values(game.units)
      .filter((u) => u.owner !== unit.owner && u.status?.fleeing !== true)
      .map((u) => aliveModels(game, u))
      .filter((ms) => ms.length)
      .map((ms) => unitDistance(mine, ms)),
  );
  return {
    move,
    march: move === null ? null : move * constant(game, "marchMultiple", 2),
    nearestEnemy,
    marchBlock: constant(game, "marchBlock", 8),
  };
}

/** Whether any of the unit's models stands (even partly) off the table, at `positions` if given. */
export function offTable(game: GameState, unit: Unit, positions?: Record<string, Vec2>): boolean {
  const hx = game.table.width / 2;
  const hy = game.table.depth / 2;
  return aliveModels(game, unit).some((m) => {
    const p = positions?.[m.id] ?? m.position;
    const { width, depth } = baseSizeInches(m.base);
    const r = Math.max(width, depth) / 2;
    return Math.abs(p.x) + r > hx + 0.01 || Math.abs(p.y) + r > hy + 0.01;
  });
}

export interface BlockSummary extends MoveBudget {
  files: number;
  ranks: number;
  /** Ranks wide enough to count, and how wide that is for this troop type. */
  fullRanks: number;
  rankWidth: number;
  strength: number;
  /** Rank bonus in close order (none when disrupted, in open order or in column). */
  rankBonus: number;
  disrupted: boolean;
  turnCost: number;
  reformCost: number;
  redressCost: number;
  redressMax: number;
}

/** What the regiment panel shows about a block, with the system's numbers. */
export function blockSummary(game: GameState, unit: Unit): BlockSummary | null {
  const frame = blockFrame(game, unit);
  if (!frame || unit.formation.kind !== "ranked") return null;
  const ranks = systemModule(game.system).rankRules?.(game, unit) ?? {
    width: constant(game, "rankWidth", 5),
    maxBonus: constant(game, "maxRankBonus", 2),
  };
  const fullRanks = rankCount(game, unit, ranks.width);
  // "disrupted" was once a formation order; it is a status now.
  const disrupted = unit.status?.disrupted === true || unit.formation.order === "disrupted";
  const order = unit.formation.order ?? "close";
  const close = order === "close" || order === "disrupted";
  const rankBonus = close && !disrupted ? Math.min(Math.max(0, fullRanks - 1), ranks.maxBonus) : 0;
  return {
    ...moveBudget(game, unit),
    files: frame.files,
    ranks: frame.ranks,
    fullRanks,
    rankWidth: ranks.width,
    strength: unitStrength(game, unit),
    rankBonus,
    disrupted,
    turnCost: constant(game, "turnCost", 0.25),
    reformCost: constant(game, "reformCost", 1),
    redressCost: constant(game, "redressCost", 0.5),
    redressMax: constant(game, "redressMax", 5),
  };
}
