import { useMemo, useState } from "react";
import { create } from "zustand";
import { applyEvent, sidePlayers, undoneSeqs, type GameRecord, type GameState } from "../core";
import { gameModule } from "../systems";
import { useStore } from "../store";
import { displayName } from "../i18n/names";
import { formatNumber, gameText, t } from "../i18n";
import { branchGame } from "../ui/Branch";
import { explain } from "../bot/explain";
import { loadNotes, putNote, deviceId, type NoteMark } from "../replay/notes";
import { startReview, useReviewRun } from "./run";
import { moveText, takeaways } from "./words";
import type { Decision, GameReview, Mark } from "./analyse";

/**
 * Game review (#61) on the stats sheet, after the game or in a replay: the
 * expected-result line across the game, its turning points (each to watch
 * again, play differently from, or keep as a replay note) and three
 * takeaways per side. Never during live play: the sheet shows it only once
 * the battle is over, or in a replay.
 */

const vp = (n: number) => formatNumber(Math.abs(n), { maximumFractionDigits: 1 });
const pct = (p: number) => formatNumber(p * 100, { maximumFractionDigits: 0 });

/** The table just before each of these entries, folded once. */
function statesBefore(record: GameRecord, seqs: number[]): Map<number, GameState> {
  const want = new Set(seqs);
  const out = new Map<number, GameState>();
  const undone = undoneSeqs(record);
  let s = record.initial;
  for (const e of record.events) {
    if (want.has(e.seq)) out.set(e.seq, s);
    if (!undone.has(e.seq)) s = { ...applyEvent(s, e.event), seq: e.seq };
  }
  return out;
}

/** The game can be reviewed: a built-in system the review's worker knows. */
export function reviewable(game: GameState): boolean {
  return !!gameModule(game.system);
}

export function ReviewPanel({ watching, close }: { watching: boolean; close: () => void }) {
  const record = useStore((s) => s.record);
  const run = useReviewRun();
  const mine = run.of?.initial === record.initial;
  if (!mine || run.status === "idle")
    return (
      <section className="game-review">
        <h4>{t("Game review")}</h4>
        <p className="muted small">
          {t(
            "The computer goes back over every decision: what each was worth, the turning points, and what to try next time.",
          )}
        </p>
        <button className="primary" onClick={() => startReview(record)}>
          {t("Review this game")}
        </button>
      </section>
    );
  if (run.status === "running")
    return (
      <section className="game-review">
        <h4>{t("Game review")}</h4>
        <p className="muted small">{t("Going over every decision… ({n}%)", { n: pct(run.done) })}</p>
        <progress value={run.done} max={1} />
      </section>
    );
  if (run.status === "error" || !run.review)
    return (
      <section className="game-review">
        <h4>{t("Game review")}</h4>
        <p className="warn">{t("The review stopped: {why}", { why: run.error ?? "" })}</p>
        <button onClick={() => startReview(record)}>{t("Try again")}</button>
      </section>
    );
  return <Review review={run.review} record={record} watching={watching} close={close} />;
}

