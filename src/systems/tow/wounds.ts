import { unitGap } from "../../core/manoeuvre";
import type { Model, Unit, WeaponProfile } from "../../core/types";
import type { CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { shooterCount } from "./ranks";
import { parseDice } from "../../core/dice";
import { frenzied, hasRule, ruleNumber, troopOf } from "./specialRules";
import type { Roll } from "./combatKit";
import {
  alive,
  charNum,
  chargedFar,
  combatArc,
  combatHit,
  count,
  hitsOf,
  owner,
  pressOfBattle,
  stat,
  toWound,
} from "./combatKit";

/**
 * Hitting and wounding in the Old World (split from combat.ts, #70): weapons
 * and their special rules, supporting attacks, strike order, close combat
 * blows, shooting and removing casualties.
 */

/**
 * An attack's special rules (by name, from its weapon or its maker; our own
 * paraphrase, from the players' rules index, #66):
 *  - Poisoned Attacks: a natural 6 to hit adds 2 to that hit's roll to wound;
 *  - Killing Blow (combat): a natural 6 to wound against infantry or cavalry
 *    allows no armour or regeneration save, and slays the model outright;
 *    Monster Slayer does the same against monsters;
 *  - Flaming Attacks: a Flammable target gets no regeneration save;
 *  - Multiple Wounds (X): each unsaved wound costs X Wounds, rolled per wound,
 *    and none spill over to the next model.
 */
export interface Blow {
  /** Hits from natural 6s to hit with Poisoned Attacks: +2 to wound. */
  poisoned?: number;
  killingBlow?: boolean;
  monsterSlayer?: boolean;
  flaming?: boolean;
  /** Multiple Wounds' X: "2", "D3", "D3+1". */
  multiple?: string;
  /** Close combat: Killing Blow counts, and Parry or a two-handed weapon changes the armour. */
  combat?: boolean;
  /** The model struck (a challenge): its own Toughness and saves, and roll labels named after the two. */
  model?: { atk: string; def: Model };
  /** Out: wounds that each land on one model (Multiple Wounds' X; a slaying blow is Infinity). */
  slain?: number[];
}

const isInfantryOrCavalry = (troop: string) => /infantry|cavalry/i.test(troop);
const isMonster = (troop: string) => /behemoth|monstrous creature|^\s*monsters?\s*$/i.test(troop);
/** All its close combat weapons need two hands (so it fights without its shield). */
const twoHanded = (u: Unit) => {
  const ws = Object.values(u.sheet?.weapons ?? {}).filter((w) => w.kind !== "ranged");
  return ws.length > 0 && ws.every((w) => w.keywords.some((k) => /^requires two hands/i.test(k.trim())));
};

/** Roll X for each of `n` (Multiple Wounds (D3), Impact Hits (D6+1)): a number, or dice per one plus any bonus. */
export function* eachX(
  ctx: Ctx,
  n: number,
  x: string,
  label: string,
  unitId: string,
): Generator<Command, number[], unknown> {
  let d: ReturnType<typeof parseDice>;
  try {
    d = parseDice(x);
  } catch {
    return Array.from({ length: n }, () => 1);
  }
  if (!d.sides || !n) return Array.from({ length: n }, () => Math.max(0, d.bonus));
  const r = (yield ctx.roll(`${n * d.count}d${d.sides}`, label, unitId)) as Roll;
  return Array.from({ length: n }, (_, i) =>
    r.rolls.slice(i * d.count, (i + 1) * d.count).reduce((t, v) => t + v, d.bonus),
  );
}

/** To wound, then armour, ward and regeneration saves. Returns the unsaved wounds (those in `blow.slain` apart). */
export function* woundAndSave(
  ctx: Ctx,
  atk: Unit,
  def: Unit,
  hits: number,
  strength: number,
  ap = 0,
  /** Armour Bane (X): wounds from a natural 6 worsen the armour save by this much more. */
  bane = 0,
  blow: Blow = {},
): Generator<Command, number, unknown> {
  const view = ctx.view;
  const target = blow.model?.def;
  const own = (k: string, d: number) =>
    target ? charNum(target, k, stat(view, def, k, d)) : stat(view, def, k, d);
  const atkLabel = (l: string) => (blow.model ? `${blow.model.atk}: ${l}` : l);
  const defLabel = (l: string) => (blow.model ? `${target?.profile?.name ?? def.name}: ${l}` : l);
  const toughness = own("T", target ? 3 : 0);
  const woundOn = toWound(strength, toughness);
  const poisoned = Math.min(blow.poisoned ?? 0, hits);
  // Poisoned: +2 to wound, so even a roll the plain hits can't make.
  const poisonOn = 2 + toughness - strength <= 6 ? Math.max(2, 2 + toughness - strength) : null;
  if (woundOn === null && (!poisoned || poisonOn === null)) {
    yield ctx.note(`${atk.name} can't wound ${def.name}`);
    return 0;
  }
  const wounds: number[] = [];
  if (hits - poisoned > 0 && woundOn !== null) {
    const r = (yield ctx.roll(`${hits - poisoned}d6`, atkLabel("to wound"), atk.id, woundOn)) as Roll;
    wounds.push(...r.rolls.filter((x) => x !== 1 && x >= woundOn));
  }
  if (poisoned && poisonOn !== null) {
    const r = (yield ctx.roll(
      `${poisoned}d6`,
      atkLabel("to wound (Poisoned Attacks +2)"),
      atk.id,
      poisonOn,
    )) as Roll;
    wounds.push(...r.rolls.filter((x) => x !== 1 && x >= poisonOn));
  }
  const sixes = wounds.filter((x) => x === 6).length;
  const troop = target?.profile?.chars.Troop ?? troopOf(view.state, def);
  const slaying =
    blow.combat &&
    ((blow.killingBlow && isInfantryOrCavalry(troop)) || (blow.monsterSlayer && isMonster(troop)));
  // A slaying blow: no armour or regeneration save, and the model falls if the ward fails.
  let slain = slaying ? sixes : 0;
  if (slain) {
    const rule = blow.killingBlow && isInfantryOrCavalry(troop) ? "Killing Blow" : "Monster Slayer";
    const sixesText = slain === 1 ? "a 6 to wound" : `${slain} sixes to wound`;
    const victims = target ? (target.profile?.name ?? def.name) : slain === 1 ? "a model" : `${slain} models`;
    yield ctx.note(
      `${atk.name}: ${sixesText}, ${rule} slays ${victims} outright, no armour or regeneration save`,
    );
  }
  let left = wounds.length - slain;
  // Armour Bane: the wounds from natural 6s save on a worse armour roll, rolled apart.
  const baned = !slaying && bane > 0 ? sixes : 0;
  for (const [save, name] of [
    ["armour", "armour"],
    ["ward", "ward"],
    ["regen", "regeneration"],
  ] as const) {
    let raw = own(save, save === "armour" ? 7 : 0) + (save === "armour" ? ap : 0);
    if (save === "armour" && blow.combat) {
      // In combat a two-handed weapon leaves the shield aside; Parry (hand weapon and shield) improves it, to 3+ at best.
      const shield = hasRule(def, /^shield\b/i);
      if (shield && twoHanded(def)) raw += 1;
      else if (shield && hasRule(def, /^parry\b/i) && raw > 3) raw -= 1;
    }
    if (save === "regen" && blow.flaming && hasRule(def, /^flammable\b/i)) {
      if (left) yield ctx.note(`${def.name} is Flammable: no regeneration save against Flaming Attacks`);
      continue;
    }
    // An armour save of 1+ is still rolled (a natural 1 fails); a ward or regeneration of 0 is none.
    const on = save === "armour" && raw >= 1 ? Math.max(2, raw) : raw;
    if (save === "ward" && slain && on >= 2 && on <= 6) {
      const r = (yield ctx.roll(`${slain}d6`, defLabel(`${name} save (slaying blow)`), def.id, on)) as Roll;
      slain -= count(r, on);
    }
    if (save === "armour" && baned && left) {
      const worse = on + bane;
      const plain = left - baned;
      if (plain && on >= 2 && on <= 6) {
        const r = (yield ctx.roll(`${plain}d6`, defLabel(`${name} save`), def.id, on)) as Roll;
        left -= count(r, on);
      }
      if (worse >= 2 && worse <= 6) {
        const r = (yield ctx.roll(
          `${baned}d6`,
          defLabel(`${name} save (Armour Bane)`),
          def.id,
          worse,
        )) as Roll;
        left -= count(r, worse);
      }
      continue;
    }
    if (!left || on < 2 || on > 6) continue;
    const r = (yield ctx.roll(`${left}d6`, defLabel(`${name} save`), def.id, on)) as Roll;
    left -= count(r, on);
  }
  const out = blow.slain;
  const big: number[] = Array.from({ length: slain }, () => Infinity);
  if (blow.multiple && left) {
    const each = yield* eachX(
      ctx,
      left,
      blow.multiple,
      atkLabel(`Multiple Wounds (${blow.multiple})`),
      atk.id,
    );
    yield ctx.note(`Multiple Wounds: ${each.join(", ")} Wounds for each unsaved wound`);
    big.push(...each);
    left = 0;
  }
  if (!out) return left + big.reduce((t, v) => t + (Number.isFinite(v) ? v : stat(view, def, "W", 1)), 0);
  out.push(...big);
  return left;
}

/**
 * A close combat weapon's Strength from its S entry: "S" or "-" is the
 * wielder's own, "S+2" or "+2" adds to it, a bare number stands as it is.
 */
export function weaponStrength(base: number, s: string | undefined): number {
  const v = (s ?? "").trim();
  if (!v || v === "-" || /^s$/i.test(v)) return base;
  const plus = /^s?\s*([+-])\s*(\d+)$/i.exec(v);
  if (plus) return base + (plus[1] === "-" ? -1 : 1) * Number(plus[2]);
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : base;
}

/**
 * A weapon special rule's X, by name ("Armour Bane (2)" gives 2), or 0 when
 * the weapon hasn't the rule; the same names system.ts weaponRules binds.
 */
function weaponRuleValue(w: WeaponProfile | undefined, name: RegExp): number {
  for (const k of w?.keywords ?? []) {
    const m = new RegExp(`^${name.source}\\s*\\(?\\s*(\\d+)\\s*\\)?$`, "i").exec(k.trim());
    if (m) return Number(m[1]);
  }
  return 0;
}
const ARMOUR_BANE = /armou?r bane/;
const MULTIPLE_SHOTS = /multiple shots/;

/** A rule an attack has: its weapon's (by name) or its maker's own. */
const attackHas = (u: Unit, keys: string[], re: RegExp) =>
  keys.some((k) => re.test(k.trim())) || hasRule(u, re);

/** The special rules an attack carries, from its weapon's rules and its maker's (Blow). */
export function blowOf(u: Unit, keys: string[], combat: boolean): Blow {
  const multiple = [...keys, ...(u.sheet?.abilities ?? []).map((a) => a.name)]
    .map((k) => /^multiple wounds\s*\(\s*([^),]+?)\s*[),]/i.exec(k.trim())?.[1])
    .find(Boolean);
  return {
    combat,
    killingBlow: combat && attackHas(u, keys, /^killing blow\b/i),
    monsterSlayer: combat && attackHas(u, keys, /^monster slayer\b/i),
    flaming: attackHas(u, keys, /^flaming attacks\b/i),
    ...(multiple ? { multiple } : {}),
  };
}

