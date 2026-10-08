import { describe, expect, it } from "vitest";
import type { TerrainPiece } from "../../core";
import { shooterCount } from "./ranks";
import { block, setup, toPhase, unitNamed } from "./testing";

const hill: TerrainPiece = {
  id: "h",
  name: "Hill",
  category: "hill",
  position: { x: 0, y: -10 },
  width: 10,
  depth: 6,
  facing: 0,
  solids: [],
};

function withRule(t: ReturnType<typeof setup>["t"], unitId: string, name: string) {
  const u = t.s.units[unitId]!;
  const sheet = { ...u.sheet!, abilities: [...u.sheet!.abilities, { name, text: "" }] };
  t.s = { ...t.s, units: { ...t.s.units, [unitId]: { ...u, sheet } } };
}

describe("The Old World: shooting with more than one rank (#40)", () => {
  it("the front rank; two ranks on a hill; Volley Fire adds half of each rank behind", () => {
    const { t } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    block(t, bows, -10, 5, 0);
    // Without the sample bowmen's Volley Fire to begin with.
    const plain = t.s.units[bows]!;
    t.s = {
      ...t.s,
      units: { ...t.s.units, [bows]: { ...plain, sheet: { ...plain.sheet!, abilities: [] } } },
    };
    const n = (opts = {}) => shooterCount(t.s, t.s.units[bows]!, opts);
    // 15 bowmen, 5 wide: three ranks.
    expect(n()).toBe(5);
    t.s = { ...t.s, terrain: [hill] };
    expect(n()).toBe(10);
    t.s = { ...t.s, terrain: [] };
    withRule(t, bows, "Volley Fire");
    expect(n()).toBe(5 + 3 + 3);
    // Not when standing and shooting.
    expect(n({ standAndShoot: true })).toBe(5);
    t.s = { ...t.s, terrain: [hill] };
    expect(n()).toBe(10 + 3);
  });

  it("a unit that moved is marked as the phase ends: no Volley Fire, and Moved and shot", () => {
    const { t } = setup();
    const bows = unitNamed(t.s, "Fen Bowmen").id;
    block(t, bows, -10, 5, 0);
    withRule(t, bows, "Volley Fire");
    toPhase(t, "movement");
    const moves = t.s.units[bows]!.modelIds.map((id) => ({
      id,
      to: { x: t.s.models[id]!.position.x, y: t.s.models[id]!.position.y + 2 },
    }));
    t.play({ type: "models/move", moves }, "p1");
    expect(t.s.units[bows]!.status?.moved).toBeFalsy();
    toPhase(t, "shooting");
    expect(t.s.units[bows]!.status?.moved).toBe(true);
    expect(shooterCount(t.s, t.s.units[bows]!)).toBe(5);
  });
});
