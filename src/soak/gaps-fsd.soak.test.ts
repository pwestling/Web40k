import { describe } from "vitest";
import type { GameState } from "../core";
import { fsdBehemothSample } from "../systems/fsd/sample";
import { scenarioSuite } from "./suite";

/** #40: FSD behemoths, a Siege Hauler a side: Systems soak hits from their side, the rest reach the Core. */
const watch = (s: GameState): string[] => {
  const notes = (s.procedure?.run.outcomes ?? []).flatMap((o) => (o.kind === "note" ? [o.text] : []));
  const tags: string[] = [];
  if (notes.some((n) => / Plate damage roll \d+: (white|orange)/.test(n))) tags.push("a System soaked a hit");
  if (notes.some((n) => /through to the core/.test(n))) tags.push("a hit went through to the Core");
  const hauler = Object.values(s.units).find((u) => u.name === "Siege Hauler" && u.status?.acting);
  if (hauler && Number(hauler.status?.actionBudget) === 10) tags.push("parts activated with the Core");
  return tags;
};

describe("rules gaps: FSD", () =>
  scenarioSuite("FSD behemoths", "fsd-1.7", { watch, armies: fsdBehemothSample }, [
    "a System soaked a hit",
    "parts activated with the Core",
  ]));
