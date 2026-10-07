import { unitCentre } from "../../core/manoeuvre";
import { blockFrame, formBlock } from "../../core/regiment";
import type { GameState, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, GameView } from "../../sdk";

/**
 * Characters: single stands with the Character keyword that can join a
 * friendly regiment. Joined, the character becomes part of the regiment
 * (one unit, one command card), stands in the middle of its front rank and,
 * being a profile of its own, is among the last stands removed. The
 * regiment keeps its own characteristics. Unverified against the rules:
 * duels, a character's own actions and lending Resolve are not covered.
 */

/** How close a character must be to join a regiment. */
const JOIN_RANGE = 3;

const isCharacter = (u: Unit | undefined) => !!u?.sheet?.keywords.includes("Character");

const alive = (state: GameState, u: Unit) =>
  u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);

function regimentsNear(view: GameView, unitId: string): { u: Unit; d: number }[] {
  const me = view.state.units[unitId];
  if (!me) return [];
  return Object.values(view.state.units)
    .filter((u) => u.owner === me.owner && u.id !== me.id && !isCharacter(u) && alive(view.state, u))
    .map((u) => ({ u, d: view.distance(me.id, u.id) }))
    .filter((x) => x.d <= JOIN_RANGE)
    .sort((a, b) => a.d - b.d);
}

const join: CodeProcedure = function* (ctx, args) {
  const before = ctx.view.state;
  const leader = before.units[String(args.unit ?? "")];
  const body = before.units[String(args.target ?? "")];
  if (!leader || !body || body.formation.kind !== "ranked") return;
  const centre = unitCentre(before, body);
  const facing = before.models[body.modelIds[0]!]?.facing ?? 0;
  yield ctx.emit({ type: "unit/attach", id: leader.id, to: body.id });
  const merged = ctx.view.state.units[body.id];
  if (!merged || merged.formation.kind !== "ranked") return;
  // The character takes the second slot: the middle of a three-wide front rank.
  const rest = merged.modelIds.filter((id) => !leader.modelIds.includes(id));
  const order = [...rest.slice(0, 1), ...leader.modelIds, ...rest.slice(1)];
  const laid = formBlock(
    ctx.view.state,
    { ...merged, modelIds: order },
    merged.formation.files,
    facing,
    centre,
  );
  yield ctx.emit({
    type: "unit/form",
    id: merged.id,
    formation: merged.formation,
    order: laid.order,
    models: laid.models,
  });
  yield ctx.note(`${leader.name} joined ${body.name}`);
};

export const characterActions: CodeAction[] = [
  {
    id: "joinRegiment",
    name: "Join regiment",
    by: "unit",
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!isCharacter(u)) return "Only characters join regiments";
      if (!blockFrame(view.state, u!) && u!.formation.kind !== "ranked") return "Not on the table";
      return regimentsNear(view, u!.id).length ? true : `No friendly regiment within ${JOIN_RANGE}"`;
    },
    targets: (view, actor) =>
      regimentsNear(view, actor.unitId ?? "").map((x) => ({
        unitId: x.u.id,
        label: `${x.u.name} (${x.d.toFixed(1)}")`,
      })),
    run: join,
  },
];
