import { describe } from "vitest";
import type { GameState } from "../core";
import { scenarioSuite } from "./suite";

/** #40: Conquest special rules from the sample armies, Supremacy each round, Broken on the worst Resolve. */
const watch = (s: GameState): string[] => {
  const tags = (s.procedure?.run.records ?? []).flatMap((r) => r.fired.map((name) => `${name}: ${r.id}`));
  if (s.rolledOff) tags.push(`Supremacy to seat ${s.rolledOff.seat}`);
  const target = s.procedure?.run.roles.target;
  const id = target && "unit" in target ? target.unit : undefined;
  if (id && s.units[id]?.status?.broken && s.procedure?.run.records.some((r) => r.id.startsWith("resolve")))
    tags.push("Broken regiment tested Resolve");
  return tags;
};

describe("rules gaps: Conquest", () =>
  // Eight games: since volleys count only stands with a clear shot (#57), a few rarely break a regiment
  // (five stopped being enough once the command stand moved to the centre of the front rank, #58).
  scenarioSuite("Conquest special rules and Supremacy", "conquest-hand", { watch, minSeeds: 8 }, [
    "Flurry: hit",
    "Terrifying: resolve",
    "Deadly Blades: defense",
    "Broken regiment tested Resolve",
    "Supremacy to seat 0",
    "Supremacy to seat 1",
  ]));
