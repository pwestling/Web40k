import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, type GameEvent, type GameState, type Model } from "../core";
import { dragVerb } from "./tableVerbs";

const model = (id: string, owner: string, x: number): Model => ({
  id,
  owner,
  label: id,
  position: { x, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
});

function table(): GameState {
  let s = createInitialState();
  const add = (
    id: string,
    owner: string,
    name: string,
    x: number,
    abilities: { name: string; text: string }[] = [],
  ) =>
    (s = applyEvent(s, {
      type: "unit/add",
      unit: {
        id,
        owner,
        name,
        modelIds: [],
        formation: { kind: "skirmish" },
        sheet: { abilities, weapons: {}, profiles: [], keywords: [] },
      },
      models: [model(`${id}-1`, owner, x)],
    } as unknown as GameEvent));
  add("lead", "p1", "Captain", 0, [
    { name: "Leader", text: "This model can be attached to the following units: Line Troopers" },
  ]);
  add("troops", "p1", "Line Troopers", 3);
  add("guards", "p1", "Gate Guards", 6);
  add("foes", "p2", "Raiders", 20);
  return s;
}

describe("dropping a unit on another (UX 84 §2, §6)", () => {
  it("lets a leader lead a unit before the battle", () => {
    const s = table();
    expect(dragVerb(s, "lead", "troops")).toMatchObject({ verb: "attach", ok: true });
    // One its Leader ability doesn't name: it can still lead it, anyway.
    expect(dragVerb(s, "lead", "guards")).toMatchObject({ verb: "attach", ok: false });
    // Not a leader, or its own unit: it just moves there.
    expect(dragVerb(s, "troops", "guards")).toBeNull();
    expect(dragVerb(s, "lead", "lead")).toBeNull();
    // Once the battle is on, a drop is a move.
    expect(dragVerb({ ...s, turn: { ...s.turn, round: 1 } }, "lead", "troops")).toBeNull();
  });
});
