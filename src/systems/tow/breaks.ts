import { fleeMove, unitCentre, unitGap } from "../../core/manoeuvre";
import { inArc } from "../../core/regiment";
import type { GameState, Model, Unit } from "../../core/types";
import type { CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { opposed } from "../../core/teams";
import { causesTerror, frenzied, hatesFoe, immune, stubborn, unbreakable } from "./specialRules";
import type { ChargeRecord } from "./combatKit";
import {
  GIVE_GROUND,
  PURSUE_DICE,
  alive,
  fallBack,
  fightTargets,
  flee,
  frightens,
  inCombat,
  leadershipTest,
  moveAway,
  moveOf,
  nearestEnemy,
  owner,
  stat,
  swiftRoll,
  unitOf,
} from "./combatKit";
import { casualties, shoot } from "./wounds";

/**
 * What comes after the blows in the Old World (split from combat.ts, #70):
 * break tests, Heavy Losses, Panic, fleeing and pursuit, and charge reactions.
 */

/**
 * One losing unit's break test, and what it does: flee, fall back in good
 * order, or give ground. Unbreakable units give ground with no test; a
 * Stubborn unit's first break test is a fall back in good order.
 */
export function* breakTest(
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
export function* panicNear(
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
export function* afterBreak(
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
export const chargeReaction: CodeProcedure = function* (ctx, args) {
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
export const panic: CodeProcedure = function* (ctx, args) {
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
export function panicAvailable(view: GameView, actor: { unitId?: string }): true | string {
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
