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