/** Armour Bane (X) from the weapon, or the maker's own rule. */
const baneOf = (u: Unit, w: WeaponProfile | undefined) =>
  Math.max(weaponRuleValue(w, ARMOUR_BANE), ruleNumber(u, /^armou?r bane\b/i));

/** Poisoned Attacks: the weapon's or the maker's. */
export const poisonous = (u: Unit, keys: string[]) => attackHas(u, keys, /^poisoned attacks\b/i);

/** How many points a weapon's AP worsens armour saves by ("-2" or "2" is 2; "-" none). */
export const weaponAp = (w: WeaponProfile | undefined) => Math.abs(Number.parseFloat(w?.chars.AP ?? "") || 0);

/** A weapon whose bonus counts only on the turn its wielder charged ("charging only", "on the charge"). */
const chargeOnly = (w: WeaponProfile) =>
  [...(w.keywords ?? []), w.chars.Rules ?? "", w.chars.Notes ?? ""].some((k) => /charg/i.test(k));

/** The close combat weapons a model (or the unit's rank and file) carries. */
function meleeWeapons(u: Unit, model?: Model): WeaponProfile[] {
  const all = Object.values(u.sheet?.weapons ?? {}).filter((w) => w.kind !== "ranged");
  const own = model?.weapons?.length ? all.filter((w) => model.weapons!.includes(w.id)) : [];
  return own.length ? own : all;
}

