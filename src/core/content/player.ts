import { isAlive } from "../units";
import type { Ability, ArmyStratagem, GameState, PlayerActionUse, PlayerId, Unit, UnitId } from "../types";
import { actingUnits, costLabel, evalCtx, pay, payFor, safeBool, setStatus, type Payment } from "./play";
import { bindRules, lookupRules, pattern, unitView } from "./runtime";
import type { AbilityTiming, ActionDef, GameSystem } from "./schema";
import { currentSlot, endActivation, systemOf } from "./turn";

/**
 * Player-level play: actions a player takes rather than a unit (40k
 * stratagems, spending command points), and reminders of the imported
 * abilities the engine doesn't automate, put in front of players when their
 * text says they matter.
 */

export interface PlayerActionOption {
  def: ActionDef;
  ok: boolean;
  why?: string;
  cost: string;
  payment: Payment[];
  /** Units it may target, when it targets one. */
  targets?: UnitId[];
}

/** A stratagem as taken: what it cost and what it was used on. */
export interface PlayerActionTaken {
  player: PlayerId;
  action: string;
  payment: Payment[];
  targetId?: UnitId;
  /** For a custom action: the name the player gave it. */
  label?: string;
}

function seatOf(state: GameState, player: PlayerId): number | undefined {
  return state.players[player]?.seat;
}

/** Earlier uses of an action that count against its limit now. */
function usesInWindow(state: GameState, player: PlayerId, def: ActionDef): PlayerActionUse[] {
  const per = def.limit?.per ?? "phase";
  const { round, phase, activeSeat } = state.turn;
  return (state.used?.[player] ?? []).filter(
    (u) =>
      u.action === def.id &&
      (per === "battle" ||
        (u.round === round &&
          (per === "round" || (u.seat === activeSeat && (per === "turn" || u.phase === phase))))),
  );
}

function playerScope(state: GameState, player: PlayerId) {
  const seat = seatOf(state, player);
  return { id: player, seat, active: seat === state.turn.activeSeat };
}

const ARMY = /^army:(.+):([^:]+)$/;

/** A faction stratagem from the player's roster (#49), as a player action. */
function armyAction(player: PlayerId, s: ArmyStratagem): ActionDef {
  return {
    id: `army:${player}:${s.id}`,
    name: s.name,
    by: "player",
    side: s.side,
    ...(s.phases?.length ? { phases: s.phases } : {}),
    cost: [{ resource: "CP", amount: s.cp }],
    limit: { count: 1, per: "phase" },
    ...(s.targetsUnit ? { target: { filter: { same: ["it.owner", "player.id"] } } } : {}),
    ...(s.auto && s.targetsUnit ? { do: [{ do: "applyStatus", status: `strat.${s.id}` }] } : {}),
    ...(s.effect || s.text ? { hint: s.effect ?? s.text } : {}),
  };
}

/** The player actions a player has: the system's, then their army's own stratagems. */
export function playerActionDefs(state: GameState, player: PlayerId): ActionDef[] {
  const own = (state.armies?.[player]?.stratagems ?? []).map((s) => armyAction(player, s));
  return [...systemOf(state).actions.filter((a) => a.by === "player"), ...own];
}

/** Any action by id, a faction stratagem's included. */
export function findAction(state: GameState, id: string): ActionDef | undefined {
  const army = ARMY.exec(id);
  if (army) {
    const s = state.armies?.[army[1]!]?.stratagems.find((x) => x.id === army[2]);
    return s && armyAction(army[1]!, s);
  }
  return systemOf(state).actions.find((a) => a.id === id);
}

