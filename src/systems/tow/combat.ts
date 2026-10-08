import { awayFrom, fleeMove, unitCentre, unitGap } from "../../core/manoeuvre";
import { blockModels, inArc, rankCount } from "../../core/regiment";
import type { GameState, Model, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { towRanks } from "./troops";
import { opposed } from "../../core/teams";
import {
  causesFear,
  causesTerror,
  frenzied,
  hasBattleStandard,
  hates,
  immune,
  isGeneral,
  stubborn,
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
 * Unbreakable (no break test, it gives ground) (#40). Not covered: overkill
 * (challenges), and supporting attacks assume every second-rank model may
 * make one. Every result is advisory and lands in the log.
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
export function stat(view: GameView, u: Unit, id: string, d = 0): number {
  const v = (view.unit(u.id) as Record<string, unknown> | undefined)?.[id];
  return typeof v === "number" ? v : d;
}

/** How far the General's Leadership and the Battle Standard's re-roll reach. */
export const AURA = 12;

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
export function leadership(state: GameState, u: Unit): { ld: number; who: string } {
  const own = ownLeadership(state, u);
  const general = friendNear(state, u, isGeneral);
  if (general && general.id !== u.id) {
    const g = ownLeadership(state, general);
    if (g.ld > own.ld) return { ld: g.ld, who: `the General's, ${general.name}` };
  }
  return own;
}

/** "Ld 9, Warden Captain" when a model other than the rank and file lends its Leadership. */
function ldLabel(state: GameState, u: Unit): string {
  const { ld, who } = leadership(state, u);
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

const count = (r: Roll, target: number) => r.rolls.filter((x) => x !== 1 && x >= target).length;
/** To hit: a natural 6 always hits, a natural 1 always misses. */
const hitsOf = (r: Roll, target: number) => r.rolls.filter((x) => x === 6 || (x !== 1 && x >= target)).length;

/** To wound, then armour, ward and regeneration saves. Returns the unsaved wounds. */
export function* woundAndSave(
  ctx: Ctx,
  atk: Unit,
  def: Unit,
  hits: number,
  strength: number,
  ap = 0,
): Generator<Command, number, unknown> {
  const view = ctx.view;
  const woundOn = toWound(strength, stat(view, def, "T"));
  if (woundOn === null) {
    yield ctx.note(`${atk.name} can't wound ${def.name}`);
    return 0;
  }
  const wound = (yield ctx.roll(`${hits}d6`, "to wound", atk.id, woundOn)) as Roll;
  let left = count(wound, woundOn);
  for (const [save, name] of [
    ["armour", "armour"],
    ["ward", "ward"],
    ["regen", "regeneration"],
  ] as const) {
    const on = stat(view, def, save, save === "armour" ? 7 : 0) + (save === "armour" ? ap : 0);
    if (!left || on < 2 || on > 6) continue;
    const r = (yield ctx.roll(`${left}d6`, `${name} save`, def.id, on)) as Roll;
    left -= count(r, on);
  }
  return left;
}

/**
 * One side's attacks against another: the front rank's Attacks plus one
 * supporting attack from each model in the second rank, then to hit, to
 * wound, armour, ward and regeneration. Returns the unsaved wounds.
 */
function* strike(
  ctx: Ctx,
  atk: Unit,
  def: Unit,
  how: { afraid?: boolean; hatred?: boolean } = {},
  duelling = 0,
): Generator<Command, number, unknown> {
  const view = ctx.view;
  const state = view.state;
  const models = alive(state, atk).length;
  if (!models || !alive(state, def).length) return 0;
  const files = atk.formation.kind === "ranked" ? Math.min(atk.formation.files, models) : models;
  const support = atk.formation.kind === "ranked" ? Math.min(files, models - files) : 0;
  const frenzy = frenzied(atk) ? 1 : 0;
  // A model fighting a challenge strikes there, not at the unit.
  const attacks = Math.max(0, files - duelling) * (Math.max(1, stat(view, atk, "A", 1)) + frenzy) + support;
  if (!attacks) return 0;
  const hitOn = how.afraid ? 6 : combatHit(stat(view, atk, "WS"), stat(view, def, "WS"));
  const label = `to hit${frenzy ? " (Frenzy +1 Attack)" : ""}${how.afraid ? " (afraid: 6s only)" : ""}`;
  const hit = (yield ctx.roll(`${attacks}d6`, label, atk.id, hitOn)) as Roll;
  let hits = hitsOf(hit, hitOn);
  if (how.hatred && hits < attacks) {
    const again = (yield ctx.roll(`${attacks - hits}d6`, "to hit re-roll (Hatred)", atk.id, hitOn)) as Roll;
    hits += hitsOf(again, hitOn);
  }
  if (!hits) return 0;
  return yield* woundAndSave(ctx, atk, def, hits, stat(view, atk, "S"));
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
  const files = shooter.formation.kind === "ranked" ? shooter.formation.files : carriers;
  const dice = Math.min(carriers, files);
  if (!dice) return 0;
  const range = Number.parseFloat(weapon.chars.Range ?? "") || 0;
  const mods = [...penalties];
  if (range && unitGap(state, shooter, target) > range / 2) mods.push("long range");
  const need = 7 - stat(view, shooter, "BS") + mods.length;
  const label = `to hit${need >= 7 ? ` (6 then ${need - 3}+)` : ""}${mods.length ? ` (${mods.join(", ")})` : ""}`;
  if (need >= 10) {
    yield ctx.note(`${shooter.name} can't hit (${mods.join(", ")})`);
    return 0;
  }
  const r = (yield ctx.roll(`${dice}d6`, label, shooter.id, Math.min(6, Math.max(2, need)))) as Roll;
  let hits = need <= 6 ? count(r, Math.max(2, need)) : r.rolls.filter((x) => x === 6).length;
  if (need >= 7 && hits) {
    const f = (yield ctx.roll(`${hits}d6`, "then", shooter.id, need - 3)) as Roll;
    hits = count(f, need - 3);
  }
  if (!hits) return 0;
  const s = Number.parseFloat(weapon.chars.S ?? "") || stat(view, shooter, "S");
  const ap = Math.abs(Number.parseFloat(weapon.chars.AP ?? "") || 0);
  return yield* woundAndSave(ctx, shooter, target, hits, s, ap);
}

/** Casualties come off the rear rank: wounded models first, then rank and file, the command group last. */
export function* casualties(ctx: Ctx, def: Unit, wounds: number): Generator<Command, void, unknown> {
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
    .map((x) => x.m);
  for (const m of order) {
    if (wounds <= 0) break;
    const w = Math.max(1, charNum(m, "W", 1));
    const lost = Math.min(w, (m.woundsLost ?? 0) + wounds);
    wounds -= lost - (m.woundsLost ?? 0);
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost: lost, destroyed: lost >= w });
  }
}

/** The nearest enemy unit still standing and not fleeing, to run from. */
export function nearestEnemy(state: GameState, u: Unit): Unit | undefined {
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
  if (move)
    yield ctx.emit(
      (turn ? move : { ...move, turn: 0, how: "drag" }) as unknown as { type: string } & Record<
        string,
        unknown
      >,
    );
}

/** The unit flees 2D6" from `from` and is marked fleeing. */
export function* flee(
  ctx: Ctx,
  u: Unit,
  from: Unit | undefined,
  why: string,
): Generator<Command, void, unknown> {
  const r = (yield ctx.roll(FLEE_DICE, "flee roll", u.id)) as Roll;
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
  const { ld } = leadership(state, u);
  // "Reaver Warband break test: 2D6 + 8 (lost by 8) against Ld 6, Reaver Chief"
  yield ctx.note(
    `${u.name} ${name}: 2D6${mod ? ` + ${mod}${why ? ` (${why})` : ""}` : ""} against ${ldLabel(state, u)}`,
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
export function combatSides(state: GameState, a: Unit, b: Unit): [Unit[], Unit[]] {
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
export function duellists(state: GameState, u: Unit): Model[] {
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
  const woundOn = toWound(charNum(atk, "S", 3), charNum(def, "T", 3));
  if (woundOn === null) return 0;
  const wound = (yield ctx.roll(`${hits}d6`, `${name}: to wound`, atkUnit.id, woundOn)) as Roll;
  let left = count(wound, woundOn);
  const armour = charNum(def, "armour", stat(ctx.view, defUnit, "armour", 7));
  for (const [on, label] of [
    [armour, "armour save"],
    [charNum(def, "ward", stat(ctx.view, defUnit, "ward", 0)), "ward save"],
  ] as const) {
    if (!left || on < 2 || on > 6) continue;
    const r = (yield ctx.roll(
      `${left}d6`,
      `${def.profile?.name ?? defUnit.name}: ${label}`,
      defUnit.id,
      on,
    )) as Roll;
    left -= count(r, on);
  }
  return left;
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
  const ini = (x: (typeof pair)[number]) => charNum(x.m, "I", 1);
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
export const challenge: CodeProcedure = function* (ctx, args) {
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
export const combat: CodeProcedure = function* (ctx, args) {
  const a = unitOf(ctx.view, args.unit);
  const b = unitOf(ctx.view, args.target);
  const sides = combatSides(ctx.view.state, a, b);
  const sideOf = new Map<string, 0 | 1>();
  sides.forEach((side, i) => side.forEach((u) => sideOf.set(u.id, i as 0 | 1)));
  const names = (side: Unit[]) => side.map((u) => u.name).join(" and ");
  yield ctx.note(`${names(sides[0])} fight ${names(sides[1])}`);
  // Who each unit fights: the named pair each other, the rest whoever they touch.
  const foes = new Map<string, Unit>();
  for (const [i, side] of sides.entries())
    for (const u of side) foes.set(u.id, foeOf(ctx.view.state, u, sides[1 - i]!, i === 0 ? b : a));
  const all = [...sides[0], ...sides[1]];
  // Highest Initiative strikes first; models with the same Initiative strike together.
  const init = (u: Unit) => stat(ctx.view, u, "I") + chargeBonus(ctx.view, u);
  for (const u of all) {
    const bonus = chargeBonus(ctx.view, u);
    if (bonus) yield ctx.note(`${u.name} charged: Initiative +${bonus}`);
  }
  // Psychology before the blows: Fear tests, and Hatred the first time these two fight.
  const how = new Map<string, { afraid?: boolean; hatred?: boolean }>();
  for (const u of all) {
    const foe = foes.get(u.id)!;
    const h: { afraid?: boolean; hatred?: boolean } = {};
    if (causesFear(foe) && !causesFear(u) && !immune(u)) {
      const t = yield* leadershipTest(ctx, u, "Fear test", 0, "");
      h.afraid = !t.passed;
      yield ctx.note(
        t.passed
          ? `${u.name} masters its fear (${t.roll.total})`
          : `${u.name} is afraid of ${foe.name} (rolled ${t.roll.total}, over Ld ${t.ld}): it hits only on 6s this round`,
      );
    }
    const key = `hated:${u.id}:${foe.id}`;
    if (hates(u) && !ctx.view.own[key]) {
      h.hatred = true;
      yield ctx.set(key, true);
      yield ctx.note(`${u.name} hates ${foe.name}: it re-rolls missed hits this round`);
    }
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
  const inits = [...new Set(all.map(init))].sort((x, y) => y - x);
  for (const step of inits.map((i) => all.filter((u) => init(u) === i))) {
    // Everyone in a step strikes before anyone in it is removed.
    const hits: [Unit, Unit, number][] = [];
    for (const u of step) {
      const atk = unitOf(ctx.view, u.id);
      const def = unitOf(ctx.view, foes.get(u.id)!.id);
      const away = (inDuel.has(u.id) ? 1 : 0) + (samePhase(ctx.view, ctx.view.own[`aside:${u.id}`]) ? 1 : 0);
      hits.push([u, def, yield* strike(ctx, atk, def, how.get(u.id), away)]);
    }
    for (const [by, def, n] of hits) {
      caused.set(by.id, (caused.get(by.id) ?? 0) + n);
      if (n) yield* casualties(ctx, unitOf(ctx.view, def.id), n);
    }
  }

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
    if (s) parts.push(`${s} wounds`);
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
    const arcs = now.map((u) => inArc(state, foe(u), u));
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
    yield ctx.note("The combat is a draw");
    for (const u of wiped) yield* panicNear(ctx, u, "was destroyed", all);
    return;
  }
  const [winners, losers, diff] =
    sa.s > sb.s ? [sides[0], sides[1], sa.s - sb.s] : [sides[1], sides[0], sb.s - sa.s];
  // Each losing unit tests, then the winners touching it follow up or pursue (one each).
  const outcomes: [Unit, "" | "flees" | "falls back"][] = [];
  for (const l of losers) {
    const lost = unitOf(ctx.view, l.id);
    if (frenzied(lost)) {
      yield ctx.emit({ type: "unit/status", id: lost.id, key: "frenzyLost", value: true });
      yield ctx.note(`${lost.name} lost the combat and its Frenzy with it`);
    }
    if (!alive(ctx.view.state, lost).length) continue;
    const from = unitOf(ctx.view, foes.get(l.id)!.id);
    outcomes.push([l, yield* breakTest(ctx, lost, from, diff)]);
  }
  for (const u of wiped) yield* panicNear(ctx, u, "was destroyed", all);
  const pursued = new Set<string>();
  for (const [l, fled] of outcomes) {
    if (fled === "flees") yield* panicNear(ctx, unitOf(ctx.view, l.id), "broke and fled", all);
    const touching = winners.filter((w) => !pursued.has(w.id) && foes.get(w.id)?.id === l.id);
    const winner = touching[0] ?? winners.find((w) => !pursued.has(w.id) && foes.get(l.id)?.id === w.id);
    if (!winner || !alive(ctx.view.state, unitOf(ctx.view, winner.id)).length) continue;
    pursued.add(winner.id);
    yield* afterBreak(ctx, winner, l, fled);
    if (fled === "flees" && !alive(ctx.view.state, unitOf(ctx.view, l.id)).length)
      yield* panicNear(ctx, unitOf(ctx.view, l.id), "was run down", all);
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
): Generator<Command, "" | "flees" | "falls back", unknown> {
  if (unbreakable(lost)) {
    yield* moveAway(ctx, lost, won, GIVE_GROUND, false);
    yield ctx.note(`${lost.name} is Unbreakable: no break test, it gives ground ${GIVE_GROUND}"`);
    return "";
  }
  if (stubborn(lost) && !lost.status?.stubbornUsed) {
    yield ctx.emit({ type: "unit/status", id: lost.id, key: "stubbornUsed", value: true });
    yield* fallBack(ctx, lost, won, "is Stubborn: its first break test, it falls back in good order");
    return "falls back";
  }
  // Break test: 2D6 against Leadership. Over it on the natural roll: break and flee. Within it
  // naturally but over once the difference is added: fall back in good order. Otherwise (or a
  // double 1): give ground.
  const {
    roll: r,
    ld,
    score: total,
  } = yield* leadershipTest(ctx, lost, "break test", diff, `lost by ${diff}`);
  const double1 = r.rolls.every((x) => x === 1);
  if (!double1 && r.total > ld) {
    yield* flee(ctx, lost, won, `breaks (rolled ${r.total}, over Ld ${ld})`);
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

/** How near a friend must be to cause a Panic test when it breaks or is destroyed. */
const PANIC_RANGE = 6;

/**
 * Automatic Panic tests: friendly units within 6" of `u` (it broke, or was
 * destroyed) test straight away, unless they are fighting (`busy`), fleeing,
 * immune or already tested this phase.
 */
export function* panicNear(
  ctx: Ctx,
  u: Unit,
  why: string,
  busy: Unit[] = [],
): Generator<Command, void, unknown> {
  const state = ctx.view.state;
  const fallen = u.modelIds.map((id) => state.models[id]).filter((m): m is Model => !!m);
  const near = (f: Unit) => {
    if (alive(state, u).length) return unitGap(state, u, f) <= PANIC_RANGE;
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
  const eager = frenzied(won) ? "Frenzy" : hates(won) ? "Hatred" : "";
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
    if (move) yield ctx.emit(move as unknown as { type: string } & Record<string, unknown>);
    yield ctx.note(`${won.name} follows up ${gap.toFixed(1)}" and stays in contact`);
    return;
  }
  const r = (yield ctx.roll(PURSUE_DICE, "pursuit roll", won.id)) as Roll;
  const caught = r.total >= gap;
  const move = towards(Math.min(r.total, gap));
  if (move) yield ctx.emit(move as unknown as { type: string } & Record<string, unknown>);
  if (!caught) {
    yield ctx.note(
      `${won.name} pursues ${r.total}" and falls ${(gap - r.total).toFixed(1)}" short of ${lost.name}`,
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
export const chargeReaction: CodeProcedure = function* (ctx, args) {
  const charger = unitOf(ctx.view, args.unit);
  const target = unitOf(ctx.view, args.target);
  const distance = unitGap(ctx.view.state, charger, target);
  const shoots =
    Object.values(target.sheet?.weapons ?? {}).some((w) => w.kind === "ranged") &&
    !target.status?.fleeing &&
    distance >= stat(ctx.view, charger, "M");
  const now = ctx.view.state.turn;
  // Charging something frightening takes nerve: a failed Fear test and the charge isn't made.
  if (causesFear(target) && !causesFear(charger) && !immune(charger)) {
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
export const panic: CodeProcedure = function* (ctx, args) {
  yield* panicTest(ctx, unitOf(ctx.view, args.unit));
};

export function* panicTest(ctx: Ctx, u: Unit): Generator<Command, void, unknown> {
  const now = ctx.view.state.turn;
  yield ctx.set(`panic:${u.id}`, { round: now.round, seat: now.activeSeat, phase: ctx.view.phase });
  const { roll, ld, passed } = yield* leadershipTest(ctx, u, "Panic test");
  if (passed) {
    yield ctx.note(`${u.name} keeps its nerve (${roll.total} against ${ld})`);
    return;
  }
  const from = nearestEnemy(ctx.view.state, u);
  const left = alive(ctx.view.state, u).length;
  if (left * 2 > u.modelIds.length)
    yield* fallBack(ctx, u, from, `panics (rolled ${roll.total}, over Ld ${ld})`);
  else yield* flee(ctx, u, from, `panics (rolled ${roll.total}, over Ld ${ld})`);
}

/** Whether the unit has taken a Panic test this phase. */
export function panicTested(view: GameView, unitId: string): boolean {
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

/** Close combat targets: in contact, not fleeing, and not already fought this phase. */
function fightTargets(view: GameView, unitId: string) {
  return enemies(view, unitId, CONTACT, false).filter((x) => !foughtNow(view, x.u.id));
}

const NO_UNIT = { modelIds: [] } as unknown as Unit;

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
      const fear = view.own[`fearTest:${u.id}`] as { round: number; seat: number } | undefined;
      const now = view.state.turn;
      if (fear && fear.round === now.round && fear.seat === now.activeSeat)
        return "Failed its Fear test this turn";
      return enemies(view, u.id, 24, false).length ? true : 'No enemy within 24"';
    },
    targets: (view, actor) =>
      enemies(view, actor.unitId ?? "", 24, false).map((x) => ({
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
    id: "panic",
    name: "Panic test",
    by: "unit",
    available: panicAvailable,
    run: panic,
  },
];