/**
 * The weapon a unit (or a duelling model) fights with this round: the only one
 * it has, or the player's pick when its weapons differ. Its Strength and AP
 * count; a charging-only bonus only on the turn the unit charged.
 */
export function* fightingWeapon(
  ctx: Ctx,
  u: Unit,
  baseS: number,
  model?: Model,
): Generator<Command, { s: number; ap: number; bane: number; name: string; keys: string[] }, unknown> {
  const ws = meleeWeapons(u, model);
  const profile = (w: WeaponProfile) => {
    const bane = baneOf(u, w);
    const keys = w.keywords ?? [];
    if (chargeOnly(w) && u.status?.charged !== true) return { s: baseS, ap: 0, bane, name: w.name, keys };
    return { s: weaponStrength(baseS, w.chars.S), ap: weaponAp(w), bane, name: w.name, keys };
  };
  const options = ws.map(profile);
  const distinct = new Set(options.map((o) => `${o.s}/${o.ap}/${o.bane}/${o.keys.join()}`));
  if (!options.length) return { s: baseS, ap: 0, bane: baneOf(u, undefined), name: "", keys: [] };
  if (distinct.size === 1) return options[0]!;
  // Asked once a battle (PX #66): the answer stands until it's changed on the unit's card.
  const key = weaponKey(u, model);
  const kept = options.find((o) => o.name === ctx.view.own[key]);
  if (kept) return kept;
  const pick = (yield ctx.ask(
    owner(u),
    weaponQuestion(u, model),
    options.map((o, i) => ({ id: String(i), label: `${o.name} (S${o.s}${o.ap ? `, AP -${o.ap}` : ""})` })),
  )) as string;
  const chosen = options[Number(pick)] ?? options[0]!;
  yield ctx.set(key, chosen.name);
  return chosen;
}

