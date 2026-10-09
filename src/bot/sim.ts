import {
  applyEvent,
  resolveIntent,
  sidePlayers,
  stateAt,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
  type Rng,
} from "../core";
import { nextRoller } from "../core/rolls";
import { hookIntents } from "../core/script";

/** Events a game's charge hook (TurnHooks.charge) answers: a charge roll, a charge move. */
const CHARGE_EVENTS = new Set(["dice/roll", "models/move", "unit/move"]);

/**
 * Trying moves out without playing them (#45): the host's own resolver run
 * on a copy of the table, so the bot sees what a move would really do, dice
 * and all. A try then plays out whatever the move set going (its rolls, a
 * question answered at random, reactions passed) until the game is back
 * with the side whose turn it is.
 */
export class Sim {
  /** Tables by seq, for code procedures that replay from where they started. */
  private readonly seen = new Map<number, GameState>();

  constructor(private record: GameRecord) {}

  /** The game moved on: keep the tables already seen, they're still right. */
  update(record: GameRecord, state: GameState): void {
    this.record = record;
    this.seen.set(state.seq, state);
    if (this.seen.size > 400) {
      const keep = [...this.seen.keys()].sort((a, b) => b - a).slice(0, 200);
      for (const k of [...this.seen.keys()]) if (!keep.includes(k)) this.seen.delete(k);
    }
  }

  private history(local: Map<number, GameState>) {
    return (seq: number): GameState => {
      const s = local.get(seq) ?? this.seen.get(seq);
      if (s) return s;
      const folded = stateAt(this.record, seq);
      this.seen.set(seq, folded);
      return folded;
    };
  }

  /** One intent on a copy of the table, or null if the host would turn it down. */
  step(
    state: GameState,
    intent: Intent,
    by: PlayerId,
    rng: Rng,
    local: Map<number, GameState>,
  ): GameState | null {
    local.set(state.seq, state);
    let event;
    try {
      event = resolveIntent(intent, by, rng, state, this.history(local));
    } catch {
      return null;
    }
    if (!event) return null;
    let next = { ...applyEvent(state, event), seq: state.seq + 1 };
    local.set(next.seq, next);
    // What the game's charge hook does about a charge roll or move (Conquest: a short charge
    // ends the activation, one that lands inspires), as the host would run it.
    if (CHARGE_EVENTS.has(event.type))
      for (const hook of hookIntents(state, next, event)) {
        if (next.script) break;
        next = this.step(next, hook, by, rng, local) ?? next;
      }
    return next;
  }

  /**
   * Play out what the game is waiting on: rolls rolled, windows passed,
   * questions answered (by `answer`, else at random), reactions passed.
   * Stops when nothing is pending, or at a question nobody here can answer.
   */
  settle(
    state: GameState,
    rng: Rng,
    local: Map<number, GameState>,
    answer?: (state: GameState) => string | undefined,
    limit = 60,
  ): GameState {
    let s = state;
    for (let i = 0; i < limit; i++) {
      const moves = pendingMoves(s, rng, answer);
      if (!moves) return s;
      let next: GameState | null = null;
      for (const [intent, by] of moves) if ((next = this.step(s, intent, by, rng, local))) break;
      if (!next) return s;
      s = next;
    }
    return s;
  }
}

/** The moves that answer what the game is waiting on, in order, or null when it isn't waiting. */
function pendingMoves(
  s: GameState,
  rng: Rng,
  answer?: (state: GameState) => string | undefined,
): [Intent, PlayerId][] | null {
  const seated = Object.values(s.players)
    .filter((p) => p.seat !== undefined)
    .map((p) => p.id);
  const all = (intent: Intent, first?: PlayerId): [Intent, PlayerId][] =>
    [...(first ? [first] : []), ...seated.filter((p) => p !== first)].map((p) => [intent, p]);
  const q = s.script?.waiting;
  if (q) {
    if (q.reveal !== undefined || q.secret !== undefined || !q.options.length) return null;
    const pick = answer?.(s) ?? q.options[Math.floor(rng() * q.options.length)]!.id;
    return [[{ type: "script/answer", answer: pick }, q.player]];
  }
  const proc = s.procedure;
  if (proc) {
    if (proc.run.pending) return all({ type: "procedure/respond", answer: "pass" });
    return all(
      proc.run.done ? { type: "procedure/clear" } : { type: "procedure/roll" },
      (!proc.run.done && nextRoller(s, proc.run)) || proc.by,
    );
  }
  const attack = s.attack;
  if (attack)
    return all(
      attack.stage === "done" ? { type: "attack/clear" } : { type: "attack/roll" },
      s.units[attack.stage === "save" ? attack.spec.targetUnitId : attack.spec.attackerUnitId]?.owner,
    );
  if (s.pending) return sidePlayers(s, s.pending.seat).map((p) => [{ type: "reaction/pass" }, p.id]);
  return null;
}
