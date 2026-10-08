import type { GameRecord } from "../core";

/** How long playback lingers on an event: dice and phase changes get time to read. */
export function pace(record: GameRecord, seq: number): number {
  const type = record.events.find((e) => e.seq === seq)?.event.type ?? "";
  if (type === "attack/roll" || type === "dice/roll") return 1000;
  if (type.startsWith("turn/")) return 900;
  if (type === "unit/add") return 150;
  return 450;
}
