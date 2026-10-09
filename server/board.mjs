// Open tables (#50) on a self-hosted site: a small board of games looking for
// players, kept in memory by the relay (server/relay.mjs). Off unless the relay
// runs with OPEN_TABLES=on. No accounts: a post carries the poster's display
// name, and only the browser holding its token can change or take it down.
//
//   GET  /board            the posts that are up
//   POST /board            {post, key, token}: put a post up, or change it
//   POST /board/withdraw   {id, token}: take it down
//   POST /board/report     {id, why}: three reports from different addresses hide it
//   GET  /board/results    ranked results (#65), signed by both players
//   POST /board/results    {result, sigs, declined?}: one more; the app checks the signatures
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
const MAX_RESULTS = 20_000;
// Results an address may send per hour: two players at one club and the copies they pass on.
const RESULTS_PER_HOUR = 60;

/**
 * @param {{now?: () => number, results?: {load(): any[], add(r: any): void}}} [options]
 *   `results` keeps ranked results past a restart (the relay's BOARD_RESULTS file).
 */
export function createBoard(options = {}) {
  const now = options.now ?? Date.now;
  /** Ranked results by replay hash. */
  const results = new Map();
  for (const r of options.results?.load() ?? []) if (resultLooksRight(r)) results.set(r.result.replay, r);
  /** @type {Map<string, number[]>} */
  const sent = new Map();
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
    if (req.method === "GET" && path === "/board/results")
      return (json({ results: [...results.values()] }), true);
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
    if (path === "/board/results") {
      if (!resultLooksRight(body)) return (json({ error: "result" }, 400), true);
      if (results.has(body.result.replay)) return (json({ ok: true }), true);
      const hour = (sent.get(from) ?? []).filter((t) => now() - t < 3600_000);
      if (hour.length >= RESULTS_PER_HOUR) return (json({ error: "too many" }, 429), true);
      if (results.size >= MAX_RESULTS) return (json({ error: "full" }, 503), true);
      sent.set(from, [...hour, now()]);
      const kept = {
        result: body.result,
        sigs: body.sigs,
        ...(body.declined ? { declined: body.declined } : {}),
      };
      results.set(body.result.replay, kept);
      options.results?.add(kept);
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

/** A ranked result as the app would read it, roughly: the app checks the signatures (src/ranked). */
function resultLooksRight(r) {
  return (
    !!r &&
    typeof r === "object" &&
    !!r.result &&
    typeof r.result === "object" &&
    typeof r.result.replay === "string" &&
    /^[a-f0-9]{64}$/.test(r.result.replay) &&
    Array.isArray(r.sigs) &&
    r.sigs.length === 2 &&
    // Signed by both, or by one with the other's signed refusal (PX ranked 1).
    (r.declined
      ? typeof r.declined === "object" &&
        (r.declined.seat === 0 || r.declined.seat === 1) &&
        typeof r.declined.why === "string" &&
        r.declined.why.length <= 10 &&
        typeof r.declined.sig === "string" &&
        r.declined.sig.length <= 200 &&
        r.sigs[r.declined.seat] === null &&
        typeof r.sigs[1 - r.declined.seat] === "string" &&
        r.sigs[1 - r.declined.seat].length <= 200
      : r.sigs.every((x) => typeof x === "string" && x.length <= 200))
  );
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
