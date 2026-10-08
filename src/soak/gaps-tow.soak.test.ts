import { describe } from "vitest";
import type { GameEvent } from "../core";
import { towSample } from "../systems/tow/sample";
import { scenarioSuite } from "./suite";

/**
 * #40: The Old World combat result extras and Stubborn (the sample Tusk Brutes are Stubborn);
 * challenges, fights with more than two units and automatic Panic tests.
 */
const watch = (_: unknown, events: GameEvent[]): string[] => {
  const steps = events.flatMap((e) =>
    e.type === "script/step" ? [e] : e.type === "procedure/clear" && e.script ? [e.script] : [],
  );
  const notes = steps.flatMap((e) => e.events.flatMap((x) => (x.type === "log/note" ? [x.text] : [])));
  const tags: string[] = [];
  for (const n of notes) {
    if (n.startsWith("Combat result:")) tags.push("combat result");
    if (/combat order \+1/.test(n)) tags.push("combat order");
    if (/is Stubborn/.test(n)) tags.push("Stubborn fell back");
    if (/^Challenge: /.test(n)) tags.push("challenge");
    if (/refuses the challenge/.test(n)) tags.push("challenge refused");
    if (/ fight .+ and /.test(n) || / and .+ fight /.test(n)) tags.push("multi-unit combat");
    if (/: a Panic test$/.test(n)) tags.push("automatic Panic");
    if (/may march|fails its march test/.test(n)) tags.push("march test");
    if (/ models: a Panic test$/.test(n)) tags.push("Panic from losses");
  }
  return tags;
};

describe("rules gaps: The Old World", () =>
  scenarioSuite("Old World combat result and Stubborn", "tow-hand", { watch, closeIn: 12 }, [
    "combat result",
    "combat order",
  ]));

/** Fewer, bigger units with characters, close together: challenges, crowded fights and Panic. */
const KEEP = [
  "Marchwarden Spears",
  "Riders of the Downs",
  "Reaver Warband",
  "Reaver Slingers",
  "Tusk Brutes",
];
const crowded = (seat: 0 | 1) => {
  const army = towSample(seat);
  return { ...army, units: army.units.filter((u) => KEEP.includes(u.name)) };
};

describe("rules gaps: Old World challenges", () =>
  scenarioSuite(
    "Old World challenges, crowded fights and Panic",
    "tow-hand",
    { watch, closeIn: 14, lineUp: true, armies: crowded, minSeeds: 6 },
    ["challenge", "multi-unit combat", "automatic Panic"],
  ));
