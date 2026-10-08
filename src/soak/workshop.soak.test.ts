import { describe, expect, it } from "vitest";
import "../systems";
import arena from "../../examples/packages/arena.js?raw";
import skirmish from "../../examples/workshop/skirmish.js?raw";
import ranked from "../../examples/workshop/ranked.js?raw";
import activations from "../../examples/workshop/activations.js?raw";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import { readManifest } from "../packages/manifest";
import { soak } from "./run";

/** The workshop's starter games (#41), the example game and Rift Lanterns (#42) each play whole soak games. */
describe("whole games from packages play through the soak bot", () => {
  for (const [name, source] of Object.entries({ arena, skirmish, ranked, activations, riftLanterns }))
    for (const seed of [1, 2])
      it(`${name} seed ${seed}`, async () => {
        const read = readManifest(source);
        if ("error" in read) throw new Error(read.error);
        const system = read.manifest.systems[0]!;
        const r = await soak({ system, seed, systemPkg: { source }, maxSteps: 3000 });
        if (!r.ok) console.error(`${name} seed ${seed}: ${r.failures.join("; ")}`);
        expect(r.failures).toEqual([]);
        expect(r.finished).toBe(true);
      }, 120_000);
});