/** Where the module keeps the weapon a unit (or one of its models, in a challenge) fights with. */
const weaponKey = (u: Unit, model?: { id: string }) => `weapon:${u.id}${model ? `:${model.id}` : ""}`;

/** "Which weapon do the Hammerers fight with?"; a character by name, "does Thane". */
function weaponQuestion(u: Unit, model?: Model): string {
  const who = model?.profile?.name ?? u.name;
  return model || u.modelIds.length === 1
    ? `Which weapon does ${who} fight with?`
    : `Which weapon do the ${who} fight with?`;
}

/** The weapon kept for this unit, when its weapons differ and one was picked. */
export function keptWeapon(view: GameView, u: Unit | undefined): string | null {
  if (!u) return null;
  const name = view.own[weaponKey(u)];
  return typeof name === "string" && meleeWeapons(u).some((w) => w.name === name) ? name : null;
}

/** Pick the unit's weapon again from its card; its next fight uses the new one. */
export const changeWeapon: CodeProcedure = function* (ctx, args) {
  const u = ctx.view.state.units[String(args.unit ?? "")];
  if (!u) return;
  const names = [...new Set(meleeWeapons(u).map((w) => w.name))];
  const pick = (yield ctx.ask(
    owner(u),
    weaponQuestion(u),
    names.map((n) => ({ id: n, label: n })),
  )) as string;
  const name = names.includes(pick) ? pick : names[0]!;
  yield ctx.set(weaponKey(u), name);
  // A model's own pick from a challenge goes too: the unit's new weapon stands for all.
  for (const id of u.modelIds)
    if (ctx.view.own[weaponKey(u, { id })]) yield ctx.set(weaponKey(u, { id }), null);
  yield ctx.note(`${u.name} will fight with ${name}`);
};

