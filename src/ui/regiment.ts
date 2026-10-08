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
import { inFootprint, segmentCrossesFootprint2D } from "../core/terrain";
import { systemModule } from "../systems";
import { aliveModels, unitDistance } from "../systems/wh40k/rules";
import { opposed } from "../core/teams";
import { hasRule } from "../systems/tow/specialRules";

const SPECIAL = new Set(["charge", "door", "flee", "pursue"]);

/**
 * Movement a block has used this phase: the sum of its moves, wheels, turns
 * and reforms since the phase began, read from the log (undone ones skipped).
 * Backwards and sideways steps cost `slow` times their distance (The Old
 * World: half rate).
 */
export function blockMoveUsed(record: GameRecord, unitId: string, uptoSeq = Infinity, slow = 1): number {
  return blockMoves(record, unitId, uptoSeq, slow).used;
}

export type Manoeuvre = "back" | "sideways" | "turn" | "redress" | "reform";

/**
 * The movement used this phase and the manoeuvres made, in order. Repeated
 * steps backwards or sideways in a row are one manoeuvre; wheels and moves
 * ahead are not manoeuvres, and a free (0") redress doesn't count.
 */
export function blockMoves(
  record: GameRecord,
  unitId: string,
  uptoSeq = Infinity,
  slow = 1,
): { used: number; manoeuvres: Manoeuvre[] } {
  const undone = undoneSeqs(record, uptoSeq);
  let used = 0;
  let manoeuvres: Manoeuvre[] = [];
  for (const { seq, event } of record.events) {
    if (seq > uptoSeq) break;
    if (undone.has(seq) || event.type === "undo") continue;
    if (event.type.startsWith("turn/")) {
      used = 0;
      manoeuvres = [];
    } else if (event.type === "unit/form" && event.id === unitId) {
      const d = Math.abs(event.distance ?? 0);
      used += d;
      if (d > 0 && (event.how === "turn" || event.how === "redress" || event.how === "reform"))
        manoeuvres.push(event.how);
    }
    // Charges, flight and pursuit are their own moves, not part of the Movement used.
    else if (event.type === "unit/move" && event.id === unitId && !SPECIAL.has(event.how ?? "")) {
      const d = Math.abs(event.distance ?? 0);
      // Old saves logged a step back as a negative "forward" move.
      const how = event.how === "forward" && (event.distance ?? 0) < 0 ? "back" : event.how;
      if (how === "back" || how === "sideways") {
        used += d * slow;
        if (manoeuvres.at(-1) !== how) manoeuvres.push(how);
      } else used += d;
    }
  }
  return { used, manoeuvres };
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
  /** Drilled (The Old World): marches near the enemy without a test, and redresses for free before moving. */
  drilled: boolean;
  /** What a step backwards or sideways costs per inch (2: half rate). */
  slow: number;
  /** Manoeuvres a move may include (The Old World: 1); 0 for no limit. */
  manoeuvreLimit: number;
  /** Movement lost to terrain this move (The Old World's difficult terrain), and the piece's name. */
  slowed: { by: number; piece: string } | null;
}

/** The terrain the unit's move this phase touches that slows it most (its category's `slows`). */
export function slowingTerrain(game: GameState, unit: Unit): { by: number; piece: string } | null {
  const cats = new Map((systemOf(game).terrain ?? []).map((c) => [c.id, c.slows ?? 0]));
  let best: { by: number; piece: string } | null = null;
  for (const p of game.terrain) {
    const by = cats.get(p.category) ?? 0;
    if (by <= (best?.by ?? 0)) continue;
    const touched = aliveModels(game, unit).some((m) => {
      const from = m.phaseStart ?? m.position;
      const r = Math.max(baseSizeInches(m.base).width, baseSizeInches(m.base).depth) / 2;
      return (
        inFootprint(p, from, r) ||
        inFootprint(p, m.position, r) ||
        segmentCrossesFootprint2D(p, from, m.position)
      );
    });
    if (touched) best = { by, piece: p.name };
  }
  return best;
}

/** A unit's move and march, and how near the closest enemy (not fleeing) is. */
export function moveBudget(game: GameState, unit: Unit): MoveBudget {
  const mine = aliveModels(game, unit);
  const m = Number.parseFloat(mine[0]?.profile?.chars.M ?? "");
  const slowed = slowingTerrain(game, unit);
  const move = Number.isFinite(m) ? (slowed ? Math.max(1, m - slowed.by) : m) : null;
  const nearestEnemy = Math.min(
    Infinity,
    ...Object.values(game.units)
      .filter((u) => opposed(game, u.owner, unit.owner) && u.status?.fleeing !== true)
      .map((u) => aliveModels(game, u))
      .filter((ms) => ms.length)
      .map((ms) => unitDistance(mine, ms)),
  );
  return {
    move,
    march: move === null ? null : move * constant(game, "marchMultiple", 2),
    nearestEnemy,
    marchBlock: constant(game, "marchBlock", 8),
    drilled: hasRule(unit, /\bdrilled\b/i),
    slow: constant(game, "slowMoveCost", 1),
    manoeuvreLimit: constant(game, "manoeuvresPerMove", 0),
    slowed,
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
  /** The system has rank bonuses, unit strength and formation orders (The Old World; not Conquest). */
  rankBonuses: boolean;
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
    rankBonuses: ranks.maxBonus > 0,
    disrupted,
    turnCost: constant(game, "turnCost", 0.25),
    reformCost: constant(game, "reformCost", 1),
    redressCost: constant(game, "redressCost", 0.5),
    redressMax: constant(game, "redressMax", 5),
  };
}
