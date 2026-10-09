import type { ActionTrigger, GameState, PendingReaction, PlayerId, Unit, UnitId } from "../types";
import { bool, num, resolve, type EvalContext } from "./expr";
import {
  applyOutcomes,
  findProcedure,
  startRun,
  type ProcedureRun,
  type RoleRef,
  type RunEnv,
  type Outcome,
} from "./runner";
import { callFor } from "./calls";
import { systemConstants } from "./gameSize";
import {
  inchesPerUnit,
  readCharacteristics,
  tableGeometry,
  unitView,
  weaponView,
  type UnitView,
} from "./runtime";
import type { ActionDef, EffectAction, Expr, GameSystem, Id } from "./schema";
import { currentSlot, systemOf, type TurnSlot } from "./turn";
import { opposed } from "../teams";

/**
 * Taking a system's actions in play: which actions a unit can take now, what
 * they cost, and what taking one does to the table. Works for any system
 * from its data:
 *
 *  - IGOUGO games (40k) list a phase's actions for the active player's units;
 *  - activation games (FSD, Conquest) need an action that `activates` the
 *    unit first, after which it takes that many of the slot's other actions;
 *  - actions with `reactTo` are offered to the other player while an action
 *    they can answer is held (state.pending).
 *
 * The unit keeps its activation in status flags the engine owns: "acting",
 * "actionsTaken", "actionBudget", "allowance" (inches it may move since the
 * slot began), and "used.<action>" for once-per-round limits.
 */

const ENGINE_ACTIVATION_FLAGS = ["acting", "actionsTaken", "actionBudget", "reacting", "moves"];

/** Dice taken from a pool, or an amount from a counter, to pay for an action. */
export interface Payment {
  resource: Id;
  /** Indices into the pool (dice pools). */
  indices?: number[];
  /** Amount taken (counters). */
  amount?: number;
  /** Dice placed ahead of time on this action's slots (FSD pre-assigned ADs), spent now. */
  placed?: { key: string; faces: number[] };
}

export interface ActionOption {
  def: ActionDef;
  ok: boolean;
  /** Why it can't be taken now. */
  why?: string;
  /** What it costs, for the button, e.g. "1 AD" or "AD 4-6". */
  cost: string;
  payment: Payment[];
  /** Pool dice faces it would spend, e.g. [1] for "uses a 1". */
  faces?: number[];
  /** How far a move action lets the unit go, in the system's unit. */
  move?: number;
  /** Units this action may activate as well (FSD command), and how many. */
  commands?: { count: number; candidates: UnitId[] };
  /** Attacks it makes (ActionDef.repeat), each at a target of its own, when more than one. */
  repeat?: number;
}

interface ActionRequest {
  weapon?: string;
  targetId?: UnitId;
  /** Dice-pool indices the player picked to pay with, tried before the lowest that fit. */
  dice?: number[];
}

export function evalCtx(state: GameState, system: GameSystem, scope: Record<string, unknown>): EvalContext {
  return {
    scope: { const: systemConstants(state, system), settings: state.settings, ...scope },
    tables: Object.fromEntries((system.tables ?? []).map((t) => [t.id, t])),
    geometry: tableGeometry(state, system),
    call: callFor(state, system.id),
  };
}

export function safeBool(expr: Expr, ctx: EvalContext): boolean {
  try {
    return bool(expr, ctx);
  } catch {
    return false;
  }
}

function safeNum(expr: Expr, ctx: EvalContext, fallback = 0): number {
  try {
    return num(expr, ctx);
  } catch {
    return fallback;
  }
}

/** Whether a slot's actions are taken through activations. */
function usesActivations(system: GameSystem, slot: TurnSlot | null): boolean {
  return !!slot?.actions.some((id) => system.actions.find((a) => a.id === id)?.activates !== undefined);
}

function seatOf(state: GameState, player: PlayerId): number | undefined {
  return state.players[player]?.seat;
}

function playerAtSeat(state: GameState, seat: number): PlayerId | undefined {
  return Object.values(state.players).find((p) => p.seat === seat)?.id;
}

