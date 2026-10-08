import { describe, expect, it } from "vitest";
import "../systems/index";
import type { GameRecord, GameState, Intent, Player } from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import { seededRng } from "../sandbox/protocol";
import { freeMoves, legal, waitingOn, type BotContext, type BotMove } from "../soak/bot";
import { systemModule } from "../systems";
import { getSystem } from "../core/content";
import { schedule } from "../core/content/turn";
import { lessonPackages, lessonSystem } from "./builtin";
import { advance, type Progress } from "./coach";
import { readLessonPackage, type Lesson, type Until } from "./lesson";
import { noteProgress, opponentMove } from "./opponent";
import { seatUnits, setUpLesson } from "./setup";

const PLAYERS: Player[] = [
  { id: "p1", name: "Player 1", color: "#2563eb", seat: 0 },
  { id: "p2", name: "Player 2", color: "#dc2626", seat: 1 },
];

const wanted = (u: Until | undefined): string[] =>
  !u
    ? []
    : "any" in u
      ? u.any.flatMap(wanted)
      : "all" in u
        ? u.all.flatMap(wanted)
        : "did" in u
          ? [u.did].flat()
          : [];

/** What a move would count as doing (coach.didIds, from the intent). */
const idsOf = (i: Intent): string[] => [
  i.type,
  ...("action" in i && typeof i.action === "string" ? [i.action] : []),
  ...(i.type === "script/start" ? [i.procedure] : []),
];

/** A learner who does what the step asks when the rules allow it, and otherwise plays on at random. */
function studentMove(
  record: GameRecord,
  state: GameState,
  ctx: BotContext,
  seat: number,
  want: string[],
): BotMove | null {
  const mine = new Set(PLAYERS.filter((p) => p.seat === seat).map((p) => p.id));
  const waiting = waitingOn(record, state, ctx);
  if (waiting) {
    const first = waiting.moves.find((m) => legal(record, state, m));
    return first && mine.has(first.as) ? first : null;
  }
  if (state.turn.activeSeat !== seat) return null;
  let fallback: BotMove | null = null;
  let n = 0;
  for (const m of freeMoves(state, ctx)) {
    if (!mine.has(m.as) || !legal(record, state, m)) continue;
    if (!want.length || idsOf(m.intent).some((id) => want.includes(id))) return m;
    fallback ??= m;
    if (++n > 40) break;
  }
  return fallback;
}

/** Play a lesson through: the learner as a student bot, the other side as the lesson's opponent. */
function walk(
  lesson: Lesson,
  seed: number,
): { progress: Progress; moves: number; state: GameState; log: GameRecord } {
  const net = createLoopbackNetwork();
  let clock = 1;
  const host = new Session({
    transport: net.connect("h"),
    role: "host",
    onChange: () => {},
    graceMs: 5,
    rng: seededRng(seed),
    now: () => clock,
  });
  const send = (i: Intent, as: string) => host.dispatch(i, as);
  for (const p of PLAYERS) send({ type: "player/join", player: p }, p.id);
  const system = lessonSystem(lesson)!;
  send({ type: "game/system", system }, "p1");
  send({ type: "layout/set", layout: systemModule(system).layout(host.current.table) }, "p1");
  setUpLesson(lesson, () => host.current, send, "t");
  const you = lesson.you ?? 0;
  const rng = seededRng(seed + 1);
  const bot: BotContext = { rng, kept: new Map(), idle: 0, tidy: true };
  const student: BotContext = { rng, kept: new Map(), idle: 0, tidy: true };
  let progress: Progress = { step: 0, began: [] };
  let moves = 0;
  for (; moves < 3000; moves++) {
    clock++;
    progress = advance(lesson, progress, host.log, host.current);
    const step = lesson.steps[progress.step];
    if (!step) break;
    if (!step.until) {
      progress = advance(lesson, progress, host.log, host.current, true);
      continue;
    }
    const state = host.current;
    const theirs = opponentMove(host.log, state, bot, 1 - you, step.hold, lesson.answers);
    const move = theirs ?? studentMove(host.log, state, student, you, wanted(step.until));
    // A step held for the learner that the student can't do from here: skip it, as the card's Skip does.
    if (!move && step.hold) {
      progress = advance(lesson, progress, host.log, host.current, true);
      continue;
    }
    if (!move) throw new Error(`stuck at step ${progress.step + 1}: "${step.say.slice(0, 60)}"`);
    send(move.intent, move.as);
    if (move.then && legal(host.log, host.current, move.then)) send(move.then.intent, move.then.as);
    noteProgress(theirs ? bot : student, host.current, move);
  }
  host.leave();
  return { progress, moves, state: host.current, log: host.log };
}

