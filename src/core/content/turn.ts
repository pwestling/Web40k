import { die, parseDice } from "../dice";
import type { GameState, Model, PlayerId, Triggered, Unit } from "../types";
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
  let next = stepTurn(
    state.triggered || state.rolledOff ? { ...state, triggered: null, rolledOff: null } : state,
    dir,
    seed,
  );
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
  const left = state.turn.round > 0 && dir === 1 ? slots[state.turn.phase] : undefined;
  if (left?.kind === "phase") state = runTriggers(state, left, "end", state.turn.activeSeat, rng);
  let { round, activeSeat, phase, firstSeat } = state.turn;
  let rolledOff: GameState["rolledOff"] = null;
  let newRound = false;
  let newPlayerTurn = false;

  if (round === 0) {
    if (dir === -1) return state;
    round = 1;
    phase = 0;
    ({ firstSeat, rolledOff } = rollForFirst(state, system, firstSeat, rng));
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
      ({ firstSeat, rolledOff } = rollForFirst(state, system, firstSeat, rng));
      activeSeat = firstSeat;
      newRound = true;
      newPlayerTurn = true;
    } else {
      // A roll-off made as play leaves a phase (Conquest's Supremacy, after the command stacks).
      if (system.turn.rollOff?.after && slot?.id === system.turn.rollOff.after)
        ({ firstSeat, rolledOff } = rollForFirst(state, system, firstSeat, rng, true));
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

  // Units moved by hand (or arriving) this phase get "moved" as it ends (system.marksMoved).
  if (system.marksMoved && dir === 1 && state.turn.round > 0) {
    const units = { ...state.units };
    for (const u of Object.values(state.units)) {
      // Set up from reserves counts as having moved (40k: Heavy, Remained Stationary).
      // How far it went: its furthest model, for the card's "Moved 4" this turn" (UX 397).
      const far = Math.max(
        0,
        ...u.modelIds.map((id) => {
          const m = state.models[id];
          return m?.phaseStart && !m.destroyed
            ? Math.hypot(m.position.x - m.phaseStart.x, m.position.y - m.phaseStart.y)
            : 0;
        }),
      );
      const went = !!u.status?.arrived || far > 0.05;
      if (!went) continue;
      const status = { ...u.status };
      if (!status.moved) status.moved = true;
      if (far > 0.05 && status.movedBy === undefined) status.movedBy = Math.round(far * 10) / 10;
      units[u.id] = { ...u, status };
    }
    state = { ...state, units };
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
      ...(rolledOff ? { rolledOff } : {}),
    },
    [
      ...ACTIVATION_FLAGS,
      "allowance",
      "applied.*",
      // Which weapons a unit has used this phase, so the attack panel can say so (dogfood).
      "fired.*",
      ...(system.resets ?? []).filter((r) => r.at === "phase").flatMap((r) => r.flags),
    ],
  );
  if (dir === -1 || round === 0) return next;

  if (newRound) next = resetFor(next, system, "round", undefined);
  // Plain activations keep "activated" for the round: a new slot of them starts everyone fresh.
  if (slots[phase]?.kind === "alternate" && plainActivations(next)) next = clearFlags(next, ["activated"]);
  if (newPlayerTurn && slots[phase]?.playerTurn) next = resetFor(next, system, "playerTurn", activeSeat);
  const owner = playerAt(next, activeSeat);
  const opponent = playerAt(next, (activeSeat + 1) % SEATS);
  for (const action of slots[phase]?.onEnter ?? [])
    next = turnAction(next, system, action, owner, opponent, rng);
  const entered = slots[phase];
  if (entered?.kind === "phase") next = runTriggers(next, entered, "start", activeSeat, rng);
  return next;
}

/**
 * A roll-off for who goes first each round (`initiative: "rollOffEachRound"`,
 * Conquest's Supremacy): each side rolls a D6, ties roll again. Plainly, the
 * higher goes first at the start of the round; with `rollOff`, it's rolled as
 * play leaves a phase, the side with fewer units on the table takes a
 * modifier, and the lower roll chooses (going first unless they hand it over).
 * Otherwise whoever went first still does.
 */
