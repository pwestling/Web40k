/**
 * TURN logins for the hosted site (#77): a Cloudflare Worker that asks
 * Cloudflare's TURN service for short-lived logins and hands them to the
 * page, so players on strict networks can still connect. The key's API
 * token stays a Worker secret; the page only ever sees logins that expire.
 *
 * GET / answers {"turn": RTCIceServer[], "ttl": seconds}, the shape a site's
 * config.json uses (src/net/config.ts). Deploying it: docs/cloudflare-turn.md.
 *
 * Settings (wrangler.toml vars and secrets):
 *   TURN_KEY_ID          the TURN key's id (a var)
 *   TURN_KEY_API_TOKEN   the TURN key's API token (a secret)
 *   ALLOWED_ORIGINS      the pages allowed to ask, comma-separated, e.g.
 *                        https://pwestling.github.io (empty: any page)
 *   TTL_SECONDS          how long a login lasts (default 4 hours)
 */

const API = "https://rtc.live.cloudflare.com/v1/turn/keys";
const DEFAULT_TTL = 4 * 3600;

const list = (v) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Cloudflare's answer as a list of servers, the TURN ones only, without port 53 (browsers time out on it). */
export function turnServers(body) {
  const raw = body?.iceServers;
  const servers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return servers.flatMap((s) => {
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls]).filter(
      (u) => typeof u === "string" && /^turns?:/.test(u) && !/:53(\?|$)/.test(u),
    );
    return urls.length && s.username && s.credential
      ? [{ urls, username: s.username, credential: s.credential }]
      : [];
  });
}

/** Answer one request; `fetcher` is the Worker's fetch (a stand-in in tests). */
export async function handle(request, env, fetcher = fetch) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = list(env.ALLOWED_ORIGINS);
  const ok = !allowed.length || allowed.includes(origin);
  const cors = {
    "access-control-allow-origin": allowed.length ? (ok ? origin : allowed[0]) : "*",
    "access-control-allow-methods": "GET, OPTIONS",
    vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
  if (!ok) return json({ error: "This page may not ask for TURN logins." }, 403, cors);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN)
    return json({ turn: [], error: "TURN_KEY_ID or TURN_KEY_API_TOKEN isn't set." }, 500, cors);
  const ttl = Math.max(600, Math.min(48 * 3600, Math.floor(Number(env.TTL_SECONDS) || DEFAULT_TTL)));
  let res;
  try {
    res = await fetcher(`${API}/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl }),
    });
  } catch {
    return json({ turn: [], error: "Cloudflare's TURN service didn't answer." }, 502, cors);
  }
  if (!res.ok) return json({ turn: [], error: `Cloudflare's TURN service said ${res.status}.` }, 502, cors);
  const turn = turnServers(await res.json().catch(() => null));
  return json({ turn, ttl }, turn.length ? 200 : 502, cors);
}

export default { fetch: (request, env) => handle(request, env) };