/**
 * Supporting attacks (tow.whfb.app, supporting attacks and how many attacks,
 * checked 2026-10-08): only models whose weapon or rules allow them (Fight in
 * Extra Rank, as spears have), standing in the rank or file directly behind
 * the fighting rank, one attack each (a model not in base contact makes one
 * attack whatever its Attacks); none against an enemy's flank or rear.
 */
export function supportingAttacks(
  view: GameView,
  atk: Unit,
  def: Unit,
  /** Ranks deep the fighting rank is (Press of Battle: two). */
  depth = 1,
): number {
  const state = view.state;
  if (atk.formation.kind !== "ranked") return 0;
  const extraRank = (n: string) => /fight in extra rank/i.test(n);
  const weapons = Object.values(atk.sheet?.weapons ?? {}).filter((w) => w.kind !== "ranged");
  if (!hasRule(atk, /fight in extra rank/i) && !weapons.some((w) => (w.keywords ?? []).some(extraRank)))
    return 0;
  // Not into the enemy's flank or rear.
  if ((combatArc(state, def, atk) ?? "front") !== "front") return 0;
  const models = alive(state, atk).length;
  const files = Math.min(atk.formation.files, models);
  // The rank behind a front (or rear) fighting rank; the file beside a flank one.
  const side = combatArc(state, atk, def);
  if (side === "left" || side === "right") return files > 1 ? Math.ceil(models / files) : 0;
  return Math.max(0, Math.min(files, models - files * depth));
}

/**
 * Initiative in combat: Strike First makes it 10, Strike Last 1 (the unit's
 * rule, or every close combat weapon it has); both cancel out.
 */
export function strikeOrder(u: Unit, initiative: number): number {
  const ws = Object.values(u.sheet?.weapons ?? {}).filter((w) => w.kind !== "ranged");
  const has = (re: RegExp) =>
    hasRule(u, re) || (ws.length > 0 && ws.every((w) => w.keywords.some((k) => re.test(k.trim()))));
  const first = has(/^strike first\b/i);
  const last = has(/^strike last\b/i);
  if (first && !last) return 10;
  if (last && !first) return 1;
  return initiative;
}

/**
 * One side's attacks against another: the front rank's Attacks plus the
 * supporting attacks (above), then to hit, to wound, armour, ward and
 * regeneration. Returns the unsaved wounds.
 */
