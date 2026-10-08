import { useMemo, useState } from "react";
import { VIEWER } from "../viewer/flag";
import { create } from "zustand";
import { stateAt, type GameRecord } from "../core";
import { momentsOf, type Moment } from "../core/moments";
import { t } from "../i18n";
import { useStore } from "../store";
import { useReel } from "../broadcast/reel";
import { playMoment, stopMoment } from "../broadcast/Moments";
import { readGame, replayIntro } from "../ui/highlights";
import { battleOver } from "../ui/StatsScreen";
import { voiceStreams } from "../voice/voice";
import { grabTable, settle } from "./capture";
import { endCard, pngOf, roundCard, saveFile, stamp } from "./cards";
import { canRecord, startClip, type Recording } from "./clip";

/**
 * Share the battle (#46): one panel for everything that leaves the app. The
 * replay as a web page that opens anywhere, a clip of the reel or of a
 * stretch of the replay, and pictures: the end-of-game card and a card for
 * each round.
 */

interface ShareState {
  open: boolean;
  /** What is being made now, said in the panel (or on the recording pill). */
  busy: string | null;
  recording: Recording | null;
  error: string | null;
}

export const useShare = create<ShareState>(() => ({ open: false, busy: null, recording: null, error: null }));

/** Look at the table at `seq` for a moment, take its picture, then put the scrubber back. */
async function tableAt(seq: number): Promise<HTMLCanvasElement | null> {
  const s = useStore.getState();
  const was = s.scrub;
  s.setScrub(seq);
  await settle();
  const picture = await grabTable();
  useStore.getState().setScrub(was);
  return picture;
}

const lastSeq = (record: GameRecord) => record.events.at(-1)?.seq ?? record.initial.seq;

async function saveEndCard() {
  const { record } = useStore.getState();
  const end = lastSeq(record);
  const picture = await tableAt(end);
  saveFile(await pngOf(endCard(record, stateAt(record, end), picture)), `${stamp()}-result.png`);
}

async function saveRoundCard(round: number) {
  const { record } = useStore.getState();
  const { rounds, highlights } = readGame(record);
  const summary = rounds.find((r) => r.round === round);
  if (!summary) return;
  const from = rounds.find((r) => r.round === round - 1)?.seq ?? record.initial.seq;
  // What happened: the round's moments first (they read best), then its highlights.
  const moments = momentsOf(record).filter((m) => m.round === round && m.kind !== "mvp");
  const marks = highlights.filter((h) => h.seq > from && h.seq <= summary.seq);
  const picture = await tableAt(summary.seq);
  const card = roundCard(stateAt(record, summary.seq), summary, [...moments, ...marks], picture);
  saveFile(await pngOf(card), `${stamp()}-round-${round}.png`);
}

/** Record while `play` runs the table, until it calls its `done`. */
function recordClip(play: (done: () => void) => void, sound: { sounds: boolean; voice: boolean }) {
  const rec = startClip(sound);
  if (!rec) {
    useShare.setState({ error: t("This browser can't record the table.") });
    return;
  }
  useShare.setState({ open: false, recording: rec, busy: t("Recording…") });
  play(() => void finishClip());
}

export async function finishClip() {
  const rec = useShare.getState().recording;
  if (!rec) return;
  useShare.setState({ recording: null, busy: t("Saving the clip…") });
  stopMoment();
  const blob = await rec.stop();
  useShare.setState({ busy: null });
  saveFile(blob, `${stamp()}.webm`);
}

/** The end-of-game reel, from its first card until it hands back to the stats. */
function playReel(done: () => void) {
  useStore.getState().set({ stats: false });
  useReel.setState({ index: 0, done: false });
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

export function SharePanel() {
  const open = useShare((s) => s.open);
  const busy = useShare((s) => s.busy);
  const error = useShare((s) => s.error);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const [sounds, setSounds] = useState(true);
  const [voice, setVoice] = useState(false);
  const [stretch, setStretch] = useState<"reel" | "round" | "game">("round");
  const final = useMemo(() => (open ? stateAt(record) : null), [open, record]);
  const rounds = useMemo(() => (open ? readGame(record).rounds : []), [open, record]);
  const reel = useMemo(() => (open ? momentsOf(record) : []), [open, record]);
  if (!open) return null;
  const over = !!final && battleOver(final);
  const last = lastSeq(record);
  const pos = scrub ?? last;
  // The end of the round the scrubber is in.
  const roundEnd = rounds.find((r) => r.seq > pos)?.seq ?? last;
  const talk = voiceStreams().length > 0;
  const run = (what: string, job: () => Promise<void>) => {
    useShare.setState({ busy: what, error: null });
    job()
      .catch((e: unknown) => useShare.setState({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => useShare.setState({ busy: null }));
  };
  const clip = () => {
    const sound = { sounds, voice: voice && talk };
    if (stretch === "reel") recordClip(playReel, sound);
    else {
      // From the end, a clip starts where the battle does.
      const from = pos >= last ? replayIntro(record).startSeq || record.initial.seq : pos;
      recordClip((done) => playStretch(from, stretch === "round" ? roundEnd : last, done), sound);
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
          <h4>{t("A web page")}</h4>
          <p className="muted small">
            {t("The whole replay with its figures in one file: it opens in any browser, even offline.")}
          </p>
          <button
            disabled={!!busy}
            onClick={() =>
              run(t("Making the page…"), async () => {
                const { exportPage } = await import("./page");
                await exportPage(useStore.getState().record);
              })
            }
          >
            {t("Download the replay page")}
          </button>
        </section>
      )}

      <section>
        <h4>{t("A clip")}</h4>
        {canRecord() ? (
          <>
            <div className="share-options">
              {reel.length > 0 && (
                <label>
                  <input type="radio" checked={stretch === "reel"} onChange={() => setStretch("reel")} />{" "}
                  {t("The highlights reel")}
                </label>
              )}
              <label>
                <input type="radio" checked={stretch === "round"} onChange={() => setStretch("round")} />{" "}
                {t("From here to the end of the round")}
              </label>
              <label>
                <input type="radio" checked={stretch === "game"} onChange={() => setStretch("game")} />{" "}
                {t("From here to the end of the game")}
              </label>
            </div>
            <div className="share-options">
              <label>
                <input type="checkbox" checked={sounds} onChange={(e) => setSounds(e.target.checked)} />{" "}
                {t("Dice and table sounds")}
              </label>
              {talk && (
                <label>
                  <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />{" "}
                  {t("Table talk")}
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
