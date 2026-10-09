import { modelSight } from "../../core/los";
import { isAlive } from "../../core/units";
import type { GameState, Unit } from "../../core/types";
import type { CodeProcedure, Command, PureFn } from "../../sdk";

/**
 * Special rules the module plays in code (#66), each found by its name on the
 * regiment (system.ts lists them with `played: "code"`):
 *  - Lethal Demise: each wound the regiment takes is a hit back on the enemy
 *    in contact that caused it;
 *  - Aura of Death: at the start of each round, each enemy in contact takes a
 *    hit per stand with it;
 *  - Fluid Formation and Arcing Fire sight for volleys (`friendSees`,
 *    `seesAllRound`), Vanguard's 8" (`enemyWithin`), and Fluid Formation's
 *    first-or-last Reform (`midActivation`).
 * Hits are rolled through the "hits" procedure: no hit roll, then Defense and
 * Resolve as usual. Names and our own paraphrase only.
 */

const onTable = (state: GameState, u: Unit | undefined): u is Unit =>
  !!u && !u.status?.reserves && isAlive(state, u);

/** Whether the regiment has a special rule, by the start of an ability's name. */
export function hasNamed(unit: Unit | undefined, name: RegExp): boolean {
  return (unit?.sheet?.abilities ?? []).some((a) => name.test(a.name.trim()));
}
const LETHAL_DEMISE = /^lethal demise\b/i;
const AURA_OF_DEATH = /^aura of death\b/i;
export const FLUID_FORMATION = /^fluid formation\b/i;
export const UNSTOPPABLE = /^unstoppable(?!\s+charge)\b/i;

const standing = (state: GameState, u: Unit) =>
  u.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [m] : [];
  });

/** In contact: within the Clash action's reach (command.ts). */
const IN_CONTACT = 1 + 1e-4;

/** `woundsLeft(unit)`: the wounds its standing stands have left. */
const woundsLeft: PureFn = (view, unitId) => {
  const u = view.state.units[String(unitId)];
  if (!u) return 0;
  return standing(view.state, u).reduce(
    (n, m) => n + Math.max(0, (Number.parseInt(m.profile?.chars.W ?? "1", 10) || 1) - (m.woundsLost ?? 0)),
    0,
  );
};

/** `friendSees(self, target)`: another regiment of its side sees the target (Arcing Fire). */
const friendSees: PureFn = (view, selfId, targetId) => {
  const self = view.state.units[String(selfId)];
  if (!self) return false;
  if (view.atTable) return true;
  return Object.values(view.state.units).some(
    (u) =>
      u.owner === self.owner &&
      u.id !== self.id &&
      onTable(view.state, u) &&
      view.visible(u.id, String(targetId)),
  );
};

/** `enemyWithin(self, inches)`: an enemy regiment on the table that close (Vanguard). */
const enemyWithin: PureFn = (view, selfId, inches) => {
  const self = view.state.units[String(selfId)];
  if (!self || view.atTable) return false;
  return Object.values(view.state.units).some(
    (u) => u.owner !== self.owner && onTable(view.state, u) && view.distance(self.id, u.id) <= Number(inches),
  );
};

/** `midActivation(self)`: some of its actions taken, some left (Fluid Formation reforms first or last). */
const midActivation: PureFn = (view, selfId) => {
  const st = view.state.units[String(selfId)]?.status ?? {};
  const taken = Number(st.actionsTaken ?? 0);
  return !!st.acting && taken > 0 && taken < Number(st.actionBudget ?? 0);
};

/** `pendingHits(target)`: the hits waiting for the "hits" procedure against it. */
const pendingHits: PureFn = (view, targetId) => Number(view.own[hitsKey(String(targetId))] ?? 0);
const hitsKey = (unitId: string) => `hits:${unitId}`;

/**
 * Whether a stand sees the target regiment all round (Fluid Formation): the
 * game's vision arc doesn't apply.
 */
export function seesAllRound(state: GameState, standId: string, target: Unit): boolean {
  const stand = state.models[standId];
  if (!stand) return false;
  const own = new Set([
    ...(stand.unitId ? (state.units[stand.unitId]?.modelIds ?? []) : []),
    ...target.modelIds,
  ]);
  return standing(state, target).some(
    (m) =>
      modelSight(state, stand, m, { allAround: true, modelsBlock: state.settings.modelsBlock, ignore: own })
        .visible,
  );
}

/** `n` hits on `target` from `from`, rolled through the "hits" procedure. */
function* hitsOn(
  ctx: Parameters<CodeProcedure>[0],
  from: Unit,
  target: Unit,
  n: number,
  why: string,
): Generator<Command, void, unknown> {
  if (n <= 0) return;
  yield ctx.note(`${why}: ${target.name} takes ${n} hit${n === 1 ? "" : "s"}`);
  yield ctx.set(hitsKey(target.id), n);
  yield ctx.run("hits", { attacker: from.id, target: target.id });
  yield ctx.set(hitsKey(target.id), 0);
}

/**
 * Lethal Demise, after an attack on a regiment with it (system.ts aftermath
 * passes `attacker` and `hp`, the wounds it had left as the attack began):
 * each wound taken is a hit on the attacker, when in contact.
 */
export const lethalDemise: CodeProcedure = function* (ctx, args) {
  const view = ctx.view;
  const unit = view.state.units[String(args.unit ?? "")];
  const attacker = view.state.units[String(args.attacker ?? "")];
  if (args.chained || !unit || !onTable(view.state, attacker) || !hasNamed(unit, LETHAL_DEMISE)) return;
  if (args.hp === undefined) return;
  if (!view.atTable && view.distance(unit.id, attacker.id) > IN_CONTACT) return;
  const taken = Number(args.hp) - Number(woundsLeft(view, unit.id));
  yield* hitsOn(ctx, unit, attacker, taken, `${unit.name}'s Lethal Demise`);
};

/** Aura of Death, at the start of each round: a hit on each enemy in contact per stand with it. */
const auraOfDeath: CodeProcedure = function* (ctx) {
  const view = ctx.view;
  if (view.atTable) return;
  const state = view.state;
  for (const unit of Object.values(state.units)) {
    if (!onTable(state, unit) || !hasNamed(unit, AURA_OF_DEATH)) continue;
    const stands = standing(state, unit).length;
    for (const enemy of Object.values(state.units))
      if (
        enemy.owner !== unit.owner &&
        onTable(state, enemy) &&
        view.distance(unit.id, enemy.id) <= IN_CONTACT
      )
        yield* hitsOn(ctx, unit, enemy, stands, `${unit.name}'s Aura of Death`);
  }
};

export const specialFunctions: Record<string, PureFn> = {
  woundsLeft,
  friendSees,
  enemyWithin,
  midActivation,
  pendingHits,
};

export const specialHooks = { roundStart: auraOfDeath };
