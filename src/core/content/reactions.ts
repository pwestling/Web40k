import type { GameEvent, Intent } from "../actions";
import type { GameRecord } from "../log";
import { sidePlayers } from "../teams";
import type { GameState, OpenReaction, PlayerId, ReactionTrigger, UnitId } from "../types";
import { isAlive } from "../units";
import { num } from "./expr";
import { evalCtx, safeBool, seatName, unitActions, type Payment } from "./play";
import { armyStratagem, playerActions } from "./player";
import { tableGeometry, unitView } from "./runtime";
import type { ActionDef, Expr, GameSystem, ReactionWindowDef } from "./schema";
import { currentSlot, systemOf } from "./turn";

/**
 * Reaction windows (#80, docs/reactions.md): the moments the other side may
 * answer, and the reactions a player can actually play in one now.
 *
 * Three things count as a window, read alike through `reactionWindow`:
 *  - `state.reaction`, opened by the reducer at a moment a system declares
 *    (`GameSystem.reactionWindows`), only when the reacting side has
 *    something playable it hasn't muted. It never blocks: the active side's
 *    next step closes it (the UI holds them for `hold` ms first);
 *  - FSD's held action (`state.pending`), which waits on the answer;
 *  - a code procedure's question that names a window (The Old World's charge
 *    reaction), which waits on the answer too.
 */

export interface ReactionWindowView extends OpenReaction {
  /** Where it comes from: an engine window, FSD's held action, or a code procedure's question. */
  source: "window" | "pending" | "script";
  /** The game waits on an answer (pending, script); an engine window never blocks. */
  blocking: boolean;
}

/** A reaction the player can play now, with what the UI needs to offer it. */
export interface PlayableReaction {
  /** The action id (a stratagem, "army:<player>:<slug>", a unit reaction) or a question's option id. */
  id: string;
  name: string;
  /** "1 CP", "" when free. */
  cost: string;
  payment: Payment[];
  window: string;
  /** Units it can be used on; empty when it takes none. */
  units: UnitId[];
  /** `play` needs `targetId` (one of `units`) added. */
  needsUnit: boolean;
  trigger: ReactionTrigger;
  /** The intent to dispatch, as the player. */
  play: Intent;
  /** A re-roll: after `play`, attack/reroll { seq, die } for the die the player picks. */
  reroll?: { seq: number; dice: { die: number; value: number }[] };
  /** The player said not to be asked about it this game. */
  muted: boolean;
}

/** The default hold on the active side's screen, in ms (settings.reactionHold). */
const REACTION_HOLD = 6000;

function seatOf(state: GameState, player: PlayerId | undefined): number | undefined {
  return player ? state.players[player]?.seat : undefined;
}

/** The seat facing `seat`. */
function otherSeat(state: GameState, seat: number | undefined): number | undefined {
  if (seat === undefined) return undefined;
  return Object.values(state.players).find((p) => p.seat !== undefined && p.seat !== seat)?.seat;
}

/** What the window code puts in front of FSD's held action. */
function pendingWindow(state: GameState): string {
  const action = state.pending?.trigger.action;
  const def = systemOf(state).actions.find((a) => a.id === action);
  return def?.move ? "moveEnded" : def?.procedure ? "targetDeclared" : "actionDeclared";
}

/** The window open now, or null: an engine window, FSD's held action, or a code procedure's question. */
export function reactionWindow(state: GameState): ReactionWindowView | null {
  const waiting = state.script?.waiting;
  if (waiting?.window) {
    const seat = seatOf(state, waiting.player);
    if (seat === undefined) return null;
    const args = state.script?.args ?? {};
    const id = (k: string) =>
      typeof args[k] === "string" ? { [k === "unit" ? "unitId" : "targetId"]: args[k] } : {};
    return {
      window: waiting.window,
      seat,
      trigger: { ...id("unit"), ...id("target") },
      opened: state.seq,
      phase: state.turn.phase,
      hold: 0,
      source: "script",
      blocking: true,
    };
  }
  const pending = state.pending;
  if (pending) {
    const t = pending.trigger;
    return {
      window: pendingWindow(state),
      seat: pending.seat,
      trigger: {
        unitId: t.unitId,
        ...(t.targetId ? { targetId: t.targetId } : {}),
        ...(t.more?.length ? { units: t.more } : {}),
      },
      opened: state.seq,
      phase: state.turn.phase,
      hold: 0,
      source: "pending",
      blocking: true,
    };
  }
  return state.reaction ? { ...state.reaction, source: "window", blocking: false } : null;
}

