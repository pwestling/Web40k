import type { GameRecord, LoggedEvent } from "../core";
import type { BotMove } from "../soak/bot";
import { useStore } from "../store";
import type { Level } from "./player";

/** Messages to the computer opponent's worker (worker.ts). */
export type ToBot =
  | { t: "init"; record: GameRecord }
  | { t: "events"; events: LoggedEvent[] }
  | { t: "saw"; move: BotMove }
  | { id: number; t: "move"; level: Level; seat: number; player: string; seed: number };

export type FromBot =
  { id: number; t: "ok"; move: BotMove | null } | { id: number; t: "error"; error: string };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (m: BotMove | null) => void; reject: (e: Error) => void }>();
/** What the worker's replica holds: the game it started from, and how many events. */
let sent: { initial: GameRecord["initial"]; count: number; last: number | undefined } | null = null;

function start(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<FromBot>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.t === "ok") p.resolve(e.data.move);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = () => {
    // It didn't load (an old browser, a blocked script): think on the page instead.
    broken = true;
    stopThinking();
  };
  return worker;
}

/** Bring the worker's copy of the game up to date: new events only, or the whole record when it changed under it. */
function sync(w: Worker): void {
  const { record } = useStore.getState();
  const n = record.events.length;
  const same =
    sent &&
    sent.initial === record.initial &&
    sent.count <= n &&
    record.events[sent.count - 1]?.seq === sent.last;
  if (!same) w.postMessage({ t: "init", record } satisfies ToBot);
  else if (n > sent!.count)
    w.postMessage({ t: "events", events: record.events.slice(sent!.count) } satisfies ToBot);
  sent = { initial: record.initial, count: n, last: record.events[n - 1]?.seq };
}

/**
 * The computer's next move, worked out in a worker so the table keeps
 * drawing while it thinks. Null when there is no worker (think on the page).
 */
export function thinkOffThread(
  level: Level,
  seat: number,
  player: string,
  seed: number,
): Promise<BotMove | null> | null {
  const w = start();
  if (!w) return null;
  sync(w);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, t: "move", level, seat, player, seed } satisfies ToBot);
  });
}

/** Whether the worker can think (false once it failed to start). */
export function canThinkOffThread(): boolean {
  return !broken;
}

/** A move was logged (after the worker's copy catches up), so the computer keeps track of its phase. */
export function sawOffThread(move: BotMove): void {
  if (!worker) return;
  sync(worker);
  worker.postMessage({ t: "saw", move } satisfies ToBot);
}

/** The game ended or the page thinks for itself now: end the worker. */
export function stopThinking(): void {
  worker?.terminate();
  worker = null;
  sent = null;
  for (const p of pending.values()) p.reject(new Error("The computer stopped thinking"));
  pending.clear();
}
