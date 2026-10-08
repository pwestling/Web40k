import { rareMoments } from "../core";
import { momentsOf } from "../core/moments";
import { playMoment, useMomentsAllowed } from "../broadcast/Moments";
import { delaying } from "../broadcast/broadcast";
import { useHold } from "./hold";
import { replayRoll } from "./hooks";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { buildLog, type LogItem } from "./gameLog";
import { pace } from "./pace";
import { BackToOriginal, BranchButton } from "./Branch";
import { readGame, type Highlight } from "./highlights";
import { useNotes } from "../replay/notes";

const ICONS: Record<Highlight["kind"], string> = { wiped: "☠", charge: "✗", swing: "★" };

/** Phase changes on the replay track, with the first one of each round marked "R1", "R2"... */
function phaseMarks(log: LogItem[]): { seq: number; text: string; round?: string }[] {
  const out: { seq: number; text: string; round?: string }[] = [];
  let lastRound: string | undefined;
  for (const l of log) {
    if (l.kind !== "header" || l.rules) continue;
    const r = /^Round (\d+)/.exec(l.text)?.[1];
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
export function ReplayBar() {
  const { record, scrub, setScrub, session: live, role, review } = useStore();
  // A review room is a replay watched together: there's no "live" in it.
  const session = review ? null : live;
  const notes = useNotes((s) => s.notes);
  const noted = useMemo(() => [...new Set(notes.map((n) => n.seq))], [notes]);
  const [playing, setPlaying] = useState(false);
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
  const phase = [...marks].reverse().find((m) => m.seq <= pos);
  // The latest action in the current phase, or that the phase has just begun.
  const latest = [...log]
    .reverse()
    .find((l) => l.kind === "line" && l.seq <= pos && l.seq > (phase?.seq ?? -1) && !l.undone);
  const now =
    latest?.kind === "line"
      ? latest.text
      : phase
        ? `${phase.text.split(" · ").at(-1)} phase began`
        : undefined;

  useEffect(() => {
    if (!playing) return;
    const at = useStore.getState().scrub ?? last;
    const next = at + 1;
    const t = setTimeout(
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
    return () => clearTimeout(t);
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
      <div className="replaybar">
        <button title="Replay: back a phase" onClick={() => jump(-1)}>
          ⏮
        </button>
        <button onClick={play}>{playing ? "⏸" : "▶"}</button>
        <button title="Replay: forward a phase" onClick={() => jump(1)}>
          ⏭
        </button>
        <div className="track">
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
              <span
                key={m.seq}
                className={`tick ${m.round ? "round" : ""}`}
                style={{ left: at(m.seq) }}
                title={m.text}
              >
                {m.round && <span className="label">R{m.round}</span>}
              </span>
            ))}
          {last > 0 &&
            highlights.map((h) => (
              <button
                key={`${h.seq}-${h.text}`}
                className={`highlight ${h.kind}`}
                style={{ left: at(h.seq) }}
                title={h.text}
                aria-label={`Replay: ${h.text}`}
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
                aria-label={`Replay: ${m.title}`}
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
                aria-label={`Replay: ${m.title}`}
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
                title={notes.find((n) => n.seq === seq)?.text || "A note"}
                aria-label={`Replay: note, ${notes.find((n) => n.seq === seq)?.text ?? ""}`}
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
                aria-label={`Replay: ${r.text}`}
                onClick={() => setScrub(r.seq >= last && session ? null : r.seq)}
              >
                ◆
              </button>
            ))}
        </div>
        <span className="muted where">
          {scrub === null ? "Live" : (phase?.text.replace(/ · [^·]+ · /, " · ") ?? "Setup")}
        </span>
        {/* What if: a new game from the point on the track (UX: roadmap #14). */}
        {/* Live, it branches from now (UX 138); not for a viewer held back by the delay (UX 146). */}
        {last > record.initial.seq && !delaying() && <BranchButton seq={pos} />}
        <BackToOriginal />
        {scrub !== null && session && <button onClick={() => setScrub(null)}>Back to live</button>}
        {!session && (
          <button
            onClick={() => {
              // Leaving a review room drops its link, so a reload doesn't join it again.
              if (review) history.replaceState(null, "", location.pathname);
              location.reload();
            }}
          >
            {review ? "Leave" : "Close replay"}
          </button>
        )}
      </div>
    </>
  );
}
