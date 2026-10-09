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
  review: GameReview | null;
  error?: string;
}

export const useReviewRun = create<ReviewRun>(() => ({ of: null, status: "idle", done: 0, review: null }));

let workers: Worker[] = [];
/** Workers side by side, each with a share of the decisions: a review is a minute or two of thinking. */
const WORKERS = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));

const sameGame = (record: GameRecord) => {
  const of = useReviewRun.getState().of;
  return !!of && of.initial === record.initial && of.last === lastSeq(record);
};

export function startReview(record: GameRecord): void {
  if (sameGame(record) && useReviewRun.getState().status !== "error") return;
  stopReview();
  useReviewRun.setState({
    of: { initial: record.initial, last: lastSeq(record) },
    status: "running",
    done: 0,
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
  const n = WORKERS;
  try {
    workers = Array.from(
      { length: n },
      () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    );
  } catch {
    stopWorkers();
  }
  if (workers.length) {
    const done = new Array<number>(n).fill(0);
    const parts: (GameReview | null)[] = new Array(n).fill(null);
    workers.forEach((w, k) => {
      w.onmessage = (e: MessageEvent<FromReview>) => {
        const m = e.data;
        if (m.t === "progress") {
          done[k] = m.done;
          finish({ done: done.reduce((a, b) => a + b, 0) / n });
        } else if (m.t === "done") {
          parts[k] = m.review;
          if (parts.every(Boolean)) {
            stopWorkers();
            finish({ status: "done", done: 1, review: mergeReviews(parts as GameReview[]) });
          }
        } else {
          stopWorkers();
          finish({ status: "error", error: m.error });
        }
      };
      w.onerror = () => {
        stopWorkers();
        finish({ status: "error", error: "The review didn't start" });
      };
      w.postMessage({ t: "review", record, part: [k, n] } satisfies ToReview);
    });
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
  const n = WORKERS;
  let done = 0;
  try {
    const source = (await import("virtual:sandbox-worker")).default;
    const started = await Promise.all(Array.from({ length: n }, () => Sandbox.start(source, () => {})));
    boxes = started;
    const parts = await Promise.all(
      started.map(async (box, k) => {
        const loaded = await box.call<Loaded>({ t: "load", packages }, STARTUP_MS);
        if (loaded.errors.length) throw new Error(loaded.errors[0]!.error);
        const part = await box.call<GameReview>({ t: "review", record, part: [k, n] }, SHARE_MS);
        finish({ done: ++done / (n + 1) });
        return part;
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