function rollForFirst(
  state: GameState,
  system: GameSystem,
  firstSeat: number,
  rng: () => number,
  now = false,
): { firstSeat: number; rolledOff: GameState["rolledOff"] } {
  if (system.turn.initiative !== "rollOffEachRound") return { firstSeat, rolledOff: null };
  const how = system.turn.rollOff;
  if (!!how?.after !== now) return { firstSeat, rolledOff: null };
  const counts = Array.from({ length: SEATS }, (_, seat) =>
    Object.values(state.units).filter(
      (u) =>
        state.players[u.owner]?.seat === seat &&
        !u.status?.reserves &&
        u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed),
    ),
  ).map((us) => us.length);
  const fewest = Math.min(...counts);
  const modifiers = counts.map(
    (n, seat) =>
      (how?.fewerUnits && n === fewest && counts.some((m) => m > n) ? -how.fewerUnits : 0) +
      (how?.best ? bestOf(state, system, seat, how.best) : 0),
  );
  const rolls: number[][] = Array.from({ length: SEATS }, () => []);
  for (let tries = 0; tries < 20; tries++) {
    const round = rolls.map((r, seat) => {
      const v = die(rng, 6) + modifiers[seat]!;
      r.push(v);
      return v;
    });
    const pick = how?.chooses === "lower" ? Math.min(...round) : Math.max(...round);
    const winners = round.flatMap((v, seat) => (v === pick ? [seat] : []));
    if (winners.length === 1)
      return {
        firstSeat: winners[0]!,
        rolledOff: {
          rolls,
          seat: winners[0]!,
          ...(modifiers.some((m) => m) ? { modifiers } : {}),
          ...(how?.chooses ? { chooses: true } : {}),
        },
      };
  }
  return { firstSeat, rolledOff: { rolls, seat: firstSeat } };
}

/** The best of a characteristic among a side's units on the table (pinned ones aside, say), for its roll-off. */
function bestOf(
  state: GameState,
  system: GameSystem,
  seat: number,
  best: { characteristic: Id; unless?: Id },
): number {
  let top = 0;
  for (const u of Object.values(state.units)) {
    if (state.players[u.owner]?.seat !== seat || u.status?.reserves) continue;
    if (best.unless && u.status?.[best.unless]) continue;
    for (const id of u.modelIds) {
      const m = state.models[id];
      if (!m || m.destroyed) continue;
      const v = parseFloat(
        String(m.profile?.chars?.[best.characteristic] ?? aliasOf(system, m, best.characteristic) ?? ""),
      );
      if (Number.isFinite(v)) top = Math.max(top, v);
    }
  }
  return top;
}

/** A characteristic read by one of its aliases ("Command" for Cmd). */
function aliasOf(system: GameSystem, m: Model, id: Id): string | undefined {
  const def = system.characteristics.find((c) => c.id === id);
  for (const a of def?.aliases ?? []) if (m.profile?.chars?.[a] !== undefined) return m.profile.chars[a];
  return undefined;
}

/**
 * Automated abilities that go off at the start or end of a phase (#38):
 * "at the start of your Command phase, gain 1CP", "one model regains up to
 * D3 lost wounds". Only on their owner's turn unless the ability says each turn.
 */
