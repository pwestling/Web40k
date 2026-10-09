import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, createRecord, type GameEvent, type GameRecord } from "../core";
import { readGame, runningVp } from "./highlights";
import { stateAt } from "../core/log";

function record(events: GameEvent[]): GameRecord {
  return { ...createRecord(), events: events.map((event, i) => ({ seq: i + 1, by: "a", at: 0, event })) };
}

const join = (id: string, name: string, seat: number): GameEvent => ({
  type: "player/join",
  player: { id, name, color: "#fff", seat },
});

const unit = (id: string, owner: string, at: { x: number; y: number }, n = 2): GameEvent => {
  const ids = Array.from({ length: n }, (_, i) => `${id}${i}`);
  return {
    type: "unit/add",
    unit: { id, name: `Squad ${id}`, owner, modelIds: ids, formation: { kind: "skirmish" } },
    models: ids.map((mid, i) => ({
      id: mid,
      unitId: id,
      owner,
      label: mid,
      position: { x: at.x + i, y: at.y },
      facing: 0,
      base: { shape: "round", diameterMm: 32 },
    })),
  };
};

const kill = (id: string): GameEvent => ({ type: "model/wounds", id, woundsLost: 1, destroyed: true });

const setup: GameEvent[] = [
  join("a", "Ann", 0),
  join("b", "Bo", 1),
  unit("u", "a", { x: 0, y: 0 }),
  unit("v", "b", { x: 0, y: 20 }),
];

/** turn/next events until the round number reaches `round`. */
function advanceTo(events: GameEvent[], round: number): GameEvent[] {
  let s = createInitialState();
  for (const e of events) s = applyEvent(s, e);
  const out: GameEvent[] = [];
  while (s.turn.round < round && out.length < 100) {
    const e: GameEvent = { type: "turn/next" };
    s = applyEvent(s, e);
    out.push(e);
  }
  return out;
}

describe("readGame", () => {
  it("marks a unit wiped out on the event that kills its last model", () => {
    const { highlights } = readGame(record([...setup, kill("v0"), kill("v1")]));
    expect(highlights).toEqual([{ seq: 6, kind: "wiped", text: "Squad v wiped out" }]);
  });

  it("marks a charge roll short of the nearest enemy, but not one that makes it", () => {
    const roll = (total: number): GameEvent => ({
      type: "dice/roll",
      roll: { by: "a", sides: 6, results: [total - 1, 1], label: "charge", unitId: "u" },
    });
    // The enemy is about 20" away, so a 7 fails and a 12 is still short; 19 would make it.
    const { highlights } = readGame(record([...setup, roll(7), roll(19)]));
    expect(highlights.map((h) => h.kind)).toEqual(["charge"]);
    expect(highlights[0]!.text).toContain('7"');
  });

  it("marks a big VP swing once per phase", () => {
    const vp = (delta: number): GameEvent => ({
      type: "resource/adjust",
      player: "a",
      resource: "VP",
      delta,
    });
    const { highlights } = readGame(record([...setup, vp(1), vp(1), vp(1), vp(1)]));
    expect(highlights).toEqual([{ seq: 7, kind: "swing", text: "Ann +3 VP" }]);
  });

  it("sums up each finished round: VP and losses per player", () => {
    const start = [...setup, ...advanceTo(setup, 1)];
    const mid: GameEvent[] = [
      kill("v0"),
      kill("v1"),
      { type: "resource/adjust", player: "a", resource: "VP", delta: 5 },
    ];
    const events = [...start, ...mid, ...advanceTo([...start, ...mid], 2)];
    const { rounds } = readGame(record(events));
    expect(rounds).toHaveLength(1);
    const [ann, bo] = rounds[0]!.players;
    expect(rounds[0]!.round).toBe(1);
    expect(ann).toMatchObject({ name: "Ann", vp: 5, vpGained: 5, modelsLost: 0 });
    expect(bo).toMatchObject({ name: "Bo", modelsLost: 2, unitsLost: ["Squad v"] });
  });

  it("gives a clip's header the round card's VP when a round's score is confirmed after it ends (UX 414)", () => {
    const start = [...setup, ...advanceTo(setup, 1)];
    const mid: GameEvent[] = [{ type: "resource/adjust", player: "a", resource: "VP", delta: 3 }];
    const next = advanceTo([...start, ...mid], 2);
    const confirm: GameEvent = {
      type: "score/confirm",
      key: "r1",
      seat: 0,
      round: 1,
      vp: 3,
      why: "Lantern",
      by: "a",
    };
    const rec = record([...start, ...mid, ...next, confirm]);
    const card = readGame(rec).rounds[0]!;
    expect(card.players[0]!.vp).toBe(6);
    expect(runningVp(rec, stateAt(rec, card.seq), 0)).toBe(6);
    expect(runningVp(rec, stateAt(rec, rec.events.at(-1)!.seq), 0)).toBe(6);
  });
});
