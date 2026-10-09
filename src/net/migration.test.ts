import { describe, expect, it } from "vitest";
import { type GameRecord, type Intent } from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { fsdLayout } from "../systems/fsd/layout";
import { fsdSample } from "../systems/fsd/sample";
import { createLoopbackNetwork } from "./loopback";
import { Session, type NetStatus, type Role } from "./session";
import type { NetMessage, Transport } from "./transport";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const GRACE = 10;
const settle = () => sleep(GRACE * 4);

/** A transport that remembers the kinds of message it received. */
function spied(t: Transport, got: string[]): Transport {
  return {
    ...t,
    selfId: t.selfId,
    onMessage: (h) => t.onMessage((m: NetMessage, from) => (got.push(m.t), h(m, from))),
  };
}

type Net = ReturnType<typeof createLoopbackNetwork>;

function join(net: Net, id: string, role: Role, record?: GameRecord, resumed = false, ready = true) {
  const got: string[] = [];
  const net$: { status?: NetStatus } = {};
  const session = new Session({
    transport: spied(net.connect(id), got),
    role,
    onChange: () => {},
    graceMs: GRACE,
    onNet: (s) => (net$.status = s),
    ...(record ? { record } : {}),
    resumed,
    ready: () => ready,
  });
  return { session, got, net: net$ };
}

const bytes = (r: GameRecord) => JSON.stringify(r);

