import { movedSoFar, type GameState, type Vec2 } from "../../core";

/**
 * How far along a drag (0 to 1) the models can go without any of them moving
 * further than `limit` this phase, measured as the unit card measures it:
 * distance across the table plus any climb (see unitMoved). `target` gives
 * where a model would stand, and at what height, a fraction `s` of the way.
 * Used to clamp a move with Alt held, and to snap a move back to its limit.
 */
export function clampFraction(
  game: GameState,
  ids: string[],
  target: (id: string, s: number) => Vec2 & { z?: number },
  limit: number,
  /** Corners of the move under way, after the model's own (core/path.ts). */
  via: (id: string) => Vec2[] = () => [],
): number {
  const fits = (s: number) =>
    ids.every((id) => {
      const m = game.models[id];
      if (!m) return true;
      const p = target(id, s);
      const climb = Math.abs((p.z ?? m.z ?? 0) - (m.phaseStartZ ?? 0));
      return movedSoFar(m, p, via(id)) + climb <= limit + 1e-6;
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