/** The event a reaction answers, as expressions see it ("event.action", "event.unit", "event.target"). */
function triggerPayload(state: GameState, system: GameSystem, t: ActionTrigger) {
  const unit = state.units[t.unitId];
  const target = t.targetId ? state.units[t.targetId] : undefined;
  // Every unit a multiple attack is aimed at, for reactions by any of them.
  const targets = [...new Set([t.targetId, ...(t.more ?? [])])].flatMap((id) => {
    const u = id ? state.units[id] : undefined;
    return u ? [unitView(state, system, u)] : [];
  });
  return {
    action: t.action,
    unit: unit ? unitView(state, system, unit) : undefined,
    target: target ? unitView(state, system, target) : undefined,
    targets,
  };
}

function limitKey(def: ActionDef, req: ActionRequest): string {
  return (def.procedure || def.prepares) && req.weapon ? `used.${def.id}.${req.weapon}` : `used.${def.id}`;
}

/** Parse "4-6" or "1-2 1-2" into slots. */
function parseSlots(text: unknown): { min: number; max: number }[] {
  if (typeof text !== "string") return [];
  const out: { min: number; max: number }[] = [];
  for (const m of text.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g))
    out.push({ min: Number(m[1]), max: Number(m[2] ?? m[1]) });
  return out;
}

/**
 * Work out how to pay an action's costs from the player's counters and dice
 * pools: each slot takes the lowest die that fits it, other dice the lowest
 * left. Returns a reason when it can't be paid.
 */
/** An action's cost as the player reads it ("2 CP", "1 die + 5-6"), whether or not they can pay. */
export function costLabel(system: GameSystem, def: ActionDef, ctx: EvalContext): string {
  return (def.cost ?? [])
    .flatMap((c) => {
      const res = system.resources?.find((r) => r.id === c.resource);
      const name = res?.short ?? res?.name ?? c.resource;
      const amount = safeNum(c.amount, ctx);
      if (res?.kind === "dicePool") {
        const slots = [...(c.slots ?? []), ...(c.slotsFrom ? parseSlots(resolve(c.slotsFrom, ctx)) : [])];
        const parts = [
          ...(amount ? [`${amount} die`] : []),
          ...slots.map((s) => (s.min === s.max ? `${s.min}` : `${s.min}-${s.max}`)),
        ];
        return parts.length ? [parts.join(" + ")] : [];
      }
      return amount ? [`${amount} ${name}`] : [];
    })
    .join(", ");
}

export function payFor(
  state: GameState,
  system: GameSystem,
  player: PlayerId,
  def: ActionDef,
  ctx: EvalContext,
  prefer: number[] = [],
  /**
   * Dice placed on this action's slots, by key, used first; `fromPool` lets
   * the rest come from the pool (placed at the start of the turn). A
   * reacting unit has only what was placed before.
   */
  slotsOf?: { key: string; fromPool: boolean },
): { payment: Payment[]; label: string; faces: number[] } | { why: string } {
  const paidFaces: number[] = [];
  const payment: Payment[] = [];
  const labels: string[] = [];
  for (const c of def.cost ?? []) {
    const res = system.resources?.find((r) => r.id === c.resource);
    const name = res?.short ?? res?.name ?? c.resource;
    const amount = safeNum(c.amount, ctx);
    if (res?.kind === "dicePool") {
      const slots = [...(c.slots ?? []), ...(c.slotsFrom ? parseSlots(resolve(c.slotsFrom, ctx)) : [])];
      const faces = state.pools?.[player]?.[c.resource] ?? [];
      // Dice the player picked come first, then the lowest.
      const order = faces
        .map((f, i) => ({ f, i }))
        .sort((a, b) => Number(prefer.includes(b.i)) - Number(prefer.includes(a.i)) || a.f - b.f);
      const used = new Set<number>();
      // Slots filled ahead of time take their placed dice.
      const placed = slotsOf ? (state.placed?.[player]?.[slotsOf.key] ?? []) : [];
      const fill = matchSlots(slots, placed);
      const fromPlaced: number[] = [];
      for (const [k, s] of slots.entries()) {
        const f = fill[k];
        if (f !== undefined) {
          fromPlaced.push(placed[f]!);
          continue;
        }
        const want = s.min === s.max ? `${s.min}` : `${s.min}-${s.max}`;
        if (slotsOf && !slotsOf.fromPool) return { why: `Needs a die showing ${want} placed on its slots` };
        const die = order.find((d) => !used.has(d.i) && d.f >= s.min && d.f <= s.max);
        if (!die) return { why: `Needs a die showing ${want}` };
        used.add(die.i);
      }
      if (fromPlaced.length && slotsOf) {
        payment.push({ resource: c.resource, placed: { key: slotsOf.key, faces: fromPlaced } });
        paidFaces.push(...fromPlaced);
      }
      for (let n = 0; n < amount; n++) {
        const die = order.find((d) => !used.has(d.i));
        if (!die) return { why: `No ${name.toLowerCase()} left` };
        used.add(die.i);
      }
      if (used.size) payment.push({ resource: c.resource, indices: [...used] });
      for (const i of used) paidFaces.push(faces[i]!);
      const parts = [
        ...(amount ? [`${amount} die`] : []),
        ...slots.map((s) => (s.min === s.max ? `${s.min}` : `${s.min}-${s.max}`)),
      ];
      if (parts.length) labels.push(parts.join(" + "));
    } else if (amount) {
      const have = state.resources[player]?.[c.resource] ?? 0;
      if (have < amount) return { why: `Needs ${amount} ${name}` };
      payment.push({ resource: c.resource, amount });
      labels.push(`${amount} ${name}`);
    }
  }
  return { payment, label: labels.join(", "), faces: paidFaces };
}

