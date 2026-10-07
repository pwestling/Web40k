import { describe, expect, it } from "vitest";
import { canonical, cyrb53, stateHash, stateAt, type GameState } from "../core";
import { createLoopbackNetwork } from "./loopback";
import { Session, type NetStatus } from "./session";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("state checksum", () => {
  it("hashes a canonical form: key order and float noise don't matter", () => {
    expect(canonical({ b: 1, a: [0.1 + 0.2, undefined] })).toBe(canonical({ a: [0.3, null], b: 1 }));
    expect(canonical({ x: -0 })).toBe(canonical({ x: 0 }));
    expect(cyrb53("a")).not.toBe(cyrb53("b"));
    const s = stateAt({ events: [] } as never);
    expect(stateHash(s)).toBe(stateHash(structuredClone(s)));
  });

  it("flags the first checkpoint where a peer's table differs, and resyncs it with a log line", async () => {
    const net = createLoopbackNetwork();
    let status: NetStatus | undefined;
    const host = new Session({ transport: net.connect("h"), role: "host", onChange: () => {}, graceMs: 10 });
    const client = new Session({
      transport: net.connect("c"),
      role: "client",
      onChange: () => {},
      graceMs: 10,
      onNet: (s) => (status = s),
    });
    await sleep(30);
    host.dispatch({ type: "player/join", player: { id: "h", name: "Ann", color: "#00f", seat: 0 } });
    client.dispatch({ type: "player/join", player: { id: "c", name: "Bo", color: "#f00", seat: 1 } });
    for (let i = 0; i < 12; i++) host.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    await sleep(30);
    expect(status?.desync ?? null).toBeNull();
    expect(client.checksumAt(10)).toBe(host.checksumAt(10));

    // Something drifts on the client only (a bug, or different code).
    const drifted: GameState = { ...client.current, table: { ...client.current.table, width: 61 } };
    (client as unknown as { state: GameState }).state = drifted;
    for (let i = 0; i < 10; i++) host.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    await sleep(30);
    expect(status?.desync).toMatchObject({ seq: 20, count: 1 });

    client.resync();
    await sleep(30);
    expect(status?.desync).toBeNull();
    expect(JSON.stringify(client.log)).toBe(JSON.stringify(host.log));
    expect(client.log.events.at(-1)?.event).toEqual({ type: "player/resync", player: "c" });
    expect(client.current.table.width).toBe(host.current.table.width);
  });
});
