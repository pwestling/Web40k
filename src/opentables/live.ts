import { sides, sidePlayers, type GameState } from "../core";
import { systemOf } from "../core/content/turn";
import { useStore } from "../store";
import type { LiveInfo } from "./post";

/**
 * Live now (#64): what a game under way says about itself on the board, and
 * how many are watching it. Players see the count too ("3 watching").
 */

/** People in the room who aren't seated: watchers, this screen too when it only watches (UX 146). */
function watcherCount(s = useStore.getState()): number {
  const { game, net, session, mode } = s;
  if (!session || mode === "hotseat") return 0;
  const seated = new Set(
    Object.values(game.players)
      .filter((p) => p.seat !== undefined)
      .map((p) => p.id),
  );
  const peers = net?.peers ?? [];
  return peers.filter((id) => !seated.has(id)).length + (net?.role === "spectator" ? 1 : 0);
}

/** The same, kept up to date for a component. */
export function useWatching(): number {
  return useStore((s) => watcherCount(s));
}

/** The round, score and watchers, as the board's Live now shows them. */
export function liveInfo(game: GameState, watching: number): LiveInfo {
  const rounds = Number(systemOf(game).turn.rounds) || 0;
  const vp = (seat: number) =>
    sidePlayers(game, seat).reduce((n, p) => n + (game.resources[p.id]?.VP ?? 0), 0);
  return {
    round: Math.min(99, game.turn.round),
    rounds: Math.min(99, rounds),
    score: sides(game)
      .map((seat) => vp(seat))
      .join("–"),
    watching: Math.min(9999, watching),
  };
}
