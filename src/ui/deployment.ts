import { undoneSeqs, type GameRecord, type GameState, type PlayerId, type Unit, type Vec2 } from "../core";

export interface DeployCheck {
  unit: Unit;
  /** Not moved by hand since it arrived on the table. */
  untouched: boolean;
  /** Some of its models stand outside its player's deployment zone. */
  outside: boolean;
  /** Waiting in reserve, so it counts as deployed. */
  reserve: boolean;
}

/**
 * Each of a player's units during deployment: whether it has been placed by
 * hand since it arrived in its tidy row, and whether it is inside the
 * player's zone. Advisory: it's a checklist, not a rule.
 */
export function deployChecks(record: GameRecord, game: GameState, player: PlayerId): DeployCheck[] {
  const undone = undoneSeqs(record);
  const touched = new Set<string>();
  const unitOf = (modelId: string) => game.models[modelId]?.unitId;
  for (const { seq, event } of record.events) {
    if (undone.has(seq)) continue;
    switch (event.type) {
      case "unit/move":
      case "unit/form":
      case "unit/reserve":
        touched.add(event.id);
        break;
      case "model/move": {
        const u = unitOf(event.id);
        if (u) touched.add(u);
        break;
      }
      case "models/move":
        for (const m of event.moves) {
          const u = unitOf(m.id);
          if (u) touched.add(u);
        }
        break;
    }
  }
  const seat = game.players[player]?.seat;
  const zones = game.zones.filter((z) => z.seat === seat);
  return Object.values(game.units)
    .filter((u) => u.owner === player)
    .map((unit) => {
      const reserve = unit.status?.reserves === true;
      const models = unit.modelIds.flatMap((id) => {
        const m = game.models[id];
        return m && !m.destroyed ? [m] : [];
      });
      const outside =
        !reserve &&
        zones.length > 0 &&
        models.some((m) => !zones.some((z) => insidePolygon(m.position, z.points)));
      return { unit, untouched: !reserve && !touched.has(unit.id), outside, reserve };
    });
}

/** Even-odd test; points on the edge count as inside closely enough. */
export function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
