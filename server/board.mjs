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
//   POST /board/results    {result, sigs, declined?}: one more, kept only if its signatures hold
//                          (the board never judges what a result says: the app does)
//   GET  /board/events     online events (#67): each organiser's event and each player's entry
//   POST /board/events     {doc, sig}: the newest of each (kind, event, author) is kept; the app checks the signatures
//
// The app checks every post again as it reads it (src/opentables/post.ts).
//
// Every path also answers under /v1 (/v1/board, /v1/board/results, ...): the
// protocol in docs/board-protocol.md, open to any client that speaks it.

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
// Online events (#67): an event's doc carries its entrants and pairings, so it can be bigger.
const MAX_EVENT_BODY = 96 * 1024;
const MAX_DOCS = 5000;
// An organiser republishes as entries and results come in, and while the event page is open.
const DOCS_PER_HOUR = 600;
// An event nobody has republished for this long has finished with.
const DOC_TTL_MS = 2 * 24 * 3600_000;

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
  /** Event docs by `${kind}:${event}:${author}`, the newest of each. */
  const docs = new Map();
  /** @type {Map<string, number[]>} */
  const docsSent = new Map();
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
    if (path === "/v1/board" || path.startsWith("/v1/board/")) path = path.slice(3);
    if (path !== "/board" && !path.startsWith("/board/")) return false;
    const json = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && path === "/board/results")
      return (json({ results: [...results.values()] }), true);
    if (req.method === "GET" && path === "/board/events") {
      for (const [k, d] of docs) if (now() - d.seen > DOC_TTL_MS) docs.delete(k);
      return (json({ docs: [...docs.values()].map((d) => ({ doc: d.doc, sig: d.sig })) }), true);
    }
    if (req.method === "GET" && path === "/board") {
      sweep();
      return (json({ posts: [...posts.values()].map((e) => ({ ...e.post, key: e.key, at: e.at })) }), true);
    }
    if (req.method !== "POST") return (json({ error: "method" }, 405), true);
    const body = await readJson(req, path === "/board/events" ? MAX_EVENT_BODY : MAX_BODY);
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
      if (!(await signaturesHold(body))) return (json({ error: "signature" }, 400), true);
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
    if (path === "/board/events") {
      const k = docKey(body);
      if (!k) return (json({ error: "doc" }, 400), true);
      const was = docs.get(k);
      if (was && was.doc.at >= body.doc.at) return (json({ ok: true }), true);
      const hour = (docsSent.get(from) ?? []).filter((t) => now() - t < 3600_000);
      if (hour.length >= DOCS_PER_HOUR) return (json({ error: "too many" }, 429), true);
      if (!was && docs.size >= MAX_DOCS) return (json({ error: "full" }, 503), true);
      docsSent.set(from, [...hour, now()]);
      docs.set(k, { doc: body.doc, sig: body.sig, seen: now() });
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

/**
 * Both players' signatures on a result (or the signer's, and the decliner's
 * on their refusal), as src/ranked/verify.ts checks them. The result travels
 * in its canonical spelling (src/core/ranked.ts canonResult), so its JSON is
 * the text signed. Keys are P-256 public keys, "x.y" in base64url.
 */
export async function signaturesHold(r) {
  const canon = JSON.stringify(r.result);
  const players = r.result.players;
  if (!Array.isArray(players) || players.length !== 2) return false;
  const check = async (text, sig, key) => {
    if (typeof key !== "string" || typeof sig !== "string") return false;
    const [x, y] = key.split(".");
    try {
      const k = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x, y, ext: true },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        k,
        Buffer.from(sig, "base64"),
        new TextEncoder().encode(text),
      );
    } catch {
      return false;
    }
  };
  const signed = `open-battle-result:${canon}`;
  if (r.declined) {
    const d = r.declined;
    return (
      (await check(signed, r.sigs[1 - d.seat], players[1 - d.seat]?.key)) &&
      (await check(`open-battle-decline:${d.why}:${canon}`, d.sig, players[d.seat]?.key))
    );
  }
  return (
    (await check(signed, r.sigs[0], players[0]?.key)) && (await check(signed, r.sigs[1], players[1]?.key))
  );
}

/** An event doc's place on the board, roughly checked: the app checks it and its signature properly. */
function docKey(body) {
  const d = body?.doc;
  if (!d || typeof d !== "object" || typeof body.sig !== "string" || body.sig.length > 200) return null;
  if (typeof d.at !== "number" || !Number.isFinite(d.at)) return null;
  const event = d.kind === "event" ? d.id : d.kind === "entry" ? d.event : null;
  const author = d.kind === "event" ? d.organiser : d.key;
  if (typeof event !== "string" || !/^[a-z0-9]{8,40}$/.test(event)) return null;
  if (typeof author !== "string" || author.length > 100) return null;
  return `${d.kind}:${event}:${author}`;
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > max) {
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
