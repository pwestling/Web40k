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
 * The numbers follow general knowledge of Warhammer: The Old World and are
 * unverified against the rules index; every result is advisory and lands in
 * the log, so players can correct it by hand.
 */

type Roll = { rolls: number[]; total: number };

const FLEE_DICE = "2d6";

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

function ranks(state: GameState, u: Unit): number {
  return rankCount(state, u, towRanks(state, u).width);
}

function rankBonus(state: GameState, u: Unit): number {
  return Math.min(Math.max(0, ranks(state, u) - 1), towRanks(state, u).maxBonus);
}

const hasStandard = (state: GameState, u: Unit) =>
  alive(state, u).some((m) => /standard|banner/i.test(m.profile?.name ?? ""));

const owner = (u: Unit) => u.owner;
const passes = (r: Roll, target: number) => r.total <= target || r.rolls.every((x) => x === 1);

/** To hit in combat: 3+ against a lower Weapon Skill, 5+ against more than double, else 4+. */
export function combatHit(ws: number, enemyWs: number): number {
  if (ws > enemyWs) return 3;
  if (enemyWs > ws * 2) return 5;
  return 4;
}

/** To wound: 4+ at equal Strength and Toughness, a step per point between; none at 4 or more short. */
export function toWound(s: number, t: number): number | null {
  if (t - s >= 4) return null;
  return Math.min(6, Math.max(2, 4 + t - s));
}

const count = (r: Roll, target: number) => r.rolls.filter((x) => x !== 1 && x >= target).length;

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
  const hits = count(hit, hitOn);
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

/** Leadership test on 2D6; a double 1 always passes. */
function* leadershipTest(
  ctx: Ctx,
  u: Unit,
  target: number,
  label: string,
): Generator<Command, boolean, unknown> {
  const r = (yield ctx.roll("2d6", `${label} (${target} or less)`, u.id)) as Roll;
  return passes(r, target);
}

/** A round of close combat between two units, then the combat result and break test. */
export const combat: CodeProcedure = function* (ctx, args) {
  const a = unitOf(ctx.view, args.unit);
  const b = unitOf(ctx.view, args.target);
  const charged = (u: Unit) => u.status?.charged === true;
  // Who strikes first: a charging unit, else higher Initiative; ties strike together.
  const order = (u: Unit) => (charged(u) ? 100 : 0) + stat(ctx.view, u, "I");
  const steps = order(a) === order(b) ? [[a, b]] : order(a) > order(b) ? [[a], [b]] : [[b], [a]];
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
      caused.set(def.id === a.id ? b.id : a.id, (caused.get(def.id === a.id ? b.id : a.id) ?? 0) + n);
      if (n) yield* casualties(ctx, unitOf(ctx.view, def.id), n);
    }
  }

  // Combat result.
  const state = ctx.view.state;
  const score = (u: Unit, other: Unit) => {
    const parts: string[] = [];
    let s = caused.get(u.id) ?? 0;
    if (s) parts.push(`${s} wounds`);
    const rb = rankBonus(state, u);
    if (rb) parts.push(`ranks +${rb}`);
    s += rb;
    const add = (n: number, why: string) => {
      s += n;
      parts.push(why);
    };
    if (hasStandard(state, u)) add(1, "standard +1");
    if (charged(u)) add(1, "charge +1");
    const arc = inArc(state, other, u);
    if (arc === "rear") add(2, "rear +2");
    else if (arc === "left" || arc === "right") add(1, "flank +1");
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

  // Break test: Leadership minus the difference, unless steadfast (more ranks than the winner).
  const steadfast = ranks(ctx.view.state, lost) > ranks(ctx.view.state, unitOf(ctx.view, winner.id));
  const ld = leadership(ctx.view.state, lost);
  const target = steadfast ? ld : ld - diff;
  const held = yield* leadershipTest(
    ctx,
    lost,
    target,
    steadfast ? "break test, steadfast" : `break test, -${diff}`,
  );
  if (held) {
    yield ctx.note(`${lost.name} holds`);
    return;
  }
  yield* flee(ctx, lost, "breaks");
  const pick = yield ctx.ask(owner(winner), `${lost.name} flees. Does ${winner.name} pursue?`, [
    { id: "pursue", label: "Pursue" },
    { id: "restrain", label: "Restrain (Leadership test)" },
  ]);
  if (pick === "pursue") {
    yield ctx.note(`${winner.name} pursues`);
    return;
  }
  const kept = yield* leadershipTest(
    ctx,
    unitOf(ctx.view, winner.id),
    leadership(ctx.view.state, winner),
    "restraint",
  );
  yield ctx.note(
    kept ? `${winner.name} holds its ground` : `${winner.name} fails to restrain and must pursue`,
  );
};

/** The charged unit's reaction: hold, stand and shoot (missile troops), or flee. */
export const chargeReaction: CodeProcedure = function* (ctx, args) {
  const charger = unitOf(ctx.view, args.unit);
  const target = unitOf(ctx.view, args.target);
  const shoots = Object.values(target.sheet?.weapons ?? {}).some((w) => w.kind === "ranged");
  yield ctx.note(`${charger.name} declares a charge against ${target.name}`);
  yield ctx.emit({ type: "unit/status", id: charger.id, key: "charged", value: true });
  const pick = yield ctx.ask(owner(target), `${charger.name} charges ${target.name}. Reaction?`, [
    { id: "hold", label: "Hold" },
    ...(shoots ? [{ id: "shoot", label: "Stand and shoot" }] : []),
    { id: "flee", label: "Flee" },
  ]);
  if (pick === "hold") yield ctx.note(`${target.name} holds`);
  if (pick === "shoot") {
    yield ctx.emit({ type: "unit/status", id: target.id, key: "standAndShoot", value: true });
    yield ctx.note(`${target.name} stands and shoots (use Shoot; -1 to hit)`);
  }
  if (pick === "flee") yield* flee(ctx, target, "won't face the charge");
};

/** A Panic test: Leadership on 2D6, or flee. */
export const panic: CodeProcedure = function* (ctx, args) {
  const u = unitOf(ctx.view, args.unit);
  const ok = yield* leadershipTest(ctx, u, leadership(ctx.view.state, u), "Panic test");
  if (ok) yield ctx.note(`${u.name} keeps its nerve`);
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
