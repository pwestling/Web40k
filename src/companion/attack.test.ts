import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, type GameState, type Model, type UnitSheet } from "../core";
import { firstAnswers, tableAttack } from "./attack";

const m = (
  id: string,
  owner: string,
  x: number,
  y: number,
  chars: Record<string, string>,
  weapons: string[] = [],
): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars },
  weapons,
});

const sheet = (
  weapons: UnitSheet["weapons"] = {},
  abilities: UnitSheet["abilities"] = [],
  keywords: string[] = [],
): UnitSheet => ({
  weapons,
  abilities,
  keywords,
});

function table(): GameState {
  let s = createInitialState();
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "a",
      owner: "p1",
      name: "Shooters",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: sheet({
        rifle: {
          id: "rifle",
          name: "Rifle",
          kind: "ranged",
          chars: { RANGE: '24"', A: "2", BS: "3+", S: "4", AP: "-1", D: "1" },
          keywords: ["Rapid Fire 1", "Anti-Infantry 4+"],
        },
        melta: {
          id: "melta",
          name: "Melta",
          kind: "ranged",
          chars: { RANGE: '12"', A: "D3", BS: "4+", S: "9", AP: "-4", D: "D6" },
          keywords: ["Melta 2"],
        },
      }),
    },
    models: [
      m("s1", "p1", 0, 0, { M: '6"' }, ["rifle", "melta"]),
      m("s2", "p1", 0, -30, { M: '6"' }, ["rifle"]),
    ],
  });
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "t",
      owner: "p2",
      name: "Targets",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: sheet({}, [{ name: "Feel No Pain 5+", text: "" }], ["Infantry"]),
    },
    models: [m("t1", "p2", 0, 6, { T: "4", SV: "3+", W: "2", INV: "5+", OC: "2" })],
  });
  return s;
}

describe("table companion attacks (#37)", () => {
  it("counts the models the players say are in range, wherever they stand here", () => {
    const st = table();
    expect(firstAnswers(st, "a", "rifle").inRange).toBe(2);
    const both = tableAttack(st, "a", "rifle", "t", firstAnswers(st, "a", "rifle"))!;
    expect(both.inRange).toBe(2);
    expect(both.spec.attacks).toBe("4");
    const one = tableAttack(st, "a", "rifle", "t", { ...firstAnswers(st, "a", "rifle"), inRange: 1 })!;
    expect(one.spec.attacks).toBe("2");
  });

  it("applies half range and cover from the answers", () => {
    const st = table();
    const a = { ...firstAnswers(st, "a", "rifle"), half: true };
    expect(tableAttack(st, "a", "rifle", "t", a)!.spec.attacks).toBe("6"); // rapid fire 1 each
    const melta = tableAttack(st, "a", "melta", "t", { ...firstAnswers(st, "a", "melta"), half: true })!;
    expect(melta.spec.damage).toBe("D6+2");
    const far = tableAttack(st, "a", "melta", "t", firstAnswers(st, "a", "melta"))!;
    expect(far.spec.damage).toBe("D6");
    const covered = tableAttack(st, "a", "rifle", "t", { ...firstAnswers(st, "a", "rifle"), cover: true })!;
    expect(covered.notes).toContain("Cover");
  });
});
