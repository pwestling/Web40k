import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  createRecord,
  resolveIntent,
  type GameRecord,
  type Intent,
  type PlayerId,
} from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { sampleRoster } from "../systems/wh40k/sample";
import { battleOver } from "../ui/StatsScreen";
import { chapters } from "./chapters";
import { cleanNote, joinNotes, startDraft, talkOrNote, useNotes, type ReplayNote } from "./notes";

function playedGame(): GameRecord {
  const record: GameRecord = createRecord(createInitialState());
  let state = record.initial;
  const play = (intent: Intent, from: PlayerId) => {
    const event = resolveIntent(intent, from, () => 0.5, state);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    const seq = state.seq + 1;
    state = { ...applyEvent(state, event), seq };
    record.events.push({ seq, by: from, at: 1000 + seq, event });
  };
  play({ type: "player/join", player: { id: "p1", name: "Ana", color: "#3b82f6", seat: 0 } }, "p1");
  play({ type: "player/join", player: { id: "p2", name: "Bo", color: "#f97316", seat: 1 } }, "p2");
  for (const i of spawnIntents(state, "p1", sampleRoster(0).units, "p1-a", "Us")) play(i, "p1");
  for (const i of spawnIntents(state, "p2", sampleRoster(1).units, "p2-b", "Them")) play(i, "p2");
  for (let i = 0; i < 60 && !battleOver(state); i++) {
    play({ type: "turn/next" }, "p1");
    if (state.turn.round === 1 && i < 3)
      play({ type: "resource/adjust", player: "p1", resource: "VP", delta: 5 }, "p1");
  }
  return record;
}

const note = (id: string, seq: number, at: number, text = "x"): ReplayNote => ({
  id,
  seq,
  by: "Coach",
  color: "#a78bfa",
  text,
  marks: [],
  at,
});

describe("annotated replays", () => {
  it("splits a replay into deployment and each side's turn, with the round cards", () => {
    const list = chapters(playedGame());
    expect(list[0]!.title).toBe("Deployment");
    expect(list[0]!.actions).toBeGreaterThan(0);
    expect(list[1]!.title).toMatch(/^Round 1 · Ana/);
    expect(list[2]!.title).toMatch(/^Round 1 · Bo/);
    // The turn that ends a round carries its card; ten turns in a five-round battle.
    expect(list.filter((c) => c.round > 0 && c.title.startsWith("Round"))).toHaveLength(10);
    expect(list.at(-1)!.title).toBe("After the battle");
    expect(list[2]!.roundCard?.round).toBe(1);
    expect(list[1]!.roundCard).toBeUndefined();
    // Chapters follow on from each other.
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.end).toBe(list[i]!.seq);
  });

  it("joins notes by id, keeping the later copy, in replay order", () => {
    const joined = joinNotes(
      [note("a", 9, 1, "old"), note("b", 3, 1)],
      [note("a", 9, 2, "new"), note("c", 5, 1)],
    );
    expect(joined.map((n) => n.id)).toEqual(["b", "c", "a"]);
    expect(joined[2]!.text).toBe("new");
  });

  it("drops a malformed note or mark from a file or a peer", () => {
    expect(cleanNote({ ...note("a", 1, 1), color: "red; background:url(x)" })).toBeNull();
    expect(cleanNote({ ...note("a", 1.5, 1) })).toBeNull();
    const ok = cleanNote({
      ...note("a", 1, 1),
      marks: [
        { kind: "arrow", from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
        { kind: "pin", at: { x: 1e9, y: 0 } },
      ],
    });
    expect(ok?.marks).toHaveLength(1);
  });

  it("draws table-talk marks into the note being written", () => {
    startDraft(12);
    talkOrNote({ kind: "arrow", from: { x: 0, y: 0 }, to: { x: 3, y: 4 } });
    talkOrNote({ kind: "ping", at: { x: 1, y: 2 } });
    expect(useNotes.getState().draft?.marks).toEqual([
      { kind: "arrow", from: { x: 0, y: 0 }, to: { x: 3, y: 4 } },
      { kind: "pin", at: { x: 1, y: 2 } },
    ]);
    useNotes.setState({ draft: null });
  });
});
