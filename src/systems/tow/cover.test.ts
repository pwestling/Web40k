import { describe, expect, it } from "vitest";
import type { GameState } from "../../core";
import { previewRun } from "../../core/content";
import { procedureEnv, procedureRoles } from "../../core/content/play";
import { getSystem } from "../../core/content/systems";
import { block, setup, toPhase, unitNamed } from "./testing";

describe("The Old World graded cover (#40)", () => {
  it("up to half the target in cover is -1 to hit, more than half -2", () => {
    const { t } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    const warband = unitNamed(t.s, "Reaver Warband").id;
    block(t, bows, -10, 5, 0);
    block(t, warband, 4, 6, Math.PI);
    toPhase(t, "shooting");
    const woods = (x: number, width: number): GameState => ({
      ...t.s,
      terrain: [
        {
          id: "w",
          name: "Woods",
          category: "woods",
          position: { x, y: 6 },
          width,
          depth: 10,
          facing: 0,
          solids: [],
        },
      ],
    });
    const plan = (state: GameState) =>
      previewRun(
        procedureEnv(state),
        "shoot",
        procedureRoles(getSystem("tow-hand"), "shoot", bows, { weapon: "missile", targetId: warband }),
      );
    // In the open: BS 3 hits on 4+.
    expect(plan(t.s).plans.hit).toMatchObject({ target: 4 });
    // One file of six in the woods: partial cover.
    let p = plan(woods(-2, 1));
    expect(p.fired.hit).toEqual(["Partial cover"]);
    expect(p.plans.hit).toMatchObject({ target: 5 });
    // The whole unit in the woods: full cover.
    p = plan(woods(0, 8));
    expect(p.fired.hit).toEqual(["Full cover"]);
    expect(p.plans.hit).toMatchObject({ target: 6 });
  });
});
