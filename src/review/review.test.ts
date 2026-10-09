import { describe, it } from "vitest";
import { checkReview } from "./reviewCheck";

describe("game review (#61)", () => {
  for (const system of ["forty-k-11", "fsd-1.7"])
    it(`reads back a game decision by decision (${system})`, () => checkReview(system), 240_000);
});
