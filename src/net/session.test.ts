import { describe, expect, it } from "vitest";
import type { GameState } from "../core";
import { createLoopbackNetwork } from "./loopback";
import { Session } from "./session";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Session", () => {
  it("keeps host and client in sync, with the host rolling dice", async () => {
    const net = createLoopbackNetwork();
    let hostState: GameState | undefined;
    let clientState: GameState | undefined;

    const host = new Session({
      transport: net.connect("host"),
      role: "host",
      onState: (s) => (hostState = s),
      rng: () => 0.99,
    });
    host.dispatch({
      type: "model/add",
      model: {
        id: "m1",
        owner: "host",
        label: "Intercessor",
        position: { x: 0, y: 0 },
        facing: 0,
        baseMm: 32,
      },
    });

    const client = new Session({
      transport: net.connect("client"),
      role: "client",
      onState: (s) => (clientState = s),
    });
    await flush();

    // The late joiner received the host's existing model via snapshot.
    expect(clientState?.models.m1).toBeDefined();

    client.dispatch({ type: "model/move", id: "m1", to: { x: 5, y: 2 } });
    client.dispatch({ type: "dice/roll", count: 2, sides: 6 });

    expect(clientState).toEqual(hostState);
    expect(clientState?.models.m1?.position).toEqual({ x: 5, y: 2 });
    expect(clientState?.log.at(-1)).toMatchObject({ kind: "roll", roll: { by: "client", results: [6, 6] } });
  });
});
