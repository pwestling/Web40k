import { displayName } from "../i18n/names";
import type { GameState, Player, PlayerId, Vec2 } from "./types";

/**
 * Team games (2v2 and up): a side is a seat, and several players can sit at
 * it (settings.teamSize). Turns already go by seat, so a side takes its turn
 * together. Counters such as CP and VP are the side's: every change one
 * player's counters get is shared with their teammates (shareSideResources).
 * Units, allocation and secrets stay each player's own.
 */

/** The players at a seat, in the order they joined (the same on every peer). */
export function sidePlayers(state: GameState, seat: number): Player[] {
  return Object.values(state.players).filter((p) => p.seat === seat);
}

/** The seats in play, in order. */
export function sides(state: GameState): number[] {
  return [
    ...new Set(Object.values(state.players).flatMap((p) => (p.seat === undefined ? [] : [p.seat]))),
  ].sort((a, b) => a - b);
}

/** "Ana & Cy": a side's players by name. */
export function sideName(state: GameState, seat: number): string {
  const names = sidePlayers(state, seat).map((p) => displayName(p.name));
  return names.length ? names.join(" & ") : displayName(`Player ${seat + 1}`);
}

export function teammates(state: GameState, player: PlayerId): Player[] {
  const seat = state.players[player]?.seat;
  return seat === undefined ? [] : sidePlayers(state, seat).filter((p) => p.id !== player);
}

/**
 * After an event: a side's counters are one set. When one teammate's counters
 * changed, the others take the same values. If several changed at once (a
 * gain each player at the seat gets), the side gets it once.
 */
export function shareSideResources(before: GameState, after: GameState): GameState {
  if (after.resources === before.resources) return after;
  let resources = after.resources;
  for (const seat of sides(after)) {
    const team = sidePlayers(after, seat);
    if (team.length < 2) continue;
    const changed = team.find((p) => after.resources[p.id] !== before.resources[p.id]);
    if (!changed) continue;
    const value = after.resources[changed.id];
    for (const p of team)
      if (p.id !== changed.id && resources[p.id] !== value) resources = { ...resources, [p.id]: value! };
  }
  return resources === after.resources ? after : { ...after, resources };
}

/**
 * Whether two players are on opposite sides. Teammates (players at the same
 * seat) are allies: they don't engage, target or charge each other. A player
 * with no seat yet only counts as their own side.
 */
export function opposed(state: GameState, a: PlayerId | undefined, b: PlayerId | undefined): boolean {
  if (a === b) return false;
  const sa = a === undefined ? undefined : state.players[a]?.seat;
  const sb = b === undefined ? undefined : state.players[b]?.seat;
  return sa === undefined || sb === undefined || sa !== sb;
}

/** A player's place at their side: the i-th of n teammates (0 of 1 when alone). */
export function teamShare(state: GameState, player: PlayerId): { index: number; of: number } {
  const seat = state.players[player]?.seat;
  const team = seat === undefined ? [] : sidePlayers(state, seat);
  const index = team.findIndex((p) => p.id === player);
  return index < 0 ? { index: 0, of: 1 } : { index, of: team.length };
}

/**
 * The i-th of n slices of a deployment zone, cut across the table's width, so
 * teammates each deploy in their own part of their side's zone.
 */
export function zoneSlice(points: Vec2[], index: number, of: number): Vec2[] {
  if (of <= 1 || points.length < 3) return points;
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs);
  const w = (Math.max(...xs) - lo) / of;
  return clipX(clipX(points, lo + w * index, 1), lo + w * (index + 1), -1);
}

/** Sutherland–Hodgman against x >= at (dir 1) or x <= at (dir -1). */
function clipX(poly: Vec2[], at: number, dir: 1 | -1): Vec2[] {
  const inside = (p: Vec2) => (p.x - at) * dir >= -1e-9;
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (at - a.x) / (b.x - a.x);
      out.push({ x: at, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
