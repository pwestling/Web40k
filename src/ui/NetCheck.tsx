import { useState } from "react";
import { netConfig } from "../net/config";

/**
 * The lobby's connection check (playtest kit, roadmap #21): can this browser
 * reach the meeting point (the signalling relay), does STUN find its public
 * address, does TURN answer (when set), a rough NAT type and the round trip,
 * then a plain verdict. Online games need the relay to meet and, behind
 * strict networks, TURN to talk.
 */

type Verdict = "good" | "turn" | "bad";

export interface NetReport {
  relays: { url: string; ms: number | null }[];
  stun: boolean;
  /** "open" (no NAT), "cone" (easy), "symmetric" (hard: direct links often fail), or unknown. */
  nat: "open" | "cone" | "symmetric" | "unknown";
  turn: boolean | null;
  rttMs: number | null;
  verdict: Verdict;
  line: string;
}

const STUN = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];
const WAIT_MS = 4000;

/** How long a WebSocket takes to open, or null if it doesn't within the wait. */
function reach(url: string): Promise<number | null> {
  return new Promise((done) => {
    const t0 = performance.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      done(null);
      return;
    }
    const timer = setTimeout(() => {
      ws.close();
      done(null);
    }, WAIT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      done(Math.round(performance.now() - t0));
      ws.close();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
  });
}

/** Gather ICE candidates for a moment with the given servers. */
async function gather(servers: RTCIceServer[], relayOnly = false): Promise<RTCIceCandidate[]> {
  const pc = new RTCPeerConnection({
    iceServers: servers,
    ...(relayOnly ? { iceTransportPolicy: "relay" } : {}),
  });
  const found: RTCIceCandidate[] = [];
  pc.createDataChannel("check");
  const finished = new Promise<void>((done) => {
    const timer = setTimeout(done, WAIT_MS);
    pc.onicecandidate = (e) => {
      if (e.candidate) found.push(e.candidate);
      else {
        clearTimeout(timer);
        done();
      }
    };
  });
  await pc.setLocalDescription(await pc.createOffer());
  await finished;
  pc.close();
  return found;
}

/** Run every check. */
export async function checkNetwork(): Promise<NetReport> {
  const config = netConfig();
  // Only load the relay library's defaults when someone asks for a check.
  const urls = config.signal.length
    ? config.signal
    : config.nostr.length
      ? config.nostr
      : (await import("@trystero-p2p/nostr")).defaultRelayUrls.slice(0, 5);
  const [relays, stunCandidates, turnCandidates] = await Promise.all([
    Promise.all(urls.map(async (url) => ({ url, ms: await reach(url) }))),
    gather(STUN.map((urls) => ({ urls }))),
    config.turn.length ? gather(config.turn, true) : Promise.resolve(null),
  ]);
  const srflx = stunCandidates.filter((c) => c.type === "srflx");
  const host = stunCandidates.filter((c) => c.type === "host");
  // The same local socket mapped to the same public port by both STUN servers: an easy (cone) NAT.
  const byBase = new Map<string, Set<number>>();
  for (const c of srflx) {
    const key = `${c.relatedAddress}:${c.relatedPort}`;
    if (!byBase.has(key)) byBase.set(key, new Set());
    if (c.port) byBase.get(key)!.add(c.port);
  }
  const mapped = [...byBase.values()];
  const nat: NetReport["nat"] = !srflx.length
    ? "unknown"
    : srflx.some((c) => host.some((h) => h.address === c.address))
      ? "open"
      : mapped.some((ports) => ports.size > 1)
        ? "symmetric"
        : mapped.length
          ? "cone"
          : "unknown";
  const turn = turnCandidates === null ? null : turnCandidates.some((c) => c.type === "relay");
  const reached = relays.filter((r) => r.ms !== null).map((r) => r.ms!);
  const rttMs = reached.length ? Math.min(...reached) : null;

  let verdict: Verdict;
  let line: string;
  if (!reached.length) {
    verdict = "bad";
    line = "Can't reach the meeting point, so online games won't connect from this network.";
  } else if (turn) {
    verdict = "good";
    line = "Good to play: TURN works too, so even strict networks will connect.";
  } else if (!srflx.length || nat === "symmetric") {
    verdict = "turn";
    line =
      turn === false
        ? "Your network may need TURN, and the TURN server didn't answer."
        : "Your network may need TURN: games with some players may not connect without it.";
  } else {
    verdict = "good";
    line = "Good to play.";
  }
  return { relays, stun: srflx.length > 0, nat, turn, rttMs, verdict, line };
}

const NAT_TEXT: Record<NetReport["nat"], string> = {
  open: "none (public address)",
  cone: "easy",
  symmetric: "strict",
  unknown: "unknown",
};

export function NetCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NetReport | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await checkNetwork());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="net-check">
      <button className="link" disabled={busy} onClick={() => void run()}>
        {busy ? "Checking your connection…" : result ? "Check again" : "Check my connection"}
      </button>
      {result && (
        <div className={`net-verdict ${result.verdict}`} role="status">
          <strong>{result.line}</strong>
          <span className="muted small">
            Meeting point: {result.relays.filter((r) => r.ms !== null).length} of {result.relays.length}{" "}
            reachable
            {result.rttMs !== null ? ` (${result.rttMs} ms)` : ""} · Public address:{" "}
            {result.stun ? "found" : "not found"} · NAT: {NAT_TEXT[result.nat]}
            {result.turn !== null ? ` · TURN: ${result.turn ? "works" : "no answer"}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
