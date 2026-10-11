import { describe, expect, it } from "vitest";
import "../systems";
import arena from "../../examples/packages/arena.js?raw";
import skirmish from "../../examples/workshop/skirmish.js?raw";
import ranked from "../../examples/workshop/ranked.js?raw";
import activations from "../../examples/workshop/activations.js?raw";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import { readManifest } from "../packages/manifest";
import { soak } from "./run";
import { scenarioSuite } from "./suite";
import factionPack from "../../examples/workshop/faction-pack.js?raw";
import { applyPack, readFactionPack } from "../packages/faction";
import { fortyK } from "../core/content/examples/forty-k";
import { sampleRoster } from "../systems/wh40k/sample";

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

/**
 * The workshop's faction pack template (#79) on the sample army it names: whole games with the
 * pack's rules on the near side's army, and one of them coming up in play.
 */
describe("the faction pack template plays through the soak bot", () => {
  const read = readFactionPack(factionPack);
  if ("error" in read) throw new Error(read.error);
  const ref = { id: read.manifest.id, name: read.manifest.name, version: "0", hash: "template", bytes: 1 };
  const names = new Set(
    [
      ...(read.pack.rules ?? []),
      ...(read.pack.abilities ?? []),
      ...(read.pack.detachments ?? []).flatMap((d) => [...(d.rules ?? []), ...(d.stratagems ?? [])]),
    ].map((r) => r.name),
  );
  scenarioSuite(
    "faction pack template",
    "forty-k-11",
    {
      armies: (seat) =>
        seat === 0 ? applyPack(sampleRoster(0), read.pack, ref, fortyK).roster : sampleRoster(1),
      watch: (s) =>
        [...(s.procedure?.run.records ?? []), ...(s.attack?.run?.records ?? [])].flatMap((r) =>
          r.fired.some((n) => names.has(n)) ? ["pack rule fired"] : [],
        ),
    },
    ["pack rule fired"],
  );
});
