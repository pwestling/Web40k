import { describe } from "vitest";
import type { GameState } from "../core";
import { scenarioSuite } from "./suite";

/** #40: damage re-rolls, save modifiers and Damage −1, from automated sample abilities. */
const watch = (s: GameState): string[] => {
  const records = [...(s.procedure?.run.records ?? []), ...(s.attack?.run?.records ?? [])];
  const tags = records.flatMap((r) => r.fired.map((name) => `${name}: ${r.id}`));
  if (records.some((r) => r.damage?.some((d) => d.rerolledFrom !== undefined))) tags.push("damage re-rolled");
  return tags;
};

describe("rules gaps: 40k", () =>
  scenarioSuite("40k damage and saves", "forty-k-11", { automate: true, watch }, [
    "Armoured Hull: damage",
    "Searing Grip: damage",
    "Fused Plates: save",
  ]));
