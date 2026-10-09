import { create } from "zustand";
import { lastSeq, type GameRecord } from "../core";
import { mergeReviews, reviewGame, type GameReview } from "./analyse";
import type { FromReview, ToReview } from "./worker";
import { runningPackages } from "../sandbox/runtime";
import { Sandbox, STARTUP_MS } from "../sandbox/host";
import type { Loaded } from "../sandbox/protocol";

/**
 * Running a game review (#61): one at a time, in a worker where there is
 * one (on the page otherwise), kept for the game it was made for so
 * closing and reopening the stats sheet doesn't start again.
 */
interface ReviewRun {
  /** The game reviewed (its first state and last entry). */
  of: { initial: GameRecord["initial"]; last: number } | null;
  status: "idle" | "running" | "done" | "error";
  done: number;
  /** When this run started, for the time-left estimate. */
  started?: number;
  review: GameReview | null;
  error?: string;
}

export const useReviewRun = create<ReviewRun>(() => ({ of: null, status: "idle", done: 0, review: null }));

let workers: Worker[] = [];
/** Workers side by side: a review is a minute or two of thinking. */
const WORKERS = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
/**
 * The decisions are split into this many shares, whatever the device, and
 * each worker takes the next share as it finishes one: a few costly decisions
 * (the closer looks) no longer leave one worker finishing long after the rest,
 * and a review comes out the same on every device.
 */
const SHARES = 12;

const sameGame = (record: GameRecord) => {
  const of = useReviewRun.getState().of;
  return !!of && of.initial === record.initial && of.last === lastSeq(record);
};

/**
 * Minutes left on a running review, from how fast it has gone so far; null
 * until there is enough progress to say. The time depends on the game's length
 * and the device, so it is measured, not promised.
 */
export function minutesLeft(run: Pick<ReviewRun, "done" | "started">): number | null {
  if (!run.started || run.done < 0.05) return null;
  const spent = Date.now() - run.started;
  if (spent < 3000) return null;
  return Math.ceil((spent * (1 - run.done)) / run.done / 60_000);
}

export function startReview(record: GameRecord): void {
  if (sameGame(record) && useReviewRun.getState().status !== "error") return;
  stopReview();
  useReviewRun.setState({
    of: { initial: record.initial, last: lastSeq(record) },
    status: "running",
    done: 0,
    started: Date.now(),
    review: null,
    error: undefined,
  });
  const mine = useReviewRun.getState().of;
  const still = () => useReviewRun.getState().of === mine;
  const finish = (r: Partial<ReviewRun>) => still() && useReviewRun.setState(r);
  const packages = runningPackages();
  if (packages?.length) {
    void inSandboxes(record, packages, finish);
    return;
  }
  const n = Math.min(WORKERS, SHARES);
  try {
    workers = Array.from(
      { length: n },
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
  } catch {
    stopWorkers();
  }
  if (workers.length) {
    const parts: (GameReview | null)[] = new Array(SHARES).fill(null);
    const progress = new Array<number>(SHARES).fill(0);
    let next = 0;
    const give = (w: Worker) => {
      if (next >= SHARES) return;
      const k = next++;
      w.onmessage = (e: MessageEvent<FromReview>) => {
        const m = e.data;
        if (m.t === "progress") {
          progress[k] = m.done;
          finish({ done: progress.reduce((a, b) => a + b, 0) / SHARES });
        } else if (m.t === "done") {
          parts[k] = m.review;
          progress[k] = 1;
          finish({ done: progress.reduce((a, b) => a + b, 0) / SHARES });
          if (parts.every(Boolean)) {
            stopWorkers();
            finish({ status: "done", done: 1, review: mergeReviews(parts as GameReview[]) });
          } else give(w);
        } else {
          stopWorkers();
          finish({ status: "error", error: m.error });
        }
      };
      w.postMessage({ t: "review", record, part: [k, SHARES] } satisfies ToReview);
    };
    for (const w of workers) {
      w.onerror = () => {
        stopWorkers();
        finish({ status: "error", error: "The review didn't start" });
      };
      give(w);
    }
    return;
  }
  reviewGame(record, { onProgress: (done) => finish({ done }), cancelled: () => !still() }).then(
    (review) => finish({ status: "done", done: 1, review }),
    (e: unknown) => finish({ status: "error", error: e instanceof Error ? e.message : String(e) }),
  );
}

function stopWorkers(): void {
  for (const w of workers) w.terminate();
  workers = [];
}

function stopReview(): void {
  stopWorkers();
  stopBoxes();
  if (useReviewRun.getState().status === "running")
    useReviewRun.setState({ of: null, status: "idle", done: 0, review: null });
}

/** Sandboxes reviewing a package game now, ended when another review starts. */
let boxes: Sandbox[] = [];

/** A long review share: this long, or the sandbox is stuck. */
const SHARE_MS = 15 * 60_000;

/**
 * A package game's review (Rift Lanterns): its code runs only in the sandbox,
 * so each share of the review runs in a sandbox of its own that has loaded the
 * game's packages, never on the page.
 */
async function inSandboxes(
  record: GameRecord,
  packages: { hash: string; source: string }[],
  finish: (r: Partial<ReviewRun>) => void,
): Promise<void> {
  const n = Math.min(WORKERS, SHARES);
  let done = 0;
  try {
    const source = (await import("virtual:sandbox-worker")).default;
    const started = await Promise.all(Array.from({ length: n }, () => Sandbox.start(source, () => {})));
    boxes = started;
    const parts: GameReview[] = [];
    let next = 0;
    await Promise.all(
      started.map(async (box) => {
        const loaded = await box.call<Loaded>({ t: "load", packages }, STARTUP_MS);
        if (loaded.errors.length) throw new Error(loaded.errors[0]!.error);
        // Each sandbox takes the next share as it finishes one (see SHARES).
        while (next < SHARES) {
          const k = next++;
          parts[k] = await box.call<GameReview>({ t: "review", record, part: [k, SHARES] }, SHARE_MS);
          finish({ done: ++done / (SHARES + 1) });
        }
      }),
    );
    finish({ status: "done", done: 1, review: mergeReviews(parts) });
  } catch (e) {
    finish({ status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    stopBoxes();
  }
}

function stopBoxes(): void {
  for (const b of boxes) b.stop();
  boxes = [];
}
