import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMailbox, vapidAuth, vapidKeys } from "./mailbox.mjs";

const BOX = "abcdefghijklmnopqrstuvwx";
const file = (index: number, from = "p1", extra = {}) => ({
  format: "open-battle/mail@1",
  game: "g",
  index,
  from,
  ...extra,
});

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

async function start(opts: Parameters<typeof createMailbox>[0] = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "mailbox-"));
  const mb = createMailbox({ dataDir, ...opts });
  await new Promise<void>((done) => mb.server.listen(0, done));
  const base = `http://127.0.0.1:${(mb.server.address() as AddressInfo).port}/mailbox`;
  stop = async () => {
    mb.server.close();
    await rm(dataDir, { recursive: true, force: true });
  };
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) }).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    }));
  const get = (path: string) =>
    fetch(`${base}${path}`).then((r) => r.json() as Promise<Record<string, unknown>>);
  return { post, get, sweep: mb.sweep };
}

describe("play-by-mail mailbox", () => {
  it("keeps each turn once, in order, and hands over what's new", async () => {
    const { post, get } = await start();
    expect((await post(`/box/${BOX}`, file(1))).body).toEqual({ ok: true, index: 1 });
    expect((await post(`/box/${BOX}`, file(2, "p2"))).status).toBe(200);
    // The same file again is fine; a different file with a number already used isn't.
    expect((await post(`/box/${BOX}`, file(2, "p2"))).status).toBe(200);
    expect((await post(`/box/${BOX}`, file(2, "p2", { x: 1 }))).status).toBe(409);
    expect((await get(`/box/${BOX}?after=1`)).files).toEqual([file(2, "p2")]);
    expect((await get(`/box/${BOX}`)).files).toHaveLength(2);
    expect((await post(`/box/${BOX}`, { format: "nope", index: 3 })).status).toBe(400);
    expect((await post(`/box/short`, file(1))).status).toBe(404);
  });

  it("tells only the other player's devices, with a signed empty push", async () => {
    const keys = vapidKeys();
    const pushed: string[] = [];
    const { post, get } = await start({
      vapid: keys,
      push: async (s) => {
        pushed.push(s.endpoint);
        return s.endpoint.includes("gone") ? 410 : 201;
      },
    });
    expect((await get("/vapid")).publicKey).toBe(keys.publicKey);
    const sub = (player: string, endpoint: string) =>
      post(`/box/${BOX}/push`, { player, subscription: { endpoint } });
    expect((await sub("p1", "https://push.example/ana")).status).toBe(200);
    expect((await sub("p2", "https://push.example/bo")).status).toBe(200);
    expect((await sub("p2", "https://push.example/gone")).status).toBe(200);
    expect((await sub("p2", "http://insecure.example/x")).status).toBe(400);
    await post(`/box/${BOX}`, file(1, "p1"));
    expect(pushed).toEqual(["https://push.example/bo", "https://push.example/gone"]);
    // A subscription the push service dropped is forgotten.
    pushed.length = 0;
    await post(`/box/${BOX}`, file(2, "p1"));
    expect(pushed).toEqual(["https://push.example/bo"]);

    // The token verifies with the public key, for the endpoint's origin.
    const auth = vapidAuth("https://push.example/bo", keys, "mailto:a@b.c");
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token!.split(".");
    const point = Buffer.from(keys.publicKey, "base64url");
    const pub = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33).toString("base64url"),
      },
      format: "jwk",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${c}`),
        { key: pub, dsaEncoding: "ieee-p1363" },
        Buffer.from(s!, "base64url"),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(c!, "base64url").toString()).aud).toBe("https://push.example");
  });

  it("forgets a mailbox nobody has touched for a while", async () => {
    const { post, get, sweep } = await start({ ttlDays: 1 });
    await post(`/box/${BOX}`, file(1));
    expect(await sweep(Date.now())).toBe(0);
    expect(await sweep(Date.now() + 2 * 86400_000)).toBe(1);
    expect((await get(`/box/${BOX}`)).files).toEqual([]);
  });
});
