import type { GameState, Player, PlayerId } from "./types";

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
  const names = sidePlayers(state, seat).map((p) => p.name);
  return names.length ? names.join(" & ") : `Player ${seat + 1}`;
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
