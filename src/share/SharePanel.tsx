import { useMemo, useState } from "react";
import { VIEWER } from "../viewer/flag";
import { stateAt, type GameRecord } from "../core";
import { momentsOf, type Moment } from "../core/moments";
import { t } from "../i18n";
import { useStore } from "../store";
import { useReel } from "../broadcast/reel";
import { playMoment, reelLength, startReel, stopMoment, stretchLength } from "../broadcast/Moments";
import { lossesBetween, readGame, replayIntro } from "../ui/highlights";
import { battleOver } from "../ui/StatsScreen";
import { voiceStreams } from "../voice/voice";
import { grabTable, settle } from "./capture";
import { endCard, pngOf, result, roundCard, stamp, standouts } from "./cards";
import { saveFile } from "../ui/files";
import { siteUrl } from "./site";
import { downloadReplay } from "../ui/Hud";
import { shot } from "../render/focus";
import { canRecord, defaultShape, startClip, type ClipShape } from "./clip";
import { useShare } from "./store";

/**
 * Share the battle (#46): one panel for everything that leaves the app. The
 * replay as a web page that opens anywhere, a clip of the reel or of a
 * stretch of the replay, and pictures: the end-of-game card and a card for
 * each round.
 */

/**
 * Look at the table at `seq` for a moment, take its picture, then put the
 * scrubber back. With a moment, the camera frames its units (PX share 3)
 * rather than the whole table.
 */
async function tableAt(
  seq: number,
  moment?: Moment,
  subject?: { x: number; y: number; span: number } | null,
): Promise<HTMLCanvasElement | null> {
  const s = useStore.getState();
  const was = { scrub: s.scrub, director: s.director };
  s.set({ director: false });
  s.setScrub(seq);
  // With no moment, the whole table, closer than the screen's view: the card's picture is narrower than a screen.
  const { width, depth } = s.game.table;
  const frame = (moment ? momentFrame(s.record, moment) : null) ??
    subject ?? {
      x: 0,
      y: 0,
      span: Math.max(width, depth) * 0.25,
    };
  shot.request = frame;
  shot.capturing++;
  await settle();
  const picture = await grabTable();
  shot.capturing--;
  shot.restore = true;
  useStore.getState().setScrub(was.scrub);
  useStore.getState().set({ director: was.director });
  return picture;
}

/** Where a moment happened: the middle of the models it involved, and how far they spread. */
function momentFrame(record: GameRecord, m: Moment): { x: number; y: number; span: number } | null {
  const state = stateAt(record, Math.max(m.seq, m.end));
  const units = new Set(m.units);
  const models = new Set<string>();
  for (const { seq, event } of record.events) {
    if (seq < m.seq || seq > Math.max(m.seq, m.end)) continue;
    const e = event as Record<string, unknown> & {
      attack?: { spec?: { attackerUnitId?: string; targetUnitId?: string } };
      roll?: { unitId?: string };
    };
    for (const id of [
      e.attack?.spec?.attackerUnitId,
      e.attack?.spec?.targetUnitId,
      e.roll?.unitId,
      e.unitId,
      e.targetId,
    ])
      if (typeof id === "string" && state.units[id]) units.add(id);
    if (typeof e.id === "string" && state.models[e.id]) models.add(e.id);
  }
  for (const u of units) for (const id of state.units[u]?.modelIds ?? []) models.add(id);
  // Where they stood when it began: the fallen are moved off to a casualty pile by the end (PX share).
  const start = stateAt(record, m.seq);
  const at = [...models].flatMap((id) => {
    const model = state.models[id]?.destroyed ? start.models[id] : state.models[id];
    return model && !model.destroyed ? [model.position] : [];
  });
  if (!at.length) return null;
  const x = at.reduce((n, p) => n + p.x, 0) / at.length;
  const y = at.reduce((n, p) => n + p.y, 0) / at.length;
  const span = Math.max(4, ...at.map((p) => 2 * Math.hypot(p.x - x, p.y - y)));
  return { x, y, span };
}