describe("reconnect and host migration", () => {
  it("sends a returning client only the events it missed, and it takes its seat back", async () => {
    const net = createLoopbackNetwork();
    const host = join(net, "h", "host").session;
    host.dispatch({ type: "player/join", player: { id: "h", name: "Ann", color: "#00f", seat: 0 } });
    const first = join(net, "c", "client");
    await settle();
    first.session.dispatch({ type: "player/join", player: { id: "c", name: "Bo", color: "#f00", seat: 1 } });
    first.session.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    const saved = first.session.log;
    first.session.leave();
    host.dispatch({ type: "dice/roll", count: 2, sides: 6 });
    host.dispatch({ type: "dice/roll", count: 3, sides: 6 });

    // The tab comes back with a new peer id and the log it saved.
    const back = join(net, "c2", "client", saved);
    await settle();
    expect(back.got).toContain("events");
    expect(back.got).not.toContain("record");
    expect(bytes(back.session.log)).toBe(bytes(host.log));
    back.session.dispatch({ type: "player/claim", player: "c" });
    expect(host.current.players.c2?.name).toBe("Bo");
    expect(host.current.players.c).toBeUndefined();
  });

  it("hands the host role over mid-attack and finishes the game with matching replays", async () => {
    const net = createLoopbackNetwork();
    const p1 = join(net, "p1", "host");
    const p2 = join(net, "p2", "client");
    const spec = join(net, "spec", "spectator");
    await settle();
    const as1 = (i: Intent) => p1.session.dispatch(i);
    const as2 = (i: Intent) => p2.session.dispatch(i);
    as1({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } });
    as2({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } });
    as1({ type: "game/system", system: "fsd-1.7" });
    as1({ type: "layout/set", layout: { ...fsdLayout(), terrain: [] } });
    for (const i of spawnIntents(p1.session.current, "p1", fsdSample(0).units, "p1", "a")) as1(i);
    for (const i of spawnIntents(p1.session.current, "p2", fsdSample(1).units, "p2", "b")) as2(i);
    const s = p1.session.current;
    const tank = Object.values(s.units).find((u) => u.name === "Lancer Tank")!;
    const gang = Object.values(s.units).find((u) => u.name === "Raider Gang")!;
    const row = (id: string, x: number, y: number) => ({
      type: "models/move" as const,
      moves: s.units[id]!.modelIds.map((m, i) => ({ id: m, to: { x: x + i * 1.5, y } })),
    });
    as1(row(tank.id, 0, 4));
    as2(row(gang.id, -1.5, -2));
    as1({ type: "turn/next" }); // rolls the dice, to pre-assigning
    // Whoever wins the Initiative hands it to the tank's side.
    if (p1.session.current.turn.activeSeat !== 0) as2({ type: "turn/first", seat: 0 });
    as1({ type: "turn/next" });
    as1({ type: "action/take", unitId: tank.id, action: "activate" });
    as1({ type: "action/take", unitId: tank.id, action: "fire", weapon: "coax-mg", targetId: gang.id });
    // The gang's reaction window is open: the host's tab dies.
    expect(p1.session.current.pending).toBeTruthy();
    const p1Saved = p1.session.log;
    p1.session.leave();
    as2({ type: "reaction/pass" }); // held until there is a host again
    await settle();

    expect(p2.net.status).toMatchObject({ role: "host", hostId: "p2", migrating: false });
    expect(spec.net.status?.hostId).toBe("p2");
    expect(p2.session.current.pending).toBeNull();
    expect(p2.session.current.procedure).toBeTruthy();

    // Player A comes back from its saved log: the room keeps its new host, A rejoins as a client.
    const a = join(net, "p1b", "host", p1Saved, true);
    await settle();
    expect(a.net.status).toMatchObject({ role: "client", hostId: "p2" });
    a.session.dispatch({ type: "player/claim", player: "p1" });
    // Now the second host goes, in the middle of the attack (rolling first could end it at once:
    // with no hits there is nothing more to roll).
    expect(p2.session.current.procedure?.run.done).toBe(false);
    p2.session.leave();
    await settle();
    expect(a.net.status).toMatchObject({ role: "host", hostId: "p1b" });
    expect(spec.net.status?.hostId).toBe("p1b");
    while (!a.session.current.procedure!.run.done) a.session.dispatch({ type: "procedure/roll" });
    a.session.dispatch({ type: "procedure/clear" });
    a.session.dispatch({ type: "turn/endActivation" });
    expect(a.session.current.turn.activeSeat).toBe(1);

    // The spectator saw exactly the same game.
    expect(bytes(spec.session.log)).toBe(bytes(a.session.log));
    const hosts = [...new Set(a.session.log.events.map((e) => e.host))];
    expect(hosts).toEqual(["p1", "p2", "p1b"]);
  });

  it("picks one new host among equal players: the lowest peer id", async () => {
    const net = createLoopbackNetwork();
    const h = join(net, "h", "host");
    const b = join(net, "b", "client");
    const a = join(net, "a", "client");
    await settle();
    h.session.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    h.session.leave();
    await settle();
    expect(a.net.status?.role).toBe("host");
    expect(b.net.status).toMatchObject({ role: "client", hostId: "a" });
    b.session.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    expect(bytes(a.session.log)).toBe(bytes(b.session.log));
  });

  it("never hands the room to a peer missing the game's rules packages", async () => {
    const net = createLoopbackNetwork();
    const h = join(net, "h", "host");
    const b = join(net, "b", "client");
    const a = join(net, "a", "client", undefined, false, false);
    await settle();
    h.session.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    h.session.leave();
    await settle();
    // "a" has the lower id but lacks a package, so "b" takes over.
    expect(b.net.status?.role).toBe("host");
    expect(a.net.status).toMatchObject({ role: "client", hostId: "b" });
  });

  it("lets a returning host take the room back when its log is at least as long", async () => {
    const net = createLoopbackNetwork();
    const h = join(net, "h", "host");
    const c = join(net, "c", "client");
    await settle();
    h.session.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    const saved = h.session.log;
    h.session.leave();
    await settle();
    expect(c.net.status?.role).toBe("host");
    const back = join(net, "h2", "host", saved, true);
    await settle();
    expect(back.net.status?.role).toBe("host");
    expect(c.net.status).toMatchObject({ role: "client", hostId: "h2" });
    c.session.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    expect(bytes(back.session.log)).toBe(bytes(c.session.log));
  });
});
