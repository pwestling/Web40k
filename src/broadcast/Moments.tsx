import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { GameRecord } from "../core";
import { momentsOf, type Moment } from "../core/moments";
import { useStore } from "../store";
import { battleOver } from "../ui/StatsScreen";
import { useGame } from "../ui/hooks";
import { pace } from "../ui/pace";
import { clearTray } from "../ui/DiceTray";
import { quietRolls, useHold } from "../ui/hold";
import { legendSting, whoosh } from "../ui/sound";
import { sendMoment, useTalk } from "../talk/talk";
import { useBroadcast } from "./broadcast";
import { useReel } from "./reel";
import { t } from "../i18n";

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
  quietRolls.upTo = 0;
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

/** About how long a moment takes to play (ms): its lead-up, its events at replay pace, the dice settling, the hold. */
function momentLength(record: GameRecord, m: Moment): number {
  if (!playable(m)) return CARD_MS;
  return stretchLength(record, m.seq, Math.max(m.seq, m.end));
}

/** How long the dice tray holds a roll before play goes on, measured from recorded clips (PX dogfood 6). */
const TRAY_MS = 3000;

/** Whether an event puts dice in the tray: an attack's roll, a plain roll, or a procedure step that rolled. */
function rolls(e: GameRecord["events"][number]): boolean {
  const ev = e.event;
  if (ev.type === "attack/roll" || ev.type === "dice/roll") return true;
  return ev.type === "procedure/set" && !!ev.run.records.at(-1)?.dice?.length;
}

/** About how long playing from `from` to `to` takes (ms), as `playMoment` paces it. */
export function stretchLength(record: GameRecord, from: number, to: number): number {
  let ms = LEAD_MS + HOLD_MS;
  const shown = record.events.filter((e) => e.seq >= from && e.seq <= to);
  shown.forEach((e, i) => {
    ms += pace(record, e.seq);
    // The tray plays an attack's rolls while play goes on, then holds the last: one wait a run of rolls
    // (procedures' rolls too: TOW, Conquest, 40k's computer). Per roll, it doubled (PX re-check of #56).
    if (rolls(e) && !(shown[i + 1] && rolls(shown[i + 1]!))) ms += TRAY_MS;
  });
  return ms;
}

/** A beat of the condensed cut: a round's title card, a jump to where some moves ended, an attack's last roll. */
interface Beat {
  seq: number;
  kind: "round" | "move" | "roll";
  round?: number;
}

// A roll beat as measured: the tray lands one roll in about 1.7 s, then the result stays up long enough to read.
const BEAT_MS: Record<Beat["kind"], number> = { round: 1600, move: 500, roll: 600 + 1100 + 1200 };
/** The condensed whole battle runs at most about this long (PX dogfood 3: a clip is for a feed). */
const CONDENSED_MS = 60000;

/**
 * The condensed cut of a stretch (PX dogfood 3): each round opens on a title
 * card, a run of plain moves is one jump cut to where they ended, and each
 * attack or action shows only its last roll. Past about a minute, the jump
 * cuts go first, then rolls are thinned evenly, the last always kept.
 */
