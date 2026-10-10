import { useRef, useState } from "react";
import { getCached } from "../assets/cache";
import { useAssets } from "../assets/store";
import { t, tn } from "../i18n";
import { useFigures, type FigureEntry } from "./library";
import { makeThumb, releaseThumbs } from "./thumb";
import { matchFromPhotos } from "./vision/client";
import { figuresFor, MAX_FIGURES } from "./vision/pick";
import { modelOf, useVision } from "./vision/settings";
import type { Assignment, MatchErrorCode, MatchUnit } from "./vision/types";

const KEYS_PAGE = "https://platform.openai.com/api-keys";

/** Draw the thumbnails the model will compare against, for figures that have none yet. */
async function ensureThumbs(entries: FigureEntry[]): Promise<FigureEntry[]> {
  const out: FigureEntry[] = [];
  try {
    for (const e of entries) {
      if (e.thumb) {
        out.push(e);
        continue;
      }
      const asset = useAssets.getState().assets[e.id] ?? (await getCached(e.id));
      const thumb = (asset && (await makeThumb(asset))) || "none";
      useFigures.getState().patch(e.id, { thumb });
      out.push({ ...e, thumb });
    }
  } finally {
    releaseThumbs();
  }
  return out;
}

const problem = (code: MatchErrorCode): string =>
  ({
    key: t("OpenAI didn't accept the key. Check it, or paste a new one."),
    quota: t("OpenAI says the key is out of credit or asked too often. Try again in a minute."),
    model: t("OpenAI doesn't offer that model to this key. Pick another under Settings."),
    photo: t("That photo couldn't be read. Try a JPEG or PNG."),
    network: t("Couldn't reach OpenAI. Check the connection."),
    answer: t("The model's answer couldn't be used. Try again, or with a clearer photo."),
    other: t("Matching from the photo didn't work."),
  })[code];

/**
 * "Match from a photo" in the army import (lazy): the player's own OpenAI key
 * looks at their painted army and proposes a library figure for each unit.
 * The proposals land in the import table's Figure column, to check before deploying.
 */
export default function PhotoMatch({
  units,
  library,
  onMatch,
}: {
  units: MatchUnit[];
  library: FigureEntry[];
  onMatch: (assignments: Assignment[]) => void;
}) {
  const vision = useVision();
  const key = vision.keys[vision.provider];
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    if (!key || !photos.length) return;
    setBusy(true);
    setNote(null);
    abort.current = new AbortController();
    try {
      const figures = await ensureThumbs(
        figuresFor(
          library,
          units.map((u) => u.name),
        ),
      );
      const r = await matchFromPhotos(
        {
          provider: vision.provider,
          key,
          model: modelOf(vision),
          photos,
          units,
          figures: figures.map((f) => ({
            id: f.id,
            name: f.name,
            tags: f.tags,
            ...(f.thumb && f.thumb !== "none" ? { thumb: f.thumb } : {}),
          })),
        },
        abort.current.signal,
      );
      if (abort.current.signal.aborted) return;
      if (!r.ok) {
        setNote({ text: problem(r.code), warn: true });
        if (r.detail) console.warn("Photo match:", r.detail);
        return;
      }
      onMatch(r.assignments);
      setNote({
        text: r.assignments.length
          ? tn(
              r.assignments.length,
              "The photo matched {n} unit. Check the Figure column before deploying.",
              "The photo matched {n} units. Check the Figure column before deploying.",
            )
          : t("No library figure looked like the units in the photo."),
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  if (!key)
    return (
      <div className="photo-match">
        <p className="small">
          {t(
            "Paste an OpenAI API key and a photo of your painted army can pick library figures for its units. The key stays on this device and goes only to OpenAI; matching costs a little on your OpenAI account.",
          )}{" "}
          <a href={KEYS_PAGE} target="_blank" rel="noreferrer">
            {t("Get a key")}
          </a>
        </p>
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            vision.setKey(draft);
            setDraft("");
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…" // i18n-ignore
            aria-label={t("OpenAI API key")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="small" disabled={!draft.trim()}>
            {t("Keep the key")}
          </button>
        </form>
      </div>
    );

  return (
    <div className="photo-match">
      <p className="row wrap">
        <label className="small">
          {t("Photos of your army")}{" "}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 4))}
          />
        </label>
        <button className="small" disabled={busy || !photos.length} onClick={() => void run()}>
          {busy ? t("Looking at the photo…") : t("Match")}
        </button>
        {busy && (
          <button className="quiet small" onClick={() => abort.current?.abort()}>
            {t("Stop")}
          </button>
        )}
      </p>
      {note && <p className={note.warn ? "warn small" : "small"}>{note.text}</p>}
      <details className="small">
        <summary>{t("Settings")}</summary>
        <p className="row wrap">
          <label>
            {t("Model")}{" "}
            <input
              className="photo-match-model"
              defaultValue={modelOf(vision)}
              spellCheck={false}
              onBlur={(e) => vision.setModel(e.target.value)}
            />
          </label>
          <button className="quiet small" onClick={() => vision.forget()}>
            {t("Forget the key")}
          </button>
        </p>
        <p className="muted">
          {t(
            "The photos, the unit names and pictures of up to {n} library figures go to OpenAI with your key. Nothing goes to the other players.",
            { n: MAX_FIGURES },
          )}
        </p>
      </details>
    </div>
  );
}
