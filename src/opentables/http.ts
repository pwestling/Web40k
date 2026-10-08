import { readPost, type SeenPost } from "./post";
import type { BoardBackend, BoardStatus } from "./board";

/**
 * The board on a self-hosted site: its relay keeps posts in memory
 * (server/board.mjs) and the app asks for them every so often. Only the
 * browser that put a post up (it holds the post's token) can change or take
 * it down.
 */

const POLL_MS = 20_000;

/** The board answered no: 429 is too many tables from this network. */
class BoardRefused extends Error {
  constructor(readonly status: number) {
    super(`board said ${status}`);
  }
}

export function httpBoard(url: string, key: string, token: (id: string) => string): BoardBackend {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new BoardRefused(res.status);
  };
  return {
    key,
    publish: (p) => post("", { post: p, key, token: token(p.id) }),
    withdraw: (p) => post("/withdraw", { id: p.id, token: token(p.id) }),
    report: (p, why) => post("/report", { id: p.id, why }),
    watch(onPosts, onStatus) {
      let stopped = false;
      const status: BoardStatus = { reached: 0, of: 1, loaded: false };
      const look = async () => {
        try {
          const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error();
          const body = (await res.json()) as { posts?: unknown[] };
          if (stopped) return;
          const posts: SeenPost[] = [];
          for (const raw of body.posts ?? []) {
            const p = readPost(raw);
            const r = raw as { key?: unknown; at?: unknown };
            if (p && typeof r.key === "string" && typeof r.at === "number")
              posts.push({ ...p, key: r.key.slice(0, 64), at: r.at });
          }
          onPosts(posts);
          status.reached = 1;
        } catch {
          status.reached = 0;
        }
        status.loaded = true;
        if (!stopped) onStatus({ ...status });
      };
      void look();
      const timer = setInterval(() => void look(), POLL_MS);
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
    leaving(p) {
      // The page is closing: a beacon still gets there.
      navigator.sendBeacon?.(`${url}/withdraw`, JSON.stringify({ id: p.id, token: token(p.id) }));
    },
  };
}
