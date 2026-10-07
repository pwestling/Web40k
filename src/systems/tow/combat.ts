import { blockModels, inArc, rankCount } from "../../core/regiment";
import type { GameState, Model, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { towRanks } from "./troops";

/**
 * Close combat, charge reactions, break tests and Panic for rank-and-flank
 * play, as code procedures (the game modules spec, step 3). Movement stays
 * by hand: fleeing and pursuit use the Charge panel, which picks up the
 * "flee roll" these log for the unit.
 *
 * Checked against the community rules index (tow.whfb.app, 2026-10-07): the
 * Weapon Skill chart, charging Initiative, combat result bonuses, the three
 * break test outcomes, Panic, flee and fall back rolls, restraint and Stand &
 * Shoot range. Not covered: high ground, overkill, special rules (Stubborn,
 * Unbreakable...), and supporting attacks assume every second-rank model may
 * make one. Every result is advisory and lands in the log.
 */

type Roll = { rolls: number[]; total: number };

const FLEE_DICE = "2d6";
/** Falling back in good order: 2D6, discarding the lowest. */
const FALL_BACK_DICE = "2d6";
/** Giving ground: straight back this far. */
const GIVE_GROUND = 2;

function unitOf(view: GameView, id: unknown): Unit {
  const u = view.state.units[String(id)];
  if (!u) throw new Error(`No unit "${String(id)}"`);
  return u;
}

const alive = (state: GameState, u: Unit) => blockModels(state, u);
const charNum = (m: Model | undefined, k: string, d = 0) => {
  const v = Number.parseFloat(m?.profile?.chars[k] ?? "");
  return Number.isFinite(v) ? v : d;
};

/** The unit's characteristic as its commonest profile has it (from the unit view). */
function stat(view: GameView, u: Unit, id: string, d = 0): number {
  const v = (view.unit(u.id) as Record<string, unknown> | undefined)?.[id];
  return typeof v === "number" ? v : d;
}

/** Leadership: the best in the unit (a character or champion lends theirs). */
function leadership(state: GameState, u: Unit): number {
  return Math.max(0, ...alive(state, u).map((m) => charNum(m, "Ld")));
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

/**
 * One side's attacks against another: the front rank's Attacks plus one
 * supporting attack from each model in the second rank, then to hit, to
 * wound, armour, ward and regeneration. Returns the unsaved wounds.
 */
function* strike(ctx: Ctx, atk: Unit, def: Unit): Generator<Command, number, unknown> {
  const view = ctx.view;
  const state = view.state;
  const models = alive(state, atk).length;
  if (!models || !alive(state, def).length) return 0;
  const files = atk.formation.kind === "ranked" ? Math.min(atk.formation.files, models) : models;
  const support = atk.formation.kind === "ranked" ? Math.min(files, models - files) : 0;
  const attacks = files * Math.max(1, stat(view, atk, "A", 1)) + support;
  const hitOn = combatHit(stat(view, atk, "WS"), stat(view, def, "WS"));
  const hit = (yield ctx.roll(`${attacks}d6`, `to hit (${hitOn}+)`, atk.id)) as Roll;
  const hits = hitsOf(hit, hitOn);
  if (!hits) return 0;
  const woundOn = toWound(stat(view, atk, "S"), stat(view, def, "T"));
  if (woundOn === null) {
    yield ctx.note(`${atk.name} can't wound ${def.name}`);
    return 0;
  }
  const wound = (yield ctx.roll(`${hits}d6`, `to wound (${woundOn}+)`, atk.id)) as Roll;
  let left = count(wound, woundOn);
  for (const [save, name] of [
    ["armour", "armour"],
    ["ward", "ward"],
    ["regen", "regeneration"],
  ] as const) {
    const on = stat(view, def, save, save === "armour" ? 7 : 0);
    if (!left || on < 2 || on > 6) continue;
    const r = (yield ctx.roll(`${left}d6`, `${name} save (${on}+)`, def.id)) as Roll;
    left -= count(r, on);
  }
  return left;
}

/** Casualties come off the rear rank: wounded models first, then rank and file, the command group last. */
function* casualties(ctx: Ctx, def: Unit, wounds: number): Generator<Command, void, unknown> {
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

/** A failed test: the unit flees; the Charge panel moves it by this roll. */
function* flee(ctx: Ctx, u: Unit, why: string): Generator<Command, void, unknown> {
  const r = (yield ctx.roll(FLEE_DICE, "flee roll", u.id)) as Roll;
  yield ctx.emit({ type: "unit/status", id: u.id, key: "fleeing", value: true });
  yield ctx.note(`${u.name} ${why} and flees ${r.total}"`);
}

/** Falls back in good order: moves like a fleeing unit (2D6, lowest discarded), then rallies at once. */
function* fallBack(ctx: Ctx, u: Unit, why: string): Generator<Command, void, unknown> {
  const r = (yield ctx.roll(FALL_BACK_DICE, "fall back roll", u.id)) as Roll;
  yield ctx.note(
    `${u.name} ${why} and falls back in good order ${Math.max(...r.rolls)}" (it rallies at the end)`,
  );
}

/** Leadership test: 2D6 equal to or under Leadership. */
function* leadershipTest(
  ctx: Ctx,
  u: Unit,
  target: number,
  label: string,
): Generator<Command, Roll, unknown> {
  return (yield ctx.roll("2d6", `${label} (${target} or less)`, u.id)) as Roll;
}

/** The charge declared for a unit this turn (chargeReaction records it): distance to the target and the arc. */
interface ChargeRecord {
  target: string;
  distance: number;
  arc: string | null;
  round: number;
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

/** A round of close combat between two units, then the combat result and break test. */
export const combat: CodeProcedure = function* (ctx, args) {
  const a = unitOf(ctx.view, args.unit);
  const b = unitOf(ctx.view, args.target);
  // Highest Initiative strikes first; models with the same Initiative strike together.
  const init = (u: Unit) => stat(ctx.view, u, "I") + chargeBonus(ctx.view, u);
  for (const u of [a, b]) {
    const bonus = chargeBonus(ctx.view, u);
    if (bonus) yield ctx.note(`${u.name} charged: Initiative +${bonus}`);
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
      hits.push([def, yield* strike(ctx, atk, def)]);
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
  yield ctx.note(
    `Combat result: ${a.name} ${sa.s} (${sa.parts.join(", ") || "nothing"}) against ${b.name} ${sb.s} (${sb.parts.join(", ") || "nothing"})`,
  );
  yield ctx.set("lastCombat", { a: a.id, b: b.id, scores: [sa.s, sb.s] });
  if (sa.s === sb.s) {
    yield ctx.note("The combat is a draw");
    return;
  }
  const [winner, loser, diff] = sa.s > sb.s ? [a, b, sa.s - sb.s] : [b, a, sb.s - sa.s];
  const lost = unitOf(ctx.view, loser.id);
  if (!alive(ctx.view.state, lost).length) return;

  // Break test: 2D6 against Leadership. Over it on the natural roll: break and flee. Within it
  // naturally but over once the difference is added: fall back in good order. Otherwise (or a
  // double 1): give ground.
  const ld = leadership(ctx.view.state, lost);
  const r = yield* leadershipTest(ctx, lost, ld, `break test, +${diff}`);
  const double1 = r.rolls.every((x) => x === 1);
  let fled = false;
  if (!double1 && r.total > ld) {
    yield* flee(ctx, lost, "breaks");
    fled = true;
  } else if (!double1 && r.total + diff > ld) {
    yield* fallBack(ctx, lost, `gives way (${r.total} + ${diff})`);
    fled = true;
  } else yield ctx.note(`${lost.name} gives ground ${GIVE_GROUND}"`);

  const pick = yield ctx.ask(
    owner(winner),
    fled ? `${lost.name} falls back. Does ${winner.name} pursue?` : `Does ${winner.name} follow up?`,
    [
      { id: "go", label: fled ? "Pursue" : "Follow up" },
      { id: "restrain", label: "Restrain (Leadership test)" },
    ],
  );
  const verb = fled ? "pursues (Charge panel: Roll to pursue)" : "follows up";
  if (pick === "go") {
    yield ctx.note(`${winner.name} ${verb}`);
    return;
  }
  const w = unitOf(ctx.view, winner.id);
  const wld = leadership(ctx.view.state, w);
  const kept = (yield* leadershipTest(ctx, w, wld, "restraint")).total <= wld;
  yield ctx.note(
    kept ? `${winner.name} restrains and may reform` : `${winner.name} fails to restrain and ${verb}`,
  );
};

/** The charged unit's reaction: hold, stand and shoot (missile troops, not too close), or flee. */
export const chargeReaction: CodeProcedure = function* (ctx, args) {
  const charger = unitOf(ctx.view, args.unit);
  const target = unitOf(ctx.view, args.target);
  const distance = ctx.view.distance(charger.id, target.id);
  const shoots =
    Object.values(target.sheet?.weapons ?? {}).some((w) => w.kind === "ranged") &&
    !target.status?.fleeing &&
    distance >= stat(ctx.view, charger, "M");
  yield ctx.note(`${charger.name} declares a charge against ${target.name} (${distance.toFixed(1)}" away)`);
  yield ctx.emit({ type: "unit/status", id: charger.id, key: "charged", value: true });
  const record: ChargeRecord = {
    target: target.id,
    distance,
    arc: inArc(ctx.view.state, target, charger),
    round: ctx.view.round,
  };
  yield ctx.set(`charge:${charger.id}`, record);
  const pick = yield ctx.ask(owner(target), `${charger.name} charges ${target.name}. Reaction?`, [
    { id: "hold", label: "Hold" },
    ...(shoots ? [{ id: "shoot", label: "Stand and shoot" }] : []),
    { id: "flee", label: "Flee" },
  ]);
  if (pick === "hold") yield ctx.note(`${target.name} holds`);
  if (pick === "shoot") {
    yield ctx.emit({ type: "unit/status", id: target.id, key: "standAndShoot", value: true });
    yield ctx.note(`${target.name} stands and shoots (use Shoot), then holds`);
  }
  if (pick === "flee") yield* flee(ctx, target, "won't face the charge");
};

/**
 * A Panic test: Leadership on 2D6. On a fail the unit falls back in good
 * order if more than half its models remain, else it flees.
 */
export const panic: CodeProcedure = function* (ctx, args) {
  const u = unitOf(ctx.view, args.unit);
  const ld = leadership(ctx.view.state, u);
  const r = yield* leadershipTest(ctx, u, ld, "Panic test");
  if (r.total <= ld) {
    yield ctx.note(`${u.name} keeps its nerve`);
    return;
  }
  const left = alive(ctx.view.state, u).length;
  if (left * 2 > u.modelIds.length) yield* fallBack(ctx, u, "panics");
  else yield* flee(ctx, u, "panics");
};

/** Enemy units within reach of this one (base contact for combat). */
function enemies(view: GameView, unitId: string, within: number) {
  const me = view.state.units[unitId];
  return Object.values(view.state.units)
    .filter((u) => me && u.owner !== me.owner && alive(view.state, u).length)
    .map((u) => ({ u, d: view.distance(unitId, u.id) }))
    .filter((x) => x.d <= within)
    .sort((x, y) => x.d - y.d);
}

/** Touching, for close combat. */
const CONTACT = 0.5;

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
      return enemies(view, u.id, 24).length ? true : 'No enemy within 24"';
    },
    targets: (view, actor) =>
      enemies(view, actor.unitId ?? "", 24).map((x) => ({
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
    available: (view, actor) =>
      enemies(view, actor.unitId ?? "", CONTACT).length ? true : "Not in base contact with an enemy",
    targets: (view, actor) =>
      enemies(view, actor.unitId ?? "", CONTACT).map((x) => ({ unitId: x.u.id, label: x.u.name })),
    run: combat,
  },
  {
    id: "panic",
    name: "Panic test",
    by: "unit",
    available: (view, actor) =>
      view.state.units[actor.unitId ?? ""]?.status?.fleeing ? "Already fleeing" : true,
    run: panic,
  },
];