/** The player actions (stratagems) a player could use now, with why not. */
export function playerActions(state: GameState, player: PlayerId): PlayerActionOption[] {
  const system = systemOf(state);
  const slot = currentSlot(state);
  const me = playerScope(state, player);
  const out: PlayerActionOption[] = [];
  for (const def of playerActionDefs(state, player)) {
    if (def.by !== "player") continue;
    const ctx = evalCtx(state, system, { player: me, turn: { round: state.turn.round } });
    const why = ((): string | undefined => {
      if (!slot || state.turn.round === 0) return "Once the battle starts";
      if (def.phases && !def.phases.includes(slot.id)) return "Not in this phase";
      if (def.side === "active" && !me.active) return "Only in your turn";
      if (def.side === "inactive" && me.active) return "Only in your opponent's turn";
      if (def.endsTurn && (actingUnits(state).length || state.pending))
        return "Finish the current activation first";
      if (def.limit && usesInWindow(state, player, def).length >= def.limit.count)
        return `Already used this ${def.limit.per}`;
      const ruled = def.notWhen?.find((n) => safeBool(n.if, ctx));
      if (ruled) return ruled.why;
      if (def.if !== undefined && !safeBool(def.if, ctx)) return "Not allowed now";
      return undefined;
    })();
    const paid = payFor(state, system, player, def, ctx);
    const option: PlayerActionOption = {
      def,
      ok: !why && !("why" in paid),
      // The price shows even when it can't be paid (UX 303).
      cost: "label" in paid ? paid.label : costLabel(system, def, ctx),
      payment: "payment" in paid ? paid.payment : [],
      ...(why || "why" in paid ? { why: why ?? (paid as { why: string }).why } : {}),
    };
    if (def.target) {
      option.targets = Object.values(state.units)
        .filter((u) => {
          const it = unitView(state, system, u);
          return (
            it.models.length > 0 && safeBool(def.target!.filter, { ...ctx, scope: { ...ctx.scope, it } })
          );
        })
        .map((u) => u.id);
      if (option.ok && !option.targets.length) {
        option.ok = false;
        option.why = "No eligible unit";
      }
    }
    out.push(option);
  }
  return out;
}

/** Note that a player used something now (a stratagem, a pool re-roll), for limits. */
export function recordUse(state: GameState, player: PlayerId, action: string): GameState {
  const use: PlayerActionUse = {
    action,
    round: state.turn.round,
    phase: state.turn.phase,
    seat: state.turn.activeSeat,
  };
  return { ...state, used: { ...state.used, [player]: [...(state.used?.[player] ?? []), use] } };
}

/** Where a player stands with a re-roll-once pool this round: re-rolled, ready, or neither. */
export function poolUsed(state: GameState, player: PlayerId, resource: string): "ready" | "rerolled" | null {
  const mine = (state.used?.[player] ?? []).filter((u) => u.round === state.turn.round);
  if (mine.some((u) => u.action === `ready:${resource}`)) return "ready";
  if (mine.some((u) => u.action === `reroll:${resource}`)) return "rerolled";
  return null;
}

/** Fold a used player action into the state: pay, count it, apply its statuses. */
export function applyPlayerAction(state: GameState, ev: PlayerActionTaken): GameState {
  const def = findAction(state, ev.action);
  const seat = seatOf(state, ev.player);
  if (!def || seat === undefined) return state;
  let next = pay(state, ev.player, ev.payment);
  const use: PlayerActionUse = {
    action: def.id,
    round: state.turn.round,
    phase: state.turn.phase,
    seat: state.turn.activeSeat,
  };
  next = { ...next, used: { ...next.used, [ev.player]: [...(next.used?.[ev.player] ?? []), use] } };
  const target = ev.targetId ? next.units[ev.targetId] : undefined;
  for (const a of def.do ?? []) {
    if (!target) break;
    if (a.do === "applyStatus") next = setStatus(next, target.id, { [a.status]: true });
    if (a.do === "removeStatus") next = setStatus(next, target.id, { [a.status]: null });
    if (a.do === "setFlag") next = setStatus(next, target.id, { [a.flag]: a.value });
  }
  // Instead of an activation: the other side goes next (UX 263).
  return def.endsTurn ? endActivation(next) : next;
}

// ---------------------------------------------------------------------------
// Ability reminders
// ---------------------------------------------------------------------------

export interface AbilityReminder {
  unitId: UnitId;
  owner: PlayerId;
  ability: Ability;
  /** Set when a player has applied it this phase. */
  applied: boolean;
}

