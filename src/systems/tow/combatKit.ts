import { awayFrom, fleeMove, unitCentre, unitGap } from "../../core/manoeuvre";
import { arcOf, blockCentre, blockFrame, blockModels, inArc, rankCount, type Arc } from "../../core/regiment";
import type { GameState, Model, Unit } from "../../core/types";
import type { Command, Ctx, GameView } from "../../sdk";
import { towRanks } from "./troops";
import { opposed } from "../../core/teams";
import {
  causesFear,
  hasBattleStandard,
  hasRule,
  randomMovement,
  immune,
  isGeneral,
  troopOf,
} from "./specialRules";

/**
 * The Old World's shared combat helpers (split from combat.ts, #70): units,
 * stats and Leadership, the Weapon Skill and wound charts, combat arcs, and
 * moving a unit that flees or falls back. Imports nothing from its siblings.
 */

export type Roll = { rolls: number[]; total: number };

const FLEE_DICE = "2d6";
/** Falling back in good order: 2D6, discarding the lowest. */
const FALL_BACK_DICE = "2d6";
/** Giving ground: straight back this far. */
export const GIVE_GROUND = 2;
/** Pursuit distance. */
export const PURSUE_DICE = "2d6";

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

/** A unit's Movement in inches; a random Movement ("2D6+1") counts as its average roll. */
export function moveOf(view: GameView, u: Unit): number {
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

export function rankBonus(state: GameState, u: Unit): number {
  if (disrupted(u)) return 0;
  const ranks = rankCount(state, u, towRanks(state, u).width);
  return Math.min(Math.max(0, ranks - 1), towRanks(state, u).maxBonus);
}

/**
 * Combat order: a close-order block at least as wide as it is deep. With Unit
 * Strength 10 or more it adds +1 to the combat result (rules index).
 */
export function combatOrder(state: GameState, u: Unit): boolean {
  if (u.formation.kind !== "ranked" || disrupted(u)) return false;
  const order = u.formation.order ?? "close";
  if (order !== "close") return false;
  const files = u.formation.files;
  return files >= Math.ceil(alive(state, u).length / Math.max(1, files));
}

/** How much higher one fighting rank must stand to hold the high ground, in inches. */
export const HIGH_GROUND = 0.5;

/** The average height of a block's front rank (models stand at their floor's height). */
export function frontHeight(state: GameState, u: Unit): number {
  const ms = alive(state, u);
  const files = u.formation.kind === "ranked" ? u.formation.files : ms.length;
  const front = ms.slice(0, Math.max(1, files));
  return front.reduce((t, m) => t + (m.z ?? 0), 0) / Math.max(1, front.length);
}

export const hasStandard = (state: GameState, u: Unit) =>
  alive(state, u).some((m) => /standard|banner/i.test(m.profile?.name ?? ""));

export const owner = (u: Unit) => u.owner;

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
export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
export const count = (r: Roll, target: number) => r.rolls.filter((x) => x !== 1 && x >= target).length;
/** To hit: a natural 6 always hits, a natural 1 always misses. */
export const hitsOf = (r: Roll, target: number) =>
  r.rolls.filter((x) => x === 6 || (x !== 1 && x >= target)).length;

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
export function chargedFar(view: GameView, u: Unit): boolean {
  const c = view.own[`charge:${u.id}`] as ChargeRecord | undefined;
  return u.status?.charged === true && !!c && c.round === view.round && c.distance >= 3;
}

/**
 * Press of Battle: a unit in combat order that didn't charge this turn fights
 * two ranks deep.
 */
export const pressOfBattle = (state: GameState, u: Unit) =>
  hasRule(u, /^press of battle\b/i) && u.status?.charged !== true && combatOrder(state, u);

/** Unit Strength: each model standing counts its own (Fear compares them). */
const unitStrength = (state: GameState, u: Unit) =>
  alive(state, u).reduce((t, m) => t + Math.max(1, charNum(m, "US", 1)), 0);

/**
 * Whether `foe` frightens `u`: it causes Fear (or has Flaming Attacks and `u`
 * is war beasts or a swarm) and has the higher Unit Strength; units that cause
 * Fear, and units immune to psychology, aren't afraid.
 */
export function frightens(state: GameState, foe: Unit, u: Unit): boolean {
  const scary =
    causesFear(foe) || (hasRule(foe, /^flaming attacks\b/i) && /war beast|swarm/i.test(troopOf(state, u)));
  return scary && !causesFear(u) && !immune(u) && unitStrength(state, foe) > unitStrength(state, u);
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
export function* moveAway(ctx: Ctx, u: Unit, from: Unit | undefined, inches: number, turn: boolean) {
  const state = ctx.view.state;
  if (!from || inches <= 0) return;
  const away = awayFrom(state, u, unitCentre(state, from));
  const move = fleeMove(state, u, away, inches);
  if (move) yield ctx.emit(turn ? move : { ...move, turn: 0, how: "drag" });
}

/** Swiftstride: a flee or pursuit roll with +D6 (always taken: further is what the unit wants). */
const swift = (u: Unit) => hasRule(u, /^swiftstride\b/i);
export function* swiftRoll(
  ctx: Ctx,
  u: Unit,
  dice: string,
  label: string,
): Generator<Command, Roll, unknown> {
  const r = (yield ctx.roll(dice, label, u.id)) as Roll;
  if (!swift(u)) return r;
  const more = (yield ctx.roll("1d6", `${label}: Swiftstride +D6`, u.id)) as Roll;
  return { rolls: r.rolls, total: r.total + more.total };
}

/** The unit flees 2D6" from `from` and is marked fleeing. */
export function* flee(
  ctx: Ctx,
  u: Unit,
  from: Unit | undefined,
  why: string,
): Generator<Command, void, unknown> {
  const r = yield* swiftRoll(ctx, u, FLEE_DICE, "flee roll");
  yield ctx.emit({ type: "unit/status", id: u.id, key: "fleeing", value: true });
  yield* moveAway(ctx, unitOf(ctx.view, u.id), from, r.total, true);
  yield ctx.note(`${u.name} ${why} and flees ${r.total}"`);
}

/** Falls back in good order: moves like a fleeing unit (2D6, lowest discarded), then rallies at once. */
export function* fallBack(
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
export interface ChargeRecord {
  target: string;
  distance: number;
  arc: string | null;
  round: number;
}

/** When a unit fought this phase, and the result line. */
export interface Fought {
  round: number;
  seat: number;
  phase: string | null;
  against: string;
  result: string;
}

/** This unit's fight this phase, if it had one. */
export function foughtNow(view: GameView, unitId: string): Fought | undefined {
  const f = view.own[`fought:${unitId}`] as Fought | undefined;
  const now = view.state.turn;
  return f && f.round === now.round && f.seat === now.activeSeat && f.phase === view.phase ? f : undefined;
}

/** Enemy units within this gap of this one, nearest first. */
export function enemies(view: GameView, unitId: string, within: number, fleeing = true) {
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
export const CONTACT = 0.5;

export const MUSICIAN = /musician|drummer|horn|bugler|trumpeter/i;

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
export function fightTargets(view: GameView, unitId: string) {
  return enemies(view, unitId, CONTACT, false).filter((x) => !foughtNow(view, x.u.id));
}
