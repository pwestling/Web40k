import type { CodeProcedure, TurnHooks } from "../../sdk";
import { alive, leadershipTest } from "./combat";
import { expireSpells } from "./magic";
import { immune, stupid } from "./specialRules";

/**
 * The start of a side's turn (the Strategy phase), as a turn hook: its own
 * lasting spells run out, and units with Stupidity test their Leadership. A
 * stupid unit is marked for the turn and played by hand (from general
 * knowledge: it stumbles straight ahead, and doesn't shoot or cast).
 */
export const startOfTurn: CodeProcedure = function* (ctx, args) {
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
};

export const towHooks: TurnHooks = { phaseStart: { strategy: startOfTurn } };