export function* strike(
  ctx: Ctx,
  atk: Unit,
  def: Unit,
  how: { afraid?: boolean; hatred?: boolean } = {},
  duelling = 0,
): Generator<Command, { n: number; slain: number[] }, unknown> {
  const view = ctx.view;
  const state = view.state;
  const models = alive(state, atk).length;
  if (!models || !alive(state, def).length) return { n: 0, slain: [] };
  const files = atk.formation.kind === "ranked" ? Math.min(atk.formation.files, models) : models;
  // Press of Battle: two ranks fight, and the supporting rank is the one behind them.
  // Only when there is a second rank to fight (not a lone model or a single rank).
  const depth = pressOfBattle(state, atk) && models > files ? 2 : 1;
  const fighting = Math.min(models, files * depth);
  const support = supportingAttacks(view, atk, def, depth);
  // Frenzy and Furious Charge: +1 Attack in a turn it charged.
  const frenzy = frenzied(atk) && atk.status?.charged === true ? 1 : 0;
  const furious = hasRule(atk, /^furious charge\b/i) && chargedFar(view, atk) ? 1 : 0;
  // A model fighting a challenge strikes there, not at the unit.
  const attacks =
    Math.max(0, fighting - duelling) * (Math.max(1, stat(view, atk, "A", 1)) + frenzy + furious) + support;
  if (!attacks) return { n: 0, slain: [] };
  // Afraid (a failed Fear test): -1 to hit; a natural 6 still hits.
  const hitOn = Math.min(6, combatHit(stat(view, atk, "WS"), stat(view, def, "WS")) + (how.afraid ? 1 : 0));
  const label = `to hit${support ? ` (${support} supporting)` : ""}${depth > 1 ? " (Press of Battle: two ranks)" : ""}${frenzy ? " (Frenzy +1 Attack)" : ""}${furious ? " (Furious Charge +1 Attack)" : ""}${how.afraid ? " (afraid: -1 to hit)" : ""}`;
  const hit = (yield ctx.roll(`${attacks}d6`, label, atk.id, hitOn)) as Roll;
  let hits = hitsOf(hit, hitOn);
  let sixes = hit.rolls.filter((x) => x === 6).length;
  if (how.hatred && hits < attacks) {
    const again = (yield ctx.roll(`${attacks - hits}d6`, "to hit re-roll (Hatred)", atk.id, hitOn)) as Roll;
    hits += hitsOf(again, hitOn);
    sixes += again.rolls.filter((x) => x === 6).length;
  }
  if (!hits) return { n: 0, slain: [] };
  const weapon = yield* fightingWeapon(ctx, atk, stat(view, atk, "S"));
  if (weapon.name && (weapon.s !== stat(view, atk, "S") || weapon.ap))
    yield ctx.note(
      `${atk.name} fights with ${weapon.name} (S${weapon.s}${weapon.ap ? `, AP -${weapon.ap}` : ""})`,
    );
  const slain: number[] = [];
  const blow: Blow = {
    ...blowOf(atk, weapon.keys, true),
    poisoned: poisonous(atk, weapon.keys) ? sixes : 0,
    slain,
  };
  const n = yield* woundAndSave(ctx, atk, def, hits, weapon.s, weapon.ap, weapon.bane, blow);
  return { n, slain };
}

/**
 * Missile fire at one unit: the front rank of models carrying the unit's
 * first missile weapon. To hit is 7 - BS, worse by one per modifier
 * (`penalties`), and 7+ needs a 6 then a 4+, 5+ or 6+; 10+ can't hit.
 */
