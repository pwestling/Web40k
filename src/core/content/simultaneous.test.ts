import { afterEach, describe, expect, it } from "vitest";
import "../../systems";
import { createInitialState, type GameState, type Intent, type PlayerId } from "../index";
import { appendEvent, createRecord, lastSeq, resolveLogged, stateAt, type GameRecord } from "../log";
import { commitmentOf } from "../secrets";
import { registerSystem, unregisterSystem } from "./systems";
import { currentSlot } from "./turn";
import { isReady, sharedPhase, simultaneousPhase, waitingFor } from "./simultaneous";
import { playerActions } from "./player";
import { fortyK } from "./examples/forty-k";
import type { GameSystem } from "./schema";

/** A seeded rng, so every run rolls the same dice. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny table kept as a log, like the host's. */
class Table {
  record: GameRecord = createRecord(createInitialState());
  r = rng(7);
  get state(): GameState {
    return stateAt(this.record);
  }
  /** Send as the player; false when the host refuses it. */
  send(intent: Intent, by: PlayerId): boolean {
    const logged = resolveLogged(this.record, intent, by, this.r, lastSeq(this.record) + 1);
    if (!logged) return false;
    this.record = appendEvent(this.record, logged);
    return true;
  }
  must(intent: Intent, by: PlayerId) {
    if (!this.send(intent, by)) throw new Error(`refused: ${JSON.stringify(intent)} from ${by}`);
  }
  last() {
    return this.record.events.at(-1)!;
  }
}

function seated(system: string, players: [PlayerId, number][], teamSize = 1): Table {
  const t = new Table();
  if (teamSize > 1) t.must({ type: "settings/set", settings: { teamSize } }, players[0]![0]);
  for (const [id, seat] of players)
    t.must({ type: "player/join", player: { id, name: id.toUpperCase(), color: "#888", seat } }, id);
  t.must({ type: "game/system", system }, players[0]![0]);
  // Watchers have no seat.
  t.must({ type: "player/join", player: { id: "w", name: "Watcher", color: "#888" } }, "w");
  t.must({ type: "turn/next" }, players[0]![0]);
  return t;
}

const phase = (s: GameState) => currentSlot(s)?.id;

afterEach(() => unregisterSystem("together-test"));

