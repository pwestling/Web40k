import { describe, expect, it } from "vitest";
import type { TerrainPiece } from "../../core";
import { gameView } from "../../core/script";
import { dangerousTests, terrainActions, terrainWarnings } from "./terrainTests";
import { block, setup, standing, toPhase, unitNamed } from "./testing";

const marsh: TerrainPiece = {
  id: "m",
  name: "Marsh",
  category: "dangerous",
  position: { x: 0, y: -6 },
  width: 10,
  depth: 2,
  facing: 0,
  solids: [],
};

describe("The Old World dangerous terrain tests (#40)", () => {
  it("a model whose move crossed dangerous terrain tests; 1s lose a Wound", () => {
    const { t } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    block(t, bows, -10, 5, 0);
    t.s = { ...t.s, terrain: [marsh] };
    toPhase(t, "movement");
    const view = () => gameView(t.s, "tow-hand");
    const actor = { player: "p1", unitId: bows };
    const action = terrainActions[0]!;
    expect(action.applies!(view(), actor)).toBe(false);
    // March all 15 bowmen 8" forward, straight through the marsh.
    const moves = t.s.units[bows]!.modelIds.map((id) => ({
      id,
      to: { x: t.s.models[id]!.position.x, y: t.s.models[id]!.position.y + 8 },
    }));
    t.play({ type: "models/move", moves }, "p1");
    expect(dangerousTests(t.s, t.s.units[bows]!)).toBe(15);
    expect(action.label!(view(), actor)).toBe("Dangerous terrain tests (15)");
    expect(terrainWarnings(view()).map((w) => w.unitId)).toEqual([bows]);
    const before = standing(t.s, bows);
    t.play({ type: "script/start", procedure: "dangerousTerrain", args: { unit: bows } }, "p1", 5);
    const note = t.notes().at(-1)!;
    expect(note).toMatch(/^Fen Bowmen takes 15 Dangerous terrain tests/);
    const lost = Number(/(\d+) Wounds? lost/.exec(note)?.[1] ?? 0);
    expect(standing(t.s, bows)).toBe(before - lost);
    expect(action.available(view(), actor)).toBe("Tested for this move");
    expect(terrainWarnings(view())).toEqual([]);
  });
});
