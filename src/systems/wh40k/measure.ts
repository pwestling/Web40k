import type { GameState, Vec2 } from "../../core";

/**
 * How far along a drag (0 to 1) the models can go without any of them moving
 * further than `limit` this phase. Used to clamp a move with Alt held, and to
 * snap a move back to its limit.
 */
export function clampFraction(
  game: GameState,
  ids: string[],
  target: (id: string, s: number) => Vec2,
  limit: number,
): number {
  const fits = (s: number) =>
    ids.every((id) => {
      const m = game.models[id];
      if (!m) return true;
      const from = m.phaseStart ?? m.position;
      const p = target(id, s);
      return Math.hypot(p.x - from.x, p.y - from.y) <= limit + 1e-6;
    });
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
