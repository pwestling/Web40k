import type { GameState, PlayerId, Unit, UnitId } from "../../core";
import { currentSlot, systemOf } from "../../core/content/turn";
import { aliveModels, engagedWith } from "./rules";

/**
 * The Fight phase order, as advice (the players may still pick any unit):
 * units that charged this turn or have Fights First fight first, then the
 * rest. In each step the players alternate picking a unit, starting with
 * the player whose turn it isn't; a player with nothing left to pick passes.
 */
interface FightOrder {
  step: "fightsFirst" | "remaining";
  /** Whose pick it is, or null when nobody has a unit left to fight. */
  picker: PlayerId | null;
  /** The units that may fight now: the picker's, in this step. */
  eligible: UnitId[];
}

/** Charged this turn, or has the Fights First ability (by name). */
function fightsFirst(unit: Unit): boolean {
  return !!unit.status?.charged || !!unit.sheet?.abilities.some((a) => /fights first/i.test(a.name));
}

/** May fight this phase and hasn't yet: engaged, or charged this turn. */
function canFight(state: GameState, unit: Unit): boolean {
  if (unit.status?.fought || unit.status?.reserves || !aliveModels(state, unit).length) return false;
  return !!unit.status?.charged || engagedWith(state, unit).length > 0;
}

/** The fight order now, or null outside the Fight phase. */
export function fightOrder(state: GameState): FightOrder | null {
  if (systemOf(state).id !== "forty-k-11" || state.turn.round === 0 || currentSlot(state)?.id !== "fight")
    return null;
  const units = Object.values(state.units);
  const waiting = units.filter((u) => canFight(state, u));
  const first = waiting.filter(fightsFirst);
  const step = first.length ? "fightsFirst" : "remaining";
  const pool = step === "fightsFirst" ? first : waiting;
  // Picks made in this step so far, per seat.
  const fought = units.filter(
    (u) => u.status?.fought && (step === "fightsFirst" ? fightsFirst(u) : !fightsFirst(u)),
  );
  const seatOf = (u: Unit) => state.players[u.owner]?.seat;
  const seats = [
    ...new Set(Object.values(state.players).flatMap((p) => (p.seat === undefined ? [] : [p.seat]))),
  ];
  const other = seats.find((s) => s !== state.turn.activeSeat);
  const active = state.turn.activeSeat;
  const has = (seat: number | undefined) => pool.some((u) => seatOf(u) === seat);
  const picks = (seat: number | undefined) => fought.filter((u) => seatOf(u) === seat).length;
  let seat: number | undefined;
  if (has(other) && has(active)) seat = picks(other) <= picks(active) ? other : active;
  else seat = has(other) ? other : has(active) ? active : undefined;
  const eligible = pool.filter((u) => seat !== undefined && seatOf(u) === seat);
  return { step, picker: eligible[0]?.owner ?? null, eligible: eligible.map((u) => u.id) };
}

/**
 * Why fighting with this unit now is out of order: "fightsFirst" (others
 * fight first) or "pick" (it's the other player's pick); undefined if it
 * isn't, or no order applies.
 */
export function fightOutOfOrder(state: GameState, unitId: UnitId): "fightsFirst" | "pick" | undefined {
  const order = fightOrder(state);
  const unit = state.units[unitId];
  if (!order || !unit || order.eligible.includes(unitId)) return undefined;
  // Fighting on with its other weapons, or not able to fight at all: not an order question.
  if (unit.status?.fought || !canFight(state, unit)) return undefined;
  if (order.step === "fightsFirst" && !fightsFirst(unit)) return "fightsFirst";
  return order.picker ? "pick" : undefined;
}