/**
 * Which placed dice fill which slots: each slot, narrowest first, takes the
 * lowest placed die that fits it. Slot index to index into `placed`.
 */
function matchSlots(slots: { min: number; max: number }[], placed: number[]): Record<number, number> {
  const fill: Record<number, number> = {};
  const used = new Set<number>();
  const order = slots.map((s, k) => ({ s, k })).sort((a, b) => a.s.max - a.s.min - (b.s.max - b.s.min));
  for (const { s, k } of order) {
    const i = placed
      .map((f, i) => ({ f, i }))
      .filter((d) => !used.has(d.i) && d.f >= s.min && d.f <= s.max)
      .sort((a, b) => a.f - b.f)[0]?.i;
    if (i === undefined) continue;
    used.add(i);
    fill[k] = i;
  }
  return fill;
}

/** The key dice placed on a weapon's slots are kept under. */
export function placedKey(unitId: UnitId, weaponId: string): string {
  return `${unitId}/${weaponId}`;
}

/** The dice placed under a key, an empty list dropping the key. */
export function setPlaced(state: GameState, player: PlayerId, key: string, faces: number[]): GameState {
  const own = { ...state.placed?.[player] };
  if (faces.length) own[key] = faces;
  else delete own[key];
  return { ...state, placed: { ...state.placed, [player]: own } };
}

/** The pool whose dice can be placed on cards: a dice pool with a `total` (FSD's AD Pool). */
export function placeablePool(system: GameSystem): Id | undefined {
  return system.resources?.find((r) => r.kind === "dicePool" && r.total !== undefined)?.id;
}

/**
 * The action a weapon's slots pay for (FSD: its special action), with the
 * slots and whether that action is switched off now (a damaged system).
 */
export function weaponSlots(
  state: GameState,
  unitId: UnitId,
  weaponId: string,
): { def: ActionDef; slots: { min: number; max: number }[]; off?: string } | null {
  const system = systemOf(state);
  const unit = state.units[unitId];
  const weapon = unit?.sheet?.weapons[weaponId];
  if (!unit || !weapon) return null;
  const pool = placeablePool(system);
  const ctx = evalCtx(state, system, {
    self: unitView(state, system, unit),
    weapon: weaponView(state, system, unit, weapon),
  });
  const def = system.actions.find(
    (a) =>
      a.cost?.some((c) => c.resource === pool && c.slotsFrom) &&
      (a.forWeapons === undefined || safeBool(a.forWeapons, ctx)),
  );
  if (!def) return null;
  const slots = (def.cost ?? []).flatMap((c) =>
    c.resource === pool
      ? [...(c.slots ?? []), ...(c.slotsFrom ? parseSlots(resolve(c.slotsFrom, ctx)) : [])]
      : [],
  );
  const off = (def.notWhen ?? []).find((n) => safeBool(n.if, ctx))?.why;
  return { def, slots, ...(off ? { off } : {}) };
}

/**
 * Whether a player may place dice on cards now: in a pre-assigning or
 * cleanup window, or at the start of their own alternating turn (before
 * anything is acting).
 */