/** "Ben may react…": who may react, for any other player's screen (never which card), or null. */
export function mayReact(state: GameState, viewer: PlayerId): { seat: number; name: string } | null {
  const open = reactionWindow(state);
  if (!open || seatOf(state, viewer) === open.seat) return null;
  return { seat: open.seat, name: seatName(state, open.seat) };
}

/** Host time (ms) until which the active side holds for an answer: the opening event's `at` plus `hold`. */
export function reactionHoldUntil(record: GameRecord, state: GameState): number | null {
  const open = state.reaction;
  if (!open?.hold) return null;
  const at = record.events.find((e) => e.seq === open.opened)?.at;
  return at === undefined ? null : at + open.hold;
}

/** Whether a reaction id is muted for the player ("Don't ask me this game"). */
function isMuted(state: GameState, player: PlayerId, id: string): boolean {
  const mine = state.reactionMute?.[player] ?? [];
  return mine.includes("*") || mine.includes(id);
}

/** The window's definition in the state's system. */
function windowDef(state: GameState, id: string): ReactionWindowDef | undefined {
  return systemOf(state).reactionWindows?.find((w) => w.id === id);
}

/** The entry saying an action answers a window: its own `reacts`, or an army stratagem's ids or When text. */
function answers(
  state: GameState,
  def: ActionDef,
  win: ReactionWindowDef | undefined,
  window: string,
): { range?: Expr; units?: Expr } | null {
  const own = def.reacts?.find((r) => r.window === window);
  if (own) return own;
  const army = armyStratagem(state, def.id);
  if (!army) return null;
  if (army.reacts) return army.reacts.includes(window) ? {} : null;
  if (!win?.match) return null;
  try {
    return new RegExp(win.match, "i").test(army.when ?? army.text) ? {} : null;
  } catch {
    return null;
  }
}

/** The trigger as expressions see it: "event.unit", "event.target", "event.units". */
function triggerScope(state: GameState, system: GameSystem, t: ReactionTrigger) {
  const view = (id: UnitId | undefined) => {
    const u = id ? state.units[id] : undefined;
    return u ? unitView(state, system, u) : undefined;
  };
  return {
    unit: view(t.unitId),
    target: view(t.targetId),
    units: (t.units ?? []).flatMap((id) => {
      const v = view(id);
      return v ? [v] : [];
    }),
  };
}

/** Units of the trigger a range is measured to: the acting unit and any others named. */
function triggerUnits(t: ReactionTrigger): UnitId[] {
  return [...new Set([...(t.unitId ? [t.unitId] : []), ...(t.units ?? [])])];
}

/**
 * The reactions a player can play now in the open window: cards in hand they
 * can pay for, within their limits and phase, with the units they could be
 * used on (the window's and the action's filters, and range). Empty when no
 * window is open for their seat.
 */
export function playableReactions(state: GameState, player: PlayerId): PlayableReaction[] {
  const open = reactionWindow(state);
  if (!open || seatOf(state, player) !== open.seat) return [];
  const muted = (id: string) => isMuted(state, player, id);
  if (open.source === "script") {
    const waiting = state.script!.waiting!;
    if (waiting.player !== player) return [];
    return waiting.options.map((o) => ({
      id: o.id,
      name: o.label,
      cost: "",
      payment: [],
      window: open.window,
      units: [],
      needsUnit: false,
      trigger: open.trigger,
      play: { type: "script/answer", answer: o.id },
      muted: muted(o.id),
    }));
  }
  if (open.source === "pending") {
    if (state.pending?.reactor) return [];
    return Object.values(state.units)
      .filter((u) => u.owner === player && !u.status?.reserves)
      .flatMap((u) =>
        unitActions(state, u.id)
          .filter((o) => o.ok && o.def.reactTo)
          .map((o) => ({
            id: o.def.id,
            name: o.def.name,
            cost: o.cost,
            payment: o.payment,
            window: open.window,
            units: [u.id],
            needsUnit: false,
            trigger: open.trigger,
            play: { type: "action/take", unitId: u.id, action: o.def.id } as Intent,
            muted: muted(o.def.id),
          })),
      );
  }
  return windowReactions(state, player, open);
}

