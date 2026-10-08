import { describe } from "vitest";
import type { GameEvent } from "../core";
import { scenarioSuite } from "./suite";

/** #40: The Old World combat result extras and Stubborn (the sample Tusk Brutes are Stubborn). */
const watch = (_: unknown, events: GameEvent[]): string[] => {
  const notes = events.flatMap((e) =>
    e.type === "script/step" ? e.events.flatMap((x) => (x.type === "log/note" ? [x.text] : [])) : [],
  );
  const tags: string[] = [];
  for (const n of notes) {
    if (n.startsWith("Combat result:")) tags.push("combat result");
    if (/combat order \+1/.test(n)) tags.push("combat order");
    if (/is Stubborn/.test(n)) tags.push("Stubborn fell back");
  }
  return tags;
};

describe("rules gaps: The Old World", () =>
  scenarioSuite("Old World combat result and Stubborn", "tow-hand", { watch, closeIn: 12 }, [
    "combat result",
    "combat order",
  ]));
