import type { LoggedEvent } from "../core";

/**
 * Why the computer made each of its moves (PX solo review B), by the event
 * it became, so the game log can say "Computer moved Thorn Slingers 6.0",
 * closing on Wick Guard". Kept on this screen only: not part of the game.
 */
const reasons = new Map<string, string>();

const keyOf = (e: LoggedEvent) =>
  e.event.type === "models/move" ? `${e.by}:${e.seq}:${JSON.stringify(e.event.moves[0]?.to)}` : null;

export function noteReason(e: LoggedEvent, text: string): void {
  const k = keyOf(e);
  if (!k) return;
  if (reasons.size > 2000) reasons.clear();
  reasons.set(k, text);
}

export function reasonFor(e: LoggedEvent): string | undefined {
  const k = keyOf(e);
  return k ? reasons.get(k) : undefined;
}
