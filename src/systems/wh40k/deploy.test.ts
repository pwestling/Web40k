import { describe, expect, it } from "vitest";
import { baseSizeInches, createInitialState, type GameState, type Vec2 } from "../../core";
import { spawnIntents, type SpawnableUnit } from "./deploy";

const unit = (name: string, n: number): SpawnableUnit => ({
  name,
  sheet: { weapons: {}, abilities: [], keywords: [] },
  base: { shape: "round", diameterMm: 32 },
  models: Array.from({ length: n }, () => ({ profile: { name, chars: {} }, weapons: [] })),
});

const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("spawning an imported army", () => {
  it("places every model inside a narrow deployment zone away from the edge", () => {
    const base = createInitialState();
    const state: GameState = {
      ...base,
      players: { p1: { id: "p1", name: "A", color: "#00f", seat: 0 } },
      // A 6" strip that starts 6" in from the player's (+y) edge, across the middle 30".
      zones: [{ seat: 0, points: box(-15, base.table.depth / 2 - 12, 15, base.table.depth / 2 - 6) }],
    } as GameState;
    const intents = spawnIntents(state, "p1", [unit("A", 10), unit("B", 5), unit("C", 3)], "x");
    for (const i of intents) {
      if (i.type !== "unit/add") throw new Error("expected unit/add");
      for (const m of i.models) {
        const r = baseSizeInches(m.base).width / 2;
        expect(m.position.x - r).toBeGreaterThanOrEqual(-15);
        expect(m.position.x + r).toBeLessThanOrEqual(15);
        expect(m.position.y - r).toBeGreaterThanOrEqual(base.table.depth / 2 - 12);
        expect(m.position.y + r).toBeLessThanOrEqual(base.table.depth / 2 - 6);
      }
    }
    // Spread across the zone, not bunched in one corner.
    const mid = intents.map((i) =>
      i.type === "unit/add" ? i.models.reduce((t, m) => t + m.position.x, 0) / i.models.length : 0,
    );
    expect(mid[0]!).toBeLessThan(-4);
    expect(Math.abs(mid[1]!)).toBeLessThan(4);
    expect(mid[2]!).toBeGreaterThan(4);
  });
});
