import "../systems";
import type { GameRecord } from "../core";
import { reviewGame } from "./analyse";

/** The game review (#61) off the main thread: it plays out a few thousand moves, which takes a while. */
export type ToReview = { t: "review"; record: GameRecord; part: [number, number] };
export type FromReview =
  | { t: "progress"; done: number }
  | { t: "done"; review: Awaited<ReturnType<typeof reviewGame>> }
  | { t: "error"; error: string };

self.onmessage = async (e: MessageEvent<ToReview>) => {
  try {
    const review = await reviewGame(e.data.record, {
      part: e.data.part,
      onProgress: (done) => self.postMessage({ t: "progress", done } satisfies FromReview),
    });
    self.postMessage({ t: "done", review } satisfies FromReview);
  } catch (err) {
    self.postMessage({
      t: "error",
      error: err instanceof Error ? err.message : String(err),
    } satisfies FromReview);
  }
};
