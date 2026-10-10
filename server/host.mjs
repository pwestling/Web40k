// Open Battle's host server. Normally a game is hosted by one player's
// browser: it rolls the dice, keeps the log and passes it to the others. A
// host server does that job instead, from a machine that stays on. Players
// open a room on it from the front door ("Host on this site's server"), then
// join it with the usual invite link; the server sits in the room as host
// over WebRTC, takes no seat, and keeps each game on disk so it survives a
// restart or a room everyone left for the night.
//
// It hosts the built-in game systems. When a game turns on a rules package
// the server hands the room to the players (it leaves, and a player's
// browser that holds the package takes over), so it never runs anyone's code.
// A ranked game is handed over the same way: its shared dice need a ranked
// player as host.
//
// The game code comes from the app itself, built for Node:
//
//   pnpm build:host && node server/host.mjs     # or: pnpm host
//
// Settings (all optional):
//   PORT          listening port (8792)
//   SIGNAL_URL    the signalling relay players meet on (ws://localhost:8787);
//                 the same relay the site's config.json names
//   DATA_DIR      where games are kept (./host-data)
//   MAX_ROOMS     games hosted at once (50)
//   IDLE_HOURS    leave a room nobody has been in this long (6); it comes back
//                 when a player opens its link again
//   KEEP_DAYS     forget a game untouched this many days (30)
//   TURN_URLS     comma-separated TURN servers for the server's own connections,
//   TURN_SECRET   with coturn's static-auth-secret to make logins from
//   HOST_BUNDLE   the built game code (../dist-host/rooms.mjs)
//
// HTTP (the paths also answer under /host, as Caddy forwards them):
//   GET  /info               { build, rooms, maxRooms }
//   POST /rooms              { room, system?, teamSize? }: host a new game there
//   GET  /rooms/<room>       { hosted }: whether this server hosts that room
//   POST /rooms/<room>/wake  come back to a room it left while it stood empty
import { createHmac } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOM = /^[A-Za-z0-9_-]{4,64}$/;
/** New rooms one address may open in an hour. */
const OPENS_PER_HOUR = 20;

/**
 * The HTTP side: `hosts` is a HostServer (src/hostServer/rooms.ts), or
 * anything with its open, wake, hosts and rooms.
 */
export function createHostApi({ hosts, build = "", maxRooms = 50, now = Date.now }) {
  const opens = new Map();

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/host/, "") || "/";
    // No cookies or logins here: any page may ask (a dev server, the site itself).
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET, POST");
    const json = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (path === "/info" && req.method === "GET") return json({ build, rooms: hosts.rooms.length, maxRooms });
    if (path === "/rooms" && req.method === "POST") {
      const from = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "")
        .split(",")[0]
        .trim();
      const hour = now() - 3600_000;
      const recent = (opens.get(from) ?? []).filter((t) => t > hour);
      if (recent.length >= OPENS_PER_HOUR) return json({ error: "too many rooms from this network" }, 429);
      let body;
      try {
        body = JSON.parse(await readBody(req, 4096));
      } catch {
        return json({ error: "send JSON: { room, system?, teamSize? }" }, 400);
      }
      const result = hosts.open({
        room: String(body?.room ?? ""),
        ...(typeof body?.system === "string" ? { system: body.system } : {}),
        ...(Number.isFinite(body?.teamSize) ? { teamSize: body.teamSize } : {}),
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      if (!result.resumed) opens.set(from, [...recent, now()]);
      return json(result);
    }
    const m = /^\/rooms\/([^/]+)(\/wake)?$/.exec(path);
    if (m && ROOM.test(m[1])) {
      if (!m[2] && req.method === "GET") return json({ hosted: hosts.hosts(m[1]) });
      if (m[2] && req.method === "POST") {
        const result = hosts.wake(m[1]);
        return result.ok ? json(result) : json({ error: result.error }, result.status);
      }
    }
    json({ error: "not found" }, 404);
  });
  return { server };
}

function readBody(req, limit) {
  return new Promise((done, fail) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        fail(new Error("too big"));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => done(Buffer.concat(parts).toString("utf8")));
    req.on("error", fail);
  });
}

/** Games kept as one JSON file each, written whole and renamed into place. */
export function fileStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = (room) => join(dir, `${room}.json`);
  return {
    load(room) {
      if (!ROOM.test(room)) return null;
      try {
        return JSON.parse(readFileSync(file(room), "utf8"));
      } catch {
        return null;
      }
    },
    save(room, record) {
      const tmp = `${file(room)}.tmp`;
      writeFileSync(tmp, JSON.stringify(record));
      renameSync(tmp, file(room));
    },
    remove(room) {
      rmSync(file(room), { force: true });
    },
    list() {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ room: f.slice(0, -5), savedAt: statSync(join(dir, f)).mtimeMs }));
    },
  };
}

/** A TURN login in coturn's use-auth-secret form, good for a day. */
function turnLogins(env) {
  const urls = (env.TURN_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!urls.length) return [];
  if (!env.TURN_SECRET) return [{ urls }];
  const username = `${Math.floor(Date.now() / 1000) + 86400}:open-battle-host`;
  const credential = createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");
  return [{ urls, username, credential }];
}

async function main() {
  const env = process.env;
  const here = fileURLToPath(new URL(".", import.meta.url));
  const bundle = env.HOST_BUNDLE ?? join(here, "../dist-host/rooms.mjs");
  const { HostServer, relayTransport, BUILD } = await import(pathToFileURL(bundle).href).catch((e) => {
    console.error(`Can't load the game code at ${bundle}: run \`pnpm build:host\` first.\n${e.message}`);
    process.exit(1);
  });
  const { RTCPeerConnection } = await import("./webrtc.mjs");
  const signal = [env.SIGNAL_URL ?? "ws://localhost:8787"];
  const maxRooms = Number(env.MAX_ROOMS ?? 50);
  const hosts = new HostServer({
    transport: (room) =>
      relayTransport(room, { signal, rtcPolyfill: RTCPeerConnection, turn: turnLogins(env) }),
    store: fileStore(env.DATA_DIR ?? "./host-data"),
    maxRooms,
    idleMs: Number(env.IDLE_HOURS ?? 6) * 3600_000,
    keepMs: Number(env.KEEP_DAYS ?? 30) * 86400_000,
  });
  const { server } = createHostApi({ hosts, build: BUILD.build, maxRooms });
  const sweep = setInterval(() => hosts.sweep(), 60_000);
  const port = Number(env.PORT ?? 8792);
  server.listen(port, () =>
    console.log(
      `Open Battle host server (${BUILD.build}) on http://localhost:${port}, meeting at ${signal[0]}`,
    ),
  );
  const stop = () => {
    clearInterval(sweep);
    hosts.stop();
    server.close();
    // Give the last messages a moment to leave.
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