export function placeWindow(state: GameState, player: PlayerId): boolean {
  const system = systemOf(state);
  if (!placeablePool(system)) return false;
  const slot = currentSlot(state);
  if (!slot || state.procedure || state.pending) return false;
  if (slot.placeDice) return true;
  return (
    usesActivations(system, slot) &&
    seatOf(state, player) === state.turn.activeSeat &&
    !actingUnits(state).length
  );
}

/** Why a pool die can't go on a weapon's slots now, or undefined if it can. */
export function cantPlace(
  state: GameState,
  player: PlayerId,
  unitId: UnitId,
  weaponId: string,
  index: number,
): string | undefined {
  const system = systemOf(state);
  const pool = placeablePool(system);
  const unit = state.units[unitId];
  if (!pool || !unit || unit.owner !== player) return "Not your unit";
  if (!placeWindow(state, player)) return "Dice go on cards at the start of your turn";
  if (!unitView(state, system, unit).models.length) return "Destroyed";
  const face = state.pools?.[player]?.[pool]?.[index];
  if (face === undefined) return "No such die";
  const at = weaponSlots(state, unitId, weaponId);
  if (!at?.slots.length) return "No AD slots";
  if (at.off) return at.off;
  const placed = state.placed?.[player]?.[placedKey(unitId, weaponId)] ?? [];
  const before = Object.keys(matchSlots(at.slots, placed)).length;
  if (Object.keys(matchSlots(at.slots, [...placed, face])).length <= before)
    return placed.length >= at.slots.length ? "Its slots are full" : `A ${face} doesn't fit its slots`;
  return undefined;
}

/** Move a pool die onto a weapon's slots. */
export function placeDie(
  state: GameState,
  player: PlayerId,
  unitId: UnitId,
  weaponId: string,
  index: number,
): GameState {
  const pool = placeablePool(systemOf(state));
  const face = pool ? state.pools?.[player]?.[pool]?.[index] : undefined;
  if (!pool || face === undefined) return state;
  const key = placedKey(unitId, weaponId);
  const next = pay(state, player, [{ resource: pool, indices: [index] }]);
  return setPlaced(next, player, key, [...(state.placed?.[player]?.[key] ?? []), face]);
}

/**
 * Drop dice placed on actions that can't be taken any more (the unit or
 * weapon is gone, or a damaged system switched the action off): they go to
 * the spent dice.
 */
export function dropDisabledPlacements(state: GameState): GameState {
  if (!state.placed) return state;
  const system = systemOf(state);
  let next = state;
  for (const [player, keys] of Object.entries(state.placed))
    for (const key of Object.keys(keys)) {
      const [unitId, weaponId] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
      const unit = next.units[unitId];
      const gone = !unit || !unitView(next, system, unit).models.length;
      if (gone || !weaponSlots(next, unitId, weaponId) || weaponSlots(next, unitId, weaponId)?.off)
        next = setPlaced(next, player, key, []);
    }
  return next;
}

/** Units whose activation is under way (or a reacting unit). */
export function actingUnits(state: GameState): Unit[] {
  return Object.values(state.units).filter((u) => u.status?.acting);
}

/**
 * The actions a unit can take now, with costs and the reason any can't be
 * taken. `req` names the weapon and target for procedure actions (Fire).
 */