/** Player actions answering an engine window, as the state stood at its phase. */
function windowReactions(state: GameState, player: PlayerId, open: OpenReaction): PlayableReaction[] {
  const system = systemOf(state);
  const win = windowDef(state, open.window);
  // A window opened as its phase ended answers that phase.
  const at: GameState =
    open.phase === state.turn.phase ? state : { ...state, turn: { ...state.turn, phase: open.phase } };
  const event = triggerScope(at, system, open.trigger);
  const geometry = tableGeometry(at, system);
  const near = triggerUnits(open.trigger).flatMap((id) => {
    const u = at.units[id];
    // Range is to the enemy's units (a charge's targets are the reactor's own).
    return u && isAlive(at, u) && seatOf(at, u.owner) !== open.seat ? [unitView(at, system, u)] : [];
  });
  const out: PlayableReaction[] = [];
  for (const o of playerActions(at, player)) {
    if (!o.ok || o.def.custom) continue;
    const entry = answers(at, o.def, win, open.window);
    if (!entry) continue;
    let units: UnitId[] = [];
    if (o.def.target) {
      const filter = entry.units ?? win?.units;
      units = (o.targets ?? []).filter((id) => {
        const u = at.units[id];
        if (!u) return false;
        const it = unitView(at, system, u);
        const ctx = evalCtx(at, system, { it, self: it, event, player: { id: player } });
        if (filter !== undefined && !safeBool(filter, ctx)) return false;
        if (entry.range === undefined) return true;
        let range: number;
        try {
          range = num(entry.range, ctx);
        } catch {
          return false;
        }
        return near.some((other) => {
          const c = { ...ctx, scope: { ...ctx.scope, self: it, it: other } };
          return Number(geometry({ kind: "distance", from: "self", to: "it" }, c)) <= range;
        });
      });
      if (!units.length) continue;
    }
    const dice = open.trigger.dice;
    out.push({
      id: o.def.id,
      name: o.def.name,
      cost: o.cost,
      payment: o.payment,
      window: open.window,
      units,
      needsUnit: !!o.def.target,
      trigger: open.trigger,
      play: { type: "player/action", action: o.def.id },
      ...(open.window === "rerollable" && dice?.length && open.trigger.seq !== undefined
        ? { reroll: { seq: open.trigger.seq, dice } }
        : {}),
      muted: isMuted(state, player, o.def.id),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Opening and closing windows (the reducer calls `foldReaction` after each event)
// ---------------------------------------------------------------------------

/** Events that leave an open window as it is: talk, clocks, rulers, settings, names. */
const KEEP = new Set<GameEvent["type"]>([
  "ruler/set",
  "clock/pause",
  "clock/adjust",
  "clock/call",
  "player/rename",
  "player/color",
  "player/dice",
  "player/resync",
  "player/rules",
  "settings/set",
  "ability/apply",
  "secret/commit",
  "secret/reveal",
  "dice/commit",
  "dice/seed",
  "dice/reveal",
  "unit/height",
  "unit/figure",
  "template/set",
  "reaction/mute",
]);

/** A window a moment would open, before checking anyone can play in it. */
interface Candidate {
  def: ReactionWindowDef;
  seat: number;
  trigger: ReactionTrigger;
  phase: number;
}

/** The windows this event opens, in the system's order. */
function candidates(prev: GameState, next: GameState, event: GameEvent): Candidate[] {
  const system = systemOf(next);
  const defs = system.reactionWindows ?? [];
  if (!defs.length || next.turn.round === 0) return [];
  const out: Candidate[] = [];
  const slotId = currentSlot(prev)?.id;
  const inPhase = (def: ReactionWindowDef, id = slotId) => !def.phases || (!!id && def.phases.includes(id));
  const seq = prev.seq + 1;
  for (const def of defs) {
    const add = (seat: number | undefined, trigger: ReactionTrigger, phase = next.turn.phase) => {
      if (seat !== undefined) out.push({ def, seat, trigger, phase });
    };
    switch (def.opens) {
      case "phaseEnd": {
        if (event.type !== "turn/next" || prev.turn.round === 0) break;
        if (prev.turn.phase === next.turn.phase && prev.turn.round === next.turn.round) break;
        if (!inPhase(def)) break;
        const active = prev.turn.activeSeat;
        // The active side's units that moved in the phase.
        const moved = Object.values(prev.units)
          .filter((u) => seatOf(prev, u.owner) === active && isAlive(prev, u) && !u.status?.reserves)
          .filter(
            (u) =>
              !!u.status?.moved ||
              u.modelIds.some((id) => {
                const m = prev.models[id];
                return (
                  !!m?.phaseStart &&
                  Math.hypot(m.position.x - m.phaseStart.x, m.position.y - m.phaseStart.y) > 0.05
                );
              }),
          )
          .map((u) => u.id);
        if (!moved.length) break;
        add(otherSeat(prev, active), { units: moved }, prev.turn.phase);
        break;
      }
      case "attackDeclared": {
        if (event.type !== "attack/declare" || !inPhase(def)) break;
        const spec = event.attack.spec;
        const target = next.units[spec.targetUnitId];
        add(seatOf(next, target?.owner), { unitId: spec.attackerUnitId, targetId: spec.targetUnitId, seq });
        break;
      }
      case "beforeSaves": {
        if (event.type !== "attack/roll" || event.reroll || !inPhase(def)) break;
        if (event.attack.stage !== "save" || prev.attack?.stage === "save") break;
        const spec = event.attack.spec;
        add(seatOf(next, next.units[spec.targetUnitId]?.owner), {
          unitId: spec.attackerUnitId,
          targetId: spec.targetUnitId,
          seq,
        });
        break;
      }
      case "attackRolled": {
        if (event.type !== "attack/roll" || event.reroll || !inPhase(def)) break;
        const attack = event.attack;
        const step = attack.run?.records.findLast((r) => r.kind === "test" && r.dice?.length);
        if (!step?.dice || step.plan.kind !== "test") break;
        const dice: { die: number; value: number }[] = [];
        step.dice.forEach((d, die) => {
          if (d.success || d.rerolledFrom !== undefined || d.dice || d.followUp !== undefined) return;
          dice.push({ die, value: d.value });
        });
        if (!dice.length) break;
        const spec = attack.spec;
        const rollerUnit = step.id === "save" ? spec.targetUnitId : spec.attackerUnitId;
        const roller = seatOf(next, next.units[rollerUnit]?.owner);
        const seat = def.who === "roller" ? roller : otherSeat(next, roller);
        add(seat, {
          unitId: spec.attackerUnitId,
          targetId: spec.targetUnitId,
          dice,
          sides: step.plan.sides,
          step: step.id,
          seq,
        });
        break;
      }
      case "unitFought": {
        if (!inPhase(def)) break;
        let unit: UnitId | undefined;
        if (
          event.type === "attack/clear" &&
          prev.attack?.spec.kind === "melee" &&
          prev.attack.stage !== "hit"
        )
          unit = prev.attack.spec.attackerUnitId;
        if (event.type === "procedure/clear" && prev.procedure?.run.done) {
          const def2 = system.actions.find((a) => a.id === prev.procedure?.action);
          if (def2?.sets?.includes("fought")) unit = prev.procedure.unitId;
        }
        if (!unit) break;
        add(otherSeat(next, seatOf(next, next.units[unit]?.owner)), { unitId: unit, seq });
        break;
      }
      case "chargeRolled": {
        if (event.type !== "dice/roll" || !event.roll.targets?.length || !inPhase(def)) break;
        const targets = event.roll.targets;
        const charger = event.roll.unitId;
        const total = event.roll.results.reduce((a, b) => a + b, 0);
        add(seatOf(next, next.units[targets[0]!]?.owner) ?? otherSeat(next, seatOf(next, event.roll.by)), {
          ...(charger ? { unitId: charger } : {}),
          targetId: targets[0]!,
          units: targets,
          total,
          step: "charge",
          seq,
        });
        break;
      }
    }
  }
  return out;
}

/** Whether any player at the window's seat has something to play there they haven't muted. */
function anyPlayable(state: GameState, open: OpenReaction): boolean {
  const probe: GameState = { ...state, reaction: open };
  return sidePlayers(probe, open.seat).some((p) => playableReactions(probe, p.id).some((r) => !r.muted));
}

/**
 * The reducer's last step for each event: open the window this moment opens
 * (when the reacting side has something to play), keep an open one through
 * table talk and the reactor's own plays while they have more to play, and
 * close it otherwise.
 */
export function foldReaction(prev: GameState, next: GameState, event: GameEvent): GameState {
  if (event.type === "reaction/close") return next.reaction ? { ...next, reaction: null } : next;
  const hold = next.settings.reactionHold ?? REACTION_HOLD;
  for (const c of candidates(prev, next, event)) {
    const open: OpenReaction = {
      window: c.def.id,
      seat: c.seat,
      trigger: c.trigger,
      opened: prev.seq + 1,
      phase: c.phase,
      hold,
    };
    if (anyPlayable(next, open)) return { ...next, reaction: open };
  }
  const was = next.reaction;
  if (!was) return next;
  const reactorPlay =
    (event.type === "player/action" && seatOf(next, event.player) === was.seat) ||
    (event.type === "attack/roll" && !!event.reroll);
  if ((KEEP.has(event.type) || reactorPlay) && anyPlayable(next, was)) return next;
  return { ...next, reaction: null };
}