describe("simultaneous phases (#81)", () => {
  it("40k's Command phase waits for both players' turn/ready, then moves on as ▶ would", () => {
    const t = seated("forty-k-11", [
      ["a", 0],
      ["b", 1],
    ]);
    expect(phase(t.state)).toBe("command");
    const active = t.state.turn.activeSeat === 0 ? "a" : "b";
    const waiting = active === "a" ? "b" : "a";
    expect(simultaneousPhase(t.state)).toMatchObject({ phase: "command", ready: [], shared: false });
    expect(waitingFor(t.state).sort()).toEqual(["a", "b"]);
    // The waiting player is done first: nothing moves, and no dice are drawn for the next phase.
    t.must({ type: "turn/ready" }, waiting);
    expect(t.last().event).toEqual({ type: "turn/ready", player: waiting, ready: true });
    expect(phase(t.state)).toBe("command");
    expect(isReady(t.state, waiting)).toBe(true);
    expect(simultaneousPhase(t.state)?.waiting).toEqual([active]);
    // Saying it twice changes nothing, so the host refuses it; nor can a watcher hold the phase up.
    expect(t.send({ type: "turn/ready" }, waiting)).toBe(false);
    expect(t.send({ type: "turn/ready" }, "w")).toBe(false);
    // The last one moves the phase on, with the seed for whatever the next phase rolls.
    t.must({ type: "turn/ready" }, active);
    expect(t.last().event).toMatchObject({ type: "turn/ready", player: active, ready: true });
    expect(typeof (t.last().event as { seed?: number }).seed).toBe("number");
    expect(phase(t.state)).toBe("movement");
    expect(t.state.turn.ready).toBeUndefined();
    // Not a simultaneous phase: turn/ready is refused.
    expect(t.send({ type: "turn/ready" }, active)).toBe(false);
  });

  it("a ready taken back, ▶ moving on anyway, and undo all go through the log", () => {
    const t = seated("forty-k-11", [
      ["a", 0],
      ["b", 1],
    ]);
    t.must({ type: "turn/ready" }, "a");
    t.must({ type: "turn/ready", ready: false }, "a");
    expect(isReady(t.state, "a")).toBe(false);
    expect(t.send({ type: "turn/ready", ready: false }, "a")).toBe(false);
    t.must({ type: "turn/ready" }, "b");
    // Undo takes b's ready back; a replay from the log reads the same.
    t.must({ type: "undo", seq: lastSeq(t.record) }, "b");
    expect(t.state.turn.ready).toEqual([]);
    // ▶ is the advisory override: on at once, whoever is ready.
    t.must({ type: "turn/next" }, "a");
    expect(phase(t.state)).toBe("movement");
  });

  it("both players draw secret mission cards at once, each under their own keys", () => {
    const t = seated("forty-k-11", [
      ["a", 0],
      ["b", 1],
    ]);
    const card = (player: PlayerId, n: number, value: string) => ({
      intent: {
        type: "secret/commit" as const,
        player,
        secrets: [{ key: `mission:00${n}`, commitment: commitmentOf(value, `salt-${player}-${n}`) }],
      },
      reveal: {
        type: "secret/reveal" as const,
        player,
        key: `mission:00${n}`,
        value,
        salt: `salt-${player}-${n}`,
      },
    });
    const a0 = card("a", 0, "seize-centre");
    const b0 = card("b", 0, "seize-centre");
    const b1 = card("b", 1, "cull");
    t.must(a0.intent, "a");
    t.must(b0.intent, "b");
    t.must(b1.intent, "b");
    t.must({ type: "turn/ready" }, "b");
    t.must(a0.reveal, "a");
    const s = t.state;
    expect(Object.keys(s.secrets?.a ?? {})).toEqual(["mission:000"]);
    expect(Object.keys(s.secrets?.b ?? {})).toEqual(["mission:000", "mission:001"]);
    expect(s.secrets?.a?.["mission:000"]?.revealed).toEqual({ value: "seize-centre" });
    expect(s.secrets?.b?.["mission:000"]?.revealed).toBeUndefined();
    expect(phase(s)).toBe("command");
  });

  it("in a 2v2 game the phase waits for all four players", () => {
    const t = seated(
      "forty-k-11",
      [
        ["a", 0],
        ["b", 1],
        ["c", 0],
        ["d", 1],
      ],
      2,
    );
    for (const p of ["a", "b", "c"]) t.must({ type: "turn/ready" }, p);
    expect(phase(t.state)).toBe("command");
    expect(waitingFor(t.state)).toEqual(["d"]);
    t.must({ type: "turn/ready" }, "d");
    expect(phase(t.state)).toBe("movement");
  });

  it("a phase outside player turns is nobody's turn: each side's own actions count as active", () => {
    const system: GameSystem = {
      ...fortyK,
      id: "together-test",
      name: "Together (test)",
      turn: {
        rounds: 2,
        initiative: "fixed",
        round: [
          { kind: "phase", id: "orders", name: "Orders", simultaneous: true },
          { kind: "playerTurns", segments: [{ kind: "phase", id: "act", name: "Act" }] },
        ],
      },
      actions: [
        {
          id: "rally",
          name: "Rally",
          by: "player",
          side: "active",
          phases: ["orders"],
          cost: [{ resource: "CP", amount: 0 }],
        },
      ],
    };
    registerSystem(system);
    const t = seated("together-test", [
      ["a", 0],
      ["b", 1],
    ]);
    expect(phase(t.state)).toBe("orders");
    expect(sharedPhase(t.state)).toBe(true);
    for (const p of ["a", "b"])
      expect(playerActions(t.state, p).find((o) => o.def.id === "rally")?.ok, p).toBe(true);
    t.must({ type: "turn/ready" }, "b");
    t.must({ type: "turn/ready" }, "a");
    expect(phase(t.state)).toBe("act");
    expect(sharedPhase(t.state)).toBe(false);
  });
});