const lastSeq = (record: GameRecord) => record.events.at(-1)?.seq ?? record.initial.seq;

async function saveEndCard() {
  const { record } = useStore.getState();
  const end = lastSeq(record);
  // The picture is the decisive moment as it happened; the words are the result.
  const { decisive } = standouts(record);
  // With none, the unit that lost the most (PX): the game's story, not a deployment corner.
  const most = lossesBetween(record, record.initial.seq, end)[0]?.at;
  const picture = decisive
    ? await tableAt(Math.max(decisive.seq, decisive.end), decisive, most)
    : await tableAt(end, undefined, most);
  saveFile(await pngOf(endCard(record, stateAt(record, end), picture)), `${stamp()}-result.png`);
}

async function saveRoundCard(round: number) {
  const { record } = useStore.getState();
  const { rounds, highlights } = readGame(record);
  const summary = rounds.find((r) => r.round === round);
  if (!summary) return;
  const from = rounds.find((r) => r.round === round - 1)?.seq ?? record.initial.seq;
  // What happened: the round's moments first (they read best), then its highlights.
  // Moments that ended this round: a story that runs to the game's end (Last one standing) isn't round 1's (UX 56).
  const moments = momentsOf(record).filter((m) => {
    const done = Math.max(m.seq, m.end);
    return m.kind !== "mvp" && done > from && done <= summary.seq;
  });
  const marks = highlights.filter((h) => h.seq > from && h.seq <= summary.seq);
  const top = [...moments].sort((a, b) => b.score - a.score)[0];
  // Who lost models this round is part of what happened (UX 339), and the picture is on them when nothing stood out.
  const losses = lossesBetween(record, from, summary.seq);
  const hurt = losses.filter((l) => l.highlight.kind === "losses").map((l) => l.highlight);
  const said = [...moments, ...marks, ...hurt].slice(0, Math.max(3, moments.length + marks.length));
  const picture = top
    ? await tableAt(Math.max(top.seq, top.end), top, losses[0]?.at)
    : await tableAt(summary.seq, undefined, losses[0]?.at);
  const card = roundCard(stateAt(record, summary.seq), summary, said, picture);
  saveFile(await pngOf(card), `${stamp()}-round-${round}.png`);
}

/** The director's setting while a clip records, put back after. */
let directorWas: boolean | null = null;

/** Record while `play` runs the table, until it calls its `done`. */
function recordClip(
  play: (done: () => void) => void,
  sound: { sounds: boolean; voice: boolean },
  shape: ClipShape,
) {
  const rec = startClip(sound, shape, () => {
    const { record } = useStore.getState();
    return { ...result(stateAt(record)), url: siteUrl() };
  });
  if (!rec) {
    useShare.setState({ error: t("This browser can't record the table.") });
    return;
  }
  // The camera follows the action while it records, as the reel does (UX 337).
  directorWas = useStore.getState().director;
  useStore.getState().set({ director: true, stats: false });
  useShare.setState({ open: false, recording: rec, busy: t("Recording…") });
  play(() => void finishClip());
}

async function finishClip() {
  const rec = useShare.getState().recording;
  if (!rec) return;
  useShare.setState({ recording: null, busy: t("Saving the clip…") });
  stopMoment();
  const blob = await rec.stop();
  if (directorWas !== null) useStore.getState().set({ director: directorWas });
  directorWas = null;
  useShare.setState({ busy: null });
  saveFile(blob, `${stamp()}.webm`);
}

/** The end-of-game reel, from its first card until it hands back to the stats. */
function playReel(done: () => void) {
  startReel();
  const stop = useReel.subscribe((s) => {
    if (s.index !== null) return;
    stop();
    done();
  });
}

