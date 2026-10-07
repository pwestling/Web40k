import { describe, expect, it } from "vitest";
import type { GameRecord, GameState } from "../core";
import type { CodeProcedure } from "../sdk";
import { currentSlot } from "../core/content/turn";
import { hookProcedures, registerCode, registerHooks, unregisterHooks } from "../core/script";
import "../systems";
import { createLoopbackNetwork } from "./loopback";
import { Session } from "./session";

const notes = (record: GameRecord) =>
  record.events.flatMap((e) =>
    e.event.type === "script/step"
      ? e.event.events.flatMap((x) => (x.type === "log/note" ? [x.text] : []))
      : [],
  );

describe("turn hooks", () => {
  it("run when a round and a phase start, one after another, waiting on questions", () => {
    let record!: GameRecord;
    let state!: GameState;
    const host = new Session({
      transport: createLoopbackNetwork().connect("p1"),
      role: "host",
      onChange: (st, r) => {
        state = st;
        record = r;
      },
    });
    host.dispatch({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } });
    host.dispatch({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } });
    const system = state.system ?? "forty-k-11";
    // Hook every phase the 40k turn might open on.
    const phases = ["command", "movement", "shooting", "charge", "fight", "strategy"];
    const { procedures, table } = hookProcedures("test", {
      roundStart: function* (ctx, args) {
        const pick = yield ctx.ask(String(args.player), "Ready?", [{ id: "yes", label: "Yes" }]);
        yield ctx.note(`round ${String(args.round)} starts (${String(pick)})`);
      },
      phaseStart: Object.fromEntries(
        phases.map((ph) => [
          ph,
          function* (ctx) {
            yield ctx.note(`${ph} starts`);
          } as CodeProcedure,
        ]),
      ),
    });
    registerCode(system, procedures);
    registerHooks(system, "test", table);
    try {
      host.dispatch({ type: "turn/next" }, "p1");
      // The round-start hook asks first; the phase-start hook waits for the answer.
      expect(state.script?.waiting?.question).toBe("Ready?");
      expect(notes(record)).toEqual([]);
      host.dispatch({ type: "script/answer", answer: "yes" }, "p1");
      const first = currentSlot(state)!.id;
      expect(notes(record)).toEqual(["round 1 starts (yes)", `${first} starts`]);
      host.dispatch({ type: "turn/next" }, "p1");
      expect(notes(record).at(-1)).toBe(`${currentSlot(state)!.id} starts`);
    } finally {
      unregisterHooks("test");
    }
  });
});
