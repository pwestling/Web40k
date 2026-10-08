import { describe, expect, it } from "vitest";
import { contrast, diceLook, readablePip } from "./diceSets";

describe("dice sets", () => {
  it("keeps readable pips and swaps unreadable ones for black or white", () => {
    expect(readablePip("#8f1d1d", "#ffffff")).toBe("#ffffff");
    expect(readablePip("#f3eee0", "#fafafa")).toBe("#111111");
    expect(readablePip("#16181d", "#202020")).toBe("#ffffff");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
  });
  it("falls back to the player's colour", () => {
    expect(diceLook({ color: "#3366ff" }, "#888888")).toEqual({
      body: "#3366ff",
      pip: "#10141a",
      finish: "solid",
    });
    expect(diceLook(undefined, "#888888").body).toBe("#888888");
  });
});
