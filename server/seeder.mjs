// Open Battle's seed node. Players share figure packs, tables, armies and
// replays as torrents between their browsers (src/share/torrent.ts); a torrent
// only lives while someone has it open. When a player shares a file, the app
// also hands it to the seed nodes it knows, which keep a copy and serve it
// over plain HTTPS as the torrent's web seed: anyone opening the link later
// gets it from the swarm, the seed node or both, even when the sharer is gone.
//
// A seed node knows nothing about games. A file is kept under its SHA-256,
// checked on arrival, and is opaque bytes: a player may encrypt it first (the
// key travels only in the link's #fragment, which never reaches a server).
// Files nobody has fetched for a while are forgotten, and the oldest go first
// when the node is full.
//
// Takedowns: set CONTACT so people know where to send notices, and drop a
// file with DELETE /blob/<sha256> and the ADMIN_TOKEN. A dropped hash is
// blocked, so the same bytes can't be posted again.
//
//   node server/seeder.mjs            # listens on port 8791 (or $PORT)
//
// Settings (all optional):
//   PORT          listening port (8791)
//   DATA_DIR      where files are kept (./seed-data)
//   MAX_FILE_MB   largest file accepted, in MB (96)
//   MAX_TOTAL_GB  room for all files together, in GB (20); the least recently fetched go first
//   TTL_DAYS      forget a file nobody has fetched this many days (30)
//   CONTACT       where takedown notices go, shown at /info (e.g. mailto:abuse@example.com)
//   ADMIN_TOKEN   lets DELETE /blob/<sha256> drop and block a file
//
// HTTP (the paths also answer under /seed, as Caddy forwards them):
//   GET    /info                  { contact, maxFileBytes, ttlDays }
//   PUT    /blob/<sha256>         the file's bytes; kept if they hash to the name
//   GET    /blob/<sha256>         the file (Range requests too: it's a BEP 19 web seed)
//   HEAD   /blob/<sha256>         whether it's here
//   DELETE /blob/<sha256>         Authorization: Bearer <ADMIN_TOKEN>; drops and blocks it
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HASH = /^[0-9a-f]{64}$/;
/** Uploads one address may make in an hour. */
const PUTS_PER_HOUR = 60;

