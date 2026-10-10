import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSeeder } from "./seeder.mjs";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = (s: string) => new TextEncoder().encode(s);

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

async function start(opts: Parameters<typeof createSeeder>[0] = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "seeder-"));
  const node = createSeeder({ dataDir, ...opts });
  await new Promise<void>((done) => node.server.listen(0, done));
  const base = `http://127.0.0.1:${(node.server.address() as AddressInfo).port}/seed`;
  stop = async () => {
    node.server.close();
    await rm(dataDir, { recursive: true, force: true });
  };
  const put = (b: Uint8Array, hash = sha(b)) =>
    fetch(`${base}/blob/${hash}`, { method: "PUT", body: Buffer.from(b) });
  return { base, put, sweep: node.sweep };
}

describe("seed node", () => {
  it("keeps a file under its hash and serves it, whole or by range", async () => {
    const { base, put } = await start();
    const file = bytes("opaque bytes of a figure pack");
    expect((await put(file)).status).toBe(201);
    expect((await put(file)).status).toBe(200);
    const whole = await fetch(`${base}/blob/${sha(file)}`);
    expect(whole.headers.get("access-control-allow-origin")).toBe("*");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(file);
    const part = await fetch(`${base}/blob/${sha(file)}`, { headers: { range: "bytes=7-11" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("bytes");
    expect(part.headers.get("content-range")).toBe(`bytes 7-11/${file.length}`);
  });

  it("turns away bytes that don't match their name, and files too big", async () => {
    const { put } = await start({ maxFileBytes: 10 });
    expect((await put(bytes("short"), sha(bytes("other")))).status).toBe(400);
    expect((await put(bytes("much too long for this node"))).status).toBe(413);
  });

  it("takes a file down only with the admin token, and keeps it down", async () => {
    const { base, put } = await start({ adminToken: "secret", contact: "mailto:abuse@example.com" });
    const file = bytes("something to take down");
    await put(file);
    const url = `${base}/blob/${sha(file)}`;
    expect((await fetch(url, { method: "DELETE" })).status).toBe(403);
    expect((await fetch(url, { method: "DELETE", headers: { authorization: "Bearer secret" } })).status).toBe(
      200,
    );
    expect((await fetch(url)).status).toBe(404);
    expect((await put(file)).status).toBe(451);
    expect(await (await fetch(`${base}/info`)).json()).toMatchObject({ contact: "mailto:abuse@example.com" });
  });

  it("forgets the least recently fetched files when it is full", async () => {
    const { base, put } = await start({ maxTotalBytes: 25 });
    const a = bytes("first file, ten");
    const b = bytes("second file!!!!");
    await put(a);
    await new Promise((r) => setTimeout(r, 20));
    await put(b);
    expect((await fetch(`${base}/blob/${sha(a)}`)).status).toBe(404);
    expect((await fetch(`${base}/blob/${sha(b)}`)).status).toBe(200);
  });
});
