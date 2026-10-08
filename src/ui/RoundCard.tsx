import { VIEWER } from "../viewer/flag";
import { reelLength, startReel } from "../broadcast/Moments";
import { playFromStart } from "./ReplayBar";
import { displayName } from "../i18n/names";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { readGame, replayIntro } from "./highlights";
import { biggestSwings, gameStats } from "../core/stats";
import { swingResult } from "./odds";
import { t, tn } from "../i18n";

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
    const timer = setTimeout(() => setClosed((c) => [...c, seq]), 7000);
    return () => clearTimeout(timer);
  }, [seq]);
  if (!current || closed.includes(current.seq)) return null;
  const swing = swings?.get(current.round);
  const delta = swing ? swing.actual - swing.expected : 0;
  return (
    <div className="round-card" role="status">
      <div className="head">
        <strong>{t("Round {n} done", { n: current.round })}</strong>
        <button className="quiet" title={t("Close")} onClick={() => setClosed((c) => [...c, current.seq])}>
          ✕
        </button>
      </div>
      {current.players.map((p) => (
        <div key={p.id} className="row" style={{ borderColor: p.color }}>
          <strong style={{ color: p.color }}>{displayName(p.name)}</strong>
          <span className="vp">
            {t("{n} VP", { n: p.vp })}
            {p.vpGained ? (
              <span className="muted">
                {" "}
                ({p.vpGained > 0 ? "+" : ""}
                {p.vpGained})
              </span>
            ) : null}
          </span>
          <span className="muted">
            {p.modelsLost ? tn(p.modelsLost, "lost {n} model", "lost {n} models") : t("no losses")}
            {p.unitsLost.length ? ", " + t("{units} wiped out", { units: p.unitsLost.join(", ") }) : ""}
          </span>
        </div>
      ))}
      {swing && Math.abs(delta) >= 0.5 && (
        <span className="swing-line">
          {t("Biggest swing: {title}: {result}", { title: swing.title, result: swingResult(swing) })}
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
  const reel = useMemo(() => (isReplay ? reelLength(record) : 0), [isReplay, record]);
  useEffect(() => {
    // On a replay page the card is the friend's way in: it stays until they pick (PX share 7).
    if (!isReplay || VIEWER) return;
    const timer = setTimeout(() => setClosedFor(record), 8000);
    return () => clearTimeout(timer);
  }, [isReplay, record]);
  const setOpen = (open: boolean) => setClosedFor(open ? null : record);
  if (!isReplay || closedFor === record) return null;
  const rounds = intro.rounds;
  const branch = record.events[0]?.event.type === "game/branch" ? record.events[0].event.branch : undefined;
  return (
    <div className="round-card replay-title" role="status">
      <div className="head">
        <strong>
          {intro.players.map((p, i) => (
            <span key={p.name}>
              {i > 0 && " " + t("vs") + " "}
              <span style={{ color: p.color }}>{displayName(p.name)}</span>
            </span>
          ))}
        </strong>
        <button className="quiet" title={t("Close")} onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      <span className="muted">
        {[
          intro.system,
          rounds > 0 ? tn(rounds, "{n} round", "{n} rounds") : t("not started"),
          tn(intro.modelsLost, "{n} model lost", "{n} models lost"),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {branch && (
        <span className="small branched">
          {branch.moment
            ? t("Branched from {game}, {moment}", { game: branch.title, moment: branch.moment })
            : t("Branched from {game}", { game: branch.title })}{" "}
          <span className="muted">
            {t("(game {hash}, event {seq})", { hash: branch.parentHash.slice(0, 8), seq: branch.parentSeq })}
          </span>
        </span>
      )}
      {/* The good bits first: someone opening a link wants the highlights (PX share 7). */}
      <div className="row wrap replay-start">
        {reel > 0 && (
          <button
            className="primary"
            onClick={() => {
              setOpen(false);
              startReel();
            }}
          >
            {t("▶ Watch the highlights ({length})", {
              length: t("about {n} s", { n: Math.max(5, Math.round(reel / 5000) * 5) }),
            })}
          </button>
        )}
        <button
          className={reel > 0 ? "" : "primary"}
          onClick={() => {
            setOpen(false);
            playFromStart();
          }}
        >
          {t("Watch from the start")}
        </button>
      </div>
    </div>
  );
}
