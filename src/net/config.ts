/**
 * Where peers find each other. By default browsers meet through public Nostr
 * relays (only the WebRTC handshake goes through them). If those are
 * unreliable, run your own signalling relay (`pnpm relay`, see README) and
 * point the app at it. Players behind strict NATs may also need a TURN server.
 *
 * Settings come from the page URL (so an invite link carries them) or from
 * build-time env vars, URL first:
 *   ?signal=wss://relay.example.com        VITE_SIGNAL_URL
 *   ?nostr=wss://a.example,wss://b.example VITE_NOSTR_RELAYS
 *   ?turn=turn:host:3478&turnUser=u&turnPass=p
 *                                          VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_PASS
 */
export interface NetConfig {
  /** Self-hosted WebSocket signalling relays; when set, Nostr is not used. */
  signal: string[];
  /** Custom Nostr relays (default: Trystero's public list). */
  nostr: string[];
  turn: RTCIceServer[];
}

const list = (v: string | null | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function netConfig(search = typeof location === "undefined" ? "" : location.search): NetConfig {
  const q = new URLSearchParams(search);
  const env = import.meta.env;
  const turnUrls = list(q.get("turn") ?? env.VITE_TURN_URL);
  const username = q.get("turnUser") ?? env.VITE_TURN_USER;
  const credential = q.get("turnPass") ?? env.VITE_TURN_PASS;
  return {
    signal: list(q.get("signal") ?? env.VITE_SIGNAL_URL),
    nostr: list(q.get("nostr") ?? env.VITE_NOSTR_RELAYS),
    turn: turnUrls.length ? [{ urls: turnUrls, ...(username ? { username, credential } : {}) }] : [],
  };
}

/** The URL parameters to keep on an invite link so the guest uses the same relays. */
export const NET_PARAMS = ["signal", "nostr", "turn", "turnUser", "turnPass"];
