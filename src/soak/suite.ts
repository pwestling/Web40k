import { expect, it } from "vitest";
import "../systems";
import secondWind from "../../examples/packages/second-wind.js?raw";
import { soak, type SoakOptions } from "./run";

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

/**
 * A rules-gap scenario (#40): seeded soak games with a probe, passing only
 * when every tag in `expect` turned up in some game, so a closed gap that
 * quietly stops firing fails here. Fewer seeds than the full soak by default.
 */
export function scenarioSuite(
  name: string,
  system: string,
  options: Pick<SoakOptions, "automate" | "watch" | "armies" | "closeIn" | "lineUp"> & {
    /** At least this many games, whatever SOAK_SEEDS says (rules that come up less often). */
    minSeeds?: number;
  },
  tags: string[],
  /** Tags that must never come up (a rule broken again). */
  never: string[] = [],
): void {
  const count = Math.max(Number(env.SOAK_SEEDS ?? 3), options.minSeeds ?? 0);
  const from = Number(env.SOAK_FROM ?? 1);
  const seen: Record<string, number> = {};
  for (let seed = from; seed < from + count; seed++)
    it(`${name} seed ${seed}`, async () => {
      const { minSeeds: _, ...opts } = options;
      const r = await soak({ system, seed, ...opts });
      if (!r.ok)
        console.error(
          `SOAK FAIL ${name} seed ${seed} (replay: SOAK_FROM=${seed} SOAK_SEEDS=1): ${r.failures.join("; ")}`,
        );
      expect(r.failures).toEqual([]);
      expect(r.finished).toBe(true);
      for (const [k, v] of Object.entries(r.seen)) seen[k] = (seen[k] ?? 0) + v;
    }, 120_000);
  it(`${name}: came up in play`, () => {
    if (env.SOAK_SEEN) console.log(JSON.stringify(seen));
    expect(tags.filter((t) => !seen[t])).toEqual([]);
    expect(never.filter((t) => seen[t])).toEqual([]);
  });
}