export function condensedBeats(
  record: GameRecord,
  from: number,
  to: number,
  rounds: { seq: number; round: number }[],
): Beat[] {
  const beats: Beat[] = [];
  // Where each round starts: just after the one before it ends.
  const starts = new Map<number, number>();
  rounds.forEach((r, i) => {
    const at = i > 0 ? rounds[i - 1]!.seq + 1 : from;
    if (at >= from && at <= to) starts.set(at, r.round);
  });
  let moveEnd: number | null = null;
  let lastRoll: number | null = null;
  const flushMoves = () => {
    if (moveEnd !== null) beats.push({ seq: moveEnd, kind: "move" });
    moveEnd = null;
  };
  const flushRoll = () => {
    if (lastRoll !== null) beats.push({ seq: lastRoll, kind: "roll" });
    lastRoll = null;
  };
  const opening = [...starts.entries()].sort((a, b) => a[0] - b[0]);
  let next = 0;
  for (const e of record.events) {
    if (e.seq < from || e.seq > to) continue;
    for (; next < opening.length && opening[next]![0] <= e.seq; next++) {
      flushMoves();
      flushRoll();
      beats.push({ seq: e.seq, kind: "round", round: opening[next]![1] });
    }
    const type = e.event.type;
    if (type === "models/move" || type === "model/move" || type === "unit/move") {
      flushRoll();
      moveEnd = e.seq;
    } else if (rolls(e)) {
      flushMoves();
      lastRoll = e.seq;
    } else if (type === "attack/clear" || type === "procedure/clear" || type === "attack/declare") {
      flushRoll();
    }
  }
  flushMoves();
  flushRoll();
  const total = (bs: Beat[]) => bs.reduce((n, b) => n + BEAT_MS[b.kind], LEAD_MS + HOLD_MS);
  let out = beats;
  if (total(out) > CONDENSED_MS) out = out.filter((b) => b.kind !== "move");
  const room = CONDENSED_MS - total(out.filter((b) => b.kind !== "roll"));
  const rollsIn = out.filter((b) => b.kind === "roll");
  const fits = Math.max(1, Math.floor(room / BEAT_MS.roll));
  if (rollsIn.length > fits) {
    // Evenly through the battle, the last roll always in.
    const keep = new Set(
      Array.from({ length: fits }, (_, i) => rollsIn[Math.round(((i + 1) * rollsIn.length) / fits) - 1]!.seq),
    );
    out = out.filter((b) => b.kind !== "roll" || keep.has(b.seq));
  }
  return out;
}

/** About how long the condensed cut runs (ms). */
export function condensedLength(beats: Beat[]): number {
  return beats.reduce((n, b) => n + BEAT_MS[b.kind], LEAD_MS + HOLD_MS);
}

/** Play the condensed cut on the table, then `done`. */
export function playCondensed(beats: Beat[], done: () => void): void {
  const token = ++playing;
  const later = (ms: number, f: () => void) =>
    setTimeout(() => {
      if (token === playing) f();
    }, ms);
  const step = (i: number) => {
    const b = beats[i];
    if (!b) {
      quietRolls.upTo = 0;
      useReel.setState({ replay: null });
      later(HOLD_MS, done);
      return;
    }
    // A roll beat shows the attack's last roll only, not the steps before it.
    quietRolls.upTo = b.kind === "roll" ? b.seq - 1 : 0;
    useStore.getState().setScrub(b.seq);
    if (b.kind === "round") {
      useReel.setState({
        replay: {
          kind: "swing",
          seq: b.seq,
          end: b.seq,
          round: b.round ?? 0,
          when: "",
          title: t("Round {n}", { n: b.round ?? 0 }),
          line: "",
          units: [],
          score: 0,
        },
      });
      later(BEAT_MS.round, () => {
        useReel.setState({ replay: null });
        step(i + 1);
      });
      return;
    }
    // A roll waits for the tray to land it, then a beat.
    const wait = (tries: number) => {
      if (useHold.getState().busy && tries > 0) later(150, () => wait(tries - 1));
      else later(b.kind === "roll" ? 1200 : 0, () => step(i + 1));
    };
    later(b.kind === "roll" ? 600 : BEAT_MS.move, () => wait(40));
  };
  later(LEAD_MS, () => step(0));
}

/** About how long the highlights reel runs (ms). */
export function reelLength(record: GameRecord): number {
  return momentsOf(record).reduce((n, m) => n + momentLength(record, m), 0);
}

/** Start the highlights reel, as at the end of a game (the replay page's first button, a clip). */
export function startReel(): void {
  useStore.getState().set({ stats: false, director: true });
  useStore.getState().select(null);
  useReel.setState({ index: 0, done: false });
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
    // Not in a review room: it goes over a finished game, with its notes and review bar (UX 244).
    if (!over || done || index !== null || !moments.length || useStore.getState().review) return;
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
      <MomentCard moment={m} step={t("{i} of {n}", { i: index + 1, n: moments.length })}>
        {/* Players can hurry their own reel; viewers watch it play (UX 143). */}
        {!watching && (
          <>
            <button onClick={() => useReel.setState({ index: index + 1 })}>{t("Next")}</button>
            <button className="quiet" onClick={() => finishReel(director.current)}>
              {t("Skip to stats")}
            </button>
          </>
        )}
      </MomentCard>
    );
  }
  return replayCard ? <MomentCard moment={replayCard} /> : null;
}

/** The lower third: big title with the player's colour, one line, and when. */
function MomentCard({ moment, step, children }: { moment: Moment; step?: string; children?: ReactNode }) {
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
