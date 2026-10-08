import type { GameState } from "../core";

/**
 * Each side's shape (#25): colour is never the only way to tell sides apart.
 * By seat; teammates share their side's shape.
 */
const SIDE_SHAPES = ["●", "▲", "■", "◆"] as const;

export function seatShape(seat: number | undefined): string {
  return seat === undefined ? "" : (SIDE_SHAPES[seat % SIDE_SHAPES.length] ?? "");
}

/** The shape of the side a player sits on. */
export function playerShape(game: GameState, playerId: string | undefined): string {
  return seatShape(playerId ? game.players[playerId]?.seat : undefined);
}
