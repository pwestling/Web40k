import type { GameState, Objective, Unit, Vec2, Zone } from "../core";

/** Helpers for writing missions: zones along the table edges, who holds an objective, what has fallen. */

/** Seat 0 deploys along the +y edge, seat 1 along the -y edge, `deep` inches in. */
export function edgeZones(table: { width: number; depth: number }, deep: number): Zone[] {
  const hx = table.width / 2;
  const hy = table.depth / 2;
  const strip = (seat: number, y0: number, y1: number): Zone => ({
    seat,
    points: [
      { x: -hx, y: y0 },
      { x: hx, y: y0 },
      { x: hx, y: y1 },
      { x: -hx, y: y1 },
    ],
  });
  return [strip(0, hy - deep, hy), strip(1, -hy, -(hy - deep))];
}

export function objective(id: string, x: number, y: number): Objective {
  return { id, position: { x, y } };
}

export const seatOf = (game: GameState, player: string) => game.players[player]?.seat;

const standing = (game: GameState) => Object.values(game.models).filter((m) => !m.destroyed && m.unitId);

/**
 * The seat holding each objective: the most models within `range` inches
 * (`weight` can count some models for more, as 40k's OC does), and nobody on a tie.
 */
export function holders(
  game: GameState,
  range: number,
  weight: (game: GameState, unit: Unit | undefined) => number = () => 1,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const o of game.objectives) {
    const count: Record<number, number> = {};
    for (const m of standing(game)) {
      if (Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) > range) continue;
      const seat = seatOf(game, m.owner);
      if (seat === undefined) continue;
      count[seat] = (count[seat] ?? 0) + weight(game, game.units[m.unitId!]);
    }
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
    out[o.id] =
      ranked[0] && ranked[0][1] > 0 && ranked[0][1] !== ranked[1]?.[1] ? Number(ranked[0][0]) : null;
  }
  return out;
}

export const held = (h: Record<string, number | null>, seat: number) =>
  Object.entries(h)
    .filter(([, s]) => s === seat)
    .map(([id]) => id);

export function inside(p: Vec2, zone: Zone): boolean {
  let hit = false;
  const pts = zone.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Units of other seats than `seat`. */
export const enemyUnits = (game: GameState, seat: number) =>
  Object.values(game.units).filter((u) => {
    const s = seatOf(game, u.owner);
    return s !== undefined && s !== seat;
  });

export const destroyed = (game: GameState, u: Unit) =>
  u.modelIds.length > 0 && u.modelIds.every((id) => game.models[id]?.destroyed);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
