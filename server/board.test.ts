import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createBoard } from "./board.mjs";

const ALIVE_MS = 20 * 60_000;
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
      ["11111111", "22222222", "33333333", "44444444"].map((id) =>
        call("POST", "/board", { post: post({ id }), key, token }, "9.9.9.9"),
      ),
    );
    expect(posted.map((r) => r.status)).toEqual([200, 200, 200, 429]);
  });
});
