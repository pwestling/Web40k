import { describe, expect, it } from "vitest";
import "../systems";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type Intent,
  type PlayerId,
} from "../core";
import { systemOf } from "../core/content/turn";
import { spawnIntents } from "../systems/wh40k/deploy";
import { wh40kModule } from "../systems/wh40k/module";
import { towModule } from "../systems/tow/module";
import type { Mission } from "../sdk";
import { pendingScores, vpByRound } from "./scoring";

const rng = () => 0.5;

function host(record: GameRecord, intent: Intent, by: PlayerId): GameRecord {
  const logged = resolveLogged(record, intent, by, rng, 0);
  if (!logged) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return appendEvent(record, logged);
}

function game(module: typeof wh40kModule, mission: Mission): GameRecord {
  let r = createRecord(createInitialState());
  r = host(r, { type: "player/join", player: { id: "p1", name: "Ana", color: "#00f", seat: 0 } }, "p1");
  r = host(r, { type: "player/join", player: { id: "p2", name: "Ben", color: "#f00", seat: 1 } }, "p2");
  r = host(r, { type: "game/system", system: module.system.id }, "p1");
  const { zones, objectives } = mission.setup(stateAt(r).table);
  r = host(
    r,
    { type: "mission/set", mission: { id: mission.id, name: mission.name }, zones, objectives },
    "p1",
  );
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(stateAt(r), p, module.app!.sample(seat).units, p, "army")) r = host(r, i, p);
  return r;
}

const confirmAll = (r: GameRecord, mission: Mission): GameRecord => {
  for (const s of pendingScores(r, stateAt(r), mission))
    r = host(
      r,
      { type: "score/confirm", key: s.key, seat: s.seat, round: s.round, vp: s.vp, why: s.why },
      s.seat ? "p2" : "p1",
    );
  return r;
};

describe("missions and scoring", () => {
  it("suggests 40k primary at the end of each Command phase from round 2, once, and adds the VP", () => {
    const mission = wh40kModule.app!.missions![0]!;
    let r = game(wh40kModule, mission);
    expect(stateAt(r).mission?.id).toBe(mission.id);
    expect(stateAt(r).objectives.length).toBe(5);
    const rounds = systemOf(stateAt(r)).turn.rounds as number;
    let keys: string[] = [];
    for (let i = 0; i < 200 && stateAt(r).turn.round <= rounds; i++) {
      r = host(r, { type: "turn/next" }, "p1");
      keys = [...keys, ...pendingScores(r, stateAt(r), mission).map((p) => p.key)];
      r = confirmAll(r, mission);
    }
    const s = stateAt(r);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("primary:1:0");
    expect(keys).toContain("primary:2:0");
    expect(keys).toContain("primary:2:1");
    expect(keys).toContain(`primary:${rounds}:1`);
    expect(pendingScores(r, s, mission)).toEqual([]);
    const total = (seat: number) =>
      (s.scores ?? []).filter((x) => x.seat === seat).reduce((a, x) => a + x.vp, 0);
    expect(s.resources.p1?.VP ?? 0).toBe(total(0));
    expect(vpByRound(s).rounds.every((n) => n >= 2)).toBe(true);
  });

  it("won't log the same score twice", () => {
    const mission = wh40kModule.app!.missions![0]!;
    const r = host(
      game(wh40kModule, mission),
      { type: "score/confirm", key: "primary:2:0", seat: 0, round: 2, vp: 5, why: "x" },
      "p1",
    );
    expect(
      resolveLogged(
        r,
        { type: "score/confirm", key: "primary:2:0", seat: 0, round: 2, vp: 5, why: "x" },
        "p1",
        rng,
        0,
      ),
    ).toBeNull();
    expect(stateAt(r).resources.p1?.VP).toBe(5);
  });

  it("scores the Old World mission once, at the end of the battle", () => {
    const mission = towModule.app!.missions![0]!;
    let r = game(towModule, mission);
    const rounds = systemOf(stateAt(r)).turn.rounds as number;
    // Ben's whole army is destroyed before the end.
    const ben = Object.values(stateAt(r).units).filter((u) => u.owner === "p2");
    for (let i = 0; i < 200 && stateAt(r).turn.round <= rounds; i++) {
      expect(pendingScores(r, stateAt(r), mission)).toEqual([]);
      r = host(r, { type: "turn/next" }, "p1");
      if (stateAt(r).turn.round === 1 && ben.length) {
        for (const u of ben.splice(0))
          for (const id of u.modelIds)
            r = host(r, { type: "model/wounds", id, woundsLost: 1, destroyed: true }, "p2");
      }
    }
    const pending = pendingScores(r, stateAt(r), mission);
    expect(pending.map((p) => p.key)).toEqual([`victory:${rounds}:0`, `victory:${rounds}:1`]);
    expect(pending[0]!.vp).toBeGreaterThan(0);
    expect(pending[1]!.vp).toBe(0);
  });
});
