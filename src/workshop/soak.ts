import { Sandbox } from "../sandbox/host";
import type { SoakReport } from "../soak/run";
import type { Loaded } from "../sandbox/protocol";

export type SoakResult = Pick<SoakReport, "seed" | "ok" | "failures" | "steps" | "round" | "finished">;

/** A bot game can take a while; past this it counts as stuck. */
const GAME_MS = 120_000;

/**
 * Soak a draft package (#41): bot games, one per seed, in a sandboxed worker
 * of their own (src/workshop/soakWorker.ts), so the draft's code never runs
 * on the page. Each result arrives as its game ends.
 */
export async function soakDraft(
  source: string,
  seeds: number[],
  each: (r: SoakResult) => void,
): Promise<void> {
  let stopped: string | null = null;
  let box: Sandbox;
  try {
    const code = (await import("virtual:soak-worker")).default;
    box = await Sandbox.start(code, (why) => (stopped = why));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    for (const seed of seeds) each({ seed, ok: false, failures: [why], steps: 0, round: 0, finished: false });
    return;
  }
  try {
    for (const seed of seeds) {
      try {
        each(await box.call<SoakReport>({ t: "soak", source, seed }, GAME_MS));
      } catch (e) {
        const why = stopped ?? (e instanceof Error ? e.message : String(e));
        each({ seed, ok: false, failures: [why], steps: 0, round: 0, finished: false });
        if (stopped) return;
      }
    }
  } finally {
    box.stop();
  }
}

/** The checker: one sandbox kept for the workshop's saves, started again if it stops. */
let checker: Promise<Sandbox> | null = null;

/**
 * Load a draft in the sandbox the way the test table will (#42, UX 307-308):
 * its load errors, and what its game gives the app (to see whether the
 * sample armies or the table changed).
 */
export async function checkDraft(source: string): Promise<Loaded> {
  const start = async () => {
    const code = (await import("virtual:soak-worker")).default;
    return Sandbox.start(code, () => (checker = null));
  };
  checker ??= start();
  try {
    return await (await checker).call<Loaded>({ t: "check", source }, CHECK_MS);
  } catch (e) {
    checker = null;
    throw e;
  }
}

/** Loading a draft runs its top level and its sample and layout code: this long, or it's stuck. */
const CHECK_MS = 5000;