export const appliedKey = (ability: string) => `applied.${ability}`;

/** Abilities that only describe a weapon keyword the unit carries (BSData lists those as abilities). */
export function describesWeaponKeyword(system: GameSystem, unit: Unit, ability: Ability): boolean {
  const name = ability.name.trim().toLowerCase();
  for (const r of system.rules)
    if (
      r.match &&
      r.appliesTo?.includes("weapon") &&
      !r.appliesTo.includes("unit") &&
      pattern(r.match).test(name)
    )
      return true;
  const stem = name.replace(/[-\s]*(x|\d+\+?|d\d+)?$/i, "");
  return Object.values(unit.sheet?.weapons ?? {}).some((w) =>
    w.keywords.some((k) => k.toLowerCase().startsWith(stem)),
  );
}

/**
 * Whether the engine already handles the ability: the player automated it,
 * or it binds to a system rule that does something (not just a manual reminder).
 */
export function isAutomated(system: GameSystem, ability: Ability): boolean {
  if (ability.auto) return true;
  const text = `${ability.name} ${ability.text}`.trim();
  const refs = [...bindRules(system.rules, [text], "unit"), ...bindRules(system.rules, [text], "model")];
  return lookupRules(system, refs).some((b) =>
    b.def.effects.some((e) => e.do.some((a) => a.do !== "manual")),
  );
}

/** Abilities the players resolve themselves, without the weapon-keyword glossary entries. */
export function manualAbilities(system: GameSystem, unit: Unit): Ability[] {
  const seen = new Set<string>();
  return (unit.sheet?.abilities ?? []).filter((a) => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return !describesWeaponKeyword(system, unit, a) && !isAutomated(system, a);
  });
}

/** The timing entries an ability's text fits, first match per phase or attack role. */
function timingsOf(system: GameSystem, ability: Ability): AbilityTiming[] {
  const out: AbilityTiming[] = [];
  const keys = new Set<string>();
  for (const t of system.abilityTimings ?? []) {
    const key = t.attack ? `attack:${t.attack}` : `phase:${t.phase}`;
    if (keys.has(key)) continue;
    if (pattern(t.match).test(ability.text) || pattern(t.match).test(ability.name)) {
      keys.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Abilities whose text says they matter in the current phase, for both players. */
export function abilityReminders(state: GameState): AbilityReminder[] {
  const system = systemOf(state);
  const slot = currentSlot(state);
  const phase = state.turn.round === 0 ? "deployment" : slot?.id;
  if (!phase) return [];
  const out: AbilityReminder[] = [];
  for (const unit of Object.values(state.units)) {
    if (!isAlive(state, unit)) continue;
    const active = seatOf(state, unit.owner) === state.turn.activeSeat;
    for (const ability of manualAbilities(system, unit)) {
      const fits = timingsOf(system, ability).some(
        (t) =>
          t.phase === phase &&
          (state.turn.round === 0 || !t.side || t.side === "either" || (t.side === "active") === active),
      );
      if (fits)
        out.push({
          unitId: unit.id,
          owner: unit.owner,
          ability,
          applied: !!unit.status?.[appliedKey(ability.name)],
        });
    }
  }
  return out;
}

/** Abilities to remind players of during an attack, for the attacking and the attacked unit. */
export function attackReminders(
  state: GameState,
  attackerId: UnitId,
  targetId: UnitId,
  weaponKind: string,
): AbilityReminder[] {
  const system = systemOf(state);
  const out: AbilityReminder[] = [];
  for (const [id, role] of [
    [attackerId, "attacker"],
    [targetId, "defender"],
  ] as const) {
    const unit = state.units[id];
    if (!unit) continue;
    for (const ability of manualAbilities(system, unit))
      if (
        timingsOf(system, ability).some(
          (t) => t.attack === role && (!t.weaponKind || t.weaponKind === weaponKind),
        )
      )
        out.push({
          unitId: id,
          owner: unit.owner,
          ability,
          applied: !!unit.status?.[appliedKey(ability.name)],
        });
  }
  return out;
}
