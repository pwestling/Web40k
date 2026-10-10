import { mkdtempSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostApi, fileStore } from "./host.mjs";

/** A stand-in for src/hostServer's HostServer: remembers what it was asked. */
function fakeHosts() {
  const open = new Set<string>();
  return {
    asked: [] as unknown[],
    get rooms() {
      return [...open];
    },
    open(req: { room: string; system?: string; teamSize?: number }) {
      this.asked.push(req);
      if (open.has(req.room)) return { ok: true as const, room: req.room, resumed: true };
      open.add(req.room);
      return { ok: true as const, room: req.room };
    },
    wake: (room: string) =>
      open.has(room)
        ? { ok: true as const, room }
        : { ok: false as const, status: 404, error: "no such room" },
    hosts: (room: string) => open.has(room),
  };
}

let close: (() => void) | null = null;
afterEach(() => close?.());

async function serve(hosts = fakeHosts()) {
  const { server } = createHostApi({ hosts, build: "0.1.0+test", maxRooms: 3 });
  await new Promise<void>((r) => server.listen(0, r));
  close = () => server.close();
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { hosts, base };
}

describe("host server HTTP", () => {
  it("opens a room, says it hosts it, and wakes it", async () => {
    const { hosts, base } = await serve();
    const opened = await fetch(`${base}/host/rooms`, {
      method: "POST",
      body: JSON.stringify({ room: "abcd1234", system: "fsd-1.7", teamSize: 2, extra: "x" }),
    });
    expect(opened.status).toBe(200);
    expect(hosts.asked).toEqual([{ room: "abcd1234", system: "fsd-1.7", teamSize: 2 }]);
    expect(await (await fetch(`${base}/host/rooms/abcd1234`)).json()).toEqual({ hosted: true });
    expect(await (await fetch(`${base}/rooms/nope1234`)).json()).toEqual({ hosted: false });
    expect((await fetch(`${base}/rooms/abcd1234/wake`, { method: "POST" })).status).toBe(200);
    expect((await fetch(`${base}/rooms/nope1234/wake`, { method: "POST" })).status).toBe(404);
    expect(await (await fetch(`${base}/info`)).json()).toEqual({
      build: "0.1.0+test",
      rooms: 1,
      maxRooms: 3,
    });
  });

  it("refuses junk and limits new rooms per network", async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/rooms`, { method: "POST", body: "not json" })).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 21; i++)
      last = (await fetch(`${base}/rooms`, { method: "POST", body: JSON.stringify({ room: `room-${i}` }) }))
        .status;
    expect(last).toBe(429);
  });
});

describe("file store", () => {
  it("keeps games by room, and nothing outside its folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "host-"));
    const store = fileStore(dir);
    store.save("abcd1234", { initial: { seq: 0 }, events: [] });
    expect(store.load("abcd1234")).toEqual({ initial: { seq: 0 }, events: [] });
    expect(store.load("../abcd1234")).toBeNull();
    expect(store.list().map((r) => r.room)).toEqual(["abcd1234"]);
    store.remove("abcd1234");
    expect(readdirSync(dir)).toEqual([]);
  });
});