export function createSeeder({
  dataDir = "./seed-data",
  maxFileBytes = 96 * 1024 * 1024,
  maxTotalBytes = 20 * 1024 ** 3,
  ttlDays = 30,
  contact = "",
  adminToken = "",
} = {}) {
  const blobs = join(dataDir, "blobs");
  const blockFile = join(dataDir, "blocked.txt");
  const file = (hash) => join(blobs, hash);
  let blocked = null;
  const puts = new Map();

  async function blockedSet() {
    if (!blocked) {
      const text = await readFile(blockFile, "utf8").catch(() => "");
      blocked = new Set(text.split("\n").filter((l) => HASH.test(l)));
    }
    return blocked;
  }

  async function listed() {
    const names = await readdir(blobs).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!HASH.test(name)) continue;
      const info = await stat(file(name)).catch(() => null);
      if (info) out.push({ hash: name, size: info.size, used: info.mtimeMs });
    }
    return out;
  }

  /** Forget files nobody fetched for `ttlDays`, then the least recently fetched until there's room. */
  async function sweep(now = Date.now(), room = 0) {
    const all = (await listed()).sort((a, b) => a.used - b.used);
    let total = all.reduce((n, f) => n + f.size, 0);
    let gone = 0;
    for (const f of all) {
      if (now - f.used <= ttlDays * 86400_000 && total + room <= maxTotalBytes) break;
      await rm(file(f.hash), { force: true });
      total -= f.size;
      gone++;
    }
    return gone;
  }

  function allowed(address, now = Date.now()) {
    const recent = (puts.get(address) ?? []).filter((at) => now - at < 3600_000);
    if (recent.length >= PUTS_PER_HOUR) return false;
    recent.push(now);
    puts.set(address, recent);
    return true;
  }

  const admin = (req) => {
    const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
    const want = Buffer.from(adminToken);
    return adminToken.length > 0 && given.length === want.length && timingSafeEqual(given, want);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/^\/seed/, "") || "/";
    const cors = {
      // Any site's app may share through this node, and fetch from it: there are no cookies or accounts.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, range, authorization",
      "access-control-expose-headers": "content-length, content-range, accept-ranges",
    };
    const json = (data, status = 200) => {
      res.writeHead(status, { ...cors, "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === "OPTIONS") return json({});
      if (path === "/info" || path === "/health")
        return json({ ok: true, contact: contact || null, maxFileBytes, ttlDays });
      const m = /^\/blob\/([0-9a-f]{64})$/.exec(path);
      if (!m) return json({ error: "Not found." }, 404);
      const hash = m[1];

      if (req.method === "DELETE") {
        if (!admin(req)) return json({ error: "Not allowed." }, 403);
        await rm(file(hash), { force: true });
        const set = await blockedSet();
        if (!set.has(hash)) {
          set.add(hash);
          await mkdir(dataDir, { recursive: true });
          await appendFile(blockFile, `${hash}\n`);
        }
        return json({ ok: true, blocked: true });
      }

      if (req.method === "PUT") {
        if ((await blockedSet()).has(hash)) return json({ error: "That file was taken down." }, 451);
        const here = await stat(file(hash)).catch(() => null);
        if (here) {
          for await (const _ of req); // drain
          return json({ ok: true, already: true });
        }
        if (!allowed(req.socket.remoteAddress ?? ""))
          return json({ error: "Too many files; try later." }, 429);
        const length = Number(req.headers["content-length"]);
        if (length > maxFileBytes) return json({ error: "That file is too big." }, 413);
        const sha = createHash("sha256");
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxFileBytes) return json({ error: "That file is too big." }, 413);
          sha.update(chunk);
          chunks.push(chunk);
        }
        if (sha.digest("hex") !== hash) return json({ error: "Those bytes don't match their hash." }, 400);
        await sweep(Date.now(), size);
        await mkdir(blobs, { recursive: true });
        const tmp = `${file(hash)}.${process.pid}.${Date.now()}.part`;
        await writeFile(tmp, Buffer.concat(chunks));
        await rename(tmp, file(hash));
        return json({ ok: true }, 201);
      }

      if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "GET, PUT or DELETE." }, 405);
      const info = await stat(file(hash)).catch(() => null);
      if (!info) return json({ error: "Not here." }, 404);
      const now = new Date();
      await utimes(file(hash), now, now).catch(() => {});
      const headers = {
        ...cors,
        "content-type": "application/octet-stream",
        "accept-ranges": "bytes",
        // The name is the content's hash: these bytes never change.
        "cache-control": "public, max-age=31536000, immutable",
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
      let start = 0;
      let end = info.size - 1;
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : end;
        if (start > end || start >= info.size) {
          res.writeHead(416, { ...cors, "content-range": `bytes */${info.size}` });
          return res.end();
        }
        res.writeHead(206, {
          ...headers,
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${info.size}`,
        });
      } else res.writeHead(200, { ...headers, "content-length": info.size });
      if (req.method === "HEAD") return res.end();
      createReadStream(file(hash), { start, end }).pipe(res);
    } catch {
      if (!res.headersSent) json({ error: "That didn't work." }, 400);
      else res.end();
    }
  });

  return { server, sweep };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const { server, sweep } = createSeeder({
    dataDir: env.DATA_DIR ?? "./seed-data",
    maxFileBytes: Number(env.MAX_FILE_MB ?? 96) * 1024 * 1024,
    maxTotalBytes: Number(env.MAX_TOTAL_GB ?? 20) * 1024 ** 3,
    ttlDays: Number(env.TTL_DAYS ?? 30),
    contact: env.CONTACT ?? "",
    adminToken: env.ADMIN_TOKEN ?? "",
  });
  const port = Number(env.PORT ?? 8791);
  server.listen(port, () => console.log(`Open Battle seed node on :${port}`));
  setInterval(() => void sweep(), 3600_000).unref();
}
