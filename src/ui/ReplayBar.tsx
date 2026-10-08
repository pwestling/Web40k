import { rareMoments } from "../core";
import { VIEWER } from "../viewer/flag";
import { momentsOf } from "../core/moments";
import { playMoment, useMomentsAllowed } from "../broadcast/Moments";
import { delaying } from "../broadcast/broadcast";
import { useHold } from "./hold";
import { replayRoll } from "./hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { t } from "../i18n";
import { useStore } from "../store";
import { buildLog, type LogItem } from "./gameLog";
import { pace } from "./pace";
import { BackToOriginal, BranchButton } from "./Branch";
import { readGame, replayIntro, type Highlight } from "./highlights";
import { useNotes } from "../replay/notes";
import { reviewThisGame } from "../replay/review";
import { battleOver } from "./StatsScreen";
import { RecordingPill, SharePanel } from "../share/SharePanel";
import { openShare, useShare } from "../share/store";

const ICONS: Record<Highlight["kind"], string> = { wiped: "☠", charge: "✗", swing: "★", losses: "✚" };

/** Phase changes on the replay track, with the first one of each round marked "R1", "R2"... */
function phaseMarks(log: LogItem[]): { seq: number; text: string; round?: string }[] {
  const out: { seq: number; text: string; round?: string }[] = [];
  let lastRound: string | undefined;
  for (const l of log) {
    if (l.kind !== "header" || l.rules) continue;
    const r = l.round === undefined ? undefined : String(l.round);
    out.push({ seq: Number(l.key), text: l.text, ...(r && r !== lastRound ? { round: r } : {}) });
    lastRound = r;
  }
  return out;
}

/**
 * Scrub through the game log, live (to look back) or on loaded replays. The
 * track is marked with rounds and phases, and a caption says what is
 * happening at the current point, for spectators and anyone scrubbing.
 */
/** Replay playback, here so the replay's title card can start it ("Watch from the start"). */
const usePlayback = create<{ playing: boolean }>(() => ({ playing: false }));

/** Play the replay from the start of the battle. */
export function playFromStart(): void {
  const { record, setScrub } = useStore.getState();
  setScrub(replayIntro(record).startSeq + 1);
  useStore.getState().set({ director: true });
  usePlayback.setState({ playing: true });
}

