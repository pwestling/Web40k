import { describe, expect, it } from "vitest";
import { applyEvent, type BaseShape, type GameState } from "../../core";
import { formBlock, inArc } from "../../core/regiment";
import { combatArc } from "./combatKit";
import { block, setup, toPhase, unitNamed, type Table } from "./testing";

/**
 * Which side of a block a big base fights (PX #66: a chariot and a monster
 * facing a Dwarf block scored "rear +2"). Invented units: the sample's Bog
 * Hulk on a chariot's or a monster's base, front to front with a block of
 * foot. Every case here is the front.
 */

const CHARIOT: BaseShape = { shape: "rect", widthMm: 50, depthMm: 100 };
const MONSTER: BaseShape = { shape: "rect", widthMm: 100, depthMm: 150 };
const MM = 25.4;

/** Put the Hulk on `base`, facing -y, with its front edge at y = `front`, its centre at x. */
function bigBase(t: Table, base: BaseShape, front: number, x = 0): string {
  const hulk = unitNamed(t.s, "Bog Hulk");
  const models = { ...t.s.models };
  for (const id of hulk.modelIds) models[id] = { ...models[id]!, base };
  let s: GameState = {
    ...t.s,
    models,
    units: { ...t.s.units, [hulk.id]: { ...hulk, formation: { kind: "ranked", files: 1, order: "close" } } },
  };
  const depth = (base.shape === "rect" ? base.depthMm : 0) / MM;
  const laid = formBlock(s, s.units[hulk.id]!, 1, Math.PI, { x, y: front + depth / 2 });
  s = applyEvent(s, { type: "models/move", moves: laid.models.map(({ id, to }) => ({ id, to })) });
  for (const { id, facing } of laid.models) s.models[id] = { ...s.models[id]!, facing };
  t.s = s;
  t.states.set(t.s.seq, t.s);
  return hulk.id;
}

describe("a big base front to front with a block (PX #66)", () => {
  // The Spears: five files, two ranks, facing +y, front rank's centres on y = 0 (front edge 0.4").
  const spearsFront = 20 / MM / 2;

  for (const [what, base] of [
    ["a chariot's base", CHARIOT],
    ["a monster's base", MONSTER],
  ] as const) {
    it(`${what}, centred on the block's front: both fight their front, no flank or rear bonus`, () => {
      const { t, spears } = setup();
      block(t, spears, 0, 5, 0);
      const hulk = bigBase(t, base, spearsFront);
      expect(inArc(t.s, t.s.units[spears]!, t.s.units[hulk]!)).toBe("front");
      expect(combatArc(t.s, t.s.units[spears]!, t.s.units[hulk]!)).toBe("front");
      expect(combatArc(t.s, t.s.units[hulk]!, t.s.units[spears]!)).toBe("front");
      toPhase(t, "combat");
      t.play({ type: "script/start", procedure: "combat", args: { unit: spears, target: hulk } }, "p1", 3);
      const result = t.notes().find((n) => n.startsWith("Combat result:"))!;
      expect(result).not.toMatch(/rear \+2|flank \+1/);
    });

    it(`${what} touching the front past the block's corner: still the front`, () => {
      const { t, spears } = setup();
      block(t, spears, 0, 3, 0);
      // Three files of 20mm: 2.4" wide. The big base overlaps the front by half an inch at the end.
      const width = (base.shape === "rect" ? base.widthMm : 0) / MM;
      const hulk = bigBase(t, base, spearsFront, 1.2 + width / 2 - 0.5);
      expect(combatArc(t.s, t.s.units[spears]!, t.s.units[hulk]!)).toBe("front");
    });

    it(`${what} pushed into the block's front by hand: its body is in front, so it is the front`, () => {
      const { t, spears } = setup();
      block(t, spears, 0, 5, 0);
      // One rank deep (0.8"), and the big base's front edge sits past the block's rear.
      const one = t.s.units[spears]!;
      t.s = { ...t.s, units: { ...t.s.units, [spears]: { ...one, modelIds: one.modelIds.slice(0, 5) } } };
      const hulk = bigBase(t, base, -1.6);
      expect(combatArc(t.s, t.s.units[spears]!, t.s.units[hulk]!)).toBe("front");
    });
  }

  it("a real flank or rear charge still counts: side on, and from behind", () => {
    const { t, spears } = setup();
    block(t, spears, 0, 5, 0);
    const hulk = bigBase(t, CHARIOT, -3);
    // From behind (the block is several ranks deep), facing its back: the rear.
    const s = t.s;
    for (const id of s.units[hulk]!.modelIds)
      s.models[id] = { ...s.models[id]!, facing: 0, position: { x: 0, y: -12 } };
    expect(combatArc(s, s.units[spears]!, s.units[hulk]!)).toBe("rear");
    // Side on, at its left or right.
    for (const id of s.units[hulk]!.modelIds)
      s.models[id] = { ...s.models[id]!, facing: Math.PI / 2, position: { x: -5, y: -1 } };
    expect(["left", "right"]).toContain(combatArc(s, s.units[spears]!, s.units[hulk]!));
  });
});
