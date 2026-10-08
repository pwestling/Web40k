import { die } from "../dice";
import type { GameState, Model, PlayerId, Unit } from "../types";
import type { EffectAction, Expr, GameSystem, Id, Segment } from "./schema";
import { getSystem } from "./systems";

/**
 * The turn structure, from GameSystem.turn. A round is flattened into a
 * schedule of slots the turn marker steps through:
 *
 *  - a phase is a window in which some actions are available;
 *  - a step runs its actions when entered (gain CP, roll activation dice);
 *  - an alternate slot is where players take turns activating until both
 *    pass in a row (FSD, Conquest);
 *  - phases inside "playerTurns" repeat for each player in turn (40k), and
 *    keep the same indices for each player, so `turn.phase` reads the same.
 */

export const DEFAULT_SYSTEM = "forty-k-11";
export const SEATS = 2;

export function systemOf(state: Pick<GameState, "system">): GameSystem {
  return getSystem(state.system ?? DEFAULT_SYSTEM);
}

export interface TurnSlot {
  id: Id;
  name: string;
  kind: "phase" | "step" | "alternate";
  /** Repeats for each player's turn. */
  playerTurn: boolean;
  /** Actions players can take here. */
  actions: Id[];
  /** Run when the slot is entered. */
  onEnter: EffectAction[];
  /** For alternating activations: actions each activation allows. */
  actionsPerActivation?: Expr;
  /** Players may place pool dice on card slots here. */
  placeDice?: boolean;
}

const cache = new WeakMap<GameSystem, TurnSlot[]>();

export function schedule(system: GameSystem): TurnSlot[] {
  let slots = cache.get(system);
  if (!slots) {
    slots = flatten(system.turn.round, false);
    cache.set(system, slots);
  }
  return slots;
}

function flatten(segments: Segment[], playerTurn: boolean): TurnSlot[] {
  const out: TurnSlot[] = [];
  for (const seg of segments) {
    switch (seg.kind) {
      case "phase": {
        const nested = seg.segments ?? [];
        const onEnter = nested.flatMap((s) => (s.kind === "step" ? s.do : []));
        out.push({
          id: seg.id,
          name: seg.name,
          kind: "phase",
          playerTurn,
          actions: seg.actions ?? [],
          onEnter,
          ...(seg.placeDice ? { placeDice: true } : {}),
        });
        out.push(
          ...flatten(
            nested.filter((s) => s.kind !== "step"),
            playerTurn,
          ),
        );
        break;
      }
      case "playerTurns":
        out.push(...flatten(seg.segments, true));
        break;
      case "alternate": {
        const inner = flatten(seg.activation, playerTurn);
        out.push({
          id: seg.id,
          name: inner.length === 1 ? inner[0]!.name : "Activations",
          kind: "alternate",
          playerTurn,
          actions: inner.flatMap((s) => s.actions),
          onEnter: inner.flatMap((s) => s.onEnter),
          ...(seg.actionsPerActivation !== undefined
            ? { actionsPerActivation: seg.actionsPerActivation }
            : {}),
        });
        break;
      }
      case "plan":
        out.push({ id: seg.id, name: "Plan", kind: "phase", playerTurn, actions: [], onEnter: [] });
        break;
      case "step":
        out.push({
          id: seg.id,
          name: stepName(seg.id),
          kind: "step",
          playerTurn,
          actions: [],
          onEnter: seg.do,
        });
        break;
    }
  }
  return out;
}

