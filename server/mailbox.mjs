// Open Battle's play-by-mail mailbox. Players in a mail game post their
// signed turn files here instead of passing them by hand, and the other
// player's app picks them up when it opens (or is told by web push). The
// mailbox checks nothing about the game: every file is signed and replayed on
// the receiving device (src/mail, docs/correspondence.md). It keeps files on
// disk, one folder per mailbox, and forgets a mailbox nobody has touched for
// a while. No accounts: a mailbox's id is a long random string only the two
// players have (it travels inside the invitation).
//
//   node server/mailbox.mjs            # listens on port 8790 (or $PORT)
//   node server/mailbox.mjs --vapid    # prints a new key pair for web push
//
// Settings (all optional):
//   PORT               listening port (8790)
//   DATA_DIR           where files are kept (./mailbox-data)
//   TTL_DAYS           forget a mailbox untouched this many days (60)
//   MAX_FILE_MB        largest file accepted, in MB; invitations carry figures (16)
//   VAPID_PUBLIC_KEY   web push keys from --vapid; without them there's no push,
//   VAPID_PRIVATE_KEY  and players see their move in the tab title instead
//   VAPID_SUBJECT      a contact for push services, e.g. mailto:you@example.com
//
// HTTP (the paths also answer under /mailbox, as Caddy forwards them):
//   GET  /vapid                      { publicKey } or { publicKey: null }
//   GET  /box/<id>?after=<n>         { files: [...] } with index > n, oldest first
//   POST /box/<id>                   a mail file (JSON); { ok, index }
//   POST /box/<id>/push              { player, subscription } to be told of the other player's files
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BOX = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_FILES = 2000;
const MAX_SUBSCRIPTIONS = 8;

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** A new VAPID key pair: the public key as an uncompressed point, the private key as `d`, base64url. */
export function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(pub.x, "base64url"),
    Buffer.from(pub.y, "base64url"),
  ]);
  return { publicKey: b64url(point), privateKey: priv.d };
}

/** The signed token a push service checks (RFC 8292), for one push endpoint's origin. */
export function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const point = Buffer.from(keys.publicKey, "base64url");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
    },
    format: "jwk",
  });
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/**
 * The mailbox server. `push` sends one notification (swapped out in tests);
 * by default it POSTs an empty push message, so nothing about the game passes
 * through the push service: the app fetches the file from here.
 */
