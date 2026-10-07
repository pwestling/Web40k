import { describe, expect, it } from "vitest";
import type { GameRecord, GameState } from "../core";
import { createLoopbackNetwork } from "./loopback";
import { Session } from "./session";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function peer() {
  const seen: { state?: GameState; record?: GameRecord } = {};
  return { seen, onChange: (state: GameState, record: GameRecord) => Object.assign(seen, { state, record }) };
}

describe("Session", () => {
  it("keeps host, client and spectator on the same log, with the host rolling dice", async () => {
    const net = createLoopbackNetwork();
    const h = peer();
    const c = peer();
    const s = peer();

    const host = new Session({
      transport: net.connect("host"),
      role: "host",
      onChange: h.onChange,
      rng: () => 0.99,
    });
    host.dispatch({
      type: "model/add",
      model: {
        id: "m1",
        owner: "host",
        label: "Trooper",
        position: { x: 0, y: 0 },
        facing: 0,
        base: { shape: "round", diameterMm: 32 },
      },
    });

    const client = new Session({ transport: net.connect("client"), role: "client", onChange: c.onChange });
    const spectator = new Session({
      transport: net.connect("spec"),
      role: "spectator",
      onChange: s.onChange,
    });
    await flush();

    // Late joiners received the existing history.
    expect(c.seen.state?.models.m1).toBeDefined();

    client.dispatch({ type: "model/move", id: "m1", to: { x: 5, y: 2 } });
    client.dispatch({ type: "dice/roll", count: 2, sides: 6 });
    spectator.dispatch({ type: "dice/roll", count: 1, sides: 6 }); // ignored
    client.dispatch({ type: "undo", seq: 2 });

    expect(c.seen.record).toEqual(h.seen.record);
    expect(s.seen.record).toEqual(h.seen.record);
    expect(h.seen.record?.events.map((e) => [e.seq, e.by, e.event.type])).toEqual([
      [1, "host", "model/add"],
      [2, "client", "model/move"],
      [3, "client", "dice/roll"],
      [4, "client", "undo"],
    ]);
    expect(c.seen.state?.models.m1?.position).toEqual({ x: 0, y: 0 });
  });
});
