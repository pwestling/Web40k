import type { GameState, Unit } from "../../core/types";
import type { CodeProcedure } from "../../sdk";
import { lethalDemise } from "./special";

/**
 * Broken and Shattered, after an attack's casualties are removed:
 *  - a regiment that has lost half or more of the stands it began the round
 *    with is Broken (it can't Charge or be Inspired until it Rallies);
 *  - a regiment already Broken that loses half or more of its remaining
 *    stands in one attack is Shattered and removed.
 * The round's starting count is kept in the module's state (`round:<unit>`)
 * the first time the regiment takes losses that round.
 */

const standing = (state: GameState, u: Unit) =>
  u.modelIds.filter((id) => state.models[id] && !state.models[id]!.destroyed);

const roundKey = (unitId: string) => `round:${unitId}`;

const brokenAndShattered: CodeProcedure = function* (ctx, args) {
  const view = ctx.view;
  const unit = view.state.units[String(args.unit ?? "")];
  if (!unit) return;
  const now = standing(view.state, unit);
  const before = Math.max(Number(args.before ?? 0), now.length);
  const lost = before - now.length;
  if (lost <= 0 || !now.length) return;
  const round = view.round;
  const kept = view.own[roundKey(unit.id)] as { round: number; start: number } | undefined;
  const start = kept?.round === round ? kept.start : before;
  if (kept?.round !== round) yield ctx.set(roundKey(unit.id), { round, start });
  if (unit.status?.broken) {
    if (lost * 2 >= before) {
      yield ctx.note(`${unit.name} is Shattered: lost ${lost} of ${before} stands while Broken`);
      for (const id of now)
        yield ctx.emit({
          type: "model/wounds",
          id,
          woundsLost: view.state.models[id]?.woundsLost ?? 0,
          destroyed: true,
        });
    }
    return;
  }
  if ((start - now.length) * 2 >= start) {
    yield ctx.emit({ type: "unit/status", id: unit.id, key: "broken", value: true });
    yield ctx.note(`${unit.name} is Broken: ${now.length} of ${start} stands left this round`);
  }
};

/** Broken and Shattered, then Lethal Demise hitting back (special.ts). */
const aftermath: CodeProcedure = function* (ctx, args) {
  yield* brokenAndShattered(ctx, args);
  yield* lethalDemise(ctx, args);
};

export const moraleProcedures: Record<string, CodeProcedure> = { aftermath };
