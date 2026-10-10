import { describe, expect, it } from "vitest";
import { lastSeq, type GameRecord } from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import { HostServer, type RoomStore } from "./rooms";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function memoryStore(): RoomStore & { saved: Map<string, { record: GameRecord; savedAt: number }> } {
  const saved = new Map<string, { record: GameRecord; savedAt: number }>();
  return {
    saved,
    load: (room) => (saved.has(room) ? structuredClone(saved.get(room)!.record) : null),
    save: (room, record) => void saved.set(room, { record: structuredClone(record), savedAt: Date.now() }),
    remove: (room) => void saved.delete(room),
    list: () => [...saved].map(([room, s]) => ({ room, savedAt: s.savedAt })),
  };
}

type Net = ReturnType<typeof createLoopbackNetwork>;

/** A room per loopback network, as each room is its own Trystero room. */
function rooms() {
  const nets = new Map<string, Net>();
  const net = (room: string) => {
    if (!nets.has(room)) nets.set(room, createLoopbackNetwork());
    return nets.get(room)!;
  };
  let n = 0;
  return { net, transport: (room: string) => net(room).connect(`server${++n}`) };
}

function player(net: Net, id: string, record?: GameRecord, ready = true) {
  return new Session({
    transport: net.connect(id),
    role: "client",
    onChange: () => {},
    graceMs: 10,
    ...(record ? { record } : {}),
    ready: () => ready,
  });
}

describe("host server", () => {
  it("hosts a game two players join and play, without a seat of its own", async () => {
    const { net, transport } = rooms();
    const server = new HostServer({ transport, saveMs: 5 });
    expect(server.open({ room: "abcd1234", system: "fsd-1.7" })).toEqual({ ok: true, room: "abcd1234" });
    const host = server.session("abcd1234")!;
    expect(host.current.system).toBe("fsd-1.7");
    expect(host.current.table).toBeTruthy();

    const ann = player(net("abcd1234"), "ann");
    const bo = player(net("abcd1234"), "bo");
    await sleep(10);
    ann.dispatch({ type: "player/join", player: { id: "ann", name: "Ann", color: "#00f", seat: 0 } });
    bo.dispatch({ type: "player/join", player: { id: "bo", name: "Bo", color: "#f00", seat: 1 } });
    bo.dispatch({ type: "dice/roll", count: 3, sides: 6 });
    await sleep(10);

    expect(Object.keys(host.current.players).sort()).toEqual(["ann", "bo"]);
    expect(ann.status.hostId).toBe(host.selfId);
    expect(JSON.stringify(ann.log)).toBe(JSON.stringify(host.log));
    expect(JSON.stringify(bo.log)).toBe(JSON.stringify(host.log));
    const roll = host.log.events.at(-1)!;
    expect(roll.by).toBe("bo");
    expect(roll.event.type === "dice/roll" && roll.event.roll.results).toHaveLength(3);
    server.stop();
  });

  it("keeps a game through a restart, and a player coming back finds it", async () => {
    const { net, transport } = rooms();
    const store = memoryStore();
    const first = new HostServer({ transport, store, saveMs: 5 });
    first.open({ room: "kept-room" });
    const ann = player(net("kept-room"), "ann");
    await sleep(5);
    ann.dispatch({ type: "player/join", player: { id: "ann", name: "Ann", color: "#00f", seat: 0 } });
    ann.dispatch({ type: "dice/roll", count: 2, sides: 6 });
    await sleep(20);
    const seq = lastSeq(first.session("kept-room")!.log);
    expect(lastSeq(store.saved.get("kept-room")!.record)).toBe(seq);
    first.stop();
    ann.leave();

    const second = new HostServer({ transport, store });
    expect(second.rooms).toEqual([]);
    expect(second.hosts("kept-room")).toBe(true);
    // Opening it again (an old link) wakes it rather than starting over.
    expect(second.open({ room: "kept-room" })).toEqual({ ok: true, room: "kept-room", resumed: true });
    const back = player(net("kept-room"), "ann2", ann.log);
    await sleep(10);
    expect(back.status.hostId).toBe(second.session("kept-room")!.selfId);
    back.dispatch({ type: "dice/roll", count: 1, sides: 6 });
    await sleep(5);
    expect(lastSeq(back.log)).toBe(seq + 1);
    second.stop();
  });

  it("leaves a room nobody is in, and comes back when asked", async () => {
    let now = 0;
    const { transport } = rooms();
    const store = memoryStore();
    const server = new HostServer({ transport, store, idleMs: 1000, keepMs: 10_000, now: () => now });
    server.open({ room: "quiet-room" });
    now = 500;
    server.sweep();
    expect(server.rooms).toEqual(["quiet-room"]);
    now = 2000;
    server.sweep();
    expect(server.rooms).toEqual([]);
    expect(store.saved.has("quiet-room")).toBe(true);
    expect(server.wake("quiet-room")).toMatchObject({ ok: true, resumed: true });
    server.stop();
    // Untouched for longer than it keeps games: forgotten.
    store.saved.get("quiet-room")!.savedAt = -20_000;
    now = 20_000;
    server.sweep();
    expect(server.hosts("quiet-room")).toBe(false);
    expect(server.wake("quiet-room")).toMatchObject({ ok: false, status: 404 });
  });

  it("hands a game that turns on a rules package to the players", async () => {
    const { net, transport } = rooms();
    const store = memoryStore();
    const server = new HostServer({ transport, store, handOffMs: 5, saveMs: 1 });
    server.open({ room: "pkg-room" });
    const ann = player(net("pkg-room"), "ann");
    const bo = player(net("pkg-room"), "bo", undefined, false);
    await sleep(5);
    ann.dispatch({
      type: "game/packages",
      app: "test",
      system: { id: "forty-k-11", builtIn: true },
      packages: [{ id: "house", name: "House", version: "1.0.0", hash: "ab".repeat(32), bytes: 10 }],
    });
    await sleep(60);
    expect(server.rooms).toEqual([]);
    expect(store.saved.has("pkg-room")).toBe(false);
    // The player holding the package hosts it now; the server won't take the room back.
    expect(ann.status.role).toBe("host");
    expect(bo.status.hostId).toBe("ann");
    expect(ann.current.packages?.packages).toHaveLength(1);
    expect(server.open({ room: "pkg-room" })).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses bad room codes, games it can't run and more rooms than it holds", () => {
    const { transport } = rooms();
    const server = new HostServer({ transport, maxRooms: 1 });
    expect(server.open({ room: "../etc" })).toMatchObject({ ok: false, status: 400 });
    expect(server.open({ room: "room-one", system: "someone-elses-game" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(server.open({ room: "room-one" }).ok).toBe(true);
    expect(server.open({ room: "room-two" })).toMatchObject({ ok: false, status: 503 });
    server.stop();
  });
});
