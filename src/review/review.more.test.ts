import { describe, it } from "vitest";
import { checkReview } from "./reviewCheck";

describe("game review (#61)", () => {
  for (const system of ["tow-hand", "conquest-hand"])
    it(`reads back a game decision by decision (${system})`, () => checkReview(system), 240_000);
});
