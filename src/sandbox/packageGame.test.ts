import { describe, expect, it } from "vitest";
import { appendEvent, createInitialState, createRecord, resolveLogged, stateAt, type Intent } from "../core";
import "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { shapeProblems, lineOf } from "../core/content/shape";
import { SandboxEngine } from "./engine";
import { seededRng } from "./protocol";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import gallery from "../../docs/community-modules.md?raw";
import { fingerprint, sha256 } from "../packages/manifest";

const importSource = (source: string) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
    default?: unknown;
  }>;

/** Rift Lanterns (#42) loaded into a sandbox engine, with a record the test plays forward. */
async function riftTable() {
  const engine = new SandboxEngine(importSource);
  const loaded = await engine.load([{ hash: "rl", source: riftLanterns }]);
  let record = createRecord(createInitialState());
  engine.init(record);
  let seed = 1;
  const play = (intent: Intent, from: string) => {
    const s = seed++ * 7919;
    const event =
      engine.resolve(intent, from, s) ?? resolveLogged(record, intent, from, seededRng(s), 0)?.event;
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    const logged = { seq: (record.events.at(-1)?.seq ?? 0) + 1, by: from, at: 0, event };
    record = appendEvent(record, logged);
    engine.events([logged]);
  };
  return { engine, loaded, play, state: () => stateAt(record) };
}

describe("a whole game from a package (Rift Lanterns)", () => {
  it("hands the app its factions, missions and a starter table built from templates", async () => {
    const { loaded } = await riftTable();
    expect(loaded.errors).toEqual([]);
    const app = loaded.packages[0]!.provides!.app;
    expect(app.armies.map((a) => a.name)).toEqual([
      "Wardens of the Wick",
      "Thornkin",
      "Cogwright Guild",
      "Gloam Choir",
    ]);
    expect(app.armies[1]!.units[0]!.models[0]).toMatchObject({ look: { shape: "beast" }, height: 1.6 });
    expect(app.missions.map((m) => m.id)).toEqual(["lantern-grab", "snuff-them-out", "last-lantern"]);
    expect(app.missions[0]!.setup.objectives).toHaveLength(3);
    expect(app.missions[0]!.table).toEqual({ width: 36, depth: 24 });
    // Templates became pieces with solids, in the game's own categories.
    expect(app.layout.terrain).toHaveLength(10);
    expect(app.layout.terrain.every((p) => Array.isArray(p.solids))).toBe(true);
    expect(app.layout.terrain.find((p) => p.name === "Woods")?.category).toBe("thicket");
  });

  it("scores its missions in the sandbox, for each round's end", async () => {
    const { engine, play, state } = await riftTable();
    play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
    play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
    play({ type: "game/system", system: "rift-lanterns" }, "p1");
    play(
      {
        type: "mission/set",
        mission: { id: "lantern-grab", name: "Lantern Grab" },
        zones: [],
        objectives: [{ id: "middle", position: { x: 0, y: 0 } }],
      },
      "p1",
    );
    // Nothing to do before there are units.
    expect(engine.appState().ready).toEqual({});
    const army = (await riftTable()).loaded.packages[0]!.provides!.app.armies[0]!;
    for (const i of spawnIntents(state(), "p1", army.units.slice(0, 1), "p1", "army")) play(i, "p1");
    // The Wick Guard stand on the middle lantern.
    const guard = Object.values(state().models);
    play(
      {
        type: "models/move",
        setup: true,
        moves: guard.map((m, i) => ({ id: m.id, to: { x: i * 0.5, y: 0 } })),
      },
      "p1",
    );
    play({ type: "turn/next" }, "p1");
    expect(state().turn.round).toBe(1);
    // Every unit activates, then the round ends.
    for (let i = 0; i < 6 && state().turn.round === 1; i++) play({ type: "turn/next" }, "p1");
    expect(state().turn.round).toBe(2);
    const app = engine.appState();
    expect(app.scores["hold:1:0"]).toEqual({ vp: 1, why: "1 lantern held" });
    expect(app.scores["hold:1:1"]).toEqual({ vp: 0, why: "0 lanterns held" });
  });

  it("refuses a system with mistyped data, naming the key and its line", async () => {
    const broken = riftLanterns
      .replace("rounds: 5,", 'rounds: "five",')
      .replace('defaultDie: "d6"', 'defaultDie: "d8"');
    const engine = new SandboxEngine(importSource);
    const loaded = await engine.load([{ hash: "x", source: broken }]);
    const error = loaded.errors[0]!.error;
    expect(error).toContain('system.turn.rounds: should be a number (got "five")');
    expect(error).toContain('system.defaultDie: should be one of the dice ("d6") (got "d8")');
    const line = lineOf(broken, error.split("; ")[1]!)!;
    expect(broken.split("\n")[line - 1]).toContain('rounds: "five"');
  });

  it("checks a system's shape", () => {
    expect(shapeProblems({})).toContain("system.id: should be text (got nothing)");
    expect(shapeProblems("nope")).toEqual(['system: should be an object (got "nope")']);
  });
});

describe("the community gallery", () => {
  it("lists Rift Lanterns with the fingerprint of the file in the repo", async () => {
    const hash = await sha256(new TextEncoder().encode(riftLanterns));
    const row = gallery.split("\n").find((l) => l.startsWith("| [Rift Lanterns]"));
    expect(row).toContain(`\`${fingerprint(hash)}\``);
  });
});
