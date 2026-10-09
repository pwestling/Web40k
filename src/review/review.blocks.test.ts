import { describe, expect, it } from "vitest";
import "../systems";
import { playMatch } from "../bot/match";
import { analyst, botPolicy } from "../bot/player";
import { reviewGame } from "./analyse";
import { conquestBench } from "./bench/conquest";

describe("game review of a block game (#66)", () => {
  it("judges a Conquest march with the block move that followed it, not as a march nowhere", async () => {
    const r = await playMatch({ system: "conquest-hand", seed: 3, mirror: 0, maxSteps: 300 }, (start) => [
      botPolicy("sharp", start, 0, { seed: 3, plan: 0 }),
      botPolicy("steady", start, 1, { seed: 4 }),
    ]);
    const review = await reviewGame(r.record!, { tries: 1, passes: 1, part: [0, 3] });
    const marches = review.decisions.filter(
      (d) => d.played?.intent.type === "action/take" && d.played.intent.action === "march",
    );
    expect(marches.length).toBeGreaterThan(0);
    for (const d of marches) expect(d.played?.then?.intent.type).toBe("unit/move");
  }, 120_000);

  it("judges a Conquest charge logged before its roll as the charge rolled, by the odds", async () => {
    const item = conquestBench.items.find((i) => i.id === "charge-the-archers")!;
    const { p, better } = await item.build();
    const logged = { ...better, then: undefined };
    delete logged.then;
    const look = (m: typeof better) =>
      analyst(p.state, p.seat, { seed: 2 }).appraise(p.record, p.state, m, new Set());
    const rolled = look(better);
    const declared = look(logged);
    expect(declared.played).not.toBeNull();
    expect(declared.played!).toBeCloseTo(rolled.played!, 6);
  }, 120_000);
});
