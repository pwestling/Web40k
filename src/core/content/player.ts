import { woundsRemaining } from "../attack";
import { isAlive } from "../units";
import type { Ability, ArmyStratagem, GameState, PlayerActionUse, PlayerId, Unit, UnitId } from "../types";
import { bool } from "./expr";
import { actingUnits, costLabel, evalCtx, pay, payFor, safeBool, setStatus, type Payment } from "./play";
import { bindRules, hasKeywordPhrase, lookupRules, pattern, unitView } from "./runtime";
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
    limit: { count: 1, per: s.once ?? "phase" },
    ...(s.targetsUnit ? { target: { filter: { same: ["it.owner", "player.id"] } } } : {}),
    // On the unit for the phase: it runs when automated, and is a reminder on its attacks when not (UX 370).
    ...(s.targetsUnit ? { do: [{ do: "applyStatus", status: `strat.${s.id}` }] } : {}),
    ...(s.effect || s.text ? { hint: s.effect ?? s.text } : {}),
  };
}

/** The player actions a player has: the system's, then their army's own stratagems. */
function playerActionDefs(state: GameState, player: PlayerId): ActionDef[] {
  const own = (state.armies?.[player]?.stratagems ?? []).map((s) => armyAction(player, s));
  return [...systemOf(state).actions.filter((a) => a.by === "player"), ...own];
}

/** The faction stratagem behind an action id, if it is one. */
export function armyStratagem(state: GameState, id: string): ArmyStratagem | undefined {
  const army = ARMY.exec(id);
  return army ? state.armies?.[army[1]!]?.stratagems.find((x) => x.id === army[2]) : undefined;
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
      const army = armyStratagem(state, def.id);
      option.targets = Object.values(state.units)
        .filter((u) => {
          const it = unitView(state, system, u);
          if (
            army?.targetKeywords &&
            !army.targetKeywords.split(/\s+or\s+/i).some((k) => hasKeywordPhrase(u, k))
          )
            return false;
          if (army?.notYet && u.status?.[army.notYet]) return false;
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
  /** A core rule of the system (`ruleReminders`), not one of the unit's own abilities. */
  rule?: true;
}

export const appliedKey = (ability: string) => `applied.${ability}`;

/** A weapon keyword's glossary entry ("Lethal Hits"), listed as a rule by BSData. */
export function isWeaponRule(system: GameSystem, ability: Ability): boolean {
  const name = ability.name.trim().toLowerCase();
  return system.rules.some(
    (r) =>
      r.match &&
      r.appliesTo?.includes("weapon") &&
      !r.appliesTo.includes("unit") &&
      pattern(r.match).test(name),
  );
}

/** Abilities that only describe a weapon keyword the unit carries (BSData lists those as abilities). */
export function describesWeaponKeyword(system: GameSystem, unit: Unit, ability: Ability): boolean {
  const name = ability.name.trim().toLowerCase();
  if (isWeaponRule(system, ability)) return true;
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
    const key = t.attack ? `attack:${t.attack}` : t.on ? `on:${t.on}:${t.phase}` : `phase:${t.phase}`;
    if (keys.has(key)) continue;
    // Armies imported before no-break spaces were made plain still have them.
    const text = ability.text.replace(/\u00a0/g, " ");
    if (pattern(t.match).test(text) || pattern(t.match).test(ability.name)) {
      keys.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Whether a unit is at the moment a timing names: activated, after a move in its activation, or reacting. */
function atMoment(unit: Unit, on: NonNullable<AbilityTiming["on"]>): boolean {
  const s = unit.status ?? {};
  if (on === "reaction") return !!s.reacting;
  if (on === "move") return !!s.acting && Number(s.moves ?? 0) > 0;
  return !!s.acting && !s.reacting;
}

/** Whether a timing's (or rule reminder's) `if` holds for the unit; one that can't be judged holds. */
function holdsFor(state: GameState, unit: Unit, cond: AbilityTiming["if"], other?: UnitId): boolean {
  if (cond === undefined) return true;
  const system = systemOf(state);
  const target = other ? state.units[other] : undefined;
  const ctx = evalCtx(state, system, {
    self: unitView(state, system, unit),
    ...(target ? { target: unitView(state, system, target) } : {}),
  });
  try {
    return bool(cond, ctx);
  } catch {
    return true;
  }
}

/**
 * Abilities whose text says they matter now, for both players: in the
 * current phase, or (timings with `on`) for the unit activated, moving or
 * reacting.
 */
export function abilityReminders(state: GameState): AbilityReminder[] {
  const system = systemOf(state);
  const slot = currentSlot(state);
  const phase = state.turn.round === 0 ? "deployment" : slot?.id;
  if (!phase) return [];
  const out: AbilityReminder[] = [];
  for (const unit of Object.values(state.units)) {
    if (!isAlive(state, unit)) continue;
    const active = seatOf(state, unit.owner) === state.turn.activeSeat;
    const sideFits = (side: AbilityTiming["side"]) =>
      state.turn.round === 0 || !side || side === "either" || (side === "active") === active;
    // The system's own rules that matter for this unit now (a Transport, a unit in reserves).
    for (const r of system.ruleReminders ?? [])
      if (r.phase === phase && sideFits(r.side) && holdsFor(state, unit, r.if))
        out.push({
          unitId: unit.id,
          owner: unit.owner,
          ability: { name: r.name, text: r.text },
          applied: !!unit.status?.[appliedKey(r.name)],
          rule: true,
        });
    for (const ability of manualAbilities(system, unit)) {
      if (!damagedFits(state, unit, ability)) continue;
      const fits = timingsOf(system, ability).some(
        (t) =>
          (t.on
            ? !t.attack && (!t.phase || t.phase === phase) && atMoment(unit, t.on)
            : t.phase === phase && sideFits(t.side)) && holdsFor(state, unit, t.if),
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

/**
 * "Damaged: 1-4 Wounds Remaining" only matters once a model is that hurt; a
 * fresh Dreadnought shouldn't remind anyone of it on every attack (dogfood).
 */
function damagedFits(state: GameState, unit: Unit, ability: Ability): boolean {
  const m = /^damaged:\s*(\d+)\s*[-–]\s*(\d+)\s*wounds?\b/i.exec(ability.name);
  if (!m) return true;
  const [lo, hi] = [Number(m[1]), Number(m[2])];
  return unit.modelIds.some((id) => {
    const model = state.models[id];
    if (!model || model.destroyed) return false;
    const w = woundsRemaining(model);
    return w >= lo && w <= hi;
  });
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
        damagedFits(state, unit, ability) &&
        timingsOf(system, ability).some(
          (t) =>
            t.attack === role &&
            (!t.weaponKind || t.weaponKind === weaponKind) &&
            holdsFor(state, unit, t.if, role === "attacker" ? targetId : attackerId),
        )
      )
        out.push({
          unitId: id,
          owner: unit.owner,
          ability,
          applied: !!unit.status?.[appliedKey(ability.name)],
        });
    // A faction stratagem used on it that the app doesn't run: its effect, to play by hand.
    for (const s of state.armies?.[unit.owner]?.stratagems ?? [])
      if (!s.auto && unit.status?.[`strat.${s.id}`])
        out.push({
          unitId: id,
          owner: unit.owner,
          ability: { name: s.name, text: s.effect ?? s.text },
          applied: !!unit.status?.[appliedKey(s.name)],
        });
  }
  return out;
}
