import { describe } from "vitest";
import type { GameEvent, GameState } from "../core";
import { towSample } from "../systems/tow/sample";
import { scenarioSuite, withRules } from "./suite";

/**
 * #40: The Old World combat result extras and Stubborn (the sample Tusk Brutes are Stubborn);
 * challenges, fights with more than two units, automatic Panic tests (from combat, shooting and
 * magic), march tests, characters joining and leaving regiments, and magic items.
 * #57: Multiple Shots and Armour Bane, found by name in a weapon's special rules.
 */
const watch = (s: GameState, events: GameEvent[]): string[] => {
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
    if (/ joined /.test(n)) tags.push("character joined");
    if (/ left /.test(n)) tags.push("character left");
    if (/ models: a Panic test$/.test(n)) tags.push("Panic from losses");
    if (/ uses .+ \(one use: now spent\)$/.test(n)) tags.push("magic item spent");
  }
  // Armour Bane in close combat: the wounds from natural 6s save apart, on a worse roll.
  for (const e of steps)
    for (const x of e.events)
      if (x.type === "dice/roll" && /\(Armour Bane\)$/.test(x.roll.label ?? ""))
        tags.push("Armour Bane in combat");
  // The shooting procedure: Multiple Shots at -1 to hit; Armour Bane on a natural 6 to wound.
  const proc = s.procedure;
  if (proc) {
    const record = (id: string) => proc.run.records.find((r) => r.id === id);
    if (record("hit")?.fired.includes("Multiple Shots")) tags.push("Multiple Shots");
    const weapon = s.units[proc.unitId]?.sheet?.weapons[proc.weapon ?? ""];
    const bane = weapon?.keywords.some((k) => /^armou?r bane/i.test(k));
    if (
      bane &&
      record("armour")?.dice?.length &&
      record("wound")?.dice?.some((d) => d.success && d.value === 6)
    )
      tags.push("Armour Bane in shooting");
  }
  return tags;
};

/**
 * The samples with invented weapon rules: slings with Multiple Shots, bows and cleavers with
 * Armour Bane, and armour for it to bane (the samples wear none).
 */
const armed = (seat: 0 | 1) =>
  withRules(towSample(seat), {
    "Marchwarden Spears": { chars: { Sv: "4+" } },
    "Riders of the Downs": { chars: { Sv: "4+" } },
    "Reaver Warband": { chars: { Sv: "5+" } },
    "Wolf Runners": { chars: { Sv: "5+" } },
    "Reaver Slingers": { weapons: { Sling: { keywords: ["Multiple Shots (2)"] } } },
    "Fen Bowmen": { weapons: { Longbow: { keywords: ["Armour Bane (1)"] } } },
    "Tusk Brutes": {
      add: [
        {
          id: "cleavers",
          name: "Tusk Cleavers",
          kind: "melee",
          chars: { S: "S", AP: "-" },
          keywords: ["Armour Bane (1)"],
        },
      ],
    },
  });

describe("rules gaps: The Old World", () =>
  scenarioSuite("Old World combat result and Stubborn", "tow-hand", { watch, closeIn: 12, armies: armed }, [
    "combat result",
    "combat order",
    "Multiple Shots",
    "Armour Bane in shooting",
  ]));

/** Fewer, bigger units with characters, close together: challenges, crowded fights and Panic. */
const KEEP = [
  "Marchwarden Spears",
  "Fen Bowmen",
  "Riders of the Downs",
  "Fen Marshal",
  "Reaver Warband",
  "Reaver Slingers",
  "Tusk Brutes",
  "Wolf Runners",
];
const crowded = (seat: 0 | 1) => {
  const army = armed(seat);
  return { ...army, units: army.units.filter((u) => KEEP.includes(u.name)) };
};

describe("rules gaps: Old World challenges", () =>
  scenarioSuite(
    "Old World challenges, crowded fights and Panic",
    "tow-hand",
    { watch, closeIn: 14, lineUp: true, armies: crowded, minSeeds: 10 },
    [
      "challenge",
      "multi-unit combat",
      "automatic Panic",
      "Panic from losses",
      "march test",
      "character joined",
      "character left",
      "magic item spent",
      "Multiple Shots",
      "Armour Bane in shooting",
      "Armour Bane in combat",
    ],
  ));
