import { inFootprint, segmentCrossesFootprint2D } from "../../core/terrain";
import type { GameState, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, GameView, Warning } from "../../sdk";
import { alive, casualties } from "./combat";

/**
 * Dangerous terrain (tow.whfb.app, checked 2026-10-08): each model that
 * starts, passes through or ends its move in dangerous terrain rolls a D6
 * for each such feature; on a 1 it loses a Wound (taken off the rear rank,
 * like other casualties). The move is the one since the phase began, so
 * the tests are offered on the unit's card, and the Table warnings panel
 * says when a unit owes them.
 */

/** One test per model per dangerous feature it crossed this phase. */
export function dangerousTests(state: GameState, u: Unit): number {
  const pieces = state.terrain.filter((p) => p.category === "dangerous");
  if (!pieces.length) return 0;
  let tests = 0;
  for (const m of alive(state, u)) {
    const from = m.phaseStart;
    if (!from || Math.hypot(m.position.x - from.x, m.position.y - from.y) < 0.05) continue;
    for (const p of pieces)
      if (
        inFootprint(p, from) ||
        inFootprint(p, m.position) ||
        segmentCrossesFootprint2D(p, from, m.position)
      )
        tests++;
  }
  return tests;
}

const mark = (view: GameView) => `${view.state.turn.round}:${view.state.turn.activeSeat}:${view.phase ?? ""}`;
const tested = (view: GameView, u: Unit) => view.own[`dangerous:${u.id}`] === mark(view);

const dangerous: CodeProcedure = function* (ctx, args) {
  const u = ctx.view.state.units[String(args.unit ?? "")];
  if (!u) return;
  const n = dangerousTests(ctx.view.state, u);
  if (!n) return;
  yield ctx.set(`dangerous:${u.id}`, mark(ctx.view));
  const r = (yield ctx.roll(`${n}d6`, "Dangerous terrain test", u.id, 2)) as { rolls: number[] };
  const ones = r.rolls.filter((x) => x === 1).length;
  if (ones) yield* casualties(ctx, u, ones);
  yield ctx.note(
    ones
      ? `${u.name} takes ${n} Dangerous terrain ${n === 1 ? "test" : "tests"}: ${ones} ${ones === 1 ? "Wound" : "Wounds"} lost`
      : `${u.name} takes ${n} Dangerous terrain ${n === 1 ? "test" : "tests"} and comes through unharmed`,
  );
};

export const terrainActions: CodeAction[] = [
  {
    id: "dangerousTerrain",
    name: "Dangerous terrain tests",
    by: "unit",
    applies: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      return !!u && dangerousTests(view.state, u) > 0;
    },
    label: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      const n = u ? dangerousTests(view.state, u) : 0;
      return n === 1 ? "Dangerous terrain test" : `Dangerous terrain tests (${n})`;
    },
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return "No unit";
      return tested(view, u) ? "Tested for this move" : true;
    },
    run: dangerous,
  },
];

/** Units that moved through dangerous terrain this phase and haven't tested yet. */
export function terrainWarnings(view: GameView): Warning[] {
  return Object.values(view.state.units)
    .filter((u) => !tested(view, u) && dangerousTests(view.state, u) > 0)
    .map((u) => ({
      id: "dangerousTerrain",
      unitId: u.id,
      message: `${u.name} moved through dangerous terrain: take its Dangerous terrain tests from its card`,
    }));
}
