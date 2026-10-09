import { describe } from "vitest";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import { systemOf, type GameEvent, type GameState } from "../core";
import { terrainOnMove } from "../core/content/moves";
import { inFootprint } from "../core/terrain";
import { moveWarnings, scenarioSuite } from "./suite";

/**
 * #57 in Rift Lanterns (a whole game from a package): a unit goes once a
 * round, so moving one that already went is a move, not a second go; and a
 * move is checked along its path, so one through a wreck to open ground
 * beyond is flagged as well as one ending in it.
 */
const watch = (s: GameState, events: GameEvent[], before: GameState): string[] => {
  const tags: string[] = [];
  for (const e of events) {
    if (e.type !== "models/move") continue;
    for (const id of new Set(e.moves.map((m) => s.models[m.id]?.unitId ?? ""))) {
      const was = before.units[id];
      const unit = s.units[id];
      if (!was || !unit || s.turn.round === 0) continue;
      if (was.status?.activated && !was.status.acting)
        tags.push(
          unit.status?.acting ? "a second go in a round" : "a unit that went moved again, no second go",
        );
      for (const p of terrainOnMove(s, systemOf(s), unit).blocked) {
        if (p.category !== "wreck") continue;
        const ends = unit.modelIds.some((m) => s.models[m] && inFootprint(p, s.models[m]!.position));
        tags.push(ends ? "a move into a wreck" : "a move through a wreck to beyond it");
      }
    }
  }
  tags.push(...moveWarnings(s, events));
  return tags;
};

describe("rules gaps: Rift Lanterns", () =>
  scenarioSuite(
    "Rift Lanterns once a round and wreck paths",
    "rift-lanterns",
    { watch, systemPkg: { source: riftLanterns }, maxSteps: 3000 },
    ["a unit that went moved again, no second go", "a move through a wreck to beyond it", "warning terrain"],
    ["a second go in a round"],
  ));
