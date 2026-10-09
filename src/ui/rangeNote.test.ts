import { describe, expect, it } from "vitest";
import "../systems";
import { getSystem } from "../core/content";
import { rangeNote } from "./rangeNote";

const gun = (range: string) => ({ chars: { Range: range } });

describe("range notes", () => {
  it("The Old World: long range past half, out of range past the weapon's range (dogfood #54)", () => {
    const tow = getSystem("tow-hand")!;
    expect(rangeNote(tow, gun("24"), 10, false)).toBeNull();
    expect(rangeNote(tow, gun("24"), 15, false)).toBe("long range");
    expect(rangeNote(tow, gun("24"), 30, false)).toBe("out of range");
  });

  it("FSD: long range past the weapon's range while a hit is still possible", () => {
    const fsd = getSystem("fsd-1.7")!;
    expect(rangeNote(fsd, gun("6"), 8, false)).toBe("long range");
    expect(rangeNote(fsd, gun("6"), 14, true)).toBe("out of range");
  });

  it("40k: past the range is simply out of range", () => {
    const fk = getSystem("forty-k-11")!;
    expect(rangeNote(fk, gun("24"), 15, false)).toBeNull();
    expect(rangeNote(fk, gun("24"), 30, false)).toBe("out of range");
  });
});
