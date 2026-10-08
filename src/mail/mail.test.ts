import { describe, expect, it } from "vitest";
import "../systems/index";
import { type GameRecord, type Intent, type Player } from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import { seededRng } from "../sandbox/protocol";
import { freeMoves, legal, waitingOn, type BotContext } from "../soak/bot";
import { systemModule } from "../systems";
import { noteProgress } from "../teach/opponent";
import { deploySamples } from "../teach/setup";
import { commitTo, newSeed, segmentRng } from "./dice";
import { buildFile, diceKey, signatureOk, startSegment, type MailFile, type Segment } from "./file";
import { replaySegment } from "./verify";

const PLAYERS: Player[] = [
  { id: "p1", name: "Player 1", color: "#2563eb", seat: 0 },
  { id: "p2", name: "Player 2", color: "#dc2626", seat: 1 },
];

/** A 40k table with both sample armies down, as an invitation would carry it. */
function startingRecord(): GameRecord {
  const host = new Session({
    transport: createLoopbackNetwork().connect("a"),
    role: "host",
    onChange: () => {},
    rng: seededRng(7),
    now: () => 1,
  });
  const send = (i: Intent, as: string) => host.dispatch(i, as);
  for (const p of PLAYERS) send({ type: "player/join", player: p }, p.id);
  send({ type: "layout/set", layout: systemModule("forty-k").layout(host.current.table) }, "p1");
  deploySamples(() => host.current, send, "m");
  send({ type: "turn/next" }, "p1");
  host.leave();
  return host.log;
}

/** Play a stretch on one device the way the app does: its dice, every intent noted. */
async function playSegment(record: GameRecord, segment: Segment, moves: number): Promise<GameRecord> {
  const rng = await segmentRng(diceKey("g", segment));
  let clock = 100;
  const host = new Session({
    transport: createLoopbackNetwork().connect("a"),
    role: "host",
    record,
    rng,
    now: () => clock++,
    onChange: () => {},
    onIntent: (intent, by) => segment.intents.push({ intent, by }),
  });
  const ctx: BotContext & { mark?: string } = { rng: seededRng(3), kept: new Map(), idle: 0, tidy: true };
  for (let i = 0; i < moves; i++) {
    const state = host.current;
    const waiting = waitingOn(host.log, state, ctx);
    const move = waiting
      ? waiting.moves.find((m) => legal(host.log, state, m))
      : [...freeMoves(state, ctx)].find((m) => legal(host.log, state, m));
    if (!move) break;
    host.dispatch(move.intent, move.as);
    if (move.then && legal(host.log, host.current, move.then)) host.dispatch(move.then.intent, move.then.as);
    noteProgress(ctx, host.current, move);
  }
  host.leave();
  return host.log;
}

describe("play by mail", () => {
  it("a stretch of play replays to the same events on the other device", async () => {
    const base = startingRecord();
    const theirs = await commitTo(newSeed());
    const segment = startSegment(base, 3, newSeed(), theirs);
    const played = await playSegment(base, segment, 120);
    expect(played.events.length).toBeGreaterThan(base.events.length + 20);
    const file = await buildFile({ game: "g", from: "p1", name: "A", segment, record: played });
    expect(await signatureOk(file)).toBe(true);
    const verdict = await replaySegment(base, file, await segmentRng(diceKey("g", file)));
    expect(verdict).toEqual({ ok: true });
  }, 60_000);

  it("catches a changed roll, different dice, a changed file and a different start", async () => {
    const base = startingRecord();
    const segment = startSegment(base, 3, newSeed(), await commitTo(newSeed()));
    const played = await playSegment(base, segment, 400);
    const file = await buildFile({ game: "g", from: "p1", name: "A", segment, record: played });
    const rng = () => segmentRng(diceKey("g", file));

    // A fudged die.
    const fudged: MailFile = JSON.parse(JSON.stringify(file));
    const roll = fudged.events.find((e) => /"(value|results)":/.test(JSON.stringify(e.event)));
    expect(roll).toBeDefined();
    const text = JSON.stringify(roll!.event);
    roll!.event = JSON.parse(
      text
        .replace(/"results":\[(\d)/, (_m, d) => `"results":[${d === "6" ? 1 : 6}`)
        .replace(/"dice":\[\{"value":(\d)/, (_m, d) => `"dice":[{"value":${d === "6" ? 1 : 6}`),
    );
    expect(JSON.stringify(roll!.event)).not.toBe(text);
    expect((await replaySegment(base, fudged, await rng())).ok).toBe(false);

    // Someone else's seed.
    const other = await segmentRng(diceKey("g", { ...file, reveal: newSeed() }));
    expect((await replaySegment(base, file, other)).ok).toBe(false);

    // Any change breaks the signature.
    expect(await signatureOk({ ...file, name: "B" })).toBe(false);

    // A different starting game.
    const moved = await playSegment(base, startSegment(base, 3, null, null), 5);
    expect((await replaySegment(moved, file, await rng())).ok).toBe(false);
  }, 60_000);
});
