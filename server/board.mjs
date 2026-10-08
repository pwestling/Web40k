// Open tables (#50) on a self-hosted site: a small board of games looking for
// players, kept in memory by the relay (server/relay.mjs). Off unless the relay
// runs with OPEN_TABLES=on. No accounts: a post carries the poster's display
// name, and only the browser holding its token can change or take it down.
//
//   GET  /board            the posts that are up
//   POST /board            {post, key, token}: put a post up, or change it
//   POST /board/withdraw   {id, token}: take it down
//   POST /board/report     {id, why}: three reports from different addresses hide it
//
// The app checks every post again as it reads it (src/opentables/post.ts).

const MAX_POSTS = 300;
// A club or a shop shares one address: room for its tables, not for a flood.
const PER_ADDRESS = 10;
const ALIVE_MS = 3 * 60_000;
const MAX_LIVE_MS = 4 * 3600_000 + 60_000;
const MAX_MAIL_MS = 2 * 24 * 3600_000 + 60_000;
const REPORTS_TO_HIDE = 3;
const MAX_BODY = 4096;

/** @param {{now?: () => number}} [options] */
export function createBoard(options = {}) {
  const now = options.now ?? Date.now;
  /** @type {Map<string, {post: any, key: string, token: string, at: number, from: string}>} */
  const posts = new Map();
  /** @type {Map<string, Set<string>>} */
  const reports = new Map();

  const up = (e, t = now()) =>
    e.post.expires > t &&
    (e.post.kind === "mail" || t - e.at < ALIVE_MS) &&
    (reports.get(e.post.id)?.size ?? 0) < REPORTS_TO_HIDE;

  const sweep = () => {
    for (const [id, e] of posts)
      if (!up(e)) {
        posts.delete(id);
        reports.delete(id);
      }
  };

  /** A post as the app would read it, roughly: the app checks it properly. */
  const looksRight = (p) =>
    p &&
    typeof p === "object" &&
    typeof p.id === "string" &&
    /^[a-f0-9]{8,32}$/.test(p.id) &&
    (p.kind === "live" || p.kind === "mail") &&
    typeof p.expires === "number" &&
    p.expires > now() &&
    p.expires <= now() + (p.kind === "live" ? MAX_LIVE_MS : MAX_MAIL_MS);

  /** Answer a board request; false when it isn't one. */
  async function handle(req, res, path, from) {
    if (path !== "/board" && !path.startsWith("/board/")) return false;
    const json = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && path === "/board") {
      sweep();
      return (json({ posts: [...posts.values()].map((e) => ({ ...e.post, key: e.key, at: e.at })) }), true);
    }
    if (req.method !== "POST") return (json({ error: "method" }, 405), true);
    const body = await readJson(req);
    if (!body) return (json({ error: "body" }, 400), true);
    sweep();
    if (path === "/board") {
      const { post, key, token } = body;
      if (!looksRight(post) || typeof key !== "string" || !/^[a-f0-9]{16,64}$/.test(key))
        return (json({ error: "post" }, 400), true);
      if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token))
        return (json({ error: "token" }, 400), true);
      const was = posts.get(post.id);
      if (was && was.token !== token) return (json({ error: "not yours" }, 403), true);
      if (!was) {
        if (posts.size >= MAX_POSTS) return (json({ error: "full" }, 503), true);
        if ([...posts.values()].filter((e) => e.from === from).length >= PER_ADDRESS)
          return (json({ error: "too many" }, 429), true);
      }
      posts.set(post.id, { post, key, token, at: now(), from });
      return (json({ ok: true }), true);
    }
    if (path === "/board/withdraw") {
      const was = posts.get(body.id);
      if (was && was.token === body.token) posts.delete(body.id);
      return (json({ ok: true }), true);
    }
    if (path === "/board/report") {
      if (posts.has(body.id)) {
        const set = reports.get(body.id) ?? new Set();
        set.add(from);
        reports.set(body.id, set);
      }
      return (json({ ok: true }), true);
    }
    return (json({ error: "not found" }, 404), true);
  }

  return { handle, size: () => (sweep(), posts.size) };
}

function readJson(req) {
  return new Promise((resolve) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > MAX_BODY) {
        resolve(null);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}