export function unitActions(state: GameState, unitId: UnitId, req: ActionRequest = {}): ActionOption[] {
  const unit = state.units[unitId];
  if (!unit) return [];
  const system = systemOf(state);
  const slot = currentSlot(state);
  if (!slot) return [];
  const view = unitView(state, system, unit);
  const activations = usesActivations(system, slot);
  const seat = seatOf(state, unit.owner);
  const active = seat === state.turn.activeSeat;
  const pending = state.pending ?? null;
  const acting = !!unit.status?.acting;
  const taken = Number(unit.status?.actionsTaken ?? 0);
  const budget = Number(unit.status?.actionBudget ?? 0);
  const weapon = req.weapon ? unit.sheet?.weapons[req.weapon] : undefined;
  const wView = weapon ? weaponView(state, system, unit, weapon) : undefined;
  const target = req.targetId ? state.units[req.targetId] : undefined;

  const out: ActionOption[] = [];
  for (const id of slot.actions) {
    const def = system.actions.find((a) => a.id === id);
    if (!def || def.by !== "unit") continue;
    const event = def.reactTo && pending ? triggerPayload(state, system, pending.trigger) : undefined;
    const ctx = evalCtx(state, system, {
      self: view,
      ...(event ? { event } : {}),
      ...(wView ? { weapon: wView } : {}),
      ...(target ? { target: unitView(state, system, target) } : {}),
    });
    const why = ((): string | undefined => {
      if (wView && def.forWeapons !== undefined && !safeBool(def.forWeapons, ctx))
        return "Not for this weapon";
      if (state.procedure) return "Finish the current roll first";
      if (view.models.length === 0) return "Destroyed";
      // Spearmen offered Shoot with nothing to shoot (dogfood): a weapon roll needs a weapon.
      if (
        def.procedure &&
        !Object.keys(unit.sheet?.weapons ?? {}).length &&
        (findProcedure(system, def.procedure).params ?? []).includes("weapon")
      )
        return "No weapon for this";
      if (def.reactTo) {
        if (!pending || pending.reactor || pending.seat !== seat) return "Only to answer an enemy action";
        if (acting) return "Already acting";
      } else if (def.activates !== undefined) {
        if (acting) return "Already activated";
        if (pending) return "Waiting on a reaction";
        if (actingUnits(state).length) return "Finish the current activation first";
        if (def.side === "active" && !active) return "Not your turn";
        if (def.side === "inactive" && active) return "Only on the other player's turn";
      } else if (activations) {
        if (!acting) return "Activate the unit first";
        if (taken >= budget && !def.free) return "No actions left";
        if (pending && pending.reactor !== unit.id) return "Waiting on a reaction";
      } else {
        if (def.side === "active" && !active) return "Not your turn";
        if (def.side === "inactive" && active) return "Only on the other player's turn";
      }
      if (def.limit && Number(unit.status?.[limitKey(def, req)] ?? 0) >= def.limit.count)
        return (def.procedure || def.prepares) && req.weapon
          ? "Weapon already used this round"
          : "Already used this round";
      for (const n of def.notWhen ?? []) if (safeBool(n.if, ctx)) return n.why;
      if (def.if !== undefined && !safeBool(def.if, ctx)) return "Not allowed now";
      return undefined;
    })();
    const paid = payFor(
      state,
      system,
      unit.owner,
      def,
      ctx,
      req.dice,
      req.weapon && placeablePool(system)
        ? { key: placedKey(unit.id, req.weapon), fromPool: acting && !unit.status?.reacting && active }
        : undefined,
    );
    const option: ActionOption = {
      def,
      ok: !why && !("why" in paid),
      cost: "label" in paid ? paid.label : "",
      ...("faces" in paid && paid.faces.length ? { faces: paid.faces } : {}),
      payment: "payment" in paid ? paid.payment : [],
      ...(why || "why" in paid ? { why: why ?? (paid as { why: string }).why } : {}),
    };
    if (def.move) option.move = safeNum(def.move.distance, ctx);
    if (def.repeat !== undefined && wView) {
      const n = Math.floor(safeNum(def.repeat, ctx, 1));
      if (n > 1) option.repeat = n;
    }
    const command = def.do?.find((a): a is Extract<EffectAction, { do: "activate" }> => a.do === "activate");
    if (command) {
      const count = safeNum(command.count, ctx);
      const candidates = Object.values(state.units).filter((u) => {
        // Units in reserve aren't on the table to be commanded (UX 293).
        if (u.id === unit.id || u.owner !== unit.owner || u.status?.acting || u.status?.reserves)
          return false;
        const it = unitView(state, system, u);
        if (!it.models.length) return false;
        return (
          command.filter === undefined || safeBool(command.filter, { ...ctx, scope: { ...ctx.scope, it } })
        );
      });
      option.commands = { count, candidates: candidates.map((u) => u.id) };
    }
    out.push(option);
  }
  return out;
}

/**
 * Enemy units an action can target, with whether its `target` allows them
 * and, when it doesn't, why (the first `notWhen` that holds). `weaponId`
 * puts the chosen weapon in scope as "weapon", so a filter can read its
 * rules (40k Indirect Fire targets units out of sight).
 */
