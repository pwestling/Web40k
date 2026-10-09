import { describe, expect, it } from "vitest";
import type { Intent } from "../core";
import type { BotMove } from "../soak/bot";
import { decisionKind, trusted, TRUSTED } from "./trust";

const m = (intent: object, then?: object): BotMove => ({
  intent: intent as Intent,
  as: "p1",
  kind: "test",
  ...(then ? { then: { intent: then as Intent, as: "p1", kind: "test" } } : {}),
});

describe("what the review's judgement is trusted with (#63)", () => {
  it("sorts a decision by the move played", () => {
    expect(decisionKind(null)).toBe("other");
    expect(decisionKind(m({ type: "action/take", unitId: "u", action: "shoot", targetId: "e" }))).toBe(
      "attack",
    );
    expect(decisionKind(m({ type: "action/take", unitId: "u", action: "charge", targetId: "e" }))).toBe(
      "charge",
    );
    expect(
      decisionKind(m({ type: "script/start", procedure: "chargeReaction", args: { target: "e" } })),
    ).toBe("charge");
    expect(decisionKind(m({ type: "script/start", procedure: "magicMissile", args: { target: "e" } }))).toBe(
      "attack",
    );
    expect(decisionKind(m({ type: "models/move", moves: [] }))).toBe("move");
    expect(
      decisionKind(m({ type: "action/take", unitId: "u", action: "march" }, { type: "unit/move" })),
    ).toBe("move");
    expect(decisionKind(m({ type: "action/take", unitId: "u", action: "remainStationary" }))).toBe("move");
    expect(decisionKind(m({ type: "action/take", unitId: "u", action: "rally" }))).toBe("other");
  });

  it("trusts only the kinds listed for the game", () => {
    expect(trusted("forty-k-11", "attack")).toBe(true);
    expect(trusted("forty-k-11", "other")).toBe(false);
    expect(trusted("no-such-game", "attack")).toBe(false);
    expect(trusted(undefined, "attack")).toBe(false);
    for (const kinds of Object.values(TRUSTED)) expect(kinds).not.toContain("other");
  });
});
