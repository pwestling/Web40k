import { unitGap } from "../../core/manoeuvre";
import type { GameState, Model, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { opposed } from "../../core/teams";
import { causesTerror, frenzied, hasRule, hatesFoe, troopOf } from "./specialRules";
import type { ChargeRecord, Fought, Roll } from "./combatKit";
import {
  CONTACT,
  HIGH_GROUND,
  MUSICIAN,
  alive,
  charNum,
  chargedFar,
  combatArc,
  combatHit,
  combatOrder,
  enemies,
  fightTargets,
  foughtNow,
  frightens,
  frontHeight,
  hasStandard,
  hitsOf,
  leadershipTest,
  owner,
  plural,
  rankBonus,
  stat,
  unitOf,
} from "./combatKit";
import type { Blow } from "./wounds";
import {
  blowOf,
  casualties,
  changeWeapon,
  eachX,
  fightingWeapon,
  keptWeapon,
  poisonous,
  strike,
  strikeOrder,
  woundAndSave,
} from "./wounds";
import { afterBreak, breakTest, chargeReaction, panic, panicAvailable, panicNear } from "./breaks";

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

/**
 * A charging unit's Initiative bonus: +1 per full inch moved before contact,
 * up to +3 into the front arc or +4 into a flank or rear.
 */
function chargeBonus(view: GameView, u: Unit): number {
  const c = view.own[`charge:${u.id}`] as ChargeRecord | undefined;
  if (!c || c.round !== view.round || u.status?.charged !== true) return 0;
  return Math.min(Math.floor(c.distance), c.arc === "front" || !c.arc ? 3 : 4);
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
    id: "changeWeapon",
    name: "Change weapon",
    by: "unit",
    applies: (view, actor) => !!keptWeapon(view, view.state.units[actor.unitId ?? ""]),
    label: (view, actor) =>
      `Fights with ${keptWeapon(view, view.state.units[actor.unitId ?? ""]) ?? "?"}: change`,
    available: () => true,
    run: changeWeapon,
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