export function actionTargets(
  state: GameState,
  unitId: UnitId,
  actionId: Id,
  weaponId?: string,
): { unitId: UnitId; ok: boolean; distance: number; why?: string }[] {
  const unit = state.units[unitId];
  if (!unit) return [];
  const system = systemOf(state);
  const def = system.actions.find((a) => a.id === actionId);
  const self = unitView(state, system, unit);
  const w = weaponId ? unit.sheet?.weapons[weaponId] : undefined;
  const ctx = evalCtx(state, system, { self, ...(w ? { weapon: weaponView(state, system, unit, w) } : {}) });
  const geometry = tableGeometry(state, system);
  return Object.values(state.units)
    .filter((u) => opposed(state, u.owner, unit.owner))
    .map((u) => {
      const it = unitView(state, system, u);
      const c = { ...ctx, scope: { ...ctx.scope, it } };
      const distance = it.models.length
        ? Number(geometry({ kind: "distance", from: "self", to: "it", measure: "centre" }, c))
        : Infinity;
      const why = def?.target?.notWhen?.find((n) => safeBool(n.if, c))?.why;
      const ok = it.models.length > 0 && (!def?.target || safeBool(def.target.filter, c)) && !why;
      return { unitId: u.id, ok, distance, ...(why ? { why } : {}) };
    })
    .filter((t) => t.distance < Infinity)
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.distance - b.distance);
}

/** The run environment for the state's system. */
export function procedureEnv(state: GameState, rng?: () => number): RunEnv {
  return { system: systemOf(state), state, ...(rng ? { rng } : {}) };
}

/** Roles for a unit's procedure: the acting unit, its weapon and the target. */
export function procedureRoles(
  system: GameSystem,
  procedure: Id,
  unitId: UnitId,
  req: ActionRequest,
): Record<string, RoleRef> {
  const params = findProcedure(system, procedure).params ?? [];
  const roles: Record<string, RoleRef> = {};
  for (const p of params) {
    if (p === "weapon" && req.weapon) roles[p] = { unit: unitId, weapon: req.weapon };
    else if (p === "target" || p === "defender") {
      if (req.targetId) roles[p] = { unit: req.targetId };
    } else roles[p] = { unit: unitId };
  }
  return roles;
}

/**
 * Whether the other player may react to this action, and so it should wait:
 * some action with `reactTo` matching it is open to one of their units.
 */
export function reactionSeat(state: GameState, trigger: ActionTrigger): number | null {
  if (state.pending) return null;
  const system = systemOf(state);
  const slot = currentSlot(state);
  const actorSeat = seatOf(state, trigger.by);
  if (actorSeat === undefined || !slot) return null;
  const reactions = system.actions.filter((a) => a.reactTo && slot.actions.includes(a.id));
  if (!reactions.length) return null;
  const event = triggerPayload(state, system, trigger);
  const otherSeat = Object.values(state.players).find(
    (p) => p.seat !== undefined && p.seat !== actorSeat,
  )?.seat;
  if (otherSeat === undefined) return null;
  const probe: GameState = { ...state, pending: { kind: "reaction", seat: otherSeat, trigger } };
  for (const def of reactions) {
    const ctx = evalCtx(state, system, { event });
    const where = def.reactTo!.where;
    if (def.reactTo!.event !== "action.declared" || (where !== undefined && !safeBool(where, ctx))) continue;
    for (const u of Object.values(state.units)) {
      if (seatOf(state, u.owner) !== otherSeat || u.status?.reserves) continue;
      if (unitActions(probe, u.id).some((o) => o.def.id === def.id && o.ok)) return otherSeat;
    }
  }
  return null;
}

/** Start a procedure run for an action, on the host. Null if it can't run (no target, unknown weapon). */
export function startActionRun(
  state: GameState,
  trigger: ActionTrigger,
  rng: () => number,
): ProcedureRun | null {
  const system = systemOf(state);
  const def = system.actions.find((a) => a.id === trigger.action);
  if (!def?.procedure) return null;
  const unit = state.units[trigger.unitId];
  if (!unit || !unitView(state, system, unit).models.length) return null;
  const roles = procedureRoles(system, def.procedure, trigger.unitId, trigger);
  const params = findProcedure(system, def.procedure).params ?? [];
  if (params.some((p) => !roles[p])) return null;
  try {
    return startRun(procedureEnv(state, rng), def.procedure, roles);
  } catch {
    return null;
  }
}

/** A system action taken, as it lands in the event log. */
export interface ActionTaken extends ActionTrigger {
  payment: Payment[];
  /** Units activated along with this one (command). */
  with?: UnitId[];
  /** The procedure, already started by the host. */
  run?: ProcedureRun;
  /** The other player may react first: the action waits. */
  hold?: boolean;
}

