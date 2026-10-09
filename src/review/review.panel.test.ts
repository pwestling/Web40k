import { describe, expect, it } from "vitest";
import "../systems";
import { createInitialState, type LoggedEvent } from "../core";
import { decisionAt } from "./analyse";

describe("game review: attacks made in the attack panel (#62 dogfood)", () => {
  it("judges a declared shot or blow as the shoot or fight action the computer would take", () => {
    const base = createInitialState();
    const state = {
      ...base,
      system: "forty-k-11",
      players: { p1: { id: "p1", name: "You", color: "#38f", seat: 0 } },
    } as typeof base;
    const declare = (kind: "ranged" | "melee") =>
      ({
        seq: 7,
        by: "p1",
        event: {
          type: "attack/declare",
          attack: {
            spec: { attackerUnitId: "walker", targetUnitId: "brutes", weaponId: "autobolter", kind },
          },
        },
      }) as unknown as LoggedEvent;
    expect(decisionAt(state, declare("ranged"))?.intent).toEqual({
      type: "action/take",
      unitId: "walker",
      action: "shoot",
      weapon: "autobolter",
      targetId: "brutes",
    });
    expect(decisionAt(state, declare("melee"))?.intent).toMatchObject({ action: "fight" });
  });
});
