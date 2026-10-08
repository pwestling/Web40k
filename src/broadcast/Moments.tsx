import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { momentsOf, type Moment } from "../core/moments";
import { useStore } from "../store";
import { battleOver } from "../ui/StatsScreen";
import { legendSting, whoosh } from "../ui/sound";
import { sendMoment, useTalk } from "../talk/talk";
import { useBroadcast } from "./broadcast";

/**
 * Moments of the game (PX-4): at the end of a game a reel replays each one on
 * the table (the camera flies there, the dice and effects play) under a lower
 * third card, before the stats screen. In replays each moment gets a card as
 * it plays. Never during a live game.
 */

const CARD_MS = 5000;
const REPLAY_CARD_MS = 4000;
/** How long the table shows the moment's lead-up before it happens. */
const LEAD_MS = 500;

interface ReelState {
  /** The card on show in the end-of-game reel, or null. */
  index: number | null;
  /** The reel has run (or been skipped) for this game. */
  done: boolean;
  /** A replay's moment card, up for a few seconds as playback passes it. */
  replay: Moment | null;
}

export const useReel = create<ReelState>(() => ({ index: null, done: false, replay: null }));

/** Whether moments may be shown: the game is over, or this is a replay. */
export function useMomentsAllowed(): boolean {
  const over = useStore((s) => battleOver(s.game));
  const replay = useStore((s) => s.session === null);
  return over || replay;
}

/** Jump the table to just before a moment, then let it happen with its effects. */
export function playMoment(m: Moment): void {
  const s = useStore.getState();
  s.setScrub(Math.max(0, m.seq - 1));
  setTimeout(() => useStore.getState().setScrub(m.seq), LEAD_MS);
}

/** Show a moment's card for a while, replaying it on the table where there is something to see. */
function showCard(m: Moment, ms: number, play: boolean): void {
  useReel.setState({ replay: m });
  if (play) {
    if (m.kind === "rare") legendSting();
    else whoosh();
    if (m.kind !== "mvp" && m.kind !== "turning") playMoment(m);
  }
  setTimeout(() => {
    if (useReel.getState().replay === m) useReel.setState({ replay: null });
  }, ms);
}

/** The commentator brings up a card, here and for everyone following them. */
export function castMoment(m: Moment): void {
  cueMoment(m);
  sendMoment(m.seq, m.kind);
}

/** Out of the reel and the stats, onto the table, with the card up. */
function cueMoment(m: Moment): void {
  useReel.setState({ index: null, done: true });
  useStore.getState().set({ stats: false });
  showCard(m, CARD_MS, true);
}

/** The reel at the end of a game, and moment cards while a replay plays. */
export function Moments() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const over = useStore((s) => battleOver(s.game));
  const allowed = useMomentsAllowed();
  const { index, done } = useReel();
  const moments = useMemo(() => (allowed ? momentsOf(record) : []), [allowed, record]);
  const director = useRef<boolean | null>(null);
  const finish = () => {
    useReel.setState({ index: null, done: true });
    const s = useStore.getState();
    s.set({ director: director.current ?? s.director, stats: true });
    if (s.session) s.setScrub(null);
  };

  // The game just ended: start the reel, once.
  useEffect(() => {
    if (!over || done || index !== null || !moments.length) return;
    director.current = useStore.getState().director;
    useStore.getState().set({ director: true });
    useReel.setState({ index: 0 });
  }, [over, done, index, moments.length]);

  // Each card: replay the moment, then move on after a while.
  useEffect(() => {
    if (index === null) return;
    const m = moments[index];
    if (!m) {
      finish();
      return;
    }
    if (m.kind === "rare") legendSting();
    else whoosh();
    if (m.kind !== "mvp" && m.kind !== "turning") playMoment(m);
    const t = setTimeout(() => useReel.setState({ index: index + 1 }), CARD_MS);
    return () => clearTimeout(t);
  }, [index, moments]);

  // In a replay, a moment's card comes up as playback reaches it.
  const replayCard = useReel((s) => s.replay);
  useEffect(() => {
    if (index !== null || scrub === null || !allowed) return;
    const m = moments.find((x) => x.seq === scrub && x.kind !== "mvp" && x.kind !== "turning");
    if (!m || useReel.getState().replay === m) return;
    showCard(m, REPLAY_CARD_MS, false);
  }, [scrub, index, allowed, moments]);

  // A commentator brought up a card: everyone following them sees it too.
  const cue = useTalk((s) => s.cue);
  useEffect(() => {
    if (!cue || !allowed || !useBroadcast.getState().follow) return;
    const m = moments.find((x) => x.seq === cue.seq && x.kind === cue.kind);
    if (m) cueMoment(m);
  }, [cue, allowed, moments]);

  if (index !== null && moments[index]) {
    const m = moments[index];
    return (
      <MomentCard moment={m} step={`${index + 1} of ${moments.length}`}>
        <button onClick={() => useReel.setState({ index: index + 1 })}>Next</button>
        <button className="quiet" onClick={finish}>
          Skip to stats
        </button>
      </MomentCard>
    );
  }
  return replayCard ? <MomentCard moment={replayCard} /> : null;
}

/** The lower third: big title with the player's colour, one line, and when. */
export function MomentCard({
  moment,
  step,
  children,
}: {
  moment: Moment;
  step?: string;
  children?: ReactNode;
}) {
  const color = useStore((s) => (moment.player ? s.game.players[moment.player]?.color : undefined));
  return (
    <div className="moment-card" style={{ borderColor: color ?? "#b45309" }} role="status">
      <div className="title">{moment.title}</div>
      <div className="line">{moment.line}</div>
      <div className="foot muted">
        {moment.when}
        {step ? ` · ${step}` : ""}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
