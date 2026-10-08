import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  rollStage,
  startAttack,
  stateAt,
  undoneSeqs,
  type AttackSpec,
  type GameEvent,
  type GameRecord,
  type GameState,
  type Model,
} from "../core";
import { buildLog, undoGroup } from "./gameLog";
import { momentsOf } from "../core/moments";

const model = (id: string, owner: string): Model => ({
  id,
  owner,
  label: id,
  position: { x: Number(id.slice(1)) * 2, y: owner === "p1" ? 0 : 10 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { T: "4", SV: "4+", W: "1" } },
  weapons: [],
});

function table(): GameState {
  let s: GameState = {
    ...createInitialState(),
    players: {
      p1: { id: "p1", name: "Ana", color: "#00f", seat: 0 },
      p2: { id: "p2", name: "Bo", color: "#f00", seat: 1 },
    },
  };
  for (const [id, owner, name, n] of [
    ["a", "p1", "Line Troopers", 1],
    ["t", "p2", "Ashen Thralls", 4],
  ] as const)
    s = applyEvent(s, {
      type: "unit/add",
      unit: { id, owner, name, modelIds: [], formation: { kind: "skirmish" } },
      models: Array.from({ length: n }, (_, i) => model(`${id}${i}`, owner)),
    });
  return { ...s, turn: { ...s.turn, round: 1 } };
}

const spec = {
  attackerUnitId: "a",
  targetUnitId: "t",
  weaponId: "w",
  weaponName: "Gun",
  kind: "ranged",
  attacks: "4",
  hit: 2,
  hitMod: 0,
  critHit: 6,
  rerollHits: "none",
  sustained: 0,
  lethal: false,
  wound: 2,
  woundMod: 0,
  critWound: 6,
  rerollWounds: "none",
  devastating: false,
  save: 6,
  damage: "1",
  fnp: null,
} satisfies AttackSpec;

describe("undo (UX 130)", () => {
  it("takes back a whole resolved attack in one go and says which", () => {
    const initial = table();
    const rng = () => 0.75; // every die a 5
    const events: GameEvent[] = [];
    let attack = startAttack(spec, rng, initial);
    events.push({ type: "attack/declare", attack });
    while (attack.stage !== "done") {
      attack = rollStage(initial, attack, rng);
      events.push({ type: "attack/roll", attack });
    }
    events.push({ type: "attack/clear" });
    let record: GameRecord = {
      format: "open-battle/record@1",
      initial,
      events: events.map((event, i) => ({ seq: i + 1, by: "p1", at: 0, event })),
    };
    // The same attack is a moment of the game: a unit wiped out in one go, and the MVP.
    expect(momentsOf(record).map((m) => `${m.kind}: ${m.line}`)).toEqual([
      "wipe: Line Troopers wiped out Ashen Thralls",
      "mvp: Line Troopers destroyed 1 unit",
    ]);
    const slain = () => Object.values(stateAt(record).models).filter((m) => m.destroyed).length;
    expect(slain()).toBe(4);

    const last = record.events.at(-1)!.seq;
    const group = undoGroup(record, last, undoneSeqs(record), stateAt(record));
    expect(group.seq).toBe(1);
    expect(group.also).toHaveLength(events.length - 1);
    expect(group.what).toBe("Line Troopers' shooting at Ashen Thralls");

    record = {
      ...record,
      events: [
        ...record.events,
        { seq: last + 1, by: "p1", at: 0, event: { type: "undo", seq: group.seq, also: group.also } },
      ],
    };
    expect(slain()).toBe(0);
    const log = buildLog(record).filter((i) => i.kind === "line");
    expect(log.at(-1)).toMatchObject({ text: "Ana took back Line Troopers' shooting at Ashen Thralls" });
  });
});
