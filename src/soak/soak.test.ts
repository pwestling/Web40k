import { describe, expect, it } from "vitest";
import "../systems";
import { soak } from "./run";

// The seeded soak games themselves run with `pnpm soak` (src/soak/*.soak.test.ts). These keep the
// bot and its checks honest in the ordinary test run.
describe("soak bot", () => {
  it("plays a whole game with trouble on the way, and it passes", async () => {
    const r = await soak({ system: "fsd-1.7", seed: 1 });
    expect(r.failures).toEqual([]);
    expect(r.finished).toBe(true);
    expect(r.trouble.join()).toMatch(/dropped.*host.*branched/);
  }, 60_000);

  it("fails a game where a guest's table drifts from the host's", async () => {
    const r = await soak({ system: "fsd-1.7", seed: 1, trouble: false, drift: 30 });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/differs|desync/);
  }, 60_000);
});
