import { awayFrom, fleeMove, unitCentre, unitGap } from "../../core/manoeuvre";
import { arcOf, blockCentre, blockFrame, blockModels, inArc, rankCount, type Arc } from "../../core/regiment";
import type { GameState, Model, Unit, WeaponProfile } from "../../core/types";
import type { CodeAction, CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { towRanks } from "./troops";
import { shooterCount } from "./ranks";
import { opposed } from "../../core/teams";
import { parseDice } from "../../core/dice";
import {
  causesFear,
  causesTerror,
  frenzied,
  hasBattleStandard,
  hasRule,
  hatesFoe,
  randomMovement,
  immune,
  isGeneral,
  ruleNumber,
  stubborn,
  troopOf,
  unbreakable,
} from "./specialRules";

/**
 * Close combat, charge reactions, break tests and Panic for rank-and-flank
 * play, as code procedures (the game modules spec, step 3). Units that flee,
 * fall back or give ground are moved straight away from the enemy; pursuit
 * and the charge move itself stay on the Charge panel.
 *
 * Checked against the community rules index (tow.whfb.app, 2026-10-07): the
 * Weapon Skill chart, charging Initiative, combat result bonuses, the three
 * break test outcomes, Panic, flee and fall back rolls, restraint, Stand &
 * Shoot (range and -1 to hit) and the shooting to-hit modifiers; combat order
 * (+1 at Unit Strength 10+), the high ground (+1 for a fighting rank standing
 * higher), Stubborn (the first break test falls back in good order) and
 * Unbreakable (no break test, it gives ground) (#40). Supporting attacks
 * come from Fight in Extra Rank only (supportingAttacks). Every result is advisory and lands in the log.
 *
 * Psychology (roadmap #32), by special rule name, from general knowledge of
 * the game and unverified: the General's Leadership within 12" (Inspiring
 * Presence) and a re-roll of failed Leadership tests within 12" of the Battle
 * Standard; Fear (a test to charge a Fear-causing enemy, and in combat a
 * failed test means hitting only on 6s); Terror (charged by it: a test, and
 * fleeing on a fail); Frenzy (+1 Attack, no restraint, lost on losing a
 * combat); Hatred (re-roll misses the first time it fights a foe, no
 * restraint); Immune to Psychology (no Panic, Fear or Terror tests, and it
 * can't flee from a charge). Stupidity is tested at the start of the turn
 * (psychology.ts).
 */

type Roll = { rolls: number[]; total: number };

const FLEE_DICE = "2d6";
/** Falling back in good order: 2D6, discarding the lowest. */
const FALL_BACK_DICE = "2d6";
/** Giving ground: straight back this far. */
const GIVE_GROUND = 2;
/** Pursuit distance. */
const PURSUE_DICE = "2d6";

export function unitOf(view: GameView, id: unknown): Unit {
  const u = view.state.units[String(id)];
  if (!u) throw new Error(`No unit "${String(id)}"`);
  return u;
}

export const alive = (state: GameState, u: Unit) => blockModels(state, u);
export const charNum = (m: Model | undefined, k: string, d = 0) => {
  const v = Number.parseFloat(m?.profile?.chars[k] ?? "");
  return Number.isFinite(v) ? v : d;
};

/** The unit's characteristic as its commonest profile has it (from the unit view). */
function stat(view: GameView, u: Unit, id: string, d = 0): number {
  const v = (view.unit(u.id) as Record<string, unknown> | undefined)?.[id];
  return typeof v === "number" ? v : d;
}

/** A unit's Movement in inches; a random Movement ("2D6+1") counts as its average roll. */
function moveOf(view: GameView, u: Unit): number {
  const r = randomMovement(view.state, u);
  return r ? r.count * ((r.sides + 1) / 2) + r.bonus : stat(view, u, "M");
}

/** How far the General's Leadership and the Battle Standard's re-roll reach. */
const AURA = 12;

/** Friendly units (this one included) still standing and not fleeing within the aura, matching `is`. */
function friendNear(state: GameState, u: Unit, is: (f: Unit) => boolean): Unit | undefined {
  return Object.values(state.units).find(
    (f) =>
      !opposed(state, f.owner, u.owner) &&
      !f.status?.fleeing &&
      alive(state, f).length > 0 &&
      is(f) &&
      (f.id === u.id || unitGap(state, u, f) <= AURA),
  );
}

/** The best Leadership among the unit's own models (a character or champion lends theirs). */
function ownLeadership(state: GameState, u: Unit): { ld: number; who: string } {
  let best = { ld: 0, who: "" };
  for (const m of alive(state, u)) {
    const ld = charNum(m, "Ld");
    if (ld > best.ld) best = { ld, who: m.profile?.name ?? "" };
  }
  return best;
}

/**
 * Leadership: the best in the unit, or the General's within 12" when it's
 * higher (Inspiring Presence), and whose it is.
 */
function leadership(state: GameState, u: Unit, warband = true): { ld: number; who: string } {
  const own = ownLeadership(state, u);
  const general = friendNear(state, u, isGeneral);
  let best = own;
  if (general && general.id !== u.id) {
    const g = ownLeadership(state, general);
    if (g.ld > own.ld) best = { ld: g.ld, who: `the General's, ${general.name}` };
  }
  // Warband: its rank bonus on its Leadership, up to 10, unless fleeing (not for restraint tests).
  const ranks = warband && !u.status?.fleeing && hasRule(u, /^warband\b/i) ? rankBonus(state, u) : 0;
  if (ranks && own.ld + ranks > best.ld)
    return { ld: Math.min(10, own.ld + ranks), who: `${own.who ? `${own.who}, ` : ""}Warband +${ranks}` };
  return best;
}

/** "Ld 9, Warden Captain" when a model other than the rank and file lends its Leadership. */
function ldLabel(state: GameState, u: Unit, warband = true): string {
  const { ld, who } = leadership(state, u, warband);
  return who && who !== u.name ? `Ld ${ld}, ${who}` : `Ld ${ld}`;
}

/** Disrupted (a status now; once a formation order): no rank bonus, no combat order. */
const disrupted = (u: Unit) =>
  u.status?.disrupted === true || (u.formation.kind === "ranked" && u.formation.order === "disrupted");

function rankBonus(state: GameState, u: Unit): number {
  if (disrupted(u)) return 0;
  const ranks = rankCount(state, u, towRanks(state, u).width);
  return Math.min(Math.max(0, ranks - 1), towRanks(state, u).maxBonus);
}

/**
 * Combat order: a close-order block at least as wide as it is deep. With Unit
 * Strength 10 or more it adds +1 to the combat result (rules index).
 */
function combatOrder(state: GameState, u: Unit): boolean {
  if (u.formation.kind !== "ranked" || disrupted(u)) return false;
  const order = u.formation.order ?? "close";
  if (order !== "close") return false;
  const files = u.formation.files;
  return files >= Math.ceil(alive(state, u).length / Math.max(1, files));
}

/** How much higher one fighting rank must stand to hold the high ground, in inches. */
const HIGH_GROUND = 0.5;

/** The average height of a block's front rank (models stand at their floor's height). */
function frontHeight(state: GameState, u: Unit): number {
  const ms = alive(state, u);
  const files = u.formation.kind === "ranked" ? u.formation.files : ms.length;
  const front = ms.slice(0, Math.max(1, files));
  return front.reduce((t, m) => t + (m.z ?? 0), 0) / Math.max(1, front.length);
}

const hasStandard = (state: GameState, u: Unit) =>
  alive(state, u).some((m) => /standard|banner/i.test(m.profile?.name ?? ""));

const owner = (u: Unit) => u.owner;

/** The Weapon Skill chart: rows the attacker's WS 1-10, columns the target's. */
const WS_CHART = [
  [4, 4, 5, 5, 5, 5, 5, 5, 5, 5],
  [3, 4, 4, 4, 5, 5, 5, 5, 5, 5],
  [2, 3, 4, 4, 4, 4, 5, 5, 5, 5],
  [2, 3, 3, 4, 4, 4, 4, 4, 5, 5],
  [2, 2, 3, 3, 4, 4, 4, 4, 4, 4],
  [2, 2, 3, 3, 3, 4, 4, 4, 4, 4],
  [2, 2, 2, 3, 3, 3, 4, 4, 4, 4],
  [2, 2, 2, 3, 3, 3, 3, 4, 4, 4],
  [2, 2, 2, 2, 3, 3, 3, 3, 4, 4],
  [2, 2, 2, 2, 3, 3, 3, 3, 3, 4],
];

/** To hit in combat, from the Weapon Skill chart. */
export function combatHit(ws: number, enemyWs: number): number {
  const clamp = (x: number) => Math.min(10, Math.max(1, Math.round(x || 1)));
  return WS_CHART.at(clamp(ws) - 1)!.at(clamp(enemyWs) - 1)!;
}

/** To wound: 4+ at equal Strength and Toughness, a step per point between; none at 4 or more short. */
export function toWound(s: number, t: number): number | null {
  if (t - s >= 4) return null;
  return Math.min(6, Math.max(2, 4 + t - s));
}

/**
 * A count with its noun, for the log ("1 wound", "3 wounds"). Log notes are
 * part of the game record every player replays, so they stay in English
 * rather than going through the viewer's tn().
 */
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const count = (r: Roll, target: number) => r.rolls.filter((x) => x !== 1 && x >= target).length;
/** To hit: a natural 6 always hits, a natural 1 always misses. */
const hitsOf = (r: Roll, target: number) => r.rolls.filter((x) => x === 6 || (x !== 1 && x >= target)).length;

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
interface Blow {
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
function* eachX(
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
function blowOf(u: Unit, keys: string[], combat: boolean): Blow {
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
const poisonous = (u: Unit, keys: string[]) => attackHas(u, keys, /^poisoned attacks\b/i);

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
function* fightingWeapon(
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
  const who = model?.profile?.name ?? u.name;
  const pick = (yield ctx.ask(
    owner(u),
    `Which weapon does ${who} fight with?`,
    options.map((o, i) => ({ id: String(i), label: `${o.name} (S${o.s}${o.ap ? `, AP -${o.ap}` : ""})` })),
  )) as string;
  return options[Number(pick)] ?? options[0]!;
}

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
function strikeOrder(u: Unit, initiative: number): number {
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
 * The side of `target` that `from` fights in a combat: the arc its front lies
 * in (inArc), except that a unit facing the target head on (within 45
 * degrees) whose body stands in the target's front arc fights the front. A
 * big base (a chariot, a monster) whose front edge reaches past the target's
 * front corner, or that was pushed into the block by hand, has its front
 * point in a flank or rear arc while it plainly faces the front (PX #66).
 */
export function combatArc(state: GameState, target: Unit, from: Unit): Arc | null {
  const arc = inArc(state, target, from);
  const frame = blockFrame(state, target);
  if (!frame || arc === "front" || !arc) return arc;
  const own = blockFrame(state, from);
  const ms = alive(state, from);
  if (!ms.length) return arc;
  const facing = own?.facing ?? ms[0]!.facing;
  const turn = Math.abs(
    Math.atan2(Math.sin(facing - frame.facing - Math.PI), Math.cos(facing - frame.facing - Math.PI)),
  );
  if (turn > Math.PI / 4) return arc;
  const centre = own
    ? blockCentre(own)
    : {
        x: ms.reduce((t, m) => t + m.position.x, 0) / ms.length,
        y: ms.reduce((t, m) => t + m.position.y, 0) / ms.length,
      };
  return arcOf(frame, centre) === "front" ? "front" : arc;
}

/** Charged this turn, moving 3" or more (Furious Charge, Impact Hits). */
function chargedFar(view: GameView, u: Unit): boolean {
  const c = view.own[`charge:${u.id}`] as ChargeRecord | undefined;
  return u.status?.charged === true && !!c && c.round === view.round && c.distance >= 3;
}

/**
 * Press of Battle: a unit in combat order that didn't charge this turn fights
 * two ranks deep.
 */
const pressOfBattle = (state: GameState, u: Unit) =>
  hasRule(u, /^press of battle\b/i) && u.status?.charged !== true && combatOrder(state, u);

/** Unit Strength: each model standing counts its own (Fear compares them). */
const unitStrength = (state: GameState, u: Unit) =>
  alive(state, u).reduce((t, m) => t + Math.max(1, charNum(m, "US", 1)), 0);

/**
 * Whether `foe` frightens `u`: it causes Fear (or has Flaming Attacks and `u`
 * is war beasts or a swarm) and has the higher Unit Strength; units that cause
 * Fear, and units immune to psychology, aren't afraid.
 */
function frightens(state: GameState, foe: Unit, u: Unit): boolean {
  const scary =
    causesFear(foe) || (hasRule(foe, /^flaming attacks\b/i) && /war beast|swarm/i.test(troopOf(state, u)));
  return scary && !causesFear(u) && !immune(u) && unitStrength(state, foe) > unitStrength(state, u);
}

/**
 * One side's attacks against another: the front rank's Attacks plus the
 * supporting attacks (above), then to hit, to wound, armour, ward and
 * regeneration. Returns the unsaved wounds.
 */
function* strike(
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
function* shoot(
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

/** The nearest enemy unit still standing and not fleeing, to run from. */
function nearestEnemy(state: GameState, u: Unit): Unit | undefined {
  let best: { e: Unit; d: number } | undefined;
  for (const e of Object.values(state.units)) {
    if (!opposed(state, e.owner, u.owner) || e.status?.fleeing || !alive(state, e).length) continue;
    const d = unitGap(state, u, e);
    if (!best || d < best.d) best = { e, d };
  }
  return best?.e;
}

/** Move a unit straight away from `from` by `inches`: turning to run (flee, fall back) or backing off (give ground). */
function* moveAway(ctx: Ctx, u: Unit, from: Unit | undefined, inches: number, turn: boolean) {
  const state = ctx.view.state;
  if (!from || inches <= 0) return;
  const away = awayFrom(state, u, unitCentre(state, from));
  const move = fleeMove(state, u, away, inches);
  if (move) yield ctx.emit(turn ? move : { ...move, turn: 0, how: "drag" });
}

/** Swiftstride: a flee or pursuit roll with +D6 (always taken: further is what the unit wants). */
const swift = (u: Unit) => hasRule(u, /^swiftstride\b/i);
function* swiftRoll(ctx: Ctx, u: Unit, dice: string, label: string): Generator<Command, Roll, unknown> {
  const r = (yield ctx.roll(dice, label, u.id)) as Roll;
  if (!swift(u)) return r;
  const more = (yield ctx.roll("1d6", `${label}: Swiftstride +D6`, u.id)) as Roll;
  return { rolls: r.rolls, total: r.total + more.total };
}

/** The unit flees 2D6" from `from` and is marked fleeing. */
function* flee(ctx: Ctx, u: Unit, from: Unit | undefined, why: string): Generator<Command, void, unknown> {
  const r = yield* swiftRoll(ctx, u, FLEE_DICE, "flee roll");
  yield ctx.emit({ type: "unit/status", id: u.id, key: "fleeing", value: true });
  yield* moveAway(ctx, unitOf(ctx.view, u.id), from, r.total, true);
  yield ctx.note(`${u.name} ${why} and flees ${r.total}"`);
}

/** Falls back in good order: moves like a fleeing unit (2D6, lowest discarded), then rallies at once. */
function* fallBack(
  ctx: Ctx,
  u: Unit,
  from: Unit | undefined,
  why: string,
): Generator<Command, void, unknown> {
  const r = (yield ctx.roll(FALL_BACK_DICE, "fall back roll", u.id)) as Roll;
  const inches = Math.max(...r.rolls);
  yield* moveAway(ctx, unitOf(ctx.view, u.id), from, inches, true);
  yield ctx.note(`${u.name} ${why} and falls back in good order ${inches}" (it rallies at the end)`);
}

/**
 * Leadership test: 2D6 (plus `mod`) equal to or under Leadership; a double 1
 * always passes. A unit within 12" of its Battle Standard re-rolls a fail once.
 */
export function* leadershipTest(
  ctx: Ctx,
  u: Unit,
  name: string,
  mod = 0,
  why = "",
): Generator<Command, { roll: Roll; ld: number; score: string; passed: boolean }, unknown> {
  const state = ctx.view.state;
  const warband = name !== "restraint test";
  const { ld } = leadership(state, u, warband);
  // "Reaver Warband break test: 2D6 + 8 (lost by 8) against Ld 6, Reaver Chief"
  yield ctx.note(
    `${u.name} ${name}: 2D6${mod ? ` + ${mod}${why ? ` (${why})` : ""}` : ""} against ${ldLabel(state, u, warband)}`,
  );
  const failed = (r: Roll) => !r.rolls.every((x) => x === 1) && r.total + mod > ld;
  let roll = (yield ctx.roll("2d6", name, u.id)) as Roll;
  const bsb = failed(roll) ? friendNear(state, u, (f) => hasBattleStandard(state, f)) : undefined;
  if (bsb) {
    yield ctx.note(
      `${u.name} re-rolls its ${name} (rolled ${roll.total}): ${bsb.id === u.id ? "it carries" : `${bsb.name} is within ${AURA}" with`} the Battle Standard`,
    );
    roll = (yield ctx.roll("2d6", `${name} re-roll`, u.id)) as Roll;
  }
  const score = mod ? `${roll.total} + ${mod} = ${roll.total + mod}` : `${roll.total}`;
  return { roll, ld, score, passed: !failed(roll) };
}

/** The charge declared for a unit (chargeReaction records it): the gap to the target and the arc. */
interface ChargeRecord {
  target: string;
  distance: number;
  arc: string | null;
  round: number;
}

/** When a unit fought this phase, and the result line. */
interface Fought {
  round: number;
  seat: number;
  phase: string | null;
  against: string;
  result: string;
}

/**
 * A charging unit's Initiative bonus: +1 per full inch moved before contact,
 * up to +3 into the front arc or +4 into a flank or rear.
 */
function chargeBonus(view: GameView, u: Unit): number {
  const c = view.own[`charge:${u.id}`] as ChargeRecord | undefined;
  if (!c || c.round !== view.round || u.status?.charged !== true) return 0;
  return Math.min(Math.floor(c.distance), c.arc === "front" || !c.arc ? 3 : 4);
}

/** This unit's fight this phase, if it had one. */
function foughtNow(view: GameView, unitId: string): Fought | undefined {
  const f = view.own[`fought:${unitId}`] as Fought | undefined;
  const now = view.state.turn;
  return f && f.round === now.round && f.seat === now.activeSeat && f.phase === view.phase ? f : undefined;
}

/**
 * Everyone in a fight: the two named units, then every unit (not fleeing) in
 * base contact with an enemy already in it, spreading outwards. Each side
 * starts with its named unit.
 */
function combatSides(state: GameState, a: Unit, b: Unit): [Unit[], Unit[]] {
  const sides: [Unit[], Unit[]] = [[a], [b]];
  const side = new Map<string, 0 | 1>([
    [a.id, 0],
    [b.id, 1],
  ]);
  const queue = [a, b];
  while (queue.length) {
    const u = queue.shift()!;
    const other = side.get(u.id) === 0 ? 1 : 0;
    for (const e of Object.values(state.units)) {
      if (side.has(e.id) || !opposed(state, e.owner, u.owner) || e.status?.fleeing) continue;
      if (!alive(state, e).length || unitGap(state, u, e) > CONTACT) continue;
      side.set(e.id, other);
      sides[other].push(e);
      queue.push(e);
    }
  }
  return sides;
}

/** Who a unit fights: the named foe, else the nearest enemy in the fight it touches. */
function foeOf(state: GameState, u: Unit, enemies: Unit[], named: Unit): Unit {
  if (named && unitGap(state, u, named) <= CONTACT) return named;
  return enemies.map((e) => ({ e, d: unitGap(state, u, e) })).sort((x, y) => x.d - y.d)[0]!.e;
}

/** A challenge between two models, kept until one falls or the fight ends. */
interface Duel {
  model: string;
  foe: string;
  foeUnit: string;
}

/** Models that may fight a challenge: characters and champions, not the rank and file or musicians and standard bearers. */
function duellists(state: GameState, u: Unit): Model[] {
  const ms = alive(state, u);
  if (ms.length < 2) return [];
  const names = new Map<string, number>();
  for (const m of ms) names.set(m.profile?.name ?? "", (names.get(m.profile?.name ?? "") ?? 0) + 1);
  const common = [...names.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return ms.filter((m) => {
    const name = m.profile?.name ?? "";
    if (name === common) return false;
    return !/drummer|musician|horn|^standard bearer|banner rider/i.test(name);
  });
}

/** The duel this unit is in, if both models still stand. */
function duelOf(view: GameView, u: Unit): Duel | null {
  const d = view.own[`duel:${u.id}`] as Duel | null | undefined;
  if (!d) return null;
  const m = view.state.models[d.model];
  const f = view.state.models[d.foe];
  return m && !m.destroyed && f && !f.destroyed ? d : null;
}

/** A character's blows in a challenge: Attacks, to hit, to wound and its saves. Returns wounds caused. */
function* duelStrike(
  ctx: Ctx,
  atkUnit: Unit,
  atk: Model,
  defUnit: Unit,
  def: Model,
): Generator<Command, number, unknown> {
  const name = atk.profile?.name ?? atkUnit.name;
  const hitOn = combatHit(charNum(atk, "WS", 3), charNum(def, "WS", 3));
  const hit = (yield ctx.roll(
    `${Math.max(1, charNum(atk, "A", 1))}d6`,
    `${name}: to hit`,
    atkUnit.id,
    hitOn,
  )) as Roll;
  const hits = hitsOf(hit, hitOn);
  if (!hits) return 0;
  const weapon = yield* fightingWeapon(ctx, atkUnit, charNum(atk, "S", 3), atk);
  const slain: number[] = [];
  const blow: Blow = {
    ...blowOf(atkUnit, weapon.keys, true),
    poisoned: poisonous(atkUnit, weapon.keys) ? hit.rolls.filter((x) => x === 6).length : 0,
    model: { atk: name, def },
    slain,
  };
  const left = yield* woundAndSave(ctx, atkUnit, defUnit, hits, weapon.s, weapon.ap, weapon.bane, blow);
  // A slaying blow takes every Wound the model has left; Multiple Wounds count in full (overkill).
  const had = Math.max(1, charNum(def, "W", 1)) - (def.woundsLost ?? 0);
  return left + slain.reduce((t, n) => t + (Number.isFinite(n) ? n : had), 0);
}

/**
 * The challenge's round: the two models strike in Initiative order (together
 * when equal). Wounds count towards the combat result, and so does overkill:
 * wounds beyond what the loser had left, up to +5.
 */
function* fightDuel(ctx: Ctx, duel: Duel, unit: Unit): Generator<Command, Map<string, number>, unknown> {
  const caused = new Map<string, number>();
  const state = ctx.view.state;
  const pair = [
    { u: unit, m: state.models[duel.model]! },
    { u: unitOf(ctx.view, duel.foeUnit), m: state.models[duel.foe]! },
  ];
  yield ctx.note(
    `Challenge: ${pair[0]!.m.profile?.name} (${pair[0]!.u.name}) fights ${pair[1]!.m.profile?.name} (${pair[1]!.u.name})`,
  );
  const ini = (x: (typeof pair)[number]) => strikeOrder(x.u, charNum(x.m, "I", 1));
  const order =
    ini(pair[0]!) === ini(pair[1]!)
      ? [pair]
      : ini(pair[0]!) > ini(pair[1]!)
        ? [[pair[0]!], [pair[1]!]]
        : [[pair[1]!], [pair[0]!]];
  const lost = new Map<string, number>();
  for (const step of order) {
    const blows: [(typeof pair)[number], number][] = [];
    for (const x of step) {
      const other = x === pair[0] ? pair[1]! : pair[0]!;
      const me = ctx.view.state.models[x.m.id];
      if (!me || me.destroyed) continue;
      blows.push([other, yield* duelStrike(ctx, x.u, x.m, other.u, ctx.view.state.models[other.m.id]!)]);
    }
    for (const [target, n] of blows) {
      if (!n) continue;
      const m = ctx.view.state.models[target.m.id]!;
      const w = Math.max(1, charNum(m, "W", 1));
      const had = w - (m.woundsLost ?? 0);
      const taken = Math.min(had, n);
      const by = target === pair[0] ? pair[1]!.u.id : pair[0]!.u.id;
      const overkill = Math.min(5, Math.max(0, n - had));
      caused.set(by, (caused.get(by) ?? 0) + taken + overkill);
      lost.set(target.m.id, n);
      yield ctx.emit({
        type: "model/wounds",
        id: m.id,
        woundsLost: (m.woundsLost ?? 0) + taken,
        destroyed: taken >= had,
      });
      if (taken >= had)
        yield ctx.note(
          `${m.profile?.name} falls in the challenge${overkill ? ` (overkill +${overkill})` : ""}`,
        );
    }
  }
  // The challenge ends when either falls.
  if ([...pair].some((x) => ctx.view.state.models[x.m.id]?.destroyed)) {
    yield ctx.set(`duel:${pair[0]!.u.id}`, null);
    yield ctx.set(`duel:${pair[1]!.u.id}`, null);
  }
  return caused;
}

/** This phase's marker, for "once this phase" keys. */
function phaseMark(view: GameView) {
  const now = view.state.turn;
  return { round: now.round, seat: now.activeSeat, phase: view.phase };
}
const samePhase = (view: GameView, v: unknown) => {
  const m = v as ReturnType<typeof phaseMark> | null | undefined;
  const now = phaseMark(view);
  return !!m && m.round === now.round && m.seat === now.seat && m.phase === now.phase;
};

/**
 * A challenge: a character or champion in the unit calls out the enemy unit
 * it fights. The enemy accepts with one of its own, who then fight each other
 * until one falls, or refuses, and one of its characters stands aside this
 * round (it strikes no blows).
 */
const challenge: CodeProcedure = function* (ctx, args) {
  const u = unitOf(ctx.view, args.unit);
  const foe = unitOf(ctx.view, args.target);
  const state = ctx.view.state;
  const mine = duellists(state, u);
  const theirs = duellists(state, foe);
  const label = (m: Model) => `${m.profile?.name ?? "Model"}`;
  const pickId =
    mine.length === 1
      ? mine[0]!.id
      : ((yield ctx.ask(
          owner(u),
          `Who in ${u.name} issues the challenge?`,
          mine.map((m) => ({ id: m.id, label: label(m) })),
        )) as string);
  const champion = state.models[pickId] ?? mine[0]!;
  yield ctx.note(`${label(champion)} of ${u.name} issues a challenge to ${foe.name}`);
  const answer = (yield ctx.ask(
    owner(foe),
    `${label(champion)} of ${u.name} challenges ${foe.name}. Accept?`,
    [
      ...theirs.map((m) => ({ id: m.id, label: `Accept with ${label(m)}` })),
      { id: "refuse", label: "Refuse" },
    ],
  )) as string;
  if (answer === "refuse" || !state.models[answer]) {
    const aside = theirs[0];
    if (aside) yield ctx.set(`aside:${foe.id}`, { ...phaseMark(ctx.view), model: aside.id });
    yield ctx.note(
      `${foe.name} refuses the challenge${aside ? `: ${label(aside)} stands aside and strikes no blows this round` : ""}`,
    );
    return;
  }
  const accepted = state.models[answer]!;
  yield ctx.set(`duel:${u.id}`, { model: champion.id, foe: accepted.id, foeUnit: foe.id } satisfies Duel);
  yield ctx.set(`duel:${foe.id}`, { model: accepted.id, foe: champion.id, foeUnit: u.id } satisfies Duel);
  yield ctx.note(`${label(accepted)} of ${foe.name} accepts: they fight each other until one falls`);
};

/** A round of close combat: everyone in contact on both sides, then the combat result and break tests. */
const combat: CodeProcedure = function* (ctx, args) {
  const a = unitOf(ctx.view, args.unit);
  const b = unitOf(ctx.view, args.target);
  const sides = combatSides(ctx.view.state, a, b);
  const sideOf = new Map<string, 0 | 1>();
  sides.forEach((side, i) => side.forEach((u) => sideOf.set(u.id, i as 0 | 1)));
  const names = (side: Unit[]) => side.map((u) => u.name).join(" and ");
  yield ctx.note(`${names(sides[0])} ${sides[0].length === 1 ? "fights" : "fight"} ${names(sides[1])}`);
  // Who each unit fights: the named pair each other, the rest whoever they touch.
  const foes = new Map<string, Unit>();
  for (const [i, side] of sides.entries())
    for (const u of side) foes.set(u.id, foeOf(ctx.view.state, u, sides[1 - i]!, i === 0 ? b : a));
  const all = [...sides[0], ...sides[1]];
  // Highest Initiative strikes first; models with the same Initiative strike together.
  const init = (u: Unit) => strikeOrder(u, stat(ctx.view, u, "I")) + chargeBonus(ctx.view, u);
  for (const u of all) {
    const bonus = chargeBonus(ctx.view, u);
    if (bonus) yield ctx.note(`${u.name} charged: Initiative +${bonus}`);
  }
  // Psychology before the blows: Fear tests, and Hatred the first time these two fight.
  const how = new Map<string, { afraid?: boolean; hatred?: boolean }>();
  for (const u of all) {
    const foe = foes.get(u.id)!;
    const h: { afraid?: boolean; hatred?: boolean } = {};
    if (frightens(ctx.view.state, foe, u)) {
      const t = yield* leadershipTest(ctx, u, "Fear test", 0, "");
      h.afraid = !t.passed;
      yield ctx.note(
        t.passed
          ? `${u.name} masters its fear (${t.roll.total})`
          : `${u.name} is afraid of ${foe.name} (rolled ${t.roll.total}, over Ld ${t.ld}): -1 to hit this round`,
      );
    }
    const key = `hated:${u.id}:${foe.id}`;
    if (hatesFoe(u, foe) && !ctx.view.own[key]) {
      h.hatred = true;
      yield ctx.set(key, true);
      yield ctx.note(`${u.name} hates ${foe.name}: it re-rolls missed hits this round`);
    }
    // Frenzy is a beat of its own, not only a to-hit label.
    if (frenzied(u) && u.status?.charged === true)
      yield ctx.note(`${u.name}: Frenzy, +1 Attack each on the charge`);
    how.set(u.id, h);
  }
  const caused = new Map<string, number>(all.map((u) => [u.id, 0]));
  // A challenge first: its two models fight each other and not the units.
  const inDuel = new Set<string>();
  for (const u of all) {
    const duel = duelOf(ctx.view, u);
    if (
      !duel ||
      inDuel.has(u.id) ||
      sideOf.get(duel.foeUnit) === sideOf.get(u.id) ||
      !sideOf.has(duel.foeUnit)
    )
      continue;
    inDuel.add(u.id).add(duel.foeUnit);
    const won = yield* fightDuel(ctx, duel, unitOf(ctx.view, u.id));
    for (const [id, n] of won) caused.set(id, (caused.get(id) ?? 0) + n);
  }
  // Impact Hits first (a charger that moved 3" or more), Stomp Attacks after every other blow.
  const autoHits = function* (rule: RegExp, why: string, when: (u: Unit) => boolean) {
    for (const u of all) {
      const atk = unitOf(ctx.view, u.id);
      const x = (atk.sheet?.abilities ?? []).map((a) => rule.exec(a.name.trim())?.[1]).find(Boolean);
      const def = unitOf(ctx.view, foes.get(u.id)!.id);
      if (!x || !when(atk) || !alive(ctx.view.state, atk).length || !alive(ctx.view.state, def).length)
        continue;
      // Each model that has the rule and touches the foe: the front rank (one for a lone model).
      const files = atk.formation.kind === "ranked" ? atk.formation.files : 1;
      const makers = Math.max(1, Math.min(files, alive(ctx.view.state, atk).length));
      const each = yield* eachX(ctx, makers, x, `${why} (${x})`, atk.id);
      const hits = each.reduce((t, n) => t + n, 0);
      if (!hits) continue;
      // Thunderstomp: a behemoth's Stomp Attacks have AP -2, except against monsters.
      const ap =
        why === "Stomp Attacks" &&
        hasRule(atk, /^thunderstomp\b/i) &&
        !/monst|behemoth/i.test(troopOf(ctx.view.state, def))
          ? 2
          : 0;
      yield ctx.note(
        `${atk.name}: ${hits === 1 ? `1 ${why.replace(/s$/, "")}` : `${hits} ${why}`}, hitting automatically at Strength ${stat(ctx.view, atk, "S")}`,
      );
      const n = yield* woundAndSave(ctx, atk, def, hits, stat(ctx.view, atk, "S"), ap);
      caused.set(u.id, (caused.get(u.id) ?? 0) + n);
      if (n) yield* casualties(ctx, unitOf(ctx.view, def.id), n);
    }
  };
  yield* autoHits(/^impact hits\s*\(\s*([^)]+?)\s*\)/i, "Impact Hits", (u) => chargedFar(ctx.view, u));
  const inits = [...new Set(all.map(init))].sort((x, y) => y - x);
  for (const step of inits.map((i) => all.filter((u) => init(u) === i))) {
    // Everyone in a step strikes before anyone in it is removed.
    const hits: [Unit, Unit, { n: number; slain: number[] }][] = [];
    for (const u of step) {
      const atk = unitOf(ctx.view, u.id);
      const def = unitOf(ctx.view, foes.get(u.id)!.id);
      const away = (inDuel.has(u.id) ? 1 : 0) + (samePhase(ctx.view, ctx.view.own[`aside:${u.id}`]) ? 1 : 0);
      hits.push([u, def, yield* strike(ctx, atk, def, how.get(u.id), away)]);
    }
    for (const [by, def, { n, slain }] of hits) {
      const big = n || slain.length ? yield* casualties(ctx, unitOf(ctx.view, def.id), n, slain) : 0;
      caused.set(by.id, (caused.get(by.id) ?? 0) + n + big);
    }
  }
  yield* autoHits(/^stomp attacks\s*\(\s*([^)]+?)\s*\)/i, "Stomp Attacks", () => true);

  // Combat result, side against side.
  const state = ctx.view.state;
  const strength = (u: Unit) => alive(state, u).reduce((t, m) => t + Math.max(1, charNum(m, "US", 1)), 0);
  const massed = (u: Unit) => (u.sheet?.abilities ?? []).some((x) => /massed infantry/i.test(x.name));
  const score = (side: Unit[]) => {
    const now = side.map((u) => unitOf(ctx.view, u.id));
    const parts: string[] = [];
    let s = now.reduce((t, u) => t + (caused.get(u.id) ?? 0), 0);
    const add = (n: number, why: string) => {
      s += n;
      parts.push(why);
    };
    if (s) parts.push(plural(s, "wound"));
    // The best rank bonus on the side; the other bonuses once each.
    const rb = Math.max(0, ...now.map((u) => rankBonus(state, u)));
    if (rb) add(rb, `ranks +${rb}`);
    if (now.some((u) => hasStandard(state, u))) add(1, "standard +1");
    if (now.some((u) => alive(state, u).some((m) => /battle standard/i.test(m.profile?.name ?? ""))))
      add(1, "battle standard +1");
    if (now.some((u) => combatOrder(state, u) && strength(u) >= 10)) add(1, "combat order +1");
    const foe = (u: Unit) => unitOf(ctx.view, foes.get(u.id)!.id);
    if (now.some((u) => frontHeight(state, u) > frontHeight(state, foe(u)) + HIGH_GROUND))
      add(1, "high ground +1");
    const arcs = now.map((u) => combatArc(state, foe(u), u));
    if (arcs.includes("rear")) add(2, "rear +2");
    else if (arcs.includes("left") || arcs.includes("right")) add(1, "flank +1");
    if (now.some((u) => massed(u) && strength(u) > strength(foe(u)))) add(1, "massed infantry +1");
    return { s, parts };
  };
  const sa = score(sides[0]);
  const sb = score(sides[1]);
  const result = `${names(sides[0])} ${sa.s} (${sa.parts.join(", ") || "nothing"}) against ${names(sides[1])} ${sb.s} (${sb.parts.join(", ") || "nothing"})`;
  yield ctx.note(`Combat result: ${result}`);
  const now = ctx.view.state.turn;
  for (const u of all) {
    const fought: Fought = {
      round: now.round,
      seat: now.activeSeat,
      phase: ctx.view.phase,
      against: foes.get(u.id)!.id,
      result,
    };
    yield ctx.set(`fought:${u.id}`, fought);
  }
  // Units wiped out in the fight shake their friends nearby.
  const wiped = all.filter((u) => !alive(ctx.view.state, unitOf(ctx.view, u.id)).length);
  if (sa.s === sb.s) {
    const music = (side: Unit[]) =>
      side.some((u) =>
        alive(ctx.view.state, unitOf(ctx.view, u.id)).some((m) => MUSICIAN.test(m.profile?.name ?? "")),
      );
    const band = music(sides[0]) !== music(sides[1]) ? (music(sides[0]) ? sides[0] : sides[1]) : [];
    const tune = band.length ? `${names(band)} ${band.length === 1 ? "has" : "have"} a musician` : "";
    yield ctx.note(
      `The combat is a draw${tune ? ` (${tune}: check its rule for drawn combats, by hand)` : ""}`,
    );
    for (const u of wiped) yield* panicNear(ctx, u, "was destroyed", all);
    return;
  }
  const [winners, losers, diff] =
    sa.s > sb.s ? [sides[0], sides[1], sa.s - sb.s] : [sides[1], sides[0], sb.s - sa.s];
  // Each losing unit tests, then the winners touching it follow up or pursue (one each).
  // Panic is measured from where the fight ended, before anyone fled.
  const ended = ctx.view.state;
  const outcomes: [Unit, "" | "flees" | "falls back"][] = [];
  for (const l of losers) {
    const lost = unitOf(ctx.view, l.id);
    if (frenzied(lost)) {
      yield ctx.emit({ type: "unit/status", id: lost.id, key: "frenzyLost", value: true });
      yield ctx.note(`${lost.name} lost the combat and its Frenzy with it`);
    }
    if (!alive(ctx.view.state, lost).length) continue;
    const from = unitOf(ctx.view, foes.get(l.id)!.id);
    // Terror on the winning side: -1 Leadership for the losers' break tests.
    const terror = winners.some((w) => causesTerror(w)) && !causesTerror(lost) ? 1 : 0;
    outcomes.push([l, yield* breakTest(ctx, lost, from, diff, terror)]);
  }
  for (const u of wiped) yield* panicNear(ctx, u, "was destroyed", all, ended);
  // Winners whose foe was wiped out may overrun (moved by hand).
  for (const w of winners) {
    const foe = foes.get(w.id);
    if (foe && wiped.some((x) => x.id === foe.id) && alive(ctx.view.state, unitOf(ctx.view, w.id)).length)
      yield ctx.note(`${w.name} destroyed ${foe.name}: it may overrun (move it by hand) or reform`);
  }
  const pursued = new Set<string>();
  for (const [l, fled] of outcomes) {
    if (fled === "flees") yield* panicNear(ctx, unitOf(ctx.view, l.id), "broke and fled", all, ended);
    const touching = winners.filter((w) => !pursued.has(w.id) && foes.get(w.id)?.id === l.id);
    const winner = touching[0] ?? winners.find((w) => !pursued.has(w.id) && foes.get(l.id)?.id === w.id);
    if (!winner || !alive(ctx.view.state, unitOf(ctx.view, winner.id)).length) continue;
    pursued.add(winner.id);
    yield* afterBreak(ctx, winner, l, fled);
    if (fled === "flees" && !alive(ctx.view.state, unitOf(ctx.view, l.id)).length)
      yield* panicNear(ctx, unitOf(ctx.view, l.id), "was run down", all, ended);
  }
};

/**
 * One losing unit's break test, and what it does: flee, fall back in good
 * order, or give ground. Unbreakable units give ground with no test; a
 * Stubborn unit's first break test is a fall back in good order.
 */
function* breakTest(
  ctx: Ctx,
  lost: Unit,
  won: Unit,
  diff: number,
  /** Leadership lost for this test (Terror on the winning side). */
  terror = 0,
): Generator<Command, "" | "flees" | "falls back", unknown> {
  if (unbreakable(lost)) {
    yield* moveAway(ctx, lost, won, GIVE_GROUND, false);
    yield ctx.note(`${lost.name} is Unbreakable: no break test, it gives ground ${GIVE_GROUND}"`);
    return "";
  }
  if (stubborn(lost) && !lost.status?.stubbornUsed) {
    yield ctx.emit({ type: "unit/status", id: lost.id, key: "stubbornUsed", value: true });
    yield* fallBack(ctx, lost, won, "is Stubborn (its first break test)");
    return "falls back";
  }
  // Break test: 2D6 against Leadership. Over it on the natural roll: break and flee. Within it
  // naturally but over once the difference is added: fall back in good order. Otherwise (or a
  // double 1): give ground.
  const test = yield* leadershipTest(
    ctx,
    lost,
    "break test",
    diff + terror,
    `lost by ${diff}${terror ? ", Terror: Ld -1" : ""}`,
  );
  const { roll: r, score: total } = test;
  const ld = test.ld - terror;
  const double1 = r.rolls.every((x) => x === 1);
  if (!double1 && r.total > ld) {
    // The same sum as the test line, and why it's the dice that count (UX 320).
    const why = diff
      ? `breaks (${total}: the dice alone, ${r.total}, are over Ld ${ld})`
      : `breaks (rolled ${r.total}, over Ld ${ld})`;
    yield* flee(ctx, lost, won, why);
    return "flees";
  }
  if (!double1 && r.total + diff > ld) {
    yield* fallBack(ctx, lost, won, `gives way (${total}, over Ld ${ld})`);
    return "falls back";
  }
  yield* moveAway(ctx, lost, won, GIVE_GROUND, false);
  yield ctx.note(
    `${lost.name} gives ground ${GIVE_GROUND}" (${double1 ? "a double 1" : `${total}, within Ld ${ld}`})`,
  );
  return "";
}

/**
 * Heavy losses from shooting or magic: a unit that lost a quarter of the
 * models it had (`before`) tests for Panic by itself, unless it is fighting,
 * fleeing, immune or tested this phase. Wiped out, its friends nearby test.
 */
export function* heavyLosses(ctx: Ctx, unitId: string, before: number): Generator<Command, void, unknown> {
  const u = unitOf(ctx.view, unitId);
  const state = ctx.view.state;
  const left = alive(state, u).length;
  if (!left) {
    yield* panicNear(ctx, u, "was destroyed");
    return;
  }
  if ((before - left) * 4 < before || u.status?.fleeing || immune(u) || panicTested(ctx.view, u.id)) return;
  if (fightTargets(ctx.view, u.id).length) return;
  yield ctx.note(`${u.name} lost ${before - left} of ${before} models: a Panic test`);
  yield* panicTest(ctx, u);
}

/** Started by the shooting procedure once it is closed: `{ unit, before }`. */
export const heavyLossesProcedure: CodeProcedure = function* (ctx, args) {
  yield* heavyLosses(ctx, String(args.unit), Number(args.before) || 0);
};

/** How near a friend must be to cause a Panic test when it breaks or is destroyed. */
const PANIC_RANGE = 6;

/**
 * Automatic Panic tests: friendly units within 6" of `u` (it broke, or was
 * destroyed) test straight away, unless they are fighting (`busy`), fleeing,
 * immune or already tested this phase.
 */
function* panicNear(
  ctx: Ctx,
  u: Unit,
  why: string,
  busy: Unit[] = [],
  /** Where to measure from: before the unit fled (the table as the fight ended), or now. */
  where?: GameState,
): Generator<Command, void, unknown> {
  const state = ctx.view.state;
  const at = where ?? state;
  const was = at.units[u.id] ?? u;
  const fallen = u.modelIds.map((id) => at.models[id]).filter((m): m is Model => !!m);
  const near = (f: Unit) => {
    if (alive(at, was).length) return unitGap(at, was, at.units[f.id] ?? f) <= PANIC_RANGE;
    // A destroyed unit is measured from where its models fell.
    return alive(state, f).some((x) =>
      fallen.some(
        (m) => Math.hypot(x.position.x - m.position.x, x.position.y - m.position.y) <= PANIC_RANGE + 1,
      ),
    );
  };
  for (const f of Object.values(state.units)) {
    if (f.id === u.id || opposed(state, f.owner, u.owner) || busy.some((b) => b.id === f.id)) continue;
    if (!alive(state, f).length || f.status?.fleeing || immune(f) || panicTested(ctx.view, f.id)) continue;
    if (!near(f)) continue;
    yield ctx.note(`${f.name} sees ${u.name}, ${PANIC_RANGE}" away or less, that ${why}: a Panic test`);
    yield* panicTest(ctx, unitOf(ctx.view, f.id));
  }
}

/** The winner follows up or pursues, unless it restrains. */
function* afterBreak(
  ctx: Ctx,
  winner: Unit,
  loser: Unit,
  fled: "" | "flees" | "falls back",
): Generator<Command, void, unknown> {
  const won = unitOf(ctx.view, winner.id);
  const lost = unitOf(ctx.view, loser.id);
  // Frenzied and hating units can't hold back.
  const eager = frenzied(won) ? "Frenzy" : hatesFoe(won, lost) ? "Hatred" : "";
  if (eager) yield ctx.note(`${winner.name} must ${fled ? "pursue" : "follow up"} (${eager})`);
  const pick = eager
    ? "go"
    : yield ctx.ask(
        owner(winner),
        fled
          ? `${lost.name} ${fled === "flees" ? "has broken and flees" : "falls back in good order"}. Does ${winner.name} pursue it?`
          : `${lost.name} gave ground. Does ${winner.name} follow up?`,
        [
          { id: "go", label: fled ? "Pursue" : "Follow up" },
          { id: "restrain", label: "Restrain (Leadership test)" },
        ],
      );
  if (pick !== "go") {
    const t = yield* leadershipTest(ctx, won, "restraint test");
    if (t.passed) {
      yield ctx.note(`${winner.name} restrains and may reform (rolled ${t.roll.total})`);
      return;
    }
    yield ctx.note(`${winner.name} fails to restrain (rolled ${t.roll.total})`);
  }
  yield* pursue(ctx, winner.id, loser.id, fled);
}

/**
 * The winner goes after the loser. Following up (the loser gave ground) keeps
 * the units in contact. Pursuing rolls 2D6": reaching a fleeing unit destroys
 * it; reaching one falling back in good order puts the pursuer back in contact.
 */
function* pursue(
  ctx: Ctx,
  winnerId: string,
  loserId: string,
  fled: "" | "flees" | "falls back",
): Generator<Command, void, unknown> {
  const state = ctx.view.state;
  const won = unitOf(ctx.view, winnerId);
  const lost = unitOf(ctx.view, loserId);
  const towards = (inches: number) => {
    const c = unitCentre(state, won);
    const t = unitCentre(state, lost);
    return fleeMove(state, won, { x: t.x - c.x, y: t.y - c.y }, inches);
  };
  const gap = unitGap(state, won, lost);
  if (!fled) {
    const move = gap > 0.05 ? towards(gap) : null;
    if (move) yield ctx.emit(move);
    yield ctx.note(`${won.name} follows up ${gap.toFixed(1)}" and stays in contact`);
    return;
  }
  const r = yield* swiftRoll(ctx, won, PURSUE_DICE, "pursuit roll");
  const caught = r.total >= gap;
  const move = towards(Math.min(r.total, gap));
  if (move) yield ctx.emit(move);
  if (!caught) {
    const short = (gap - r.total).toFixed(1);
    yield ctx.note(
      short === "0.0"
        ? `${won.name} pursues ${r.total}" and falls just short (under 0.1") of ${lost.name}`
        : `${won.name} pursues ${r.total}" and falls ${short}" short of ${lost.name}`,
    );
    return;
  }
  if (fled === "falls back") {
    yield ctx.note(`${won.name} pursues ${r.total}" and catches ${lost.name}: they are in combat again`);
    return;
  }
  for (const m of alive(ctx.view.state, lost))
    yield ctx.emit({
      type: "model/wounds",
      id: m.id,
      woundsLost: stat(ctx.view, lost, "W", 1),
      destroyed: true,
    });
  yield ctx.note(`${won.name} pursues ${r.total}" and catches ${lost.name}, which is destroyed`);
}

/** The charged unit's reaction: hold, stand and shoot (missile troops, not too close), or flee. */
const chargeReaction: CodeProcedure = function* (ctx, args) {
  const charger = unitOf(ctx.view, args.unit);
  const target = unitOf(ctx.view, args.target);
  const distance = unitGap(ctx.view.state, charger, target);
  const shoots =
    Object.values(target.sheet?.weapons ?? {}).some((w) => w.kind === "ranged") &&
    !target.status?.fleeing &&
    !inCombat(ctx.view, target.id) &&
    distance >= moveOf(ctx.view, charger);
  const now = ctx.view.state.turn;
  // Charging something frightening takes nerve: a failed Fear test and the charge isn't made.
  if (frightens(ctx.view.state, target, charger)) {
    const t = yield* leadershipTest(ctx, charger, "Fear test", 0, "");
    if (!t.passed) {
      yield ctx.set(`fearTest:${charger.id}`, { round: now.round, seat: now.activeSeat });
      yield ctx.note(
        `${charger.name} is too afraid of ${target.name} to charge (rolled ${t.roll.total}, over Ld ${t.ld})`,
      );
      return;
    }
    yield ctx.note(`${charger.name} masters its fear of ${target.name} (${t.roll.total})`);
  }
  yield ctx.note(`${charger.name} declares a charge against ${target.name} (${distance.toFixed(1)}" away)`);
  yield ctx.emit({ type: "unit/status", id: charger.id, key: "charged", value: true });
  const record: ChargeRecord = {
    target: target.id,
    distance,
    arc: inArc(ctx.view.state, target, charger),
    round: ctx.view.round,
  };
  yield ctx.set(`charge:${charger.id}`, record);
  // Charged by something terrifying: a Terror test, and fleeing on a fail.
  if (causesTerror(charger) && !causesTerror(target) && !immune(target) && !target.status?.fleeing) {
    const t = yield* leadershipTest(ctx, target, "Terror test", 0, "");
    if (!t.passed) {
      yield* flee(
        ctx,
        target,
        charger,
        `is terrified of ${charger.name} (rolled ${t.roll.total}, over Ld ${t.ld})`,
      );
      return;
    }
    yield ctx.note(`${target.name} stands its ground against ${charger.name} (${t.roll.total})`);
  }
  // A unit that is already fleeing can only flee again.
  if (target.status?.fleeing) {
    yield* flee(ctx, target, charger, "is already fleeing");
    yield ctx.note(
      `If ${charger.name}'s charge still reaches ${target.name}, the fleeing unit is destroyed (by hand)`,
    );
    return;
  }
  const options = [
    { id: "hold", label: "Hold" },
    ...(shoots ? [{ id: "shoot", label: `Stand and shoot at ${charger.name} (-1 to hit)` }] : []),
    // Immune to Psychology (and frenzied) units won't flee.
    ...(immune(target) ? [] : [{ id: "flee", label: "Flee" }]),
  ];
  // Only Hold left (UX 260): no question, and the log says why it can't flee.
  if (options.length === 1) {
    yield ctx.note(
      `${target.name} holds: ${frenzied(target) ? "frenzied units" : "units immune to psychology"} don't flee`,
    );
    return;
  }
  const pick = yield ctx.ask(
    owner(target),
    `${charger.name} charges ${target.name}. ${options
      .map((o) => o.label.split(" at ")[0])
      .join(", ")
      .replace(/, ([^,]*)$/, " or $1")}?`,
    options,
  );
  if (pick === "hold") yield ctx.note(`${target.name} holds`);
  if (pick === "shoot") {
    const n = yield* shoot(ctx, target, charger, ["stand and shoot"]);
    if (n) yield* casualties(ctx, unitOf(ctx.view, charger.id), n);
    yield ctx.note(
      `${target.name} stands and shoots (${n} unsaved ${n === 1 ? "wound" : "wounds"}), then holds`,
    );
  }
  if (pick === "flee") yield* flee(ctx, target, charger, "won't face the charge");
};

/**
 * A Panic test: Leadership on 2D6. On a fail the unit falls back in good
 * order if more than half its models remain, else it flees.
 */
const panic: CodeProcedure = function* (ctx, args) {
  yield* panicTest(ctx, unitOf(ctx.view, args.unit));
};

function* panicTest(ctx: Ctx, u: Unit): Generator<Command, void, unknown> {
  const now = ctx.view.state.turn;
  yield ctx.set(`panic:${u.id}`, { round: now.round, seat: now.activeSeat, phase: ctx.view.phase });
  const { roll, ld, passed } = yield* leadershipTest(ctx, u, "Panic test");
  if (passed) {
    yield ctx.note(`${u.name} keeps its nerve (${roll.total} against ${ld})`);
    return;
  }
  const from = nearestEnemy(ctx.view.state, u);
  const left = alive(ctx.view.state, u).length;
  // A failed Panic test: more than half the unit left falls back in good order, otherwise it
  // flees (tow.whfb.app, panic tests, checked 2026-10-08; UX 320).
  if (left * 2 > u.modelIds.length)
    yield* fallBack(
      ctx,
      u,
      from,
      `fails its Panic test (rolled ${roll.total}, over Ld ${ld}), keeps more than half its models,`,
    );
  else yield* flee(ctx, u, from, `fails its Panic test (rolled ${roll.total}, over Ld ${ld})`);
}

/** Whether the unit has taken a Panic test this phase. */
function panicTested(view: GameView, unitId: string): boolean {
  const t = view.own[`panic:${unitId}`] as { round: number; seat: number; phase: string | null } | undefined;
  const now = view.state.turn;
  return !!t && t.round === now.round && t.seat === now.activeSeat && t.phase === view.phase;
}

/**
 * When a Panic test may be rolled by hand (advisory): in the Shooting or Combat phase, once a
 * phase, for a unit that has lost a quarter of its models or has a friendly unit within 6"
 * destroyed or fleeing. Friends breaking or destroyed in combat call for one by themselves
 * (panicNear).
 */
function panicAvailable(view: GameView, actor: { unitId?: string }): true | string {
  const state = view.state;
  const u = state.units[actor.unitId ?? ""];
  if (!u) return "No unit";
  if (u.status?.fleeing) return "Already fleeing";
  if (immune(u)) return frenzied(u) ? "Frenzied: immune to Panic" : "Immune to Psychology";
  if (view.phase !== "shooting" && view.phase !== "combat") return "Only after shooting or combat";
  if (panicTested(view, u.id)) return "Already tested this phase";
  // Heavy losses: a quarter of the unit or more (the rules count those from one phase's shooting).
  const lost = u.modelIds.filter((id) => state.models[id]?.destroyed).length;
  if (lost && lost * 4 >= u.modelIds.length) return true;
  const mine = alive(state, u);
  // A destroyed unit is measured from where its models fell (centre to centre, a little generous).
  const fellNear = (f: Unit) =>
    f.modelIds.some((id) => {
      const m = state.models[id];
      return m && mine.some((x) => Math.hypot(x.position.x - m.position.x, x.position.y - m.position.y) <= 7);
    });
  const shaken = Object.values(state.units).some(
    (f) =>
      f.id !== u.id &&
      !opposed(state, f.owner, u.owner) &&
      (alive(state, f).length ? f.status?.fleeing && unitGap(state, u, f) <= 6 : fellNear(f)),
  );
  return shaken
    ? true
    : "Nothing to panic about: under a quarter lost, and no friend nearby destroyed or fleeing";
}

/** Enemy units within this gap of this one, nearest first. */
function enemies(view: GameView, unitId: string, within: number, fleeing = true) {
  const me = view.state.units[unitId];
  if (!me) return [];
  return Object.values(view.state.units)
    .filter(
      (u) =>
        opposed(view.state, u.owner, me.owner) &&
        alive(view.state, u).length &&
        (fleeing || !u.status?.fleeing),
    )
    .map((u) => ({ u, d: unitGap(view.state, me, u) }))
    .filter((x) => x.d <= within)
    .sort((x, y) => x.d - y.d);
}

/** Touching, for close combat. */
const CONTACT = 0.5;

const MUSICIAN = /musician|drummer|horn|bugler|trumpeter/i;

/** In base contact with an enemy that isn't fleeing. */
export function inCombat(view: GameView, unitId: string): boolean {
  return enemies(view, unitId, CONTACT, false).length > 0;
}

/** For data: `{ call: "inCombat", args: [unit id] }`. */
export const inCombatFn = (view: GameView, unitId: unknown) => inCombat(view, String(unitId));

/** For data: it marched this turn (a failed march test counts), and has no rule letting it shoot after. */
export const marchedNoShot = (view: GameView, unitId: unknown): boolean => {
  const u = view.state.units[String(unitId)];
  return !!u?.status?.marching && !hasRule(u, /quick shot/i);
};

/** Close combat targets: in contact, not fleeing, and not already fought this phase. */
function fightTargets(view: GameView, unitId: string) {
  return enemies(view, unitId, CONTACT, false).filter((x) => !foughtNow(view, x.u.id));
}

const NO_UNIT = { modelIds: [] } as unknown as Unit;

/** How near an enemy (not fleeing) must be for a march to need a Leadership test. */
const MARCH_BLOCK = 8;

/**
 * The march test: with an enemy that isn't fleeing within 8", a unit must
 * pass a Leadership test to march. A fail and it moves normally but still
 * counts as having marched. Drilled units don't test. The result is the
 * unit's `marchTest` status ("passed" 1, "failed" 0) until its next turn.
 */
const marchTest: CodeProcedure = function* (ctx, args) {
  const u = unitOf(ctx.view, args.unit);
  const t = yield* leadershipTest(ctx, u, "march test");
  yield ctx.emit({ type: "unit/status", id: u.id, key: "marchTest", value: t.passed ? 1 : 0 });
  yield ctx.emit({ type: "unit/status", id: u.id, key: "marching", value: true });
  yield ctx.note(
    t.passed
      ? `${u.name} may march (${t.roll.total} against Ld ${t.ld})`
      : `${u.name} fails its march test (rolled ${t.roll.total}, over Ld ${t.ld}): it moves normally but counts as having marched`,
  );
};

/** Enemies a unit could declare a charge against: within 24" and in its sight (its vision arc). */
function chargeable(view: GameView, unitId: string) {
  return enemies(view, unitId, 24, false).filter((x) => view.atTable || view.visible(unitId, x.u.id));
}

/** Enemies in contact that could answer a challenge (with a character or champion, and not in one already). */
function challengeTargets(view: GameView, unitId: string) {
  return fightTargets(view, unitId).filter((x) => duellists(view.state, x.u).length && !duelOf(view, x.u));
}

export const towActions: CodeAction[] = [
  {
    id: "chargeReaction",
    name: "Declare charge",
    by: "unit",
    phases: ["movement"],
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return "No unit";
      if (u.status?.fleeing) return "Fleeing units can't charge";
      if (u.status?.charged) return "Already charged this turn";
      if (u.status?.stupid) return "Stupid this turn: it can't declare a charge";
      // Charges are declared at the start of the Movement phase, before anything moves (UX 323).
      const moved = alive(view.state, u).some(
        (m) =>
          m.phaseStart && Math.hypot(m.position.x - m.phaseStart.x, m.position.y - m.phaseStart.y) > 0.05,
      );
      if (moved || u.status?.marching)
        return "It has already moved this turn: charges are declared before moving";
      const fear = view.own[`fearTest:${u.id}`] as { round: number; seat: number } | undefined;
      const now = view.state.turn;
      if (fear && fear.round === now.round && fear.seat === now.activeSeat)
        return "Failed its Fear test this turn";
      if (!enemies(view, u.id, 24, false).length) return 'No enemy within 24"';
      return chargeable(view, u.id).length ? true : "No enemy it can see to charge";
    },
    targets: (view, actor) =>
      chargeable(view, actor.unitId ?? "").map((x) => ({
        unitId: x.u.id,
        label: `${x.u.name} (${x.d.toFixed(1)}")`,
      })),
    run: chargeReaction,
  },
  {
    id: "combat",
    name: "Fight",
    by: "unit",
    phases: ["combat"],
    available: (view, actor) => {
      const id = actor.unitId ?? "";
      const u = view.state.units[id];
      if (u?.status?.fleeing) return "Fleeing units don't fight";
      const done = foughtNow(view, id);
      if (done) return `Fought this phase: ${done.result}`;
      if (fightTargets(view, id).length) return true;
      return enemies(view, id, CONTACT).length
        ? "The enemy in contact is fleeing"
        : "Not in base contact with an enemy";
    },
    targets: (view, actor) =>
      fightTargets(view, actor.unitId ?? "").map((x) => ({ unitId: x.u.id, label: x.u.name })),
    run: combat,
  },
  {
    id: "challenge",
    name: "Issue a challenge",
    by: "unit",
    phases: ["combat"],
    applies: (view, actor) =>
      duellists(view.state, view.state.units[actor.unitId ?? ""] ?? NO_UNIT).length > 0,
    available: (view, actor) => {
      const id = actor.unitId ?? "";
      const u = view.state.units[id];
      if (!u) return "No unit";
      if (u.status?.fleeing) return "Fleeing units don't fight";
      if (foughtNow(view, id)) return "Fought this phase";
      if (!duellists(view.state, u).length) return "No character or champion to issue it";
      if (duelOf(view, u)) return "Already fighting a challenge";
      if (!fightTargets(view, id).length) return "Not in base contact with an enemy";
      return challengeTargets(view, id).length ? true : "No enemy in contact can answer a challenge";
    },
    targets: (view, actor) =>
      challengeTargets(view, actor.unitId ?? "").map((x) => ({ unitId: x.u.id, label: x.u.name })),
    run: challenge,
  },
  {
    id: "marchTest",
    name: "March test",
    by: "unit",
    phases: ["movement"],
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return "No unit";
      if (u.status?.fleeing) return "Fleeing units don't march";
      if (hasRule(u, /\bdrilled\b/i)) return "Drilled: it marches without a test";
      if (typeof u.status?.marchTest === "number") return "Already tested this turn";
      return enemies(view, u.id, MARCH_BLOCK, false).length
        ? true
        : `No enemy within ${MARCH_BLOCK}": it may simply march`;
    },
    run: marchTest,
  },
  {
    id: "panic",
    name: "Panic test",
    by: "unit",
    available: panicAvailable,
    run: panic,
  },
];
