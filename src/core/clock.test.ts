import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  createRecord,
  resolveIntent,
  type Intent,
  type PlayerId,
} from "./index";
import { clocks, clockText, timeCall, timeCallOf, timeLeft } from "./clock";

function game() {
  const record = createRecord(createInitialState());
  let state = record.initial;
  let at = 0;
  const play = (intent: Intent, from: PlayerId, after: number) => {
    at += after;
    const event = resolveIntent(intent, from, () => 0.5, state);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    const seq = state.seq + 1;
    state = { ...applyEvent(state, event), seq };
    record.events.push({ seq, by: from, at, event });
  };
  return {
    record,
    play,
    get state() {
      return state;
    },
  };
}

const MIN = 60_000;

describe("chess clocks", () => {
  it("charge the side that has to act, stop while paused, and take adjustments", () => {
    const g = game();
    g.play({ type: "player/join", player: { id: "a", name: "Ana", color: "#3b82f6", seat: 0 } }, "a", 1000);
    g.play({ type: "player/join", player: { id: "b", name: "Bo", color: "#f97316", seat: 1 } }, "b", 1000);
    g.play({ type: "settings/set", settings: { clock: { minutes: 90, gameMinutes: 180 } } }, "a", 1000);
    // Deployment is untimed.
    g.play({ type: "resource/adjust", player: "a", resource: "CP", delta: 1 }, "a", 30 * MIN);
    g.play({ type: "turn/next" }, "a", 1000); // round 1, Ana's turn
    expect(clocks(g.record).running).toBe(0);
    const phases = g.state.turn.phase;
    // Ana takes 2 minutes a phase, then Bo's turn starts.
    let steps = 0;
    while (g.state.turn.activeSeat === 0) {
      g.play({ type: "turn/next" }, "a", 2 * MIN);
      steps++;
    }
    expect(phases).toBe(0);
    const c1 = clocks(g.record);
    expect(c1.running).toBe(1);
    expect(c1.used[0]).toBe(steps * 2 * MIN);
    expect(c1.used[1] ?? 0).toBe(0);
    // Bo thinks for 5 minutes, then the clocks stop for 20 (not counted), then 1 more minute.
    g.play({ type: "clock/pause", paused: true }, "a", 5 * MIN);
    g.play({ type: "clock/pause", paused: false }, "a", 20 * MIN);
    g.play({ type: "clock/adjust", seat: 1, ms: 2 * MIN }, "a", MIN);
    const c2 = clocks(g.record);
    expect(c2.used[1]).toBe(6 * MIN);
    expect(timeLeft(c2, { minutes: 90 }, 1, c2.at)).toBe(90 * MIN + 2 * MIN - 6 * MIN);
    // Ticking on from the last event, live.
    expect(timeLeft(c2, { minutes: 90 }, 1, c2.at + MIN)).toBe(85 * MIN);
    expect(clockText(-12_000)).toBe("−0:12");
    expect(clockText(83 * MIN + 5000)).toBe("1:23:05");
  });

  it("calls the last turn when there's no time for another round at this pace", () => {
    const g = game();
    g.play({ type: "player/join", player: { id: "a", name: "Ana", color: "#3b82f6", seat: 0 } }, "a", 0);
    g.play({ type: "player/join", player: { id: "b", name: "Bo", color: "#f97316", seat: 1 } }, "b", 0);
    g.play({ type: "turn/next" }, "a", 0);
    // Each battle round takes an hour.
    const round = () => {
      const r = g.state.turn.round;
      let n = 0;
      while (g.state.turn.round === r) {
        g.play({ type: "turn/next" }, g.state.turn.activeSeat === 0 ? "a" : "b", 0);
        n++;
      }
      g.record.events.at(-1)!.at += 60 * MIN;
      return n;
    };
    round();
    const settings = { minutes: 90, gameMinutes: 200 };
    const c = clocks(g.record);
    expect(c.roundsDone).toBe(1);
    // 140 minutes left: this round (an hour at this pace) and another fit.
    expect(timeCall(c, settings, c.at)).toBeNull();
    expect(timeCall(c, settings, c.at + 70 * MIN)).toBeNull();
    // 50 minutes left: not enough for another round after this one.
    expect(timeCall(c, settings, c.at + 90 * MIN)).toMatch(/Last turn/);
    expect(timeCall(c, settings, c.at + 141 * MIN)).toMatch(/Time's up/);
    // Written into the log once: the clocks then know it was called (UX 218).
    const call = timeCallOf(c, settings, c.at + 90 * MIN)!;
    expect(call.kind).toBe("last-turn");
    g.play({ type: "clock/call", kind: call.kind, text: call.text }, "a", 90 * MIN);
    expect(clocks(g.record).called).toEqual(["last-turn"]);
    expect(() => g.play({ type: "clock/call", kind: "Bad Kind!", text: "x" }, "a", 0)).toThrow();
  });
});
