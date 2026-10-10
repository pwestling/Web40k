import { useState } from "react";
import { useAssets } from "../assets/store";
import type { AssetKind } from "../assets/types";
import { t, tn } from "../i18n";
import { useFigures } from "./library";
import { downloadUrl, indexFolder, scanSave, type TtsFolder, type TtsScan } from "./tts";

/**
 * Figures from Tabletop Simulator: open a save or a workshop mod, and every
 * custom model on its table, in its bags and states comes into the library,
 * painted and at its TTS size. The files come from the player's own TTS
 * folder, where TTS keeps a copy of everything it has downloaded; anything
 * not there is downloaded, where its host lets a web page do that.
 */
/** `onDone` gets a line saying what came in, and draws the new thumbnails. */
export function TtsImport({ onDone }: { onDone: (note: string) => void }) {
  const [folder, setFolder] = useState<TtsFolder | null>(null);
  const [scan, setScan] = useState<TtsScan | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [kinds, setKinds] = useState<Record<string, AssetKind>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const pickFolder = async (files: FileList) => {
    const list = Array.from(files);
    const infos = await Promise.all(
      list
        .filter((f) => /^(SaveFileInfos|WorkshopFileInfos)\.json$/i.test(f.name))
        .map((f) =>
          f
            .text()
            .then((s) => JSON.parse(s) as unknown)
            .catch(() => null),
        ),
    );
    const index = indexFolder(list, infos);
    setFolder(index);
    setError(
      index.files || index.saves.length
        ? null
        : t(
            "No Tabletop Simulator files there. Pick the folder called Tabletop Simulator, in Documents, My Games.",
          ),
    );
  };

  const openSave = async (file: File) => {
    setError(null);
    try {
      const next = scanSave(JSON.parse(await file.text()));
      setScan(next);
      setSkip(new Set());
      setKinds({});
      if (!next.models.length) setError(t("That save has no custom models in it."));
    } catch (err) {
      setScan(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const chosen = scan?.models.filter((m) => !skip.has(m.key)) ?? [];

  const run = async () => {
    if (!scan) return;
    let added = 0;
    let missing = 0;
    let failed = 0;
    const { importFile } = useAssets.getState();
    for (const [i, m] of chosen.entries()) {
      setProgress(t("Importing {n} of {total}: {name}", { n: i + 1, total: chosen.length, name: m.name }));
      const mesh = folder?.find(m.mesh, "model") ?? (await download(m.mesh));
      if (!mesh) {
        missing++;
        continue;
      }
      const texture = m.diffuse
        ? (folder?.find(m.diffuse, "image") ?? (await download(m.diffuse)))
        : undefined;
      const asset = await importFile(
        new File([mesh], `${m.name}.obj`),
        `library:tts:${m.key}`,
        kinds[m.key] ?? m.kind,
        { ...(texture ? { texture } : {}), unitScale: m.scale },
      );
      if (!asset) {
        failed++;
        continue;
      }
      added++;
      // TTS's own names let army units find the figure by name; no picture matching needed.
      const { entries, patch } = useFigures.getState();
      const entry = entries[asset.id];
      patch(asset.id, {
        tags: [...new Set([...(entry?.tags ?? []), "tts", scan.title.toLowerCase()])],
        units: [...new Set([...(entry?.units ?? []), ...m.names])].slice(0, 40),
        ...(m.description && !entry?.description ? { description: m.description } : {}),
      });
    }
    setProgress(null);
    const parts = [
      tn(added, "Added {n} model from {save}.", "Added {n} models from {save}.", { save: scan.title }),
    ];
    if (missing)
      parts.push(
        tn(
          missing,
          "{n} wasn't in your TTS folder and couldn't be downloaded: load the save in TTS once, then pick the folder again.",
          "{n} weren't in your TTS folder and couldn't be downloaded: load the save in TTS once, then pick the folder again.",
        ),
      );
    if (failed) parts.push(tn(failed, "{n} couldn't be read.", "{n} couldn't be read."));
    onDone(parts.join(" "));
    setScan(null);
  };

  return (
    <div className="tts-import">
      <p className="small">
        {t(
          "Bring the models from a Tabletop Simulator save or workshop mod into your library. Pick your Tabletop Simulator folder (Documents, My Games) so the files TTS already downloaded are read from your computer; with only a save, each model is downloaded if its host allows it.",
        )}
      </p>
      <div className="row wrap">
        <label className="file button">
          {t("Pick your TTS folder…")}
          <input
            type="file"
            // Folder picking: React has no typed prop for it.
            {...{ webkitdirectory: "", directory: "" }}
            onChange={(e) => {
              if (e.target.files) void pickFolder(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {folder && folder.saves.length > 0 && (
          <select
            aria-label={t("Save or mod")}
            defaultValue=""
            onChange={(e) => {
              const s = folder.saves[Number(e.target.value)];
              if (s) void openSave(s.file);
            }}
          >
            <option value="" disabled>
              {tn(folder.saves.length, "Choose from {n} save or mod…", "Choose from {n} saves and mods…")}
            </option>
            {folder.saves.map((s, i) => (
              <option key={i} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <label className="file button quiet">
          {t("Open a save file…")}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void openSave(f);
            }}
          />
        </label>
      </div>
      {folder && (
        <p className="muted small">
          {tn(folder.files, "Your TTS folder has {n} cached file.", "Your TTS folder has {n} cached files.")}
        </p>
      )}
      {error && <p className="small">{error}</p>}
      {scan && scan.models.length > 0 && (
        <>
          <h3>{scan.title}</h3>
          <ul className="tts-models">
            {scan.models.map((m) => {
              const local = folder?.find(m.mesh, "model");
              return (
                <li key={m.key} className="row">
                  <label className="row grow">
                    <input
                      type="checkbox"
                      checked={!skip.has(m.key)}
                      onChange={(e) => {
                        const next = new Set(skip);
                        if (e.target.checked) next.delete(m.key);
                        else next.add(m.key);
                        setSkip(next);
                      }}
                    />
                    <span>
                      {m.name}
                      {m.count > 1 && <span className="muted"> ×{m.count}</span>}
                    </span>
                  </label>
                  <span className="muted small">{local ? t("on this computer") : t("to download")}</span>
                  <select
                    aria-label={t("Kind")}
                    value={kinds[m.key] ?? m.kind}
                    onChange={(e) => setKinds({ ...kinds, [m.key]: e.target.value as AssetKind })}
                  >
                    <option value="miniature">{t("Figure")}</option>
                    <option value="terrain">{t("Terrain")}</option>
                  </select>
                </li>
              );
            })}
          </ul>
          {scan.bundles > 0 && (
            <p className="muted small">
              {tn(
                scan.bundles,
                "{n} object is a Unity asset bundle, which only TTS can read; it's left out.",
                "{n} objects are Unity asset bundles, which only TTS can read; they're left out.",
              )}
            </p>
          )}
          <div className="row wrap">
            <button disabled={!!progress || !chosen.length} onClick={() => void run()}>
              {tn(chosen.length, "Add {n} model to the library", "Add {n} models to the library")}
            </button>
            <button
              className="quiet"
              disabled={!!progress}
              onClick={() => setSkip(new Set(chosen.length ? scan.models.map((m) => m.key) : []))}
            >
              {chosen.length ? t("Pick none") : t("Pick all")}
            </button>
          </div>
          {progress && <p className="muted small">{progress}</p>}
        </>
      )}
    </div>
  );
}

/** A file from the web, if its host lets this page have it. */
async function download(url: string): Promise<Blob | undefined> {
  try {
    const r = await fetch(downloadUrl(url));
    return r.ok ? await r.blob() : undefined;
  } catch {
    return undefined;
  }
}
