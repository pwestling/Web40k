import { describe, expect, it } from "vitest";
import type { AttackSpec } from "../core";
import { damageValue, shiftDamage, stepValue } from "./autoText";

const spec = (over: Partial<AttackSpec>): AttackSpec =>
  ({ damage: "1", hit: 3, hitMod: 0, wound: 4, woundMod: 0, save: 3, ...over }) as AttackSpec;

describe("attack summary numbers (UX 296, 302)", () => {
  it("leads with the number to roll, then the printed number and why", () => {
    const s = spec({
      save: 6,
      saveMod: 1,
      because: [{ name: "Fused Plates", step: "save", change: { mod: 1 } }],
    });
    expect(stepValue(s, "save", 6, 1)).toBe("5+ (6+, +1 Fused Plates)");
    expect(stepValue(spec({}), "hit", 3, -1)).toBe("4+ (3+, −1)");
    expect(stepValue(spec({}), "hit", 3, 0)).toBe("3+");
    // A hit never needs more than a 6, and modifiers count up to one.
    expect(stepValue(spec({}), "hit", 6, -2)).toBe("6+ (6+, −2)");
    expect(stepValue(spec({}), "wound", 2, 1)).toBe("2+ (2+, +1)");
  });

  it("shows damage as rolled, with the profile's own and the changes", () => {
    expect(shiftDamage("D6", 1)).toBe("D6+1");
    expect(shiftDamage("D6+1", -1)).toBe("D6");
    expect(shiftDamage("3", 1)).toBe("4");
    const s = spec({
      damage: "D6",
      rerollDamage: "ones",
      because: [{ name: "Armoured Hull", step: "damage", change: { mod: -1 } }],
    });
    expect(damageValue(s)).toBe("D6 (D6+1, −1 Armoured Hull; re-roll 1s)");
    expect(damageValue(spec({ damage: "2" }))).toBe("2");
  });
});
