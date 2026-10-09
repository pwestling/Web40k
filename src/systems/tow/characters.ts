import { isAlive } from "../../core/units";
import { unitCentre } from "../../core/manoeuvre";
import { rotate } from "../../core/geometry";
import { blockFrame, formBlock } from "../../core/regiment";
import type { GameState, Unit } from "../../core/types";
import { opposed } from "../../core/teams";
import type { CodeAction, CodeProcedure, GameView } from "../../sdk";
import { hasRule } from "./specialRules";

/**
 * Characters joining and leaving regiments (The Old World): a character on
 * its own (a one-model unit that isn't a monster, chariot or war machine)
 * within 2" of a friendly regiment joins it in the Movement phase and stands
 * in the middle of its front rank; the regiment then moves, fights and tests
 * as one, with the character's Leadership and rules. It can leave again in a
 * later Movement phase, stepping out in front. From general knowledge of the
 * game, unverified against the rules index.
 */

const JOIN_RANGE = 2;

/** A character on its own: one model, and not a monster, chariot or war machine. */
function loneCharacter(state: GameState, u: Unit | undefined): boolean {
  if (!u || u.modelIds.length !== 1 || u.joined?.length) return false;
  const m = state.models[u.modelIds[0]!];
  const troop = m?.profile?.chars.Troop ?? "";
  if (/monster|chariot|war machine|swarm/i.test(troop)) return false;
  return (
    /character|general|lord|hero|wizard/i.test([...(u.sheet?.keywords ?? []), troop].join(" ")) ||
    !!u.sheet?.wizard ||
    Number.parseFloat(m?.profile?.chars.W ?? "1") > 1
  );
}

/**
 * Rules that keep a character out of a regiment (#66): a Clumsy unit takes
 * only a Clumsy character; Loner, Unbreakable and Ethereal characters and
 * units only join their own kind. Null when it may join, else why not.
 */
export function joinBar(character: Unit, regiment: Unit): string | null {
  if (hasRule(regiment, /^clumsy\b/i) && !hasRule(character, /^clumsy\b/i))
    return `${regiment.name} is Clumsy: only a Clumsy character joins it`;
  for (const [re, name] of [
    [/^loner\b/i, "Loner"],
    [/^unbreakable\b/i, "Unbreakable"],
    [/^ethereal\b/i, "Ethereal"],
  ] as const)
    if (hasRule(regiment, re) !== hasRule(character, re))
      return `${name}: only ${name} characters and units join each other`;
  return null;
}

function regimentsNear(view: GameView, unitId: string): { u: Unit; d: number }[] {
  const state = view.state;
  const me = state.units[unitId];
  if (!me) return [];
  return Object.values(state.units)
    .filter(
      (u) =>
        u.id !== me.id &&
        !opposed(state, u.owner, me.owner) &&
        u.formation.kind === "ranked" &&
        u.modelIds.length > 1 &&
        !u.status?.fleeing &&
        isAlive(state, u),
    )
    .map((u) => ({ u, d: view.distance(me.id, u.id) }))
    .filter((x) => x.d <= JOIN_RANGE)
    .sort((a, b) => a.d - b.d);
}

const join: CodeProcedure = function* (ctx, args) {
  const before = ctx.view.state;
  const leader = before.units[String(args.unit ?? "")];
  const body = before.units[String(args.target ?? "")];
  if (!leader || !body || body.formation.kind !== "ranked") return;
  const frame = blockFrame(before, body);
  const centre = unitCentre(before, body);
  const facing = frame?.facing ?? before.models[body.modelIds[0]!]?.facing ?? 0;
  yield ctx.emit({ type: "unit/attach", id: leader.id, to: body.id });
  const merged = ctx.view.state.units[body.id];
  if (!merged || merged.formation.kind !== "ranked") return;
  // The character takes the middle of the front rank; the rank and file shuffle back.
  const files = merged.formation.files;
  const rest = merged.modelIds.filter((id) => !leader.modelIds.includes(id));
  const mid = Math.floor((files - 1) / 2);
  const order = [...rest.slice(0, mid), ...leader.modelIds, ...rest.slice(mid)];
  const laid = formBlock(ctx.view.state, { ...merged, modelIds: order }, files, facing, centre);
  yield ctx.emit({
    type: "unit/form",
    id: merged.id,
    formation: merged.formation,
    order: laid.order,
    models: laid.models,
  });
  yield ctx.note(`${leader.name} joined ${body.name}`);
};

const leave: CodeProcedure = function* (ctx, args) {
  const before = ctx.view.state;
  const body = before.units[String(args.unit ?? "")];
  const who = body?.joined?.find((u) => u.id === String(args.target ?? ""));
  if (!body || !who) return;
  const frame = blockFrame(before, body);
  const facing = frame?.facing ?? 0;
  yield ctx.emit({ type: "unit/detach", id: body.id, unit: who.id });
  const state = ctx.view.state;
  const remaining = state.units[body.id];
  // The regiment closes up; the character steps out 1" in front of it.
  if (remaining && remaining.formation.kind === "ranked" && remaining.modelIds.length) {
    const laid = formBlock(state, remaining, remaining.formation.files, facing, unitCentre(state, body));
    yield ctx.emit({
      type: "unit/form",
      id: remaining.id,
      formation: remaining.formation,
      order: laid.order,
      models: laid.models,
    });
  }
  const front = frame?.front ?? unitCentre(before, body);
  const ahead = rotate({ x: 0, y: 1.5 }, facing);
  const moves = who.modelIds
    .filter((id) => state.models[id] && !state.models[id]!.destroyed)
    .map((id) => ({ id, to: { x: front.x + ahead.x, y: front.y + ahead.y } }));
  if (moves.length) yield ctx.emit({ type: "models/move", moves });
  yield ctx.note(`${who.name} left ${remaining?.name ?? body.name}`);
};

export const characterActions: CodeAction[] = [
  {
    id: "joinRegiment",
    name: "Join regiment",
    by: "unit",
    phases: ["movement"],
    applies: (view, actor) => loneCharacter(view.state, view.state.units[actor.unitId ?? ""]),
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!loneCharacter(view.state, u)) return "Only a character on its own joins a regiment";
      if (u!.status?.fleeing) return "Fleeing characters don't join regiments";
      const near = regimentsNear(view, u!.id);
      if (!near.length) return `No friendly regiment within ${JOIN_RANGE}"`;
      return near.some((x) => !joinBar(u!, x.u)) ? true : joinBar(u!, near[0]!.u)!;
    },
    targets: (view, actor) =>
      regimentsNear(view, actor.unitId ?? "")
        .filter((x) => !joinBar(view.state.units[actor.unitId ?? ""]!, x.u))
        .map((x) => ({
          unitId: x.u.id,
          label: `${x.u.name} (${x.d.toFixed(1)}")`,
        })),
    run: join,
  },
  {
    id: "leaveRegiment",
    name: "Leave regiment",
    by: "unit",
    phases: ["movement"],
    applies: (view, actor) => !!view.state.units[actor.unitId ?? ""]?.joined?.length,
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u?.joined?.length) return "No character has joined it";
      if (u.status?.fleeing) return "A fleeing regiment's characters stay with it";
      return true;
    },
    targets: (view, actor) =>
      (view.state.units[actor.unitId ?? ""]?.joined ?? [])
        .filter((j) => j.modelIds.some((id) => view.state.models[id] && !view.state.models[id]!.destroyed))
        .map((j) => ({ unitId: j.id, label: j.name })),
    run: leave,
  },
];
