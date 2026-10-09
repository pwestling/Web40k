import { describe, expect, it } from "vitest";
import { gameView } from "../../core/script";
import { itemActions } from "./items";
import { ITEM_GROUP } from "./roster";
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
    expect(use.label!(view(), actor)).toBe("Use Marsh Lantern (one use)");
    t.play({ type: "script/start", procedure: "useItem", args: { unit: spears } }, "p1");
    expect(t.notes().at(-1)).toBe("Marchwarden Spears uses Marsh Lantern (one use: now spent)");
    expect(t.s.units[spears]!.status?.["spent.Marsh Lantern"]).toBe(true);
    expect(use.available(view(), actor)).toBe("Marsh Lantern is spent");
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
    expect(itemActions[0]!.available(gameView(t.s, "tow-hand"), actor)).toBe(
      "Bone Charm was used this phase",
    );
    toPhase(t, "shooting");
    expect(itemActions[0]!.available(gameView(t.s, "tow-hand"), actor)).toBe(true);
  });

  it("a universal rule taken as an option isn't an item to use: the module plays it", () => {
    const { t, spears } = setup();
    const u = t.s.units[spears]!;
    const abilities = (u.sheet?.abilities ?? []).filter((a) => a.group !== ITEM_GROUP);
    t.s = {
      ...t.s,
      units: {
        ...t.s.units,
        [spears]: {
          ...u,
          sheet: {
            ...u.sheet!,
            abilities: [...abilities, { name: "Frenzy", text: "+1 Attack on the charge", group: ITEM_GROUP }],
          },
        },
      },
    };
    const actor = { player: "p1", unitId: spears };
    expect(itemActions[0]!.applies!(gameView(t.s, "tow-hand"), actor)).toBe(false);
  });
});