export function setStatus(
  state: GameState,
  unitId: UnitId,
  patch: Record<string, number | boolean | null>,
): GameState {
  const u = state.units[unitId];
  if (!u) return state;
  const status = { ...u.status };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === false) delete status[k];
    else status[k] = v;
  }
  return { ...state, units: { ...state.units, [unitId]: { ...u, status } } };
}

/** Fold a taken action into the state. */
export function applyAction(state: GameState, ev: ActionTaken): GameState {
  const system = systemOf(state);
  const def = system.actions.find((a) => a.id === ev.action);
  const unit = state.units[ev.unitId];
  if (!def || !unit) return state;
  let next = pay(state, unit.owner, ev.payment);
  const view = unitView(next, system, unit);
  const ctx = evalCtx(next, system, { self: view });

  if (def.activates !== undefined) {
    const budget = safeNum(def.activates, ctx, 1);
    const start = { acting: true, activated: true, actionsTaken: 0, actionBudget: budget };
    next = setStatus(next, unit.id, { ...start, ...(def.reactTo ? { reacting: true } : {}) });
    for (const id of ev.with ?? []) next = setStatus(next, id, { ...start, commanded: true });
    if (def.reactTo && next.pending) next = { ...next, pending: { ...next.pending, reactor: unit.id } };
  } else {
    const patch: Record<string, number | boolean> = {};
    if (unit.status?.acting && !def.free) patch.actionsTaken = Number(unit.status.actionsTaken ?? 0) + 1;
    if (def.limit) patch[limitKey(def, ev)] = Number(unit.status?.[limitKey(def, ev)] ?? 0) + 1;
    if (def.move) {
      const inches = safeNum(def.move.distance, ctx) * inchesPerUnit(system);
      patch.allowance = Number(unit.status?.allowance ?? 0) + inches;
      // Move actions this activation, for rules about a single move (FSD areas of control).
      patch.moves = Number(unit.status?.moves ?? 0) + 1;
    }
    for (const f of def.sets ?? []) patch[f] = true;
    if (def.prepares && ev.weapon) patch[`prepared.${ev.weapon}`] = true;
    next = setStatus(next, unit.id, patch);
  }
  for (const a of def.do ?? []) {
    if (a.do === "applyStatus" || a.do === "removeStatus" || a.do === "setFlag") {
      const target = a.target && a.target !== "self" ? resolve(a.target, ctx) : view;
      const id = (target as UnitView | undefined)?.id;
      if (!id || !next.units[id]) continue;
      const key = a.do === "setFlag" ? a.flag : a.status;
      const value = a.do === "setFlag" ? a.value : a.do === "applyStatus";
      next = setStatus(next, id, { [key]: value });
    }
  }
  const trigger: ActionTrigger = {
    unitId: ev.unitId,
    action: ev.action,
    by: ev.by,
    ...(ev.targetId ? { targetId: ev.targetId } : {}),
    ...(ev.weapon ? { weapon: ev.weapon } : {}),
    ...(ev.more?.length ? { more: ev.more } : {}),
  };
  if (ev.hold) {
    const seat = Object.values(next.players).find(
      (p) => p.seat !== undefined && p.seat !== seatOf(next, ev.by),
    )?.seat;
    if (seat !== undefined) next = { ...next, pending: { kind: "reaction", seat, trigger } };
  }
  if (ev.run) next = withRun(next, trigger, ev.run);
  return next;
}

export function pay(state: GameState, player: PlayerId, payment: Payment[]): GameState {
  let next = state;
  for (const p of payment) {
    if (p.placed) {
      const left = [...(next.placed?.[player]?.[p.placed.key] ?? [])];
      for (const f of p.placed.faces) {
        const i = left.indexOf(f);
        if (i >= 0) left.splice(i, 1);
      }
      next = setPlaced(next, player, p.placed.key, left);
    }
    if (p.indices) {
      const drop = new Set(p.indices);
      const faces = (next.pools?.[player]?.[p.resource] ?? []).filter((_, i) => !drop.has(i));
      next = {
        ...next,
        pools: { ...next.pools, [player]: { ...next.pools?.[player], [p.resource]: faces } },
      };
    } else if (p.amount) {
      const own = next.resources[player] ?? {};
      next = {
        ...next,
        resources: {
          ...next.resources,
          [player]: { ...own, [p.resource]: (own[p.resource] ?? 0) - p.amount },
        },
      };
    }
  }
  return next;
}

