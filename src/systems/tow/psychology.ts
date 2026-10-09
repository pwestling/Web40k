import type { CodeProcedure, Command, Ctx, TurnHooks } from "../../sdk";
import { alive, leadershipTest } from "./combat";
import { expireSpells } from "./magic";
import { immune, stupid } from "./specialRules";
import { terrainDisruption } from "./terrainTests";

/**
 * The start of a side's turn (the Strategy phase), as a turn hook: its own
 * lasting spells run out, and units with Stupidity test their Leadership. A
 * stupid unit is marked for the turn and played by hand (from general
 * knowledge: it stumbles straight ahead, and doesn't shoot or cast). Then
 * the side's fleeing units try to rally.
 */
const startOfTurn: CodeProcedure = function* (ctx, args) {
  const player = String(args.player ?? ctx.view.activePlayer ?? "");
  yield* expireSpells(ctx, player);
  for (const u of Object.values(ctx.view.state.units)) {
    if (u.owner !== player) continue;
    if (u.status?.stupid) yield ctx.emit({ type: "unit/status", id: u.id, key: "stupid", value: null });
    if (!stupid(u) || immune(u) || u.status?.fleeing || !alive(ctx.view.state, u).length) continue;
    const t = yield* leadershipTest(ctx, u, "Stupidity test");
    if (t.passed) {
      yield ctx.note(`${u.name} keeps its wits (${t.roll.total})`);
      continue;
    }
    yield ctx.emit({ type: "unit/status", id: u.id, key: "stupid", value: true });
    yield ctx.note(
      `${u.name} is stupid this turn (rolled ${t.roll.total}, over Ld ${t.ld}): it blunders straight ahead and does nothing clever`,
    );
  }
  yield* rallyFleeing(ctx, player);
};

/**
 * Rally fleeing troops (the end of the Strategy phase): each of the side's
 * fleeing units takes a Leadership test (the General's Leadership and the
 * Battle Standard's re-roll count). Passed, it stops fleeing and may reform;
 * failed, it keeps fleeing and makes its flee move with the compulsory moves.
 */
function* rallyFleeing(ctx: Ctx, player: string): Generator<Command, void, unknown> {
  for (const u of Object.values(ctx.view.state.units)) {
    if (u.owner !== player || !u.status?.fleeing || !alive(ctx.view.state, u).length) continue;
    const left = alive(ctx.view.state, u).length;
    const t = yield* leadershipTest(ctx, u, "Rally test");
    if (t.passed) {
      yield ctx.emit({ type: "unit/status", id: u.id, key: "fleeing", value: null });
      yield ctx.note(`${u.name} rallies (${t.roll.total} against Ld ${t.ld}) and may reform`);
    } else
      yield ctx.note(
        `${u.name} keeps fleeing (rolled ${t.roll.total}, over Ld ${t.ld}): it flees again with the Movement phase's compulsory moves`,
      );
    if (left * 4 <= u.modelIds.length)
      yield ctx.note(
        `${u.name} is down to a quarter of its models or fewer: check the rally rules for so small a unit`,
      );
  }
}

export const towHooks: TurnHooks = {
  phaseStart: { strategy: startOfTurn },
  phaseEnd: { movement: terrainDisruption },
};
