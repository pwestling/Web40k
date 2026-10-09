import type { GameState, Unit } from "../../core/types";
import type { CodeProcedure } from "../../sdk";

/**
 * Reinforcements: every regiment starts in reserve. Each round, before the
 * command stacks, each player brings in one regiment of every class that may
 * arrive that round, and rolls a die for each of the others: one that rolls
 * the class's number for that round or less (ARRIVAL) arrives too. An arriving regiment is set up at
 * its owner's table edge by hand; its first action is a March and it can't
 * Charge that round (the "reinforced" flag, system.ts).
 */

export type UnitClass = "Light" | "Medium" | "Heavy";
export const CLASSES: UnitClass[] = ["Light", "Medium", "Heavy"];

/** What each class needs to arrive, by round: a roll of this or less, or "auto" for all of them. */
const ARRIVAL: Record<number, Partial<Record<UnitClass, number | "auto">>> = {
  1: { Light: 4 },
  2: { Light: 4, Medium: 2 },
  3: { Light: "auto", Medium: 4, Heavy: 2 },
  4: { Light: "auto", Medium: "auto", Heavy: 4 },
};

export function arrivalTarget(round: number, cls: UnitClass): number | "auto" | null {
  if (round < 1) return null;
  if (round >= 5) return "auto";
  return ARRIVAL[round]?.[cls] ?? null;
}

/** A regiment's class from its roster ("Light" unless it says otherwise). */
export function classOf(unit: Unit, state: GameState): UnitClass {
  const model = state.models[unit.modelIds[0] ?? ""];
  const cls = model?.profile?.chars.Class;
  return cls === "Medium" || cls === "Heavy" ? cls : "Light";
}

/**
 * An arriving regiment, set just inside its owner's table edge where it
 * waited (reserves wait off that edge, core/actions.ts), facing as deployed.
 */
export function atEdge(state: GameState, unit: Unit): { id: string; to: { x: number; y: number } }[] {
  const ms = unit.modelIds.map((id) => state.models[id]).filter((m) => !!m);
  if (!ms.length) return [];
  const seat = state.players[unit.owner]?.seat ?? 0;
  const zone = state.zones.find((z) => z.seat === seat);
  const zy = zone?.points.length ? zone.points.reduce((t, p) => t + p.y, 0) / zone.points.length : 0;
  const side = zy !== 0 ? Math.sign(zy) : seat === 0 ? 1 : -1;
  const xs = ms.map((m) => m.position.x);
  const ys = ms.map((m) => m.position.y);
  const halfW = state.table.width / 2 - 1;
  const dx = Math.max(-halfW - Math.min(...xs), Math.min(0, halfW - Math.max(...xs)));
  const outer = side > 0 ? Math.max(...ys) : Math.min(...ys);
  const dy = side * (state.table.depth / 2 - 1) - outer;
  return ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } }));
}

export const reservesOf = (state: GameState, player: string): Unit[] =>
  Object.values(state.units).filter((u) => u.owner === player && u.status?.reserves === true);

export const rolledKey = (player: string, round: number) => `reinforced:${player}:${round}`;

/** Whether a player still has this round's reinforcements to bring in. */
export function needsRoll(game: GameState, own: Record<string, unknown>, player: string): boolean {
  const round = game.turn.round;
  if (own[rolledKey(player, round)]) return false;
  return reservesOf(game, player).some((u) => arrivalTarget(round, classOf(u, game)) !== null);
}

/**
 * Roll a player's reinforcements for this round: `{ player, first }`, where
 * `first` names the regiment of each class that arrives without a roll
 * (the first in reserve if missing).
 */
const reinforcements: CodeProcedure = function* (ctx, args) {
  const state = ctx.view.state;
  const player = String(args.player ?? "");
  if (!state.players[player]) throw new Error(`No player "${player}"`);
  const round = state.turn.round;
  if (ctx.view.own[rolledKey(player, round)]) throw new Error("Already rolled this round");
  const first = (args.first ?? {}) as Partial<Record<UnitClass, string>>;
  const arriving: Unit[] = [];
  for (const cls of CLASSES) {
    const target = arrivalTarget(round, cls);
    const waiting = reservesOf(state, player).filter((u) => classOf(u, state) === cls);
    if (target === null || !waiting.length) continue;
    const lead = waiting.find((u) => u.id === first[cls]) ?? waiting[0]!;
    arriving.push(lead);
    for (const u of waiting) {
      if (u === lead) continue;
      if (target === "auto") {
        arriving.push(u);
        continue;
      }
      const roll = (yield ctx.roll("1d6", `arrival (needs ${target} or less)`, u.id)) as { rolls: number[] };
      if ((roll.rolls[0] ?? 7) <= target) arriving.push(u);
    }
  }
  for (const u of arriving) {
    yield ctx.emit({ type: "unit/reserve", id: u.id, reserve: false, moves: atEdge(state, u) });
    yield ctx.emit({ type: "unit/status", id: u.id, key: "reinforced", value: true });
  }
  yield ctx.set(
    rolledKey(player, round),
    arriving.map((u) => u.id),
  );
  const name = state.players[player]!.name;
  yield ctx.note(
    arriving.length
      ? `${name}'s reinforcements: ${arriving.map((u) => u.name).join(", ")}`
      : `${name}: no reinforcements this round`,
  );
};

export const reinforceProcedures: Record<string, CodeProcedure> = { reinforcements };
