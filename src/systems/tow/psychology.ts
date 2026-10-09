import type { CodeProcedure, Command, Ctx, TurnHooks } from "../../sdk";
import { alive, leadershipTest } from "./combatKit";
import { expireSpells } from "./magic";
import { hasRule, immune, isGeneral, stupid } from "./specialRules";
import type { GameState, Unit } from "../../core/types";
import { terrainDisruption } from "./terrainTests";

/**
 * Who acts in the Command sub-phase: the General, and units with a rule
 * named for the command phase or sub-phase, or a command ability.
 */
function commanders(state: GameState, player: string): Unit[] {
  return Object.values(state.units).filter(
    (u) =>
      u.owner === player &&
      alive(state, u).length > 0 &&
      !u.status?.reserves &&
      (isGeneral(u) ||
        hasRule(u, /command (sub-)?phase|command abilit/i) ||
        (u.sheet?.abilities ?? []).some((a) => /command sub-phase|command phase/i.test(a.text))),
  );
}

/**
 * The start of a side's turn (the Strategy phase), as a turn hook, in its
 * sub-phases' order. Start of turn: its own lasting spells run out, and units
 * with Stupidity test their Leadership (a stupid unit is marked for the turn
 * and played by hand: from general knowledge, it stumbles straight ahead and
 * doesn't shoot or cast). Command sub-phase: a log line names who may use
 * command abilities now (by hand; the abilities themselves come up on the
 * cards, system.ts abilityTimings). Conjuration is cast from the cards
 * (magic.ts). Then the side's fleeing units try to rally.
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
  const leaders = commanders(ctx.view.state, player);
  if (leaders.length)
    yield ctx.note(
      `Command sub-phase: ${leaders.map((u) => u.name).join(", ")} may use command abilities now (by hand)`,
    );
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
