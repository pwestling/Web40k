import { describe, expect, it } from "vitest";
import "../systems";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import { sha256Hex } from "../core";
import { restoreSystems } from "../core/content/systems";
import { playMatch } from "../bot/match";
import { botPolicy } from "../bot/player";
import { SandboxEngine } from "../sandbox/engine";
import { mergeReviews, reviewGame } from "./analyse";

const importSource = (source: string) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
    default?: unknown;
  }>;

describe("game review of a package game (#62)", () => {
  // In the app this runs in sandboxes that loaded the game's packages (review/run.ts); here, an engine loaded the same way.
  it("reads back a Rift Lanterns game, code actions and all", async () => {
    const r = await playMatch(
      { system: "rift-lanterns", systemPkg: { source: riftLanterns, importSource }, seed: 4, maxSteps: 400 },
      (start) => [
        botPolicy("sharp", start, 0, { seed: 4, plan: 0 }),
        botPolicy("steady", start, 1, { seed: 5 }),
      ],
    );
    expect(r.error).toBeUndefined();
    const engine = new SandboxEngine(importSource);
    const loaded = await engine.load([{ hash: sha256Hex(riftLanterns), source: riftLanterns }]);
    expect(loaded.errors).toEqual([]);
    try {
      const review = mergeReviews([await reviewGame(r.record!, { tries: 1, passes: 1, part: [0, 2] })]);
      expect(review.decisions.length).toBeGreaterThan(3);
      // Its units' goes are code actions (shoot, fight): they're judged against the others on offer.
      const code = review.decisions.filter((d) => d.played?.intent.type === "script/start");
      expect(code.length).toBeGreaterThan(0);
      expect(code.some((d) => d.options > 1)).toBe(true);
      // A shot or a fight that ended at once still names its target (iPad dogfood: "Dusk Stalkers: fight").
      expect(
        code.some(
          (d) => d.played?.intent.type === "script/start" && typeof d.played.intent.args?.target === "string",
        ),
      ).toBe(true);
      expect(review.points.length).toBeGreaterThan(5);
    } finally {
      restoreSystems();
    }
  }, 240_000);
});