export function* shoot(
  ctx: Ctx,
  shooter: Unit,
  target: Unit,
  penalties: string[],
): Generator<Command, number, unknown> {
  const view = ctx.view;
  const state = view.state;
  const weapon = Object.values(shooter.sheet?.weapons ?? {}).find((w) => w.kind === "ranged");
  if (!weapon) return 0;
  const carriers = alive(state, shooter).filter((m) => (m.weapons ?? []).includes(weapon.id)).length;
  // The front rank, or two on a hill; no Volley Fire when standing and shooting.
  // Multiple Shots (X): X shots a model, at -1 to hit.
  const shots = weaponRuleValue(weapon, MULTIPLE_SHOTS);
  const dice = Math.min(carriers, shooterCount(state, shooter, { standAndShoot: true })) * Math.max(1, shots);
  if (!dice) return 0;
  const range = Number.parseFloat(weapon.chars.Range ?? "") || 0;
  const mods = penalties.map((p) => ({ p, by: 1 }));
  if (shots > 1) mods.push({ p: "multiple shots", by: 1 });
  if (range && unitGap(state, shooter, target) > range / 2) mods.push({ p: "long range", by: 1 });
  // Graded cover, as the Shooting phase has it: up to half the models seen in cover -1, more -2.
  // Large Targets get no cover.
  const share = hasRule(target, /^large target\b/i) ? 0 : coverShare(view, shooter, target);
  if (share > 0.5) mods.push({ p: "full cover", by: 2 });
  else if (share > 0) mods.push({ p: "partial cover", by: 1 });
  const need = 7 - stat(view, shooter, "BS") + mods.reduce((t, m) => t + m.by, 0);
  const why = mods.map((m) => m.p).join(", ");
  const label = `to hit${need >= 7 ? ` (6 then ${need - 3}+)` : ""}${why ? ` (${why})` : ""}`;
  if (need >= 10) {
    yield ctx.note(`${shooter.name} can't hit (${why})`);
    return 0;
  }
  const r = (yield ctx.roll(`${dice}d6`, label, shooter.id, Math.min(6, Math.max(2, need)))) as Roll;
  let hits = need <= 6 ? count(r, Math.max(2, need)) : r.rolls.filter((x) => x === 6).length;
  // Poisoned Attacks: natural 6s to hit wound more easily (not when 7+ was needed).
  const poisoned =
    need <= 6 && poisonous(shooter, weapon.keywords) ? r.rolls.filter((x) => x === 6).length : 0;
  if (need >= 7 && hits) {
    const f = (yield ctx.roll(`${hits}d6`, "then", shooter.id, need - 3)) as Roll;
    hits = count(f, need - 3);
  }
  if (!hits) return 0;
  const s = Number.parseFloat(weapon.chars.S ?? "") || stat(view, shooter, "S");
  const ap = Math.abs(Number.parseFloat(weapon.chars.AP ?? "") || 0);
  return yield* woundAndSave(ctx, shooter, target, hits, s, ap, baneOf(shooter, weapon), {
    ...blowOf(shooter, weapon.keywords, false),
    poisoned,
  });
}

/** Of the target's models the shooter sees, the share in cover (0 when it sees none, or at a real table). */
function coverShare(view: GameView, shooter: Unit, target: Unit): number {
  if (view.atTable) return view.inCover(shooter.id, target.id) ? 1 : 0;
  const seen = alive(view.state, target).filter((m) => view.visible(shooter.id, m.id));
  if (!seen.length) return view.inCover(shooter.id, target.id) ? 1 : 0;
  return seen.filter((m) => view.inCover(shooter.id, m.id)).length / seen.length;
}

/**
 * Casualties come off the rear rank: wounded models first, then rank and
 * file, the command group last. `slain` are wounds that each land on one
 * model and don't spill over (Multiple Wounds' X; Infinity, a slaying blow).
 * Returns the Wounds those cost.
 */
export function* casualties(
  ctx: Ctx,
  def: Unit,
  wounds: number,
  slain: number[] = [],
): Generator<Command, number, unknown> {
  const state = ctx.view.state;
  const models = alive(state, def);
  const names = new Map<string, number>();
  for (const m of models) names.set(m.profile?.name ?? "", (names.get(m.profile?.name ?? "") ?? 0) + 1);
  const common = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const order = models
    .map((m, i) => ({
      m,
      k: ((m.woundsLost ?? 0) > 0 ? 0 : 2) + (m.profile?.name === common ? 0 : 4) - i / (models.length + 1),
    }))
    .sort((a, b) => a.k - b.k)
    .map((x) => ({ m: x.m, w: Math.max(1, charNum(x.m, "W", 1)), lost: x.m.woundsLost ?? 0 }));
  let k = 0;
  /** `n` Wounds on the next model standing; what it took. */
  const land = (n: number) => {
    while (k < order.length && order[k]!.lost >= order[k]!.w) k++;
    const slot = order[k];
    if (!slot) return 0;
    const take = Math.min(n, slot.w - slot.lost);
    slot.lost += take;
    return take;
  };
  for (let left = wounds; left > 0;) {
    const took = land(left);
    if (!took) break;
    left -= took;
  }
  let cost = 0;
  for (const n of slain) cost += land(n);
  for (const slot of order)
    if (slot.lost !== (slot.m.woundsLost ?? 0))
      yield ctx.emit({
        type: "model/wounds",
        id: slot.m.id,
        woundsLost: slot.lost,
        destroyed: slot.lost >= slot.w,
      });
  return cost;
}
