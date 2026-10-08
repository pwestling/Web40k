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
 * Shoot (range and -1 to hit) and the shooting to-hit modifiers. Not covered:
 * high ground, overkill, special rules (Stubborn, Unbreakable...), and
 * supporting attacks assume every second-rank model may make one. Every
 * result is advisory and lands in the log.
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

function rankBonus(state: GameState, u: Unit): number {
  const ranks = rankCount(state, u, towRanks(state, u).width);
  return Math.min(Math.max(0, ranks - 1), towRanks(state, u).maxBonus);
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
): Generator<Command, number, unknown> {
  const view = ctx.view;
  const state = view.state;
  const models = alive(state, atk).length;
  if (!models || !alive(state, def).length) return 0;
  const files = atk.formation.kind === "ranked" ? Math.min(atk.formation.files, models) : models;
  const support = atk.formation.kind === "ranked" ? Math.min(files, models - files) : 0;
  const frenzy = frenzied(atk) ? 1 : 0;
  const attacks = files * (Math.max(1, stat(view, atk, "A", 1)) + frenzy) + support;
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

/** A round of close combat between two units, then the combat result and break test. */
export const combat: CodeProcedure = function* (ctx, args) {
  const a = unitOf(ctx.view, args.unit);
  const b = unitOf(ctx.view, args.target);
  yield ctx.note(`${a.name} fight ${b.name}`);
  // Highest Initiative strikes first; models with the same Initiative strike together.
  const init = (u: Unit) => stat(ctx.view, u, "I") + chargeBonus(ctx.view, u);
  for (const u of [a, b]) {
    const bonus = chargeBonus(ctx.view, u);
    if (bonus) yield ctx.note(`${u.name} charged: Initiative +${bonus}`);
  }
  // Psychology before the blows: Fear tests, and Hatred the first time these two fight.
  const how = new Map<string, { afraid?: boolean; hatred?: boolean }>();
  for (const [u, foe] of [
    [a, b],
    [b, a],
  ] as const) {
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
  const steps = init(a) === init(b) ? [[a, b]] : init(a) > init(b) ? [[a], [b]] : [[b], [a]];
  const caused = new Map<string, number>([
    [a.id, 0],
    [b.id, 0],
  ]);
  for (const step of steps) {
    // Everyone in a step strikes before anyone in it is removed.
    const hits: [Unit, number][] = [];
    for (const u of step) {
      const atk = unitOf(ctx.view, u.id);
      const def = unitOf(ctx.view, (u.id === a.id ? b : a).id);
      hits.push([def, yield* strike(ctx, atk, def, how.get(u.id))]);
    }
    for (const [def, n] of hits) {
      const by = def.id === a.id ? b.id : a.id;
      caused.set(by, (caused.get(by) ?? 0) + n);
      if (n) yield* casualties(ctx, unitOf(ctx.view, def.id), n);
    }
  }

  // Combat result.
  const state = ctx.view.state;
  const strength = (u: Unit) => alive(state, u).reduce((t, m) => t + Math.max(1, charNum(m, "US", 1)), 0);
  const massed = (u: Unit) => (u.sheet?.abilities ?? []).some((x) => /massed infantry/i.test(x.name));
  const score = (u: Unit, other: Unit) => {
    const parts: string[] = [];
    let s = caused.get(u.id) ?? 0;
    const add = (n: number, why: string) => {
      s += n;
      parts.push(why);
    };
    if (s) parts.push(`${s} wounds`);
    if (u.formation.kind !== "ranked" || u.formation.order !== "disrupted") {
      const rb = rankBonus(state, u);
      if (rb) add(rb, `ranks +${rb}`);
    }
    if (hasStandard(state, u)) add(1, "standard +1");
    if (alive(state, u).some((m) => /battle standard/i.test(m.profile?.name ?? "")))
      add(1, "battle standard +1");
    const arc = inArc(state, other, u);
    if (arc === "rear") add(2, "rear +2");
    else if (arc === "left" || arc === "right") add(1, "flank +1");
    if (massed(u) && strength(u) > strength(other)) add(1, "massed infantry +1");
    return { s, parts };
  };
  const sa = score(unitOf(ctx.view, a.id), unitOf(ctx.view, b.id));
  const sb = score(unitOf(ctx.view, b.id), unitOf(ctx.view, a.id));
  const result = `${a.name} ${sa.s} (${sa.parts.join(", ") || "nothing"}) against ${b.name} ${sb.s} (${sb.parts.join(", ") || "nothing"})`;
  yield ctx.note(`Combat result: ${result}`);
  const now = ctx.view.state.turn;
  for (const [u, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const fought: Fought = {
      round: now.round,
      seat: now.activeSeat,
      phase: ctx.view.phase,
      against: other.id,
      result,
    };
    yield ctx.set(`fought:${u.id}`, fought);
  }
  if (sa.s === sb.s) {
    yield ctx.note("The combat is a draw");
    return;
  }
  const [winner, loser, diff] = sa.s > sb.s ? [a, b, sa.s - sb.s] : [b, a, sb.s - sa.s];
  const lost = unitOf(ctx.view, loser.id);
  if (frenzied(lost)) {
    yield ctx.emit({ type: "unit/status", id: lost.id, key: "frenzyLost", value: true });
    yield ctx.note(`${lost.name} lost the combat and its Frenzy with it`);
  }
  if (!alive(ctx.view.state, lost).length) return;

  // Break test: 2D6 against Leadership. Over it on the natural roll: break and flee. Within it
  // naturally but over once the difference is added: fall back in good order. Otherwise (or a
  // double 1): give ground.
  const {
    roll: r,
    ld,
    score: total,
  } = yield* leadershipTest(ctx, lost, "break test", diff, `lost by ${diff}`);
  const double1 = r.rolls.every((x) => x === 1);
  const won = unitOf(ctx.view, winner.id);
  let fled: "" | "flees" | "falls back" = "";
  if (!double1 && r.total > ld) {
    yield* flee(ctx, lost, won, `breaks (rolled ${r.total}, over Ld ${ld})`);
    fled = "flees";
  } else if (!double1 && r.total + diff > ld) {
    yield* fallBack(ctx, lost, won, `gives way (${total}, over Ld ${ld})`);
    fled = "falls back";
  } else {
    yield* moveAway(ctx, lost, won, GIVE_GROUND, false);
    yield ctx.note(
      `${lost.name} gives ground ${GIVE_GROUND}" (${double1 ? "a double 1" : `${total}, within Ld ${ld}`})`,
    );
  }

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
};

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
  const u = unitOf(ctx.view, args.unit);
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
};

/**
 * When a Panic test is called for (advisory: the players can still roll one by hand): in the
 * Shooting or Combat phase, once a turn, for a unit that has lost models or has a friendly unit
 * within 6" destroyed or fleeing.
 */
function panicAvailable(view: GameView, actor: { unitId?: string }): true | string {
  const state = view.state;
  const u = state.units[actor.unitId ?? ""];
  if (!u) return "No unit";
  if (u.status?.fleeing) return "Already fleeing";
  if (immune(u)) return frenzied(u) ? "Frenzied: immune to Panic" : "Immune to Psychology";
  if (view.phase !== "shooting" && view.phase !== "combat") return "Only after shooting or combat";
  const t = view.own[`panic:${u.id}`] as { round: number; seat: number; phase: string | null } | undefined;
  const now = state.turn;
  if (t && t.round === now.round && t.seat === now.activeSeat && t.phase === view.phase)
    return "Already tested this phase";
  if (u.modelIds.some((id) => state.models[id]?.destroyed)) return true;
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
  return shaken ? true : "Nothing to panic about: no losses, and no friend nearby destroyed or fleeing";
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
    id: "panic",
    name: "Panic test",
    by: "unit",
    available: panicAvailable,
    run: panic,
  },
];
