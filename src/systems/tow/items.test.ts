import { describe, expect, it } from "vitest";
import { gameView } from "../../core/script";
import { itemActions } from "./items";
import { setup, toPhase, unitNamed } from "./testing";

describe("Old World magic items (#40)", () => {
  it("uses an item from the card; a one-use item is spent", () => {
    const { t, spears } = setup();
    toPhase(t, "movement");
    const use = itemActions[0]!;
    const view = () => gameView(t.s, "tow-hand");
    const actor = { player: "p1", unitId: spears };
    expect(use.applies!(view(), actor)).toBe(true);
    expect(use.available(view(), actor)).toBe(true);
    t.play({ type: "script/start", procedure: "useItem", args: { unit: spears } }, "p1");
    expect(t.notes().at(-1)).toBe("Marchwarden Spears uses Marsh Lantern (one use: now spent)");
    expect(t.s.units[spears]!.status?.["spent.Marsh Lantern"]).toBe(true);
    expect(use.available(view(), actor)).toBe("Its magic items are spent or used this phase");
    // A unit without items isn't offered the action at all.
    const bowmen = unitNamed(t.s, "Fen Bowmen").id;
    expect(use.applies!(view(), { player: "p1", unitId: bowmen })).toBe(false);
  });

  it("an item that isn't one use comes back next phase", () => {
    const { t } = setup();
    const warband = unitNamed(t.s, "Reaver Warband");
    const actor = { player: warband.owner, unitId: warband.id };
    t.play({ type: "script/start", procedure: "useItem", args: { unit: warband.id } }, warband.owner);
    expect(t.notes().at(-1)).toBe("Reaver Warband uses Bone Charm");
    expect(itemActions[0]!.available(gameView(t.s, "tow-hand"), actor)).toMatch(/used this phase/);
    toPhase(t, "shooting");
    expect(itemActions[0]!.available(gameView(t.s, "tow-hand"), actor)).toBe(true);
  });
});
