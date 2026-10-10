import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createBoard, signaturesHold } from "./board.mjs";

const ALIVE_MS = 3 * 60_000;
const hour = 3600_000;
const post = (over: Record<string, unknown> = {}) => ({
  id: "a1b2c3d4e5f60718",
  name: "Porter",
  system: "forty-k-11",
  game: "Warhammer 40,000",
  kind: "live",
  seats: 1,
  join: "abcd1234",
  expires: Date.now() + 2 * hour,
  ...over,
});

describe("the self-hosted Open tables board (#50)", () => {
  it("keeps posts on a self-hosted board, changed only by their poster", async () => {
    let now = Date.now();
    const board = createBoard({ now: () => now });
    const call = async (method: string, path: string, body?: unknown, from = "1.1.1.1") => {
      let status = 0;
      let out = "";
      const req = Object.assign(new PassThrough(), { method });
      const res = {
        writeHead: (s: number) => void (status = s),
        end: (t: string) => void (out = t),
      };
      const done = board.handle(req, res, path, from);
      req.end(body === undefined ? "" : JSON.stringify(body));
      await done;
      return { status, body: JSON.parse(out) as { posts?: unknown[] } };
    };
    const token = "0".repeat(32);
    const key = "a".repeat(32);
    expect((await call("POST", "/board", { post: post(), key, token })).status).toBe(200);
    expect((await call("GET", "/board")).body.posts).toHaveLength(1);
    // Someone else can't change it or take it down.
    expect(
      (await call("POST", "/board", { post: post({ seats: 3 }), key, token: "1".repeat(32) })).status,
    ).toBe(403);
    await call("POST", "/board/withdraw", { id: post().id, token: "1".repeat(32) });
    expect((await call("GET", "/board")).body.posts).toHaveLength(1);
    // Three reports from different addresses hide it.
    for (const from of ["2", "3", "4"]) await call("POST", "/board/report", { id: post().id }, from);
    expect((await call("GET", "/board")).body.posts).toHaveLength(0);
    // A live post its host stops refreshing goes.
    await call("POST", "/board", { post: post({ id: "1234567890abcdef" }), key, token });
    now += ALIVE_MS + 1;
    expect((await call("GET", "/board")).body.posts).toHaveLength(0);
    // Each address gets a few posts at a time.
    now = Date.now();
    const posted = await Promise.all(
      Array.from({ length: 11 }, (_, i) => `${i}`.padStart(8, "a")).map((id) =>
        call("POST", "/board", { post: post({ id }), key, token }, "9.9.9.9"),
      ),
    );
    // A club's ten tables on one address; the eleventh waits.
    expect(posted.map((r) => r.status)).toEqual([...Array(10).fill(200), 429]);
  });
});

describe("ranked results on the board (docs/board-protocol.md)", () => {
  async function player() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const sign = async (text: string) =>
      Buffer.from(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pair.privateKey,
          new TextEncoder().encode(text),
        ),
      ).toString("base64");
    return { key: `${jwk.x}.${jwk.y}`, sign };
  }

  it("keeps a result only when both signatures hold, and answers under /v1 too", async () => {
    const [a, b, c] = [await player(), await player(), await player()];
    // In canonResult's spelling (src/core/ranked.ts): its keys in that order.
    const result = {
      v: 1,
      system: "rift-lanterns",
      points: null,
      rounds: 5,
      players: [
        { key: a.key, name: "Ana", vp: 3 },
        { key: b.key, name: "Ben", vp: 1 },
      ],
      winner: 0,
      replay: "e".repeat(64),
      at: 1000,
      rules: { app: "0.1.0+x", packages: [] },
    };
    const text = `open-battle-result:${JSON.stringify(result)}`;
    const good = { result, sigs: [await a.sign(text), await b.sign(text)] };
    expect(await signaturesHold(good)).toBe(true);
    // Signed by someone else, or for another score.
    expect(await signaturesHold({ result, sigs: [await a.sign(text), await c.sign(text)] })).toBe(false);
    expect(await signaturesHold({ ...good, result: { ...result, winner: 1 } })).toBe(false);
    // A refusal: the signer's signature on the result and the decliner's on their refusal.
    const declined = {
      result,
      sigs: [await a.sign(text), null],
      declined: {
        seat: 1,
        why: "agreed",
        sig: await b.sign(`open-battle-decline:agreed:${JSON.stringify(result)}`),
      },
    };
    expect(await signaturesHold(declined)).toBe(true);
    expect(await signaturesHold({ ...declined, declined: { ...declined.declined, why: "broke" } })).toBe(
      false,
    );

    const board = createBoard();
    const call = async (path: string, body?: unknown) => {
      let status = 0;
      let out = "";
      const req = Object.assign(new PassThrough(), { method: body === undefined ? "GET" : "POST" });
      const res = { writeHead: (s: number) => void (status = s), end: (t: string) => void (out = t) };
      const done = board.handle(req, res, path, "1.1.1.1");
      req.end(body === undefined ? "" : JSON.stringify(body));
      await done;
      return { status, body: JSON.parse(out) as { results?: unknown[] } };
    };
    expect((await call("/v1/board/results", { result, sigs: [good.sigs[0], good.sigs[0]] })).status).toBe(
      400,
    );
    expect((await call("/v1/board/results", good)).status).toBe(200);
    expect((await call("/board/results")).body.results).toHaveLength(1);
  });
});
