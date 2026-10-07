import { rareMoments } from "../core";
import { useEffect, useMemo, useState } from "react";
import type { GameRecord } from "../core";
import { useStore } from "../store";
import { buildLog, type LogItem } from "./gameLog";
import { readGame, type Highlight } from "./highlights";

const ICONS: Record<Highlight["kind"], string> = { wiped: "☠", charge: "✗", swing: "★" };

/** How long playback lingers on an event: dice and phase changes get time to read. */
function pace(record: GameRecord, seq: number): number {
  const type = record.events.find((e) => e.seq === seq)?.event.type ?? "";
  if (type === "attack/roll" || type === "dice/roll") return 1000;
  if (type.startsWith("turn/")) return 900;
  if (type === "unit/add") return 150;
  return 450;
}

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
  const { record, scrub, setScrub, session, role } = useStore();
  const [playing, setPlaying] = useState(false);
  const last = record.events.at(-1)?.seq ?? 0;
  const pos = scrub ?? last;
  const log = useMemo(() => buildLog(record), [record]);
  // Phase changes, with the first one of each round marked "R1", "R2"...
  const marks = useMemo(() => phaseMarks(log), [log]);
  const { highlights } = useMemo(() => readGame(record), [record]);
  // Against all odds: rare outcomes, starred on the track.
  const moments = useMemo(() => rareMoments(record), [record]);
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
          s.setScrub(s.session ? null : last);
        } else s.setScrub(next);
      },
      pace(record, next),
    );
    return () => clearTimeout(t);
  }, [playing, last, pos, record]);

  const play = () => {
    // Playing from the end starts again from the beginning.
    if (!playing && pos >= last) setScrub(0);
    // A replay starts straight away (which also closes its title card).
    else if (!playing && !session) setScrub(pos + 1);
    setPlaying(!playing);
  };

  const jump = (dir: 1 | -1) => {
    const target =
      dir === 1 ? marks.find((m) => m.seq > pos)?.seq : [...marks].reverse().find((m) => m.seq < pos)?.seq;
    const to = target ?? (dir === 1 ? last : 0);
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
            min={0}
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
                style={{ left: `${(m.seq / last) * 100}%` }}
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
                style={{ left: `${(h.seq / last) * 100}%` }}
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
                style={{ left: `${(m.seq / last) * 100}%` }}
                title={`${m.title}: ${m.line}`}
                aria-label={`Replay: ${m.title}`}
                onClick={() => setScrub(m.seq >= last && session ? null : m.seq)}
              >
                ★
              </button>
            ))}
          {last > 0 &&
            rulesChanges.map((r) => (
              <button
                key={`rules-${r.seq}`}
                className="highlight rules"
                style={{ left: `${(r.seq / last) * 100}%` }}
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
        {scrub !== null && session && <button onClick={() => setScrub(null)}>Back to live</button>}
        {!session && <button onClick={() => location.reload()}>Close replay</button>}
      </div>
    </>
  );
}
