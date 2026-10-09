import { useEffect, useState } from "react";
import { create } from "zustand";
import { useStore } from "../store";

/**
 * Broadcast mode (roadmap #13): a clean view for streaming (`?view=broadcast`),
 * a spectator delay, and a commentator whose camera the audience can follow.
 * None of it touches the game log: the delay only holds back what this screen
 * shows, and the commentator's camera travels with table talk.
 */

const params = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);

/** This tab is the clean streaming view: board, score bar and caption, no panels. */
export const BROADCAST = params().get("view") === "broadcast";

/** Delays a spectator can pick, in seconds. */
export const DELAYS = [0, 10, 30, 60, 120] as const;

interface BroadcastState {
  /** How far behind the game this screen runs, in seconds (spectators only). */
  delay: number;
  /** This peer is commentating: its camera goes out to the audience. */
  casting: boolean;
  /** Follow the commentator's camera when there is one. */
  follow: boolean;
}

const fromUrl = Number(params().get("delay"));

export const useBroadcast = create<BroadcastState>(() => ({
  delay: Number.isFinite(fromUrl) && fromUrl > 0 ? Math.min(600, fromUrl) : 0,
  casting: false,
  follow: BROADCAST,
}));

/** When this peer first saw each event, by seq. */
const arrived = new Map<number, number>();
/** The scrub position the delay last set, so a viewer's own scrubbing is left alone. */
let owned: number | null = null;

/** The newest event at least `delay` seconds old here, or null to show everything. */
export function delayedSeq(seqs: number[], seen: ReadonlyMap<number, number>, delay: number, now: number) {
  if (delay <= 0 || !seqs.length) return null;
  let shown = -1;
  for (const seq of seqs) if ((seen.get(seq) ?? now) <= now - delay * 1000) shown = seq;
  return shown === seqs.at(-1) ? null : Math.max(0, shown);
}

/**
 * For a spectator with a delay: the table shows the game as it stood `delay`
 * seconds ago, stepping forward as events come of age. It drives the replay
 * scrubber, so the log, caption and dice all run behind together. Scrubbing
 * by hand takes over until the viewer goes back to live.
 */
export function useSpectatorDelay(): void {
  const spectator = useStore((s) => s.role === "spectator");
  const asked = useBroadcast((s) => s.delay);
  // The host already sends this screen its events late (UX/PX: Live now): hold back only the rest.
  const held = useStore((s) => (s.net?.hostDelay ?? 0) / 1000);
  const delay = Math.max(0, asked - held);
  useEffect(() => {
    if (!spectator) return;
    let first = true;
    const tick = () => {
      const s = useStore.getState();
      const now = Date.now();
      const seqs = s.record.events.map((e) => e.seq);
      // The game so far, as it was when this screen joined, counts as old; anything after runs behind.
      for (const seq of seqs) if (!arrived.has(seq)) arrived.set(seq, first ? 0 : now);
      if (seqs.length) first = false;
      if (s.scrub !== null && s.scrub !== owned) return;
      const want = delayedSeq(seqs, arrived, delay, now);
      owned = want;
      if (want !== s.scrub) s.setScrub(want);
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => {
      clearInterval(timer);
      if (owned !== null && useStore.getState().scrub === owned) useStore.getState().setScrub(null);
      owned = null;
    };
  }, [spectator, delay]);
}

/** Whether the replay position is the delay's (not a viewer scrubbing back). */
export const delaying = () => owned !== null && useStore.getState().scrub === owned;

/** The time, refreshed every `ms`, for showing whether something is still fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A commentator's camera counts as live while it has been heard from this recently. */
export const CASTER_FRESH_MS = 5000;

/** Whether this screen is following a commentator right now (the director stands aside). */
export const followed = { active: false };
