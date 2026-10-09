import { describe } from "vitest";
import { systemOf, type GameEvent, type GameState } from "../core";
import { actionTargets } from "../core/content/play";
import { terrainOnMove } from "../core/content/moves";
import { fsdBehemothSample, fsdSample } from "../systems/fsd/sample";
import { moveWarnings, scenarioSuite, withRules } from "./suite";

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

/** A unit's type for the terrain rules: infantry crosses walls and ruins that stop vehicles and mechs. */
const typeOf = (s: GameState, unitId: string) =>
  s.units[unitId]?.sheet?.keywords.includes("INFANTRY") ? "infantry" : "vehicle or mech";

/**
 * #57: multiple attacks (x2) at targets named up front, terrain that blocks or
 * slows a move by unit type (checked along the path), the AD Pool following
 * the game size, and arcs of fire.
 */
const engineGaps = (s: GameState, events: GameEvent[], before: GameState): string[] => {
  const tags: string[] = [];
  for (const e of events) {
    if (e.type === "procedure/clear" && e.next) tags.push("a multiple attack went on to its next attack");
    if (e.type === "action/take" && e.action === "fire" && e.targetId) {
      if (e.more?.some((id) => id !== e.targetId)) tags.push("a multiple attack at two targets");
      const weapon = before.units[e.unitId]?.sheet?.weapons[e.weapon ?? ""];
      if (Number(weapon?.chars.Arc ?? 0) > 0) {
        const targets = actionTargets(before, e.unitId, "fire", e.weapon);
        if (targets.some((t) => !t.ok && t.why === "Outside the weapon's arc of fire"))
          tags.push("a target outside the arc of fire greyed out");
        // Advisory: the fuzzer may fire outside the arc too (greyed out, not refused).
        if (targets.find((t) => t.unitId === e.targetId)?.ok) tags.push("fired inside the arc of fire");
      }
    }
    if (e.type === "models/move") {
      const moved = new Set(e.moves.map((m) => s.models[m.id]?.unitId ?? ""));
      for (const id of moved) {
        const unit = s.units[id];
        if (!unit) continue;
        const on = terrainOnMove(s, systemOf(s), unit);
        if (on.blocked.length) tags.push(`terrain blocked a ${typeOf(s, id)} move`);
        if (on.slowed)
          tags.push(`terrain slowed ${typeOf(s, id) === "infantry" ? "an" : "a"} ${typeOf(s, id)} move`);
      }
    }
  }
  // An 80-point game: 14 AD a round, not the standard 12.
  for (const p of Object.keys(s.players)) {
    const placed = Object.values(s.placed?.[p] ?? {}).reduce((n, f) => n + f.length, 0);
    if ((s.pools?.[p]?.readyDice?.length ?? 0) + placed > 12)
      tags.push("an AD Pool over 12 from the game size");
  }
  tags.push(...moveWarnings(s, events));
  return tags;
};

/** The sample warbands with invented weapon options: fire twice (x2), arcs of fire. */
const armed = (seat: 0 | 1) =>
  withRules(
    fsdSample(seat),
    seat === 0
      ? {
          "Lancer Tank": { weapons: { "Coax MG": { chars: { x: "x2", Arc: "90" } } } },
          "Strider Walker": {
            weapons: { "Light MG": { chars: { x: "x2" } }, Autocannon: { chars: { Arc: "180" } } },
          },
        }
      : {
          "Scrap Crawler": { weapons: { "Heavy Stubber": { chars: { x: "x2", Arc: "180" } } } },
          "Raider Gang": { weapons: { Carbines: { chars: { x: "x2" } } } },
        },
  );

describe("rules gaps: FSD engine gaps (#57)", () =>
  scenarioSuite(
    "FSD multiple attacks, terrain, game size and arcs",
    "fsd-1.7",
    { watch: engineGaps, armies: armed, settings: { points: 80 } },
    [
      "a multiple attack at two targets",
      "a multiple attack went on to its next attack",
      "a target outside the arc of fire greyed out",
      "fired inside the arc of fire",
      "terrain blocked a vehicle or mech move",
      "terrain slowed an infantry move",
      "warning terrain",
      "an AD Pool over 12 from the game size",
    ],
  ));
