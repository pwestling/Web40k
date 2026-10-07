import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { readGame, replayIntro } from "./highlights";
import { biggestSwings, gameStats } from "../core/stats";
import { swingResult } from "./odds";

/** How far past a round's end (in events) its card still comes up. */
const RECENT = 40;

/**
 * The end-of-round card: VP, what each side gained and lost. Comes up when
 * a round ends, live or in a replay, and goes away on its own.
 */
export function RoundCard() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const pos = scrub ?? record.events.at(-1)?.seq ?? 0;
  const { rounds } = useMemo(() => readGame(record), [record]);
  // Replay viewers get the round's biggest swing against the odds; nothing like it shows during play.
  const watching = useStore((s) => s.role === "spectator" && s.session === null);
  const swings = useMemo(() => (watching ? biggestSwings(gameStats(record).runs) : null), [watching, record]);
  const current = rounds.findLast((r) => r.seq <= pos && pos - r.seq < RECENT);
  const [closed, setClosed] = useState<number[]>([]);
  const seq = current?.seq;
  useEffect(() => {
    if (seq === undefined) return;
    const t = setTimeout(() => setClosed((c) => [...c, seq]), 7000);
    return () => clearTimeout(t);
  }, [seq]);
  if (!current || closed.includes(current.seq)) return null;
  const swing = swings?.get(current.round);
  const delta = swing ? swing.actual - swing.expected : 0;
  return (
    <div className="round-card" role="status">
      <div className="head">
        <strong>Round {current.round} done</strong>
        <button className="quiet" title="Close" onClick={() => setClosed((c) => [...c, current.seq])}>
          ✕
        </button>
      </div>
      {current.players.map((p) => (
        <div key={p.id} className="row" style={{ borderColor: p.color }}>
          <strong style={{ color: p.color }}>{p.name}</strong>
          <span className="vp">
            {p.vp} VP
            {p.vpGained ? (
              <span className="muted">
                {" "}
                ({p.vpGained > 0 ? "+" : ""}
                {p.vpGained})
              </span>
            ) : null}
          </span>
          <span className="muted">
            {p.modelsLost ? `lost ${p.modelsLost} model${p.modelsLost === 1 ? "" : "s"}` : "no losses"}
            {p.unitsLost.length ? `, ${p.unitsLost.join(", ")} wiped out` : ""}
          </span>
        </div>
      ))}
      {swing && Math.abs(delta) >= 0.5 && (
        <span className="swing-line">
          Biggest swing: {swing.title}: {swingResult(swing)}
        </span>
      )}
    </div>
  );
}

/** A replay's title card: who played what, how long, and how bloody. */
export function ReplayTitle() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const isReplay = useStore((s) => s.session === null && s.role === "spectator");
  const intro = useMemo(() => replayIntro(record), [record]);
  // Closed per replay: a newly opened replay gets its card again.
  const [closedFor, setClosedFor] = useState<unknown>(null);
  // Playing or scrubbing away from the start closes it for good.
  if (isReplay && closedFor !== record && scrub !== null && scrub !== intro.startSeq) setClosedFor(record);
  useEffect(() => {
    if (!isReplay) return;
    const t = setTimeout(() => setClosedFor(record), 8000);
    return () => clearTimeout(t);
  }, [isReplay, record]);
  const setOpen = (open: boolean) => setClosedFor(open ? null : record);
  if (!isReplay || closedFor === record) return null;
  const rounds = intro.rounds;
  return (
    <div className="round-card replay-title" role="status">
      <div className="head">
        <strong>
          {intro.players.map((p, i) => (
            <span key={p.name}>
              {i > 0 && " vs "}
              <span style={{ color: p.color }}>{p.name}</span>
            </span>
          ))}
        </strong>
        <button className="quiet" title="Close" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      <span className="muted">
        {[
          intro.system,
          rounds > 0 ? `${rounds} round${rounds === 1 ? "" : "s"}` : "not started",
          `${intro.modelsLost} model${intro.modelsLost === 1 ? "" : "s"} lost`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <span className="muted small">Press ▶ to watch from the start of the battle.</span>
    </div>
  );
}