function runTriggers(
  state: GameState,
  slot: TurnSlot,
  at: "start" | "end",
  seat: number,
  rng: () => number,
): GameState {
  const out: Triggered[] = [];
  let next = state;
  for (const unit of Object.values(state.units)) {
    const alive = unit.modelIds.map((id) => state.models[id]).filter((m) => m && !m.destroyed) as Model[];
    if (!alive.length || unit.status?.reserves) continue;
    for (const a of unit.sheet?.abilities ?? []) {
      const tr = a.auto?.trigger;
      if (!tr || tr.phase !== slot.id || tr.at !== at) continue;
      if (a.auto?.whileLeading && !unit.status?.attached) continue;
      if (!tr.anyTurn && slot.playerTurn && state.players[unit.owner]?.seat !== seat) continue;
      if (tr.gain) {
        const own = next.resources[unit.owner] ?? {};
        next = {
          ...next,
          resources: {
            ...next.resources,
            [unit.owner]: { ...own, [tr.gain.resource]: (own[tr.gain.resource] ?? 0) + tr.gain.amount },
          },
        };
        out.push({ unitId: unit.id, ability: a.name, gained: tr.gain });
      }
      if (tr.heal) {
        // The most hurt model regains them.
        const hurt = alive
          .map((m) => next.models[m.id]!)
          .filter((m) => (m.woundsLost ?? 0) > 0)
          .sort((x, y) => (y.woundsLost ?? 0) - (x.woundsLost ?? 0))[0];
        if (!hurt) continue;
        let roll: number | undefined;
        let amount = Number(tr.heal);
        if (!Number.isFinite(amount)) {
          let d;
          try {
            d = parseDice(tr.heal);
          } catch {
            continue;
          }
          roll = Array.from({ length: d.count }, () => die(rng, d.sides)).reduce((x, y) => x + y, d.bonus);
          amount = roll;
        }
        const wounds = Math.min(amount, hurt.woundsLost ?? 0);
        next = {
          ...next,
          models: { ...next.models, [hurt.id]: { ...hurt, woundsLost: (hurt.woundsLost ?? 0) - wounds } },
        };
        out.push({
          unitId: unit.id,
          ability: a.name,
          healed: { wounds, ...(roll !== undefined ? { roll } : {}) },
        });
      }
    }
  }
  return out.length ? { ...next, triggered: [...(next.triggered ?? []), ...out] } : next;
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
export function endActivation(state: GameState, seed = 0): GameState {
  const system = systemOf(state);
  const flags = (system.resets ?? []).filter((r) => r.at === "activation").flatMap((r) => r.flags);
  const cleared = clearFlags(state, [...ACTIVATION_FLAGS, ...flags]);
  const next = (state.turn.activeSeat + 1) % SEATS;
  const ended = { ...cleared, pending: null, turn: { ...state.turn, activeSeat: next, passes: 0 } };
  if (!plainActivations(state)) return ended;
  // Every unit has gone: the round is over. A side with none left waits while the other finishes (UX 324).
  const left = (seat: number) =>
    Object.values(ended.units).some(
      (u) =>
        ended.players[u.owner]?.seat === seat &&
        !u.status?.activated &&
        u.modelIds.some((id) => ended.models[id] && !ended.models[id]!.destroyed),
    );
  if (!left(0) && !left(1)) return advanceTurn(ended, 1, seed);
  if (!left(next)) return { ...ended, turn: { ...ended.turn, activeSeat: state.turn.activeSeat } };
  return ended;
}

/**
 * Alternating activations of units where nothing in the rules data starts
 * one (a package game such as Rift Lanterns): a unit activates by moving or
 * by taking a code action, and its activation ends when that action is done
 * or its player says so. Games whose data actions activate units (Conquest,
 * Full Spectrum Dominance) keep their own bookkeeping.
 */
export function plainActivations(state: GameState): boolean {
  const slot = currentSlot(state);
  if (!slot || slot.kind !== "alternate") return false;
  return !systemOf(state).actions.some((a) => a.activates !== undefined);
}

/** A unit of the side whose go it is starts its activation (moving, or a code action). */
export function startActivation(state: GameState, unitId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.status?.acting || !plainActivations(state)) return state;
  if (state.players[unit.owner]?.seat !== state.turn.activeSeat) return state;
  // Someone else already acting: their activation goes on (the app warns).
  if (Object.values(state.units).some((u) => u.status?.acting)) return state;
  const status = { ...unit.status, acting: true, activated: true };
  return { ...state, units: { ...state.units, [unitId]: { ...unit, status } } };
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