function Review({
  review,
  record,
  watching,
  close,
}: {
  review: GameReview;
  record: GameRecord;
  watching: boolean;
  close: () => void;
}) {
  const final = useStore((s) => s.game);
  const states = useMemo(
    () =>
      statesBefore(
        record,
        review.decisions.map((d) => d.seq),
      ),
    [record, review],
  );
  const at = (seq: number) => states.get(seq) ?? final;
  const sideName = (seat: number) =>
    sidePlayers(final, seat)
      .map((p) => displayName(p.name))
      .join(" & ") || t("Player {n}", { n: seat + 1 });
  const color = (seat: number) => sidePlayers(final, seat)[0]?.color ?? "#9ca3af";
  // The biggest turning points, in the order they happened.
  const turning = useMemo(
    () =>
      [...review.marks]
        .sort((a, b) => Math.abs(b.size) - Math.abs(a.size))
        .slice(0, 8)
        .sort((a, b) => a.decision - b.decision || a.kind.localeCompare(b.kind)),
    [review],
  );
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <section className="game-review">
      <h4>{t("Game review")}</h4>
      <ResultLine
        review={review}
        sideName={sideName}
        color={color}
        turning={turning}
        picked={picked}
        pick={setPicked}
      />
      <h4>{t("Turning points")}</h4>
      {turning.length ? (
        <ol className="turning">
          {turning.map((m) => (
            <TurningPoint
              key={`${m.kind}-${m.decision}`}
              mark={m}
              d={review.decisions[m.decision]!}
              state={at(review.decisions[m.decision]!.seq)}
              record={record}
              sideName={sideName}
              color={color}
              watching={watching}
              close={close}
              on={picked === m.decision}
              pick={() => setPicked(m.decision)}
            />
          ))}
        </ol>
      ) : (
        <p className="muted">{t("No big swings: both sides played close to the best on offer.")}</p>
      )}
      <h4>{t("Takeaways")}</h4>
      <div className="takeaways">
        {review.seats.map((seat) => (
          <div key={seat}>
            <div className="who">
              <span className="swatch" style={{ background: color(seat) }} />
              <strong>{sideName(seat)}</strong>
            </div>
            <ul>
              {takeaways(review, at, seat).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const kindText = (m: Mark) =>
  m.kind === "costly"
    ? t("Costly")
    : m.kind === "strong"
      ? t("Strong")
      : m.kind === "missed"
        ? t("Missed chance")
        : m.size > 0
          ? t("Lucky dice")
          : t("Unlucky dice");

/** The expected result across the game: above the middle line, the first side is ahead. */
function ResultLine({
  review,
  sideName,
  color,
  turning,
  picked,
  pick,
}: {
  review: GameReview;
  sideName: (seat: number) => string;
  color: (seat: number) => string;
  turning: Mark[];
  picked: number | null;
  pick: (n: number) => void;
}) {
  const pts = review.points;
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return null;
  const [a, b] = [review.seats[0] ?? 0, review.seats[1] ?? 1];
  const W = 520;
  const H = 160;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const mid = y(0.5);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
  const area = `${line}L${x(pts.length - 1)},${mid}L${x(0)},${mid}Z`;
  const index = (seq: number) => {
    let n = 0;
    for (let i = 0; i < pts.length; i++) if (pts[i]!.seq <= seq) n = i;
    return n;
  };
  // Round boundaries along the bottom.
  const last = Math.max(...pts.slice(0, -1).map((p) => p.round));
  const rounds = pts.flatMap((p, i) =>
    i && p.round !== pts[i - 1]!.round && p.round <= last ? [{ i, round: p.round }] : [],
  );
  const shown = hover ?? null;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(f * (pts.length - 1)))));
  };
  return (
    <div className="result-line">
      <div className="legend-row">
        <span>
          <span className="swatch" style={{ background: color(a) }} />
          {t("{side} ahead", { side: sideName(a) })} ↑
        </span>
        <span>
          <span className="swatch" style={{ background: color(b) }} />
          {t("{side} ahead", { side: sideName(b) })} ↓
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="review-chart"
        role="img"
        aria-label={t("Expected result across the game")}
      >
        <defs>
          <clipPath id="review-above">
            <rect x={0} y={0} width={W} height={mid} />
          </clipPath>
          <clipPath id="review-below">
            <rect x={0} y={mid} width={W} height={H - mid} />
          </clipPath>
        </defs>
        <path d={area} fill={color(a)} opacity={0.22} clipPath="url(#review-above)" />
        <path d={area} fill={color(b)} opacity={0.22} clipPath="url(#review-below)" />
        <line x1={pad.l} x2={W - pad.r} y1={mid} y2={mid} className="mid" />
        {rounds.map((r) => (
          <g key={r.i}>
            <line x1={x(r.i)} x2={x(r.i)} y1={pad.t} y2={H - pad.b} className="round" />
            <text x={x(r.i) + 3} y={H - 6} className="tick">
              {t("R{n}", { n: r.round })}
            </text>
          </g>
        ))}
        <path d={line} className="line" />
        {turning.map((m) => {
          const d = review.decisions[m.decision]!;
          const i = index(d.seq);
          return (
            <circle
              key={`${m.kind}-${m.decision}`}
              cx={x(i)}
              cy={y(pts[i]!.p)}
              r={picked === m.decision ? 6 : 4.5}
              className={`mark ${m.kind}`}
              fill={color(d.seat)}
              onClick={() => pick(m.decision)}
            >
              <title>{kindText(m)}</title>
            </circle>
          );
        })}
        {shown !== null && <line x1={x(shown)} x2={x(shown)} y1={pad.t} y2={H - pad.b} className="cross" />}
        <rect
          x={pad.l}
          y={0}
          width={W - pad.l - pad.r}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <p className="muted small chart-read">
        {shown !== null
          ? t("Round {round}: {side} {n}% to win", {
              round: pts[shown]!.round,
              side: sideName(pts[shown]!.p >= 0.5 ? a : b),
              n: pct(Math.max(pts[shown]!.p, 1 - pts[shown]!.p)),
            })
          : t("How the computer rated each side's chances as the game went on.")}
      </p>
    </div>
  );
}

function TurningPoint({
  mark,
  d,
  state,
  record,
  sideName,
  color,
  watching,
  close,
  on,
  pick,
}: {
  mark: Mark;
  d: Decision;
  state: GameState;
  record: GameRecord;
  sideName: (seat: number) => string;
  color: (seat: number) => string;
  watching: boolean;
  close: () => void;
  on: boolean;
  pick: () => void;
}) {
  const played = moveText(state, d.played);
  const better = d.best ? moveText(state, d.best) : null;
  const line =
    mark.kind === "costly"
      ? t("{played}. Better: {better} (about {vp} VP more).", {
          played,
          better: better ?? "",
          vp: vp(mark.size),
        })
      : mark.kind === "missed"
        ? t("Moved on with {better} still to do (about {vp} VP).", {
            better: better ?? "",
            vp: vp(mark.size),
          })
        : mark.kind === "strong"
          ? t("{played}: about {vp} VP better than the next best choice.", { played, vp: vp(mark.size) })
          : mark.size > 0
            ? t("{played}: the dice gave about {vp} VP more than the average.", { played, vp: vp(mark.size) })
            : t("{played}: the dice gave about {vp} VP less than the average.", {
                played,
                vp: vp(mark.size),
              });
  const prev = [...record.events].reverse().find((e) => e.seq < d.seq)?.seq ?? record.initial.seq;
  const show = () => {
    close();
    const { setScrub } = useStore.getState();
    setScrub(prev);
    setTimeout(() => useStore.getState().setScrub(d.endSeq), 900);
  };
  const tryBetter = () => {
    if (better) useBetterMove.setState({ text: better, side: sideName(d.seat) });
    branchGame(prev, "hotseat");
  };
  const [noted, setNoted] = useState(false);
  const note = async () => {
    await loadNotes(record);
    const marks: NoteMark[] = [];
    const ex = d.best && (mark.kind === "costly" || mark.kind === "missed") ? explain(state, d.best) : null;
    if (ex?.from && ex.to) marks.push({ kind: "arrow", from: ex.from, to: ex.to });
    putNote({
      id: `review-${d.seq}-${mark.kind}`,
      seq: d.endSeq,
      by: t("Game review"),
      color: color(d.seat),
      text: `${kindText(mark)}: ${line}`,
      marks,
      at: Date.now(),
      author: deviceId(),
    });
    setNoted(true);
  };
  return (
    <li className={on ? "on" : ""} onClick={pick}>
      <div className="tp-head">
        <span className={`kind ${mark.kind}${mark.kind === "dice" && mark.size < 0 ? " down" : ""}`}>
          {kindText(mark)}
        </span>
        <span className="swatch" style={{ background: color(d.seat) }} />
        <span className="muted small">
          {t("{side} · round {round}, {phase}", {
            side: sideName(d.seat),
            round: d.round,
            phase: gameText(d.phase),
          })}
        </span>
      </div>
      <div>{line}</div>
      <div className="tp-actions">
        <button className="quiet small" onClick={show} title={t("Watch it again on the table")}>
          {t("Show")}
        </button>
        {!watching && better && (mark.kind === "costly" || mark.kind === "missed") && (
          <button
            className="quiet small"
            onClick={tryBetter}
            title={t("A new game on this screen, just before this choice")}
          >
            {t("Try the better move")}
          </button>
        )}
        <button
          className="quiet small"
          disabled={noted}
          onClick={note}
          title={t("Keep it as a note on this replay")}
        >
          {noted ? t("Added to notes") : t("Add to notes")}
        </button>
      </div>
    </li>
  );
}

/** "Try the better move": the move to try, shown over the branched game until it's dismissed. */
const useBetterMove = create<{ text: string | null; side: string }>(() => ({ text: null, side: "" }));

export function BetterMoveHint() {
  const { text, side } = useBetterMove();
  if (!text) return null;
  return (
    <div className="panel better-move" role="status">
      <span>
        {t("Try the better move for {side}:", { side })} <strong>{text}</strong>
      </span>
      <button className="quiet" title={t("Close")} onClick={() => useBetterMove.setState({ text: null })}>
        ✕
      </button>
    </div>
  );
}
