import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { momentsOf, type Moment } from "../core/moments";
import { useStore } from "../store";
import { battleOver } from "../ui/StatsScreen";
import { useGame } from "../ui/hooks";
import { pace } from "../ui/pace";
import { clearTray } from "../ui/DiceTray";
import { useHold } from "../ui/hold";
import { legendSting, whoosh } from "../ui/sound";
import { sendMoment, useTalk } from "../talk/talk";
import { useBroadcast } from "./broadcast";
import { useReel } from "./reel";

/**
 * Moments of the game (PX-4): at the end of a game a reel plays each one
 * through on the table (the camera cuts there, then the dice, topples and
 * pop-ups run) under a lower third card, before the stats screen. In replays
 * each moment gets a card as it plays. Never during a live game.
 */

/** A card with nothing to play (most valuable unit, turning point) stays up this long. */
const CARD_MS = 5000;
const REPLAY_CARD_MS = 4000;
/** The camera cuts to the moment's lead-up for this long before it plays. */
const LEAD_MS = 600;
/** The card stays after the moment has played out. */
const HOLD_MS = 1500;

/** Whether moments may be shown: the game is over, or this is a replay. */
export function useMomentsAllowed(): boolean {
  const over = useStore((s) => battleOver(s.game));
  const replay = useStore((s) => s.session === null);
  return over || replay;
}

const playable = (m: Moment) => m.kind !== "mvp" && m.kind !== "turning";

/** The playback running now; starting another (or stopping) cancels it. */
let playing = 0;

/** Stop any moment playing on the table. */
export function stopMoment(): void {
  playing++;
}

/**
 * Play a moment on the table: cut to just before it, then step through to its
 * end at replay pace, so the dice, topples and pop-ups all run. `done` is
 * called a moment after it ends (or after a while, for one with nothing to play).
 */
export function playMoment(m: Moment, done?: () => void): void {
  const token = ++playing;
  const later = (ms: number, f: () => void) =>
    setTimeout(() => {
      if (token === playing) f();
    }, ms);
  if (!playable(m)) {
    if (done) later(CARD_MS, done);
    return;
  }
  const { record, setScrub } = useStore.getState();
  setScrub(Math.max(record.initial.seq, m.seq - 1));
  const seqs = record.events.map((e) => e.seq).filter((s) => s >= m.seq && s <= Math.max(m.seq, m.end));
  const step = (i: number) => {
    const seq = seqs[i];
    if (seq === undefined) {
      // The card stays until the tray has settled the moment's last roll, then a beat more.
      const wait = (tries: number) => {
        if (useHold.getState().busy && tries > 0) later(150, () => wait(tries - 1));
        else if (done) later(HOLD_MS, done);
      };
      wait(100);
      return;
    }
    useStore.getState().setScrub(seq);
    later(pace(record, seq), () => step(i + 1));
  };
  later(LEAD_MS, () => step(0));
}

/** Show a moment's card on its own: while it plays through, or for a few seconds. */
function showCard(m: Moment, play: boolean): void {
  useReel.setState({ replay: m });
  const clear = () => {
    if (useReel.getState().replay === m) useReel.setState({ replay: null });
  };
  if (!play) {
    setTimeout(clear, REPLAY_CARD_MS);
    return;
  }
  if (m.kind === "rare") legendSting();
  else whoosh();
  playMoment(m, clear);
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
  showCard(m, true);
}

/** Back from the reel to the game's end, with the stats screen up. */
function finishReel(director: boolean | null): void {
  stopMoment();
  useReel.setState({ index: null, done: true });
  const s = useStore.getState();
  s.set({ director: director ?? s.director, stats: true });
  if (s.session) s.setScrub(null);
}

/** The reel at the end of a game, and moment cards while a replay plays. */
export function Moments() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  // The game as this screen shows it: a delayed viewer's reel waits until their table reaches the end (UX 144).
  const over = battleOver(useGame()) && scrub === null;
  const allowed = useMomentsAllowed();
  const { index, done } = useReel();
  const moments = useMemo(() => (allowed ? momentsOf(record) : []), [allowed, record]);
  const director = useRef<boolean | null>(null);

  // The game just ended (on this screen): start the reel, once.
  useEffect(() => {
    if (!over || done || index !== null || !moments.length) return;
    director.current = useStore.getState().director;
    useStore.getState().set({ director: true });
    useStore.getState().select(null);
    useReel.setState({ index: 0 });
  }, [over, done, index, moments.length]);

  // A clean stage while the reel runs: no panels, caption or replay bar.
  useEffect(() => {
    if (index === null) return;
    document.body.classList.add("reeling");
    return () => document.body.classList.remove("reeling");
  }, [index]);

  // Each card: play the moment through, then on to the next.
  useEffect(() => {
    if (index === null) return;
    const m = moments[index];
    if (!m) {
      finishReel(director.current);
      return;
    }
    // Each card starts on a clear tray, not the last one's dice.
    clearTray();
    if (m.kind === "rare") legendSting();
    else whoosh();
    playMoment(m, () => useReel.setState({ index: index + 1 }));
    return stopMoment;
  }, [index, moments]);

  // In a replay, a moment's card comes up as playback reaches it.
  const replayCard = useReel((s) => s.replay);
  useEffect(() => {
    if (index !== null || scrub === null || !allowed) return;
    const m = moments.find((x) => x.seq === scrub && playable(x));
    if (!m || useReel.getState().replay?.seq === m.seq) return;
    showCard(m, false);
  }, [scrub, index, allowed, moments]);

  // A commentator brought up a card: everyone following them sees it too.
  const cue = useTalk((s) => s.cue);
  useEffect(() => {
    if (!cue || !allowed || !useBroadcast.getState().follow) return;
    const m = moments.find((x) => x.seq === cue.seq && x.kind === cue.kind);
    if (m) cueMoment(m);
  }, [cue, allowed, moments]);

  const watching = useStore((s) => s.role === "spectator");
  if (index !== null && moments[index]) {
    const m = moments[index];
    return (
      <MomentCard moment={m} step={`${index + 1} of ${moments.length}`}>
        {/* Players can hurry their own reel; viewers watch it play (UX 143). */}
        {!watching && (
          <>
            <button onClick={() => useReel.setState({ index: index + 1 })}>Next</button>
            <button className="quiet" onClick={() => finishReel(director.current)}>
              Skip to stats
            </button>
          </>
        )}
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