/** A stretch of the replay, played at replay pace with the dice and cards, from `from` to `to`. */
function playStretch(from: number, to: number, done: () => void) {
  const stretch: Moment = {
    kind: "swing",
    seq: from,
    end: to,
    round: 0,
    when: "",
    title: "",
    line: "",
    units: [],
    score: 0,
  };
  playMoment(stretch, done);
}

type Stretch = "reel" | "here-round" | "here-game" | "whole" | "round";

/** "about 30 s": a length to say before recording (UX 338). */
const about = (ms: number) => t("about {n} s", { n: Math.max(5, Math.round(ms / 5000) * 5) });

export function SharePanel() {
  const open = useShare((s) => s.open);
  const busy = useShare((s) => s.busy);
  const error = useShare((s) => s.error);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const [sounds, setSounds] = useState(true);
  const [voice, setVoice] = useState(false);
  const [shape, setShape] = useState<ClipShape>(defaultShape);
  const [choice, setChoice] = useState<Stretch | null>(null);
  const [round, setRound] = useState<number | null>(null);
  const final = useMemo(() => (open ? stateAt(record) : null), [open, record]);
  const rounds = useMemo(() => (open ? readGame(record).rounds : []), [open, record]);
  const reel = useMemo(() => (open ? momentsOf(record) : []), [open, record]);
  if (!open) return null;
  const over = !!final && battleOver(final);
  const last = lastSeq(record);
  const pos = scrub ?? last;
  const start = replayIntro(record).startSeq || record.initial.seq;
  // At the end (or live), "from here" means nothing: offer the whole battle or a round (UX 338).
  const atEnd = pos >= last;
  const roundEnd = rounds.find((r) => r.seq > pos)?.seq ?? last;
  const shownRound = round ?? rounds.at(-1)?.round ?? null;
  const roundSpan = (n: number): [number, number] => {
    const at = rounds.findIndex((r) => r.round === n);
    return [at > 0 ? rounds[at - 1]!.seq + 1 : start, rounds[at]?.seq ?? last];
  };
  const spans: Partial<Record<Stretch, [number, number]>> = atEnd
    ? { whole: [start, last], ...(shownRound !== null ? { round: roundSpan(shownRound) } : {}) }
    : { "here-round": [pos, roundEnd], "here-game": [pos, last] };
  const options: Stretch[] = [
    ...(Object.keys(spans) as Stretch[]),
    ...(reel.length ? (["reel"] as const) : []),
  ];
  const stretch = choice && options.includes(choice) ? choice : options[0]!;
  const length = (s: Stretch) =>
    s === "reel" ? reelLength(record) : spans[s] ? stretchLength(record, ...spans[s]!) : 0;
  const labels: Record<Stretch, string> = {
    reel: t("The highlights reel"),
    "here-round": t("From here to the end of the round"),
    "here-game": t("From here to the end of the game"),
    whole: t("The whole battle"),
    round: t("A round"),
  };
  const talk = voiceStreams().length > 0;
  const run = (what: string, job: () => Promise<void>) => {
    useShare.setState({ busy: what, error: null });
    job()
      .catch((e: unknown) => useShare.setState({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => useShare.setState({ busy: null }));
  };
  const clip = () => {
    const sound = { sounds, voice: voice && talk };
    if (stretch === "reel") recordClip(playReel, sound, shape);
    else {
      const [from, to] = spans[stretch]!;
      recordClip((done) => playStretch(from, to, done), sound, shape);
    }
  };
  return (
    <div className="panel share-panel" role="dialog" aria-label={t("Share the battle")}>
      <div className="row spread">
        <strong>{t("Share the battle")}</strong>
        <button className="quiet" title={t("Close")} onClick={() => useShare.setState({ open: false })}>
          ✕
        </button>
      </div>

      {!VIEWER && (
        <section>
          <h4>{t("The replay")}</h4>
          {/* Two downloads, each saying what it's for (UX 343). */}
          <div className="share-download">
            <button
              disabled={!!busy}
              onClick={() =>
                run(t("Making the page…"), async () => {
                  const { exportPage } = await import("./page");
                  await exportPage(useStore.getState().record);
                })
              }
            >
              {t("Web page")}
            </button>
            <span className="muted small">{t("Opens in any browser, even offline: send it to anyone.")}</span>
          </div>
          <div className="share-download">
            <button disabled={!!busy} onClick={() => void downloadReplay(useStore.getState().record)}>
              {t("Replay file")}
            </button>
            <span className="muted small">{t("Opens in Open Battle, with notes and What if…")}</span>
          </div>
        </section>
      )}

      <section>
        <h4>{t("A clip")}</h4>
        {canRecord() ? (
          <>
            <div className="share-options" role="radiogroup" aria-label={t("What to record")}>
              {options.map((s) => (
                <label key={s}>
                  <input type="radio" checked={stretch === s} onChange={() => setChoice(s)} />
                  <span>
                    {labels[s]}
                    {s === "round" && shownRound !== null && (
                      <select
                        aria-label={t("Round")}
                        value={shownRound}
                        onChange={(e) => {
                          setRound(Number(e.target.value));
                          setChoice("round");
                        }}
                      >
                        {rounds.map((r) => (
                          <option key={r.round} value={r.round}>
                            {t("Round {n}", { n: r.round })}
                          </option>
                        ))}
                      </select>
                    )}{" "}
                    <span className="muted small">{about(length(s))}</span>
                  </span>
                </label>
              ))}
              {!reel.length && (
                <p className="muted small">{t("No highlights reel: this game had no standout moments.")}</p>
              )}
            </div>
            {/* The clip's shape, apart from what to record (UX 353): a label and three segments. */}
            <div className="share-shape">
              <span className="muted small" id="share-shape-label">
                {t("Shape")}
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="share-shape-label">
                {(
                  [
                    ["wide", t("Wide"), t("16:9, for screens and video sites")],
                    ["square", t("Square"), t("1:1, for feeds")],
                    ["tall", t("Tall"), t("9:16, for stories")],
                  ] as const
                ).map(([id, label, about]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={shape === id}
                    className={shape === id ? "on" : ""}
                    title={about}
                    onClick={() => setShape(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="share-options">
              <label>
                <input type="checkbox" checked={sounds} onChange={(e) => setSounds(e.target.checked)} />{" "}
                <span>{t("Dice and table sounds")}</span>
              </label>
              {talk && (
                <label>
                  <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />{" "}
                  <span>{t("Table talk")}</span>
                </label>
              )}
            </div>
            <button className="primary" disabled={!!busy} onClick={clip}>
              ● {t("Record")}
            </button>
          </>
        ) : (
          <p className="muted small">{t("This browser can't record the table.")}</p>
        )}
      </section>

      <section>
        <h4>{t("Pictures")}</h4>
        <div className="row wrap">
          {over && (
            <button disabled={!!busy} onClick={() => run(t("Drawing the card…"), saveEndCard)}>
              {t("End-of-game card")}
            </button>
          )}
          {rounds.map((r) => (
            <button
              key={r.round}
              disabled={!!busy}
              onClick={() => run(t("Drawing the card…"), () => saveRoundCard(r.round))}
            >
              {t("Round {n}", { n: r.round })}
            </button>
          ))}
          {!over && !rounds.length && (
            <p className="muted small">{t("Cards come once a round has ended.")}</p>
          )}
        </div>
      </section>
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="warn small">{error}</p>}
    </div>
  );
}

/** While a clip records: what's happening, and Stop. Not in the clip itself. */
export function RecordingPill() {
  const recording = useShare((s) => s.recording);
  const busy = useShare((s) => s.busy);
  if (!recording && !busy) return null;
  if (!recording) return <div className="recording-pill">{busy}</div>;
  return (
    <div className="recording-pill" role="status">
      <span className="dot" /> {t("Recording")}
      <button onClick={() => void finishClip()}>{t("Stop")}</button>
    </div>
  );
}