/** Put a procedure run into the state, applying its outcomes once it is done. */
export function withRun(state: GameState, trigger: ActionTrigger, run: ProcedureRun): GameState {
  const system = systemOf(state);
  const def = system.actions.find((a) => a.id === trigger.action);
  const unit = state.units[trigger.unitId];
  const weapon = trigger.weapon ? unit?.sheet?.weapons[trigger.weapon] : undefined;
  const target = trigger.targetId ? state.units[trigger.targetId] : undefined;
  const title = [unit?.name, weapon?.name ?? def?.name, target ? `at ${target.name}` : ""]
    .filter(Boolean)
    .join(" ");
  const next: GameState = {
    ...state,
    procedure: {
      run,
      title,
      unitId: trigger.unitId,
      action: trigger.action,
      by: trigger.by,
      ...(trigger.targetId ? { targetId: trigger.targetId } : {}),
      ...(trigger.weapon ? { weapon: trigger.weapon } : {}),
      ...(trigger.more?.length ? { more: trigger.more } : {}),
    },
  };
  return run.done ? finishRun(next) : next;
}

/** Update the run in progress (after a roll or an answer). */
export function setRun(state: GameState, run: ProcedureRun): GameState {
  if (!state.procedure) return state;
  const next = { ...state, procedure: { ...state.procedure, run } };
  return run.done ? finishRun(next) : next;
}

function finishRun(state: GameState): GameState {
  const proc = state.procedure;
  if (!proc || proc.applied) return state;
  // A reaction's results wait for the action it answers, and land with them; so do a
  // multiple attack's, until its last attack is rolled.
  if ((state.pending?.reactor && state.pending.reactor === proc.unitId) || proc.more?.length)
    return {
      ...state,
      deferred: [...(state.deferred ?? []), ...proc.run.outcomes],
      procedure: { ...proc, applied: true },
    };
  const applied = applyDeferred(applyRunOutcomes(state, proc.run.outcomes));
  return { ...applied, procedure: { ...proc, applied: true } };
}

/** Apply a reaction's results held back for the action it answered, then drop dice on switched-off actions. */
export function applyDeferred(state: GameState): GameState {
  const held = state.deferred;
  const next = held?.length ? { ...applyRunOutcomes(state, held), deferred: null } : state;
  return dropDisabledPlacements(next);
}

/** Apply a run's table changes, with each model's wounds from its profile. */
export function applyRunOutcomes(state: GameState, outcomes: Outcome[]): GameState {
  const system = systemOf(state);
  const maxWounds = (id: string) => {
    const m = state.models[id];
    const w = Number(readCharacteristics(system, "model", m?.profile?.chars).W ?? 1);
    return w > 0 ? w : 1;
  };
  return applyOutcomes(state, outcomes, maxWounds);
}

/**
 * Close the procedure panel. If a reacting unit has now used its action,
 * the reaction is over and the held action goes on (`resume`).
 */
export function reactionOver(state: GameState): boolean {
  const reactor = state.pending?.reactor;
  const u = reactor ? state.units[reactor] : undefined;
  if (!state.pending || !reactor) return false;
  if (!u || !unitView(state, systemOf(state), u).models.length) return true;
  return Number(u.status?.actionsTaken ?? 0) >= Number(u.status?.actionBudget ?? 1);
}

/** End a reaction: the reactor's turn is over and the held action resumes (with its run, if any). */
export function endReaction(state: GameState, run: ProcedureRun | null): GameState {
  const pending: PendingReaction | null | undefined = state.pending;
  if (!pending) return state;
  let next: GameState = { ...state, pending: null };
  if (pending.reactor) {
    const clear = Object.fromEntries(ENGINE_ACTIVATION_FLAGS.map((f) => [f, null]));
    next = setStatus(next, pending.reactor, clear);
  }
  if (run) next = withRun(next, pending.trigger, run);
  // The answered action had nothing to resolve (a move): the reaction's results land now.
  else next = applyDeferred(next);
  return next;
}

/** Name of the player in a seat, for "waiting on" prompts. */
export function seatName(state: GameState, seat: number): string {
  const id = playerAtSeat(state, seat);
  return (id && state.players[id]?.name) || `Player ${seat + 1}`;
}
