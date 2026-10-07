import {
  blockFrame,
  rankCount,
  systemOf,
  undoneSeqs,
  unitStrength,
  type GameRecord,
  type GameState,
  type Unit,
} from "../core";
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

export interface BlockSummary {
  files: number;
  ranks: number;
  /** Ranks wide enough to count. */
  fullRanks: number;
  strength: number;
  /** Rank bonus in close order (none when disrupted, open or in column). */
  rankBonus: number;
  /** Movement characteristic, and what a march allows. */
  move: number | null;
  march: number | null;
  /** Nearest enemy, for the march check. */
  nearestEnemy: number;
  marchBlock: number;
  turnCost: number;
  reformCost: number;
}

/** What the regiment panel shows about a block, with the system's numbers. */
export function blockSummary(game: GameState, unit: Unit): BlockSummary | null {
  const frame = blockFrame(game, unit);
  if (!frame || unit.formation.kind !== "ranked") return null;
  const fullRanks = rankCount(game, unit, constant(game, "rankWidth", 5));
  const order = unit.formation.order ?? "close";
  const rankBonus =
    order === "close" ? Math.min(Math.max(0, fullRanks - 1), constant(game, "maxRankBonus", 3)) : 0;
  const first = aliveModels(game, unit)[0];
  const m = Number.parseFloat(first?.profile?.chars.M ?? "");
  const move = Number.isFinite(m) ? m : null;
  const mine = aliveModels(game, unit);
  const nearestEnemy = Math.min(
    Infinity,
    ...Object.values(game.units)
      .filter((u) => u.owner !== unit.owner)
      .map((u) => aliveModels(game, u))
      .filter((ms) => ms.length)
      .map((ms) => unitDistance(mine, ms)),
  );
  return {
    files: frame.files,
    ranks: frame.ranks,
    fullRanks,
    strength: unitStrength(game, unit),
    rankBonus,
    move,
    march: move === null ? null : move * constant(game, "marchMultiple", 2),
    nearestEnemy,
    marchBlock: constant(game, "marchBlock", 8),
    turnCost: constant(game, "turnCost", 0.25),
    reformCost: constant(game, "reformCost", 0.5),
  };
}
