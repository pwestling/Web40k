import { inArc } from "../../core/regiment";
import { isAlive } from "../../core/units";
import type { GameState, Unit } from "../../core/types";
import type { CodeProcedure, GameView, PureFn, TurnHooks } from "../../sdk";

/**
 * Charges (research/conquest-rules.md, Actions): a regiment charges an enemy
 * in its front arc that it can see; it moves D6 + March. If it lands it is
 * Inspired; if it falls short it moves the die only, loses Inspired and its
 * activation is over. Advisory throughout: targets outside the arc or out of
 * sight are left out of the charge's targets, and the outcome hook below
 * reacts to the charge roll and the charge move (core TurnHooks.charge).
 */

const onTable = (state: GameState, u: Unit | undefined): u is Unit =>
  !!u && !u.status?.reserves && isAlive(state, u);

/** Whether `target` is in the front arc of `charger` and the charger sees it. */
function chargeableBy(view: GameView, charger: Unit, target: Unit): boolean {
  if (target.owner === charger.owner || !onTable(view.state, target)) return false;
  // At a real table the positions aren't the table's: leave it to the players.
  if (view.atTable) return true;
  // Kept while the models, units and terrain stay the same (every eligibility check asks; the bot a lot).
  const state = view.state;
  let memo = chargeMemo.get(state.models);
  if (!memo || memo.units !== state.units || memo.terrain !== state.terrain)
    chargeMemo.set(state.models, (memo = { units: state.units, terrain: state.terrain, seen: new Map() }));
  const key = `${charger.id}>${target.id}`;
  const known = memo.seen.get(key);
  if (known !== undefined) return known;
  const ok = inArc(state, charger, target) === "front" && view.visible(charger.id, target.id);
  memo.seen.set(key, ok);
  return ok;
}
const chargeMemo = new WeakMap<object, { units: unknown; terrain: unknown; seen: Map<string, boolean> }>();

/** The enemies a regiment may charge now: in its front arc and in sight. */
function chargeTargets(view: GameView, unitId: string): Unit[] {
  const charger = view.state.units[unitId];
  if (!onTable(view.state, charger)) return [];
  return Object.values(view.state.units).filter((u) => chargeableBy(view, charger, u));
}

/**
 * `chargeable(self)`: some enemy is in the front arc and in sight.
 * `chargeable(self, it)`: that enemy is.
 */
const chargeableFn: PureFn = (view, unitId, targetId) => {
  const charger = view.state.units[String(unitId)];
  if (!onTable(view.state, charger)) return false;
  if (targetId === undefined) return chargeTargets(view, charger.id).length > 0;
  const target = view.state.units[String(targetId)];
  return !!target && chargeableBy(view, charger, target);
};

export const chargeFunctions: Record<string, PureFn> = { chargeable: chargeableFn };

/** A regiment's March, from its first standing stand. */
function marchOf(state: GameState, unit: Unit): number {
  const m = unit.modelIds.map((id) => state.models[id]).find((x) => x && !x.destroyed);
  const v = Number.parseFloat(m?.profile?.chars.M ?? m?.profile?.chars.March ?? "");
  return Number.isFinite(v) ? v : 0;
}

/**
 * The charge outcome (TurnHooks.charge). A charge roll whose D6 + March can't
 * reach the nearest enemy in the front arc and in sight falls short; so does
 * a charge move that ends out of contact. A short charge loses Inspired and
 * ends the activation (no actions left; the short move is made by hand). A
 * charge move that ends in contact lands: the regiment is Inspired (unless
 * Broken) and the module notes `landed:<unit>` for the round.
 */
const chargeOutcome: CodeProcedure = function* (ctx, args) {
  const view = ctx.view;
  const unit = view.state.units[String(args.unitId ?? "")];
  if (!onTable(view.state, unit)) return;
  // Only a regiment that declared a Charge this round.
  if (!unit.status?.charged) return;
  let short = false;
  let why = "";
  if (args.kind === "roll") {
    if (view.atTable) return;
    const targets = chargeTargets(view, unit.id);
    if (!targets.length) return;
    const gap = Math.min(...targets.map((t) => view.distance(unit.id, t.id)));
    const reach = Number(args.roll ?? 0) + marchOf(view.state, unit);
    if (reach + 0.05 >= gap) {
      // A manual reminder at the moment it matters: how the charge move is made.
      yield ctx.note(
        `${unit.name} can reach (${reach}"): it charges straight ahead, with one free wheel of up to 90° at the start`,
      );
      return;
    }
    short = true;
    why = `${reach}" of ${Math.round(gap * 10) / 10}" needed`;
  } else if (args.kind === "move") {
    if (args.landed) {
      if (!unit.status?.broken && !unit.status?.inspired)
        yield ctx.emit({ type: "unit/status", id: unit.id, key: "inspired", value: true });
      yield ctx.set(`landed:${unit.id}`, view.round);
      const target = view.state.units[String(args.targetId ?? "")];
      yield ctx.note(`${unit.name}'s charge lands${target ? ` on ${target.name}` : ""}: Inspired`);
      return;
    }
    short = true;
    why = "it ended out of contact";
  }
  if (!short) return;
  yield ctx.set(`short:${unit.id}`, view.round);
  if (unit.status?.inspired)
    yield ctx.emit({ type: "unit/status", id: unit.id, key: "inspired", value: null });
  if (unit.status?.acting)
    yield ctx.emit({
      type: "unit/status",
      id: unit.id,
      key: "actionsTaken",
      value: Math.max(Number(unit.status.actionBudget ?? 0), Number(unit.status.actionsTaken ?? 0)),
    });
  yield ctx.note(
    `${unit.name}'s charge falls short (${why}): it moves the die's distance only, loses Inspired, and its activation is over`,
  );
};

export const chargeHooks: TurnHooks = { charge: chargeOutcome };