/** "rollActivationDice" → "Roll activation dice". */
function stepName(id: string): string {
  const words = id.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The slot the turn marker is on, or null during deployment. */
export function currentSlot(state: GameState): TurnSlot | null {
  if (state.turn.round === 0) return null;
  return schedule(systemOf(state))[state.turn.phase] ?? null;
}

/** Name of the current phase, e.g. "Shooting", or undefined during deployment. */
export function phaseName(state: GameState): string | undefined {
  return currentSlot(state)?.name;
}

/** What the turn bar shows: the phases of the current player turn (or round), and which is current. */
export function turnView(state: GameState): { phases: string[]; current: number; alternating: boolean } {
  const slots = schedule(systemOf(state));
  const slot = slots[state.turn.phase];
  if (slot?.playerTurn) {
    const group = groupOf(slots, state.turn.phase);
    return {
      phases: slots.slice(group.start, group.end).map((s) => s.name),
      current: state.turn.phase - group.start,
      alternating: false,
    };
  }
  return {
    phases: slots.map((s) => s.name),
    current: state.turn.phase,
    alternating: slot?.kind === "alternate",
  };
}

/** The run of consecutive player-turn slots around index i. */
function groupOf(slots: TurnSlot[], i: number): { start: number; end: number } {
  let start = i;
  while (start > 0 && slots[start - 1]!.playerTurn) start--;
  let end = i;
  while (end < slots.length && slots[end]!.playerTurn) end++;
  return { start, end };
}

/** Starting resources for a player, from the system's counters. */
export function initialResources(state: Pick<GameState, "system">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of systemOf(state).resources ?? [])
    if (r.kind !== "dicePool") out[r.id] = typeof r.initial === "number" ? r.initial : 0;
  return out;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playerAt(state: GameState, seat: number): PlayerId | undefined {
  return Object.values(state.players).find((p) => p.seat === seat)?.id;
}

/**
 * Move the turn marker one slot forwards or back. Entering a slot records
 * where every model stands (moves are measured from there) and, going
 * forwards, runs the slot's actions and the system's resets. Dice rolled on
 * the way (activation dice) come from `seed`, so every peer gets the same.
 */
export function advanceTurn(state: GameState, dir: 1 | -1, seed = 0): GameState {
  // Steps only run their actions: pass straight through them.
  let next = stepTurn(state, dir, seed);
  const slots = schedule(systemOf(state));
  for (let guard = 0; guard < slots.length; guard++) {
    if (next.turn.round === 0 || slots[next.turn.phase]?.kind !== "step") break;
    next = stepTurn(next, dir, seed + guard + 1);
  }
  return next;
}

function stepTurn(state: GameState, dir: 1 | -1, seed: number): GameState {
  const system = systemOf(state);
  const slots = schedule(system);
  const rng = seeded(seed);
  let { round, activeSeat, phase } = state.turn;
  const { firstSeat } = state.turn;
  let newRound = false;
  let newPlayerTurn = false;

  if (round === 0) {
    if (dir === -1) return state;
    round = 1;
    phase = 0;
    activeSeat = firstSeat;
    newRound = true;
    newPlayerTurn = true;
  } else if (dir === 1) {
    const slot = slots[phase];
    const group = slot?.playerTurn ? groupOf(slots, phase) : null;
    const lastSeat = (firstSeat + SEATS - 1) % SEATS;
    if (group && phase + 1 >= group.end && activeSeat !== lastSeat) {
      // The next player's turn of the same phases.
      phase = group.start;
      activeSeat = (activeSeat + 1) % SEATS;
      newPlayerTurn = true;
    } else if (phase + 1 >= slots.length) {
      round += 1;
      phase = 0;
      activeSeat = firstSeat;
      newRound = true;
      newPlayerTurn = true;
    } else {
      phase += 1;
      if (slots[phase]!.playerTurn && !slot?.playerTurn) {
        activeSeat = firstSeat;
        newPlayerTurn = true;
      }
      if (slots[phase]!.kind === "alternate") activeSeat = firstSeat;
    }
  } else {
    const slot = slots[phase];
    const group = slot?.playerTurn ? groupOf(slots, phase) : null;
    if (group && phase === group.start && activeSeat !== firstSeat) {
      phase = group.end - 1;
      activeSeat = (activeSeat + SEATS - 1) % SEATS;
    } else if (phase === 0) {
      if (round === 1) {
        round = 0;
      } else {
        round -= 1;
        phase = slots.length - 1;
        activeSeat = slots[phase]?.playerTurn ? (firstSeat + SEATS - 1) % SEATS : firstSeat;
      }
    } else phase -= 1;
  }

  const models: Record<string, Model> = {};
  for (const [id, m] of Object.entries(state.models))
    models[id] = { ...m, phaseStart: m.position, phaseStartZ: m.z ?? 0 };
  // Moves are measured from here, so move allowances and activations start afresh.
  let next: GameState = clearFlags(
    {
      ...state,
      models,
      attack: null,
      procedure: null,
      pending: null,
      turn: { round, activeSeat, phase, firstSeat, passes: 0 },
    },
    [
      ...ACTIVATION_FLAGS,
      "allowance",
      "applied.*",
      ...(system.resets ?? []).filter((r) => r.at === "phase").flatMap((r) => r.flags),
    ],
  );
  if (dir === -1 || round === 0) return next;

  if (newRound) next = resetFor(next, system, "round", undefined);
  if (newPlayerTurn && slots[phase]?.playerTurn) next = resetFor(next, system, "playerTurn", activeSeat);
  const owner = playerAt(next, activeSeat);
  const opponent = playerAt(next, (activeSeat + 1) % SEATS);
  for (const action of slots[phase]?.onEnter ?? [])
    next = turnAction(next, system, action, owner, opponent, rng);
  return next;
}

/** Flags the engine keeps on a unit during its activation (see play.ts). */
const ACTIVATION_FLAGS = ["acting", "actionsTaken", "actionBudget", "reacting", "moves"];

/** Clear unit flags; a trailing "*" clears every flag with that prefix. */
function clearFlags(state: GameState, flags: string[], seat?: number): GameState {
  if (!flags.length) return state;
  const exact = new Set(flags.filter((f) => !f.endsWith("*")));
  const prefixes = flags.filter((f) => f.endsWith("*")).map((f) => f.slice(0, -1));
  let units: GameState["units"] | null = null;
  for (const [id, u] of Object.entries(state.units)) {
    if (!u.status) continue;
    if (seat !== undefined && state.players[u.owner]?.seat !== seat) continue;
    const keys = Object.keys(u.status).filter((k) => exact.has(k) || prefixes.some((p) => k.startsWith(p)));
    if (!keys.length) continue;
    const status = { ...u.status };
    for (const k of keys) delete status[k];
    units ??= { ...state.units };
    units[id] = { ...u, status } as Unit;
  }
  return units ? { ...state, units } : state;
}

/** End the active player's activation: the other player goes next. */
export function endActivation(state: GameState): GameState {
  const system = systemOf(state);
  const flags = (system.resets ?? []).filter((r) => r.at === "activation").flatMap((r) => r.flags);
  const cleared = clearFlags(state, [...ACTIVATION_FLAGS, ...flags]);
  return {
    ...cleared,
    pending: null,
    turn: { ...state.turn, activeSeat: (state.turn.activeSeat + 1) % SEATS, passes: 0 },
  };
}

/** The active player passes; when every player has passed in a row, the round moves on. */
export function passTurn(state: GameState, seed = 0): GameState {
  const passes = (state.turn.passes ?? 0) + 1;
  if (passes >= SEATS) return advanceTurn(state, 1, seed);
  return { ...state, turn: { ...state.turn, activeSeat: (state.turn.activeSeat + 1) % SEATS, passes } };
}

function resetFor(
  state: GameState,
  system: GameSystem,
  at: "playerTurn" | "round",
  seat: number | undefined,
) {
  const flags = (system.resets ?? []).filter((r) => r.at === at).flatMap((r) => r.flags);
  const units = clearFlags(state, flags, seat).units;
  let resources = state.resources;
  let pools = state.pools;
  for (const r of system.resources ?? []) {
    if (r.reset !== at) continue;
    for (const p of Object.values(state.players)) {
      if (p.seat === undefined || (seat !== undefined && p.seat !== seat)) continue;
      if (r.kind === "dicePool") pools = { ...pools, [p.id]: { ...pools?.[p.id], [r.id]: [] } };
      else
        resources = {
          ...resources,
          [p.id]: { ...resources[p.id], [r.id]: typeof r.initial === "number" ? r.initial : 0 },
        };
    }
  }
  return { ...state, units, resources, ...(pools ? { pools } : {}) };
}

function constant(system: GameSystem, expr: Expr): number {
  if (typeof expr === "number") return expr;
  if (typeof expr === "object" && expr !== null && "ref" in expr) {
    const m = /^const\.(\w+)$/.exec(expr.ref);
    if (m) return system.constants?.[m[1]!] ?? 0;
  }
  return 0;
}

/** Actions a turn step can run: resources and reminders. */
function turnAction(
  state: GameState,
  system: GameSystem,
  action: EffectAction,
  owner: PlayerId | undefined,
  opponent: PlayerId | undefined,
  rng: () => number,
): GameState {
  if (action.do !== "gainResource" && action.do !== "spendResource") return state;
  const player = action.player === "opponent" ? opponent : owner;
  if (!player) return state;
  const def = system.resources?.find((r) => r.id === action.resource);
  const amount = constant(system, action.amount) * (action.do === "spendResource" ? -1 : 1);
  if (def?.kind === "dicePool") {
    const sides = def.sides ?? 6;
    const have = state.pools?.[player]?.[def.id] ?? [];
    // Dice placed on cards are out of the pool until spent (FSD: fewer to roll).
    const placed = Object.values(state.placed?.[player] ?? {}).reduce((n, f) => n + f.length, 0);
    const room = def.total !== undefined ? def.total - placed - have.length : Infinity;
    const rolled = Array.from({ length: Math.max(0, Math.min(amount, room)) }, () => die(rng, sides));
    return {
      ...state,
      pools: { ...state.pools, [player]: { ...state.pools?.[player], [def.id]: [...have, ...rolled] } },
    };
  }
  const own = state.resources[player] ?? {};
  return {
    ...state,
    resources: {
      ...state.resources,
      [player]: { ...own, [action.resource]: (own[action.resource] ?? 0) + amount },
    },
  };
}
