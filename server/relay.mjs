// A tiny signalling relay for Open Battle. Browsers use it only to find each
// other and set up WebRTC; game data then flows directly between them.
//
//   pnpm relay              # listens on port 8787 (or $PORT)
//
// Then open the app with ?signal=ws://localhost:8787 (or wss://your-host for
// a deployed relay; an https page needs wss://, so put it behind TLS).
//
// It also answers two plain HTTP requests, which the self-host stack
// (docker-compose.yml, docs/self-host.md) routes to it:
//
//   GET /config.json   Where the app should meet and relay: the signalling URL
//                      and, when TURN_SECRET is set, short-lived TURN logins
//                      (coturn's "use-auth-secret" scheme), so the secret
//                      never reaches a browser.
//   GET /health.json   Is this relay up, and does the TURN server answer?
//
// Settings (all optional):
//   PORT          listening port (8787)
//   PUBLIC_URL    the site's address, e.g. https://battle.example.com; the
//                 signalling URL becomes wss://battle.example.com/relay.
//                 Without it, the address the browser asked for is used
//                 (behind a proxy that sets X-Forwarded-Proto, such as Caddy)
//   SIGNAL_URL    the signalling URL in full, instead of deriving it
//   TURN_URLS     comma-separated, e.g. turn:battle.example.com:3478
//   TURN_SECRET   coturn's static-auth-secret
//   TURN_CHECK    host:port the health check sends a STUN request to
//                 (default: the first TURN_URLS host)
//   TURN_TTL      lifetime of a TURN login in seconds (86400)
import { createHmac } from "node:crypto";
import dgram from "node:dgram";
import { createServer } from "node:http";
import { createWsRelayServer } from "@trystero-p2p/ws-relay/server";

const env = process.env;
const port = Number(env.PORT ?? 8787);
const list = (v) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const turnUrls = list(env.TURN_URLS);
const ttl = Number(env.TURN_TTL ?? 86400);
const started = Date.now();

function signalUrl(req) {
  if (env.SIGNAL_URL) return env.SIGNAL_URL;
  const host = req?.headers["x-forwarded-host"] ?? req?.headers.host;
  const proto = req?.headers["x-forwarded-proto"] ?? "http";
  const base = env.PUBLIC_URL ?? (host ? `${String(proto).split(",")[0]}://${host}` : null);
  if (!base) return null;
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/relay";
  return url.toString();
}

/** A TURN login good for `ttl` seconds, in the form coturn's use-auth-secret checks. */
function turnLogin() {
  const username = `${Math.floor(Date.now() / 1000) + ttl}:open-battle`;
  const credential = createHmac("sha1", env.TURN_SECRET).update(username).digest("base64");
  return { urls: turnUrls, username, credential };
}

function siteConfig(req) {
  const signal = signalUrl(req);
  return {
    signal: signal ? [signal] : [],
    turn: turnUrls.length && env.TURN_SECRET ? [turnLogin()] : [],
  };
}

/** Send a STUN binding request; true if a binding response comes back. */
function stunPing(target, waitMs = 2000) {
  const [host, p] = target.split(":");
  return new Promise((done) => {
    const socket = dgram.createSocket(host.includes(":") ? "udp6" : "udp4");
    const id = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)));
    // Type 0x0001 (binding request), length 0, magic cookie, transaction id.
    const request = Buffer.concat([Buffer.from([0, 1, 0, 0, 0x21, 0x12, 0xa4, 0x42]), id]);
    const finish = (ok) => {
      clearTimeout(timer);
      socket.close();
      done(ok);
    };
    const timer = setTimeout(() => finish(false), waitMs);
    socket.on("message", (msg) => finish(msg.readUInt16BE(0) === 0x0101 && msg.subarray(8, 20).equals(id)));
    socket.on("error", () => finish(false));
    socket.send(request, Number(p || 3478), host);
  });
}

function turnTarget() {
  if (env.TURN_CHECK) return env.TURN_CHECK;
  const first = turnUrls[0];
  if (!first) return null;
  // turn:host:port?transport=udp → host:port
  return first.replace(/^turns?:/, "").replace(/\?.*$/, "");
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname.replace(/^\/relay/, "") || "/";
  const json = (body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (path === "/config.json") return json(siteConfig(req));
  if (path === "/health.json") {
    const target = turnTarget();
    const turn = target ? await stunPing(target) : null;
    const ok = turn !== false;
    return json(
      {
        ok,
        relay: { ok: true, uptimeS: Math.round((Date.now() - started) / 1000), signal: signalUrl(req) },
        turn: target ? { ok: turn, checked: target, logins: !!env.TURN_SECRET } : null,
      },
      ok ? 200 : 503,
    );
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Open Battle signalling relay. Connect with a WebSocket.\n");
});

createWsRelayServer({ server, onError: (err) => console.error(err) });
server.listen(port, () => {
  console.log(`Open Battle relay listening on ws://localhost:${port}`);
  if (turnUrls.length) console.log(`TURN: ${turnUrls.join(", ")}${env.TURN_SECRET ? " (with logins)" : ""}`);
});
