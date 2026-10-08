import { expect, it } from "vitest";
import "../systems";
import secondWind from "../../examples/packages/second-wind.js?raw";
import { soak } from "./run";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Seeded soak games for one system: SOAK_SEEDS games (20 by default) from
 * seed SOAK_FROM (1). A failing game names its seed, so `SOAK_FROM=<seed>
 * SOAK_SEEDS=1` replays exactly that game.
 */
export function soakSuite(system: string, teamSize: 1 | 2 = 1): void {
  const count = Number(env.SOAK_SEEDS ?? 20);
  const from = Number(env.SOAK_FROM ?? 1);
  for (let seed = from; seed < from + count; seed++)
    it(
      `${system}${teamSize > 1 ? " 2v2" : ""} seed ${seed}`,
      async () => {
        const r = await soak({ system, seed, teamSize, pkg: { source: secondWind, systems: ["tow-hand"] } });
        if (!r.ok)
          console.error(
            `SOAK FAIL ${system}${teamSize > 1 ? " 2v2" : ""} seed ${seed} (replay: SOAK_FROM=${seed} SOAK_SEEDS=1): ${r.failures.join("; ")}\n  trouble: ${r.trouble.join(", ")}`,
          );
        expect(r.failures).toEqual([]);
        expect(r.finished).toBe(true);
        // A 2v2 game moves four armies, so it takes several times as long; on a loaded machine
        // seed 157 took 150s (36s on its own).
      },
      teamSize > 1 ? 400_000 : 120_000,
    );
}
