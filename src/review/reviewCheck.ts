import { expect } from "vitest";
import "../systems";
import { stateAt, type GameRecord } from "../core";
import { playMatch } from "../bot/match";
import { botPolicy } from "../bot/player";
import { mergeReviews, reviewGame } from "./analyse";
import { moveText, takeaways } from "./words";

/** A quick Sharp-against-Steady game to read back. */
async function game(system: string, seed: number, maxSteps?: number): Promise<GameRecord> {
  const r = await playMatch({ system, seed, mirror: 0, ...(maxSteps ? { maxSteps } : {}) }, (start) => [
    botPolicy("sharp", start, 0, { seed, plan: 0 }),
    botPolicy("steady", start, 1, { seed: seed + 1 }),
  ]);
  expect(r.error, system).toBeUndefined();
  return r.record!;
}

/** A game played and read back decision by decision (#61 tests, one file per few systems so they run side by side). */
export async function checkReview(system: string): Promise<void> {
  const record = await game(system, 3, 500);
  // Two workers' shares of six, joined, as the app runs it (a quick, rough reading: one go of each).
  const parts = await Promise.all(
    [0, 3].map((k) => reviewGame(record, { tries: 1, passes: 1, part: [k, 6] })),
  );
  const review = mergeReviews(parts);
  expect(review.seats).toEqual([0, 1]);
  expect(review.scale).toBeGreaterThan(0);
  expect(review.decisions.length).toBeGreaterThan(3);
  expect(review.decisions.map((d) => d.seq)).toEqual(
    [...review.decisions.map((d) => d.seq)].sort((a, b) => a - b),
  );
  for (const d of review.decisions) {
    expect(d.loss).toBeGreaterThanOrEqual(0);
    expect(d.endSeq).toBeGreaterThanOrEqual(d.seq);
    expect(moveText(stateAt(record, d.seq - 1), d.played).length).toBeGreaterThan(0);
  }
  // The expected-result line runs the whole game, between a sure loss and a sure win.
  expect(review.points.length).toBeGreaterThan(10);
  for (const p of review.points) expect(p.p >= 0 && p.p <= 1).toBe(true);
  for (const m of review.marks) expect(review.decisions[m.decision]).toBeDefined();
  // Every side gets its takeaways, in words.
  for (const seat of review.seats) {
    const lines = takeaways(review, (seq) => stateAt(record, seq - 1), seat);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
  }
}
