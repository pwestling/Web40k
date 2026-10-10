import { describe, expect, it } from "vitest";
import { handle, turnServers } from "./turn-worker.mjs";

const env = {
  TURN_KEY_ID: "key1",
  TURN_KEY_API_TOKEN: "secret",
  ALLOWED_ORIGINS: "https://pwestling.github.io, http://localhost:5173",
};
const answer = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ],
};
const ask = (origin: string | null, method = "GET") =>
  new Request("https://turn.example.workers.dev/", { method, headers: origin ? { origin } : {} });

describe("TURN login worker (#77)", () => {
  it("passes on TURN logins only, without port 53", () => {
    expect(turnServers(answer)).toEqual([
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "u",
        credential: "c",
      },
    ]);
    // The older endpoint's single object.
    expect(turnServers({ iceServers: { urls: "turn:a:3478", username: "u", credential: "c" } })).toHaveLength(
      1,
    );
    expect(turnServers(null)).toEqual([]);
  });

  it("asks Cloudflare with the secret token, for the allowed pages only", async () => {
    const calls: [string, RequestInit][] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return Response.json(answer);
    };
    const res = await handle(ask("https://pwestling.github.io"), env, fetcher);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://pwestling.github.io");
    const body = (await res.json()) as { turn: unknown[]; ttl: number };
    expect(body.turn).toHaveLength(1);
    expect(body.ttl).toBe(4 * 3600);
    expect(calls[0]![0]).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers",
    );
    expect((calls[0]![1].headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ ttl: 4 * 3600 });

    expect((await handle(ask("https://evil.example"), env, fetcher)).status).toBe(403);
    expect((await handle(ask(null), env, fetcher)).status).toBe(403);
    expect((await handle(ask("http://localhost:5173", "OPTIONS"), env, fetcher)).status).toBe(204);
    expect(calls).toHaveLength(1);
  });

  it("says what's wrong when it can't get logins", async () => {
    const down = async () => new Response("nope", { status: 401 });
    const res = await handle(ask("https://pwestling.github.io"), env, down);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ turn: [], error: "Cloudflare's TURN service said 401." });
    const unset = await handle(ask("https://pwestling.github.io"), { ALLOWED_ORIGINS: "" }, down);
    expect(unset.status).toBe(500);
  });
});
