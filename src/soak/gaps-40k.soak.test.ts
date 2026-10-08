import { describe } from "vitest";
import type { GameState } from "../core";
import { scenarioSuite } from "./suite";

/**
 * #40: damage re-rolls, save modifiers and Damage −1 from automated sample
 * abilities, and the 11th edition core stratagems.
 */
const watch = (s: GameState): string[] => {
  const records = [...(s.procedure?.run.records ?? []), ...(s.attack?.run?.records ?? [])];
  const tags = records.flatMap((r) => r.fired.map((name) => `${name}: ${r.id}`));
  if (records.some((r) => r.damage?.some((d) => d.rerolledFrom !== undefined))) tags.push("damage re-rolled");
  // 11th edition stratagems: the bot plays whatever the table offers.
  for (const uses of Object.values(s.used ?? {}))
    for (const u of uses) {
      tags.push(`stratagem ${u.action}`);
      if (u.action === "rapidIngress" && u.round <= 1) tags.push("Rapid Ingress in round 1");
      if (u.action === "goToGround") tags.push("Go to Ground");
    }
  return tags;
};

describe("rules gaps: 40k", () =>
  scenarioSuite(
    "40k damage and saves",
    "forty-k-11",
    { automate: true, watch },
    ["Armoured Hull: damage", "Searing Grip: damage", "Fused Plates: save", "stratagem commandReroll"],
    ["Rapid Ingress in round 1", "Go to Ground"],
  ));