export function ReplayBar() {
  const { record, scrub, setScrub, session: live, role, review } = useStore();
  // A review room is a replay watched together: there's no "live" in it.
  const session = review ? null : live;
  const watching = VIEWER || (!!session && role === "spectator");
  const notes = useNotes((s) => s.notes);
  const over = useStore((s) => battleOver(s.game));
  const noted = useMemo(() => [...new Set(notes.map((n) => n.seq))], [notes]);
  const playing = usePlayback((s) => s.playing);
  const setPlaying = (playing: boolean) => usePlayback.setState({ playing });
  // The track's width, so round labels that would collide thin out (UX 342).
  const track = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(600);
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTrackWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const last = record.events.at(-1)?.seq ?? 0;
  // A branched game's log starts mid-battle: the track runs from its first event.
  const first = record.initial.seq;
  const at = (seq: number) => `${((seq - first) / Math.max(1, last - first)) * 100}%`;
  // The caption waits for the dice tray, like the log.
  const held = useHold((s) => s.held);
  const pos = scrub ?? (held !== null ? held - 1 : last);
  const log = useMemo(() => buildLog(record), [record]);
  // Phase changes, with the first one of each round marked "R1", "R2"...
  const marks = useMemo(() => phaseMarks(log), [log]);
  const { highlights } = useMemo(() => readGame(record), [record]);
  // Against all odds: rare outcomes, starred on the track.
  const moments = useMemo(() => rareMoments(record), [record]);
  // Moments of the game (PX-4), once it's over or in a replay; rare dice already have their ★.
  const allowed = useMomentsAllowed();
  const stories = useMemo(
    () =>
      allowed
        ? momentsOf(record).filter((m) => m.kind !== "rare" && m.kind !== "mvp" && m.kind !== "turning")
        : [],
    [allowed, record],
  );
  // Rules changes both players agreed to, marked ◆ on the track.
  const rulesChanges = useMemo(
    () => log.flatMap((l) => (l.kind === "header" && l.rules ? [{ seq: Number(l.key), text: l.text }] : [])),
    [log],
  );
  const roundMarks = marks.filter((m) => m.round);
  const closest = roundMarks
    .slice(1)
    .reduce(
      (gap, m, i) => Math.min(gap, ((m.seq - roundMarks[i]!.seq) / Math.max(1, last - first)) * trackWidth),
      Infinity,
    );
  // A label is about 24 px wide: label every round, every 2nd, 3rd... so they never touch.
  const every = Number.isFinite(closest) ? Math.max(1, Math.ceil(26 / Math.max(1, closest))) : 1;
  const phase = [...marks].reverse().find((m) => m.seq <= pos);
  // The latest action in the current phase, or that the phase has just begun.
  const latest = [...log]
    .reverse()
    .find((l) => l.kind === "line" && l.seq <= pos && l.seq > (phase?.seq ?? -1) && !l.undone);
  const now =
    latest?.kind === "line"
      ? latest.text
      : phase
        ? t("{phase} phase began", { phase: phase.text.split(" · ").at(-1) })
        : undefined;

  useEffect(() => {
    if (!playing) return;
    const at = useStore.getState().scrub ?? last;
    const next = at + 1;
    const timer = setTimeout(
      () => {
        const s = useStore.getState();
        if (next >= last) {
          setPlaying(false);
          s.setScrub(session ? null : last);
        } else {
          s.setScrub(next);
          // Playback stops at a note, to read it; play goes on from there.
          if (useNotes.getState().notes.some((n) => n.seq === next)) setPlaying(false);
        }
      },
      pace(record, next),
    );
    return () => clearTimeout(timer);
  }, [playing, last, pos, record, session]);

  const play = () => {
    // Playing from the end starts again from the beginning.
    if (!playing && pos >= last) setScrub(first);
    // A replay starts straight away (which also closes its title card).
    else if (!playing && !session) setScrub(pos + 1);
    setPlaying(!playing);
  };

  const jump = (dir: 1 | -1) => {
    const target =
      dir === 1 ? marks.find((m) => m.seq > pos)?.seq : [...marks].reverse().find((m) => m.seq < pos)?.seq;
    const to = target ?? (dir === 1 ? last : first);
    setScrub(to >= last && session ? null : to);
  };
  const captioned = role === "spectator" || scrub !== null;

  return (
    <>
      {captioned && (phase || now) && (
        <div className="caption">
          {phase && <span className="when">{phase.text}</span>}
          {now && <span>{now}</span>}
        </div>
      )}
      <SharePanel />
      <RecordingPill />
      <div className="replaybar">
        <button title={t("Replay: back a phase")} onClick={() => jump(-1)}>
          ⏮
        </button>
        <button onClick={play}>{playing ? "⏸" : "▶"}</button>
        <button title={t("Replay: forward a phase")} onClick={() => jump(1)}>
          ⏭
        </button>
        <div className="track" ref={track}>
          <input
            type="range"
            min={first}
            max={last}
            value={pos}
            onChange={(e) => {
              const v = Number(e.target.value);
              setScrub(v >= last && session ? null : v);
            }}
          />
          {last > 0 &&
            marks.map((m) => (
              // Every round keeps its tick; only every `every`th is labelled when they'd crowd.
              <span
                key={m.seq}
                className={`tick ${m.round ? "round" : ""}`}
                style={{ left: at(m.seq) }}
                title={m.text}
              >
                {m.round && roundMarks.indexOf(m) % every === 0 && (
                  <span className="label">{t("R{round}", { round: m.round })}</span>
                )}
              </span>
            ))}
          {last > 0 &&
            highlights.map((h) => (
              <button
                key={`${h.seq}-${h.text}`}
                className={`highlight ${h.kind}`}
                style={{ left: at(h.seq) }}
                title={h.text}
                aria-label={t("Replay: {what}", { what: h.text })}
                onClick={() => setScrub(h.seq >= last && session ? null : h.seq)}
              >
                {ICONS[h.kind]}
              </button>
            ))}
          {last > 0 &&
            moments.map((m) => (
              <button
                key={`rare-${m.seq}`}
                className="highlight rare"
                style={{ left: at(m.seq) }}
                title={`${m.title}: ${m.line}`}
                aria-label={t("Replay: {what}", { what: m.title })}
                onClick={() => replayRoll(m.seq)}
              >
                ★
              </button>
            ))}
          {last > 0 &&
            stories.map((m) => (
              <button
                key={`moment-${m.kind}-${m.seq}`}
                className="highlight moment"
                style={{ left: at(m.seq) }}
                title={`${m.title}: ${m.line}`}
                aria-label={t("Replay: {what}", { what: m.title })}
                onClick={() => playMoment(m)}
              >
                ❖
              </button>
            ))}
          {last > 0 &&
            noted.map((seq) => (
              <button
                key={`note-${seq}`}
                className="highlight note"
                style={{ left: at(seq) }}
                title={notes.find((n) => n.seq === seq)?.text || t("A note")}
                aria-label={t("Replay: note, {text}", { text: notes.find((n) => n.seq === seq)?.text ?? "" })}
                onClick={() => setScrub(seq)}
              >
                ✎
              </button>
            ))}
          {last > 0 &&
            rulesChanges.map((r) => (
              <button
                key={`rules-${r.seq}`}
                className="highlight rules"
                style={{ left: at(r.seq) }}
                title={r.text}
                aria-label={t("Replay: {what}", { what: r.text })}
                onClick={() => setScrub(r.seq >= last && session ? null : r.seq)}
              >
                ◆
              </button>
            ))}
        </div>
        <span className="muted where">
          {scrub === null ? t("Live") : (phase?.text.replace(/ · [^·]+ · /, " · ") ?? t("Setup"))}
        </span>
        {/* What if: a new game from the point on the track (UX: roadmap #14). */}
        {/* Live, it branches from now (UX 138); not for a viewer held back by the delay (UX 146). */}
        {/* Neither is a watcher's (PX): not on the replay page, nor for a spectator at someone's game. */}
        {last > record.initial.seq && !delaying() && !watching && <BranchButton seq={pos} />}
        {/* Share the battle (#46): a page, a clip, pictures. In a replay, or once the game is over. */}
        {(!session || over) && last > record.initial.seq && !watching && (
          <button
            title={t("Share the battle")}
            onClick={() => {
              if (useShare.getState().open) useShare.setState({ open: false });
              else {
                useStore.getState().set({ stats: false });
                openShare();
              }
            }}
          >
            {t("Share…")}
          </button>
        )}
        <BackToOriginal />
        {scrub !== null && session && <button onClick={() => setScrub(null)}>{t("Back to live")}</button>}
        {scrub !== null && session && over && (
          <button title={t("Open this game as a replay to add notes and marks")} onClick={reviewThisGame}>
            {t("Review with notes")}
          </button>
        )}
        {!session && !VIEWER && (
          <button
            onClick={() => {
              // Leaving a review room drops its link, so a reload doesn't join it again.
              if (review) history.replaceState(null, "", location.pathname);
              location.reload();
            }}
          >
            {review ? t("Leave") : t("Close replay")}
          </button>
        )}
      </div>
    </>
  );
}
