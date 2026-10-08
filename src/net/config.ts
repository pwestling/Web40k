/**
 * Where peers find each other. By default browsers meet through public Nostr
 * relays (only the WebRTC handshake goes through them). If those are
 * unreliable, run your own signalling relay (`pnpm relay`, see README) and
 * point the app at it. Players behind strict NATs may also need a TURN server.
 *
 * Settings come from the page URL (so an invite link carries them), from the
 * site's own config.json (a self-hosted server, see docs/self-host.md: built
 * with VITE_SITE_CONFIG=config.json) or from build-time env vars, in that order:
 *   ?signal=wss://relay.example.com        VITE_SIGNAL_URL
 *   ?nostr=wss://a.example,wss://b.example VITE_NOSTR_RELAYS
 *   ?turn=turn:host:3478&turnUser=u&turnPass=p
 *                                          VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_PASS
 *   ?forceTurn=1   send everything through TURN, to test a TURN server
 *   ?mailbox=https://battle.example.com/mailbox
 *                  where play-by-mail turns are posted (server/mailbox.mjs)
 *                                          VITE_MAILBOX_URL
 */
export interface NetConfig {
  /** Self-hosted WebSocket signalling relays; when set, Nostr is not used. */
  signal: string[];
  /** Custom Nostr relays (default: Trystero's public list). */
  nostr: string[];
  turn: RTCIceServer[];
  /** Only connect through TURN (a test of the TURN server). */
  forceTurn?: boolean;
  /** A play-by-mail mailbox (server/mailbox.mjs); without one, turns travel as files. */
  mailbox?: string;
}

const list = (v: string | null | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** What the site's config.json said, once loaded. */
let site: Partial<NetConfig> = {};

/**
 * Fetch the site's config.json when this build asks for one. A self-hosted
 * server answers it with its relay and fresh TURN logins (server/relay.mjs).
 * Never throws: without it the app falls back to the defaults.
 */
export async function loadSiteConfig(
  url = import.meta.env.VITE_SITE_CONFIG as string | undefined,
): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const body = (await res.json()) as Partial<NetConfig>;
    site = {
      ...(Array.isArray(body.signal) && body.signal.length ? { signal: body.signal } : {}),
      ...(Array.isArray(body.nostr) && body.nostr.length ? { nostr: body.nostr } : {}),
      ...(Array.isArray(body.turn) && body.turn.length ? { turn: body.turn } : {}),
      ...(typeof body.mailbox === "string" && body.mailbox ? { mailbox: body.mailbox } : {}),
    };
  } catch {
    // An unreachable or malformed config.json is the same as none.
  }
}

/** For tests. */
export function setSiteConfig(config: Partial<NetConfig>): void {
  site = config;
}

export function netConfig(search = typeof location === "undefined" ? "" : location.search): NetConfig {
  const q = new URLSearchParams(search);
  const env = import.meta.env;
  const turnUrls = list(q.get("turn") ?? (site.turn ? null : env.VITE_TURN_URL));
  const username = q.get("turnUser") ?? env.VITE_TURN_USER;
  const credential = q.get("turnPass") ?? env.VITE_TURN_PASS;
  const fromUrl = (key: string) => (q.has(key) ? list(q.get(key)) : null);
  const mailbox = q.get("mailbox") ?? site.mailbox ?? (env.VITE_MAILBOX_URL as string | undefined);
  return {
    signal: fromUrl("signal") ?? site.signal ?? list(env.VITE_SIGNAL_URL),
    nostr: fromUrl("nostr") ?? site.nostr ?? list(env.VITE_NOSTR_RELAYS),
    turn: turnUrls.length
      ? [{ urls: turnUrls, ...(username ? { username, credential } : {}) }]
      : (site.turn ?? []),
    ...(q.get("forceTurn") === "1" ? { forceTurn: true } : {}),
    ...(mailbox ? { mailbox } : {}),
  };
}

/** The URL parameters to keep on an invite link so the guest uses the same relays. */
export const NET_PARAMS = ["signal", "nostr", "turn", "turnUser", "turnPass", "forceTurn", "mailbox"];