export function createMailbox({
  dataDir = "./mailbox-data",
  ttlDays = 60,
  maxFileBytes = 16 * 1024 * 1024,
  vapid = null,
  subject = "mailto:admin@localhost",
  push = null,
} = {}) {
  const send =
    push ??
    (async (subscription) => {
      const res = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          TTL: "86400",
          Urgency: "normal",
          Authorization: vapidAuth(subscription.endpoint, vapid, subject),
        },
      });
      return res.status;
    });

  const dir = (box) => join(dataDir, createHash("sha256").update(box).digest("hex").slice(0, 32));

  async function files(box) {
    try {
      return (await readdir(dir(box)))
        .filter((n) => /^\d+\.json$/.test(n))
        .map((n) => Number(n.slice(0, -5)))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  async function subscriptions(box) {
    try {
      return JSON.parse(await readFile(join(dir(box), "push.json"), "utf8"));
    } catch {
      return [];
    }
  }

  async function touch(box) {
    const now = new Date();
    await utimes(dir(box), now, now).catch(() => {});
  }

  /** Forget mailboxes nobody has touched for `ttlDays`. */
  async function sweep(now = Date.now()) {
    let names = [];
    try {
      names = await readdir(dataDir);
    } catch {
      return 0;
    }
    let gone = 0;
    for (const name of names) {
      const path = join(dataDir, name);
      const info = await stat(path).catch(() => null);
      if (info?.isDirectory() && now - info.mtimeMs > ttlDays * 86400_000) {
        await rm(path, { recursive: true, force: true });
        gone++;
      }
    }
    return gone;
  }

  async function body(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error("too big"), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/^\/mailbox/, "") || "/";
    const json = (data, status = 200) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        // The app may be served from another origin than its mailbox (development, or a mailbox shared
        // between sites). There are no cookies: a mailbox id is the only key.
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === "OPTIONS") return json({});
      if (path === "/vapid") return json({ publicKey: vapid?.publicKey ?? null });
      if (path === "/health") return json({ ok: true, push: !!vapid });
      const m = /^\/box\/([^/]+)(\/push)?$/.exec(path);
      if (!m || !BOX.test(m[1])) return json({ error: "No such mailbox." }, 404);
      const box = m[1];
      if (m[2]) {
        if (req.method !== "POST") return json({ error: "POST a subscription." }, 405);
        if (!vapid) return json({ error: "This mailbox has no web push." }, 501);
        const { player, subscription } = JSON.parse(await body(req, 8192));
        if (typeof player !== "string" || player.length > 40 || typeof subscription?.endpoint !== "string")
          return json({ error: "That isn't a push subscription." }, 400);
        const endpoint = new URL(subscription.endpoint);
        if (endpoint.protocol !== "https:") return json({ error: "Push endpoints are https." }, 400);
        await mkdir(dir(box), { recursive: true });
        const subs = (await subscriptions(box)).filter(
          (s) => s.subscription.endpoint !== subscription.endpoint,
        );
        subs.push({ player, subscription: { endpoint: subscription.endpoint } });
        await writeFile(join(dir(box), "push.json"), JSON.stringify(subs.slice(-MAX_SUBSCRIPTIONS)));
        return json({ ok: true });
      }
      if (req.method === "GET") {
        const after = Number(url.searchParams.get("after") ?? 0) || 0;
        const out = [];
        for (const index of await files(box))
          if (index > after) out.push(JSON.parse(await readFile(join(dir(box), `${index}.json`), "utf8")));
        if (out.length) await touch(box);
        return json({ files: out });
      }
      if (req.method !== "POST") return json({ error: "GET or POST." }, 405);
      const text = await body(req, maxFileBytes);
      const file = JSON.parse(text);
      if (file?.format !== "open-battle/mail@1" || !Number.isInteger(file.index) || file.index < 1)
        return json({ error: "That isn't a play-by-mail file." }, 400);
      const have = await files(box);
      if (have.length >= MAX_FILES) return json({ error: "This mailbox is full." }, 507);
      // Files only ever go forward: the same file again is fine, a different one with its number isn't.
      const path2 = join(dir(box), `${file.index}.json`);
      if (have.includes(file.index)) {
        const same = (await readFile(path2, "utf8")) === text;
        return same
          ? json({ ok: true, index: file.index })
          : json({ error: "That turn is already here." }, 409);
      }
      await mkdir(dir(box), { recursive: true });
      await writeFile(path2, text);
      await touch(box);
      // Tell the other player's devices; a subscription the push service has dropped is forgotten.
      if (vapid) {
        const subs = await subscriptions(box);
        const keep = [];
        for (const s of subs) {
          if (s.player === file.from) {
            keep.push(s);
            continue;
          }
          const status = await send(s.subscription).catch(() => 0);
          if (status !== 404 && status !== 410) keep.push(s);
        }
        if (keep.length !== subs.length) await writeFile(join(dir(box), "push.json"), JSON.stringify(keep));
      }
      return json({ ok: true, index: file.index });
    } catch (err) {
      return json(
        { error: err.status === 413 ? "That file is too big." : "That didn't work." },
        err.status ?? 400,
      );
    }
  });

  return { server, sweep };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--vapid")) {
    const keys = vapidKeys();
    console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
    process.exit(0);
  }
  const env = process.env;
  const vapid =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      : null;
  const { server, sweep } = createMailbox({
    dataDir: env.DATA_DIR ?? "./mailbox-data",
    ttlDays: Number(env.TTL_DAYS ?? 60),
    maxFileBytes: Number(env.MAX_FILE_MB ?? 16) * 1024 * 1024,
    vapid,
    subject: env.VAPID_SUBJECT ?? "mailto:admin@localhost",
  });
  const port = Number(env.PORT ?? 8790);
  server.listen(port, () => {
    console.log(`Open Battle mailbox on http://localhost:${port}${vapid ? " (with web push)" : ""}`);
  });
  void sweep();
  setInterval(() => void sweep(), 6 * 3600_000).unref();
}
