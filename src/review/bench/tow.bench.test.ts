import { describe, expect, it } from "vitest";
import { TRUSTED } from "../trust";
import { benchTimeout, calibrate } from "./judge";
import { towBench } from "./tow";

describe("the review benchmark (#63): The Old World", () => {
  it(
    "ranks the better play above the worse in every kind the review trusts",
    async () => {
      const { failed, items } = await calibrate(towBench);
      expect(failed).toEqual([]);
      // Every kind the review trusts here has at least two items behind it.
      for (const kind of TRUSTED[towBench.system] ?? [])
        expect(items[kind] ?? 0, kind).toBeGreaterThanOrEqual(2);
    },
    benchTimeout,
  );
});