describe("lessons", () => {
  const packages = lessonPackages();

  it("every built-in lesson package reads, for a game the app has", () => {
    expect(packages.length).toBe(4);
    for (const p of packages)
      for (const l of p.lessons) {
        expect(lessonSystem(l), l.id).toBeDefined();
        expect(l.steps.length).toBeGreaterThan(3);
        // A phase the game doesn't have would never come round: the step would never finish.
        const slots = new Set(schedule(getSystem(lessonSystem(l)!)).map((s) => s.id));
        const phases = (u: Until | undefined): string[] =>
          !u
            ? []
            : "any" in u
              ? u.any.flatMap(phases)
              : "all" in u
                ? u.all.flatMap(phases)
                : "phase" in u
                  ? [u.phase]
                  : [];
        for (const s of l.steps)
          for (const ph of phases(s.until)) expect(slots, `${l.id}: ${ph}`).toContain(ph);
      }
  });

  it("refuses lessons that aren't plain data or that the coach can't follow", () => {
    const pkg = (lessons: string) =>
      `export const manifest = { id: "x", name: "X", version: "1", api: 1, kind: "lesson", systems: [] };\nexport const lessons = ${lessons};`;
    expect(readLessonPackage(pkg("[]"))).toEqual({ manifest: expect.anything(), lessons: [] });
    expect(readLessonPackage(pkg("make()"))).toHaveProperty("error");
    expect(
      readLessonPackage(
        pkg(
          `[{ id: "a", title: "A", system: "fsd", summary: "s", steps: [{ say: "hi", until: { dance: true } }] }]`,
        ),
      ),
    ).toEqual({ error: "Lesson 1: step 1: until isn't one the coach knows" });
    expect(
      readLessonPackage(
        `export const manifest = { id: "x", name: "X", version: "1", api: 1, kind: "extension", systems: [] };`,
      ),
    ).toEqual({ error: "That isn't a lesson package." });
  });

  it("places the units a lesson names", () => {
    const lesson = packages.flatMap((p) => p.lessons).find((l) => l.place?.length)!;
    const net = createLoopbackNetwork();
    const host = new Session({ transport: net.connect("h"), role: "host", onChange: () => {}, graceMs: 5 });
    for (const p of PLAYERS) host.dispatch({ type: "player/join", player: p }, p.id);
    host.dispatch({ type: "game/system", system: lessonSystem(lesson)! }, "p1");
    setUpLesson(
      lesson,
      () => host.current,
      (i, as) => host.dispatch(i, as),
      "t",
    );
    const s = host.current;
    for (const p of lesson.place!) {
      const ms = seatUnits(s, p.seat)[p.unit]!.modelIds.map((id) => s.models[id]!);
      const cx = ms.reduce((a, m) => a + m.position.x, 0) / ms.length;
      const cy = ms.reduce((a, m) => a + m.position.y, 0) / ms.length;
      expect(cx).toBeCloseTo(p.at.x, 5);
      expect(cy).toBeCloseTo(p.at.y, 5);
    }
    expect(s.turn.round).toBe(1);
    expect(s.turn.activeSeat).toBe(lesson.you ?? 0);
    host.leave();
  });

  for (const lesson of lessonPackages().flatMap((p) => p.lessons))
    it(`${lesson.system} "${lesson.title}" can be finished`, () => {
      for (const seed of [1, 2, 3]) {
        const { progress, moves } = walk(lesson, seed);
        const { state } = walk(lesson, seed);
        expect(
          progress.step,
          `seed ${seed}, ${moves} moves, round ${state.turn.round} seat ${state.turn.activeSeat} ${JSON.stringify(state.turn).slice(0, 300)}`,
        ).toBe(lesson.steps.length);
      }
    }, 120_000);

  it("Break and panic: the slingers break and a friend takes a Panic test, in some games", () => {
    const lesson = packages.flatMap((p) => p.lessons).find((l) => l.id === "break-and-panic")!;
    let panicked = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const notes = walk(lesson, seed).log.events.flatMap(({ event: e }) =>
        (e.type === "script/step" ? [e] : e.type === "procedure/clear" && e.script ? [e.script] : []).flatMap(
          (x) => x.events.flatMap((n) => (n.type === "log/note" ? [n.text] : [])),
        ),
      );
      if (notes.some((n) => /: a Panic test$/.test(n))) panicked++;
    }
    expect(panicked).toBeGreaterThan(1);
  }, 120_000);
});
