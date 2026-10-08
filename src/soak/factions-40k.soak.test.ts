import { describe } from "vitest";
import type { GameState } from "../core";
import { scenarioSuite } from "./suite";

/**
 * #49: faction rules from the roster. Both sample armies bring a detachment
 * with a rule and stratagems (invented text); each side spends CP on its own,
 * and the confirmed effects run in attacks.
 */
const watch = (s: GameState): string[] => {
  const tags: string[] = [];
  for (const [player, uses] of Object.entries(s.used ?? {}))
    for (const u of uses)
      if (u.action.startsWith("army:")) tags.push(`faction stratagem, seat ${s.players[player]?.seat}`);
  const names = new Map<string, string>();
  for (const army of Object.values(s.armies ?? {})) {
    for (const st of army.stratagems) names.set(st.name, "stratagem");
    for (const r of army.rules) names.set(r.name, "detachment rule");
  }
  const records = [...(s.procedure?.run.records ?? []), ...(s.attack?.run?.records ?? [])];
  for (const r of records)
    for (const name of r.fired) {
      const kind = names.get(name);
      if (kind) tags.push(`${kind} fired`, `${name} fired`);
    }
  return tags;
};

describe("faction rules: 40k", () =>
  scenarioSuite("40k faction stratagems", "forty-k-11", { automate: true, watch, minSeeds: 8 }, [
    "faction stratagem, seat 0",
    "faction stratagem, seat 1",
    "stratagem fired",
    "detachment rule fired",
  ]));
