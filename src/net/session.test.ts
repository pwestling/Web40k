import { describe, expect, it, vi } from "vitest";
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

  it("holds a watcher's events back on the host, so its copy never runs ahead of the delay", async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000_000;
      const net = createLoopbackNetwork();
      const h = peer();
      const s = peer();
      const c = peer();
      const host = new Session({
        transport: net.connect("host"),
        role: "host",
        onChange: h.onChange,
        now: () => now,
      });
      host.setSpectatorFloor(30_000);
      const roll = () => host.dispatch({ type: "dice/roll", count: 1, sides: 6 });
      roll();
      now += 40_000;
      roll();
      new Session({ transport: net.connect("client"), role: "client", onChange: c.onChange });
      new Session({ transport: net.connect("spec"), role: "spectator", onChange: s.onChange });
      await vi.advanceTimersByTimeAsync(10);
      // The first roll is old enough; the second, 0 s old, isn't sent yet.
      expect(s.seen.record?.events.map((e) => e.seq)).toEqual([1]);
      expect(c.seen.record?.events.map((e) => e.seq)).toEqual([1, 2]);
      roll();
      await vi.advanceTimersByTimeAsync(300);
      expect(s.seen.record?.events.map((e) => e.seq)).toEqual([1]);
      now += 31_000;
      await vi.advanceTimersByTimeAsync(300);
      expect(s.seen.record?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(c.seen.record?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes side-channel messages between any peers, outside the log", async () => {
    const net = createLoopbackNetwork();
    const host = new Session({ transport: net.connect("host"), role: "host", onChange: () => {} });
    const client = new Session({ transport: net.connect("client"), role: "client", onChange: () => {} });
    const got: string[] = [];
    host.listenSide((m, from) => got.push(`${m.t} ${from}`));
    await flush();
    client.sendSide({ t: "asset/want", id: "abc" });
    await flush();
    expect(got).toEqual(["asset/want client"]);
    expect(host.log.events).toHaveLength(0);
  });

  it("dresses only the named profiles with a figure and lifts its bands onto the base", () => {
    const host = new Session({
      transport: createLoopbackNetwork().connect("host"),
      role: "host",
      onChange: () => {},
    });
    const base = { shape: "round", diameterMm: 32 } as const;
    const model = (id: string, name: string) => ({
      id,
      owner: "host",
      label: name,
      position: { x: 0, y: 0 },
      facing: 0,
      base,
      unitId: "u",
      profile: { name, chars: {} },
    });
    host.dispatch({
      type: "unit/add",
      unit: { id: "u", owner: "host", name: "Squad", modelIds: ["a", "b"], formation: { kind: "skirmish" } },
      models: [model("a", "Sergeant"), model("b", "Trooper")],
    });
    const figure = { asset: "f", name: "trooper.stl", yaw: 0, scale: 2 };
    host.dispatch({
      type: "unit/figure",
      id: "u",
      keys: ["Trooper"],
      figure,
      bands: [{ r: 0.3, z0: 0, z1: 1 }],
    });
    expect(host.current.models.a!.figure).toBeUndefined();
    expect(host.current.models.b!.figure).toEqual(figure);
    expect(host.current.models.b!.bands).toEqual([
      { r: 0.63, z0: 0, z1: 0.2 },
      { r: 0.6, z0: 0.2, z1: 2.2 },
    ]);
    host.dispatch({ type: "unit/figure", id: "u", keys: ["Trooper"], figure: null });
    expect(host.current.models.b!.figure).toBeUndefined();
    expect(host.current.models.b!.bands).toBeUndefined();
  });
});

describe("builds (docs/compatibility.md)", () => {
  it("tells each side when the other runs another build", async () => {
    const net = createLoopbackNetwork();
    const host = new Session({ transport: net.connect("host"), role: "host", onChange: () => {} });
    // An old client (no build info) and a client from another build, sending by hand.
    const old = net.connect("old");
    const other = net.connect("other");
    await flush();
    expect(host.status.otherBuilds).toEqual([]);
    old.send({ t: "hello", seq: 0, role: "client" }, "host");
    other.send({ t: "hello", seq: 0, role: "client", v: { protocol: 1, build: "9.9.9+fork" } }, "host");
    await flush();
    expect(host.status.otherBuilds).toEqual([{ peer: "other", protocol: 1, build: "9.9.9+fork" }]);
    // The same build is no news.
    const same = new Session({ transport: net.connect("same"), role: "client", onChange: () => {} });
    await flush();
    expect(host.status.otherBuilds.map((b) => b.peer)).toEqual(["other"]);
    expect(same.status.otherBuilds).toEqual([]);
  });

  it("parks a peer on another protocol: no log for it, no intents from it", async () => {
    const net = createLoopbackNetwork();
    const host = new Session({ transport: net.connect("host"), role: "host", onChange: () => {} });
    const got: unknown[] = [];
    const future = net.connect("future");
    future.onMessage((m) => got.push(m));
    await flush();
    future.send({ t: "hello", seq: 0, role: "client", v: { protocol: 99, build: "9.0.0+x" } }, "host");
    await flush();
    const before = host.log.events.length;
    future.send(
      {
        t: "intent",
        intent: { type: "player/join", player: { id: "future", name: "F", color: "#000", seat: 0 } },
      },
      "host",
    );
    host.dispatch({
      type: "model/add",
      model: {
        id: "m1",
        owner: "host",
        label: "T",
        position: { x: 0, y: 0 },
        facing: 0,
        base: { shape: "round", diameterMm: 32 },
      },
    });
    await flush();
    expect(host.status.otherBuilds).toEqual([{ peer: "future", protocol: 99, build: "9.0.0+x" }]);
    expect(host.log.events.some((e) => e.by === "future")).toBe(false);
    expect(got.filter((m) => (m as { t: string }).t !== "host")).toEqual([]);
    expect(host.log.events.length).toBe(before + 1);
  });
});
