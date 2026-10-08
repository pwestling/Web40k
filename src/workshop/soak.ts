import { Sandbox } from "../sandbox/host";
import type { SoakReport } from "../soak/run";

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
