import { useMemo, useState } from "react";
import { listSystems } from "../core/content";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { closeLibrary } from "../figures/open";
import type { TtsFolder } from "../figures/tts";
import { t, tn } from "../i18n";
import { bringTable, type BroughtTable } from "./bring";
import { openTtsGame } from "./open";
import { scanTable } from "./table";

/**
 * The rest of a TTS save (#73), below its models in the figure library: the
 * terrain as a saved table and the armies on it as shelf armies, or straight
 * into a game of the system the player picks with both armies placed.
 */
export function TtsWholeTable({
  save,
  folder,
  busy,
  onDone,
}: {
  save: unknown;
  folder: TtsFolder | null;
  busy: boolean;
  onDone: (note: string) => void;
}) {
  const scan = useMemo(() => {
    try {
      return save ? scanTable(save) : null;
    } catch {
      return null;
    }
  }, [save]);
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [progress, setProgress] = useState<string | null>(null);
  if (!scan) return null;
  const placed = scan.units.filter((u) => u.placed);
  const sides = new Set(scan.units.map((u) => u.side)).size;
  if (!scan.terrain.length && !scan.units.length) return null;

  const bring = async (play: boolean) => {
    let brought: BroughtTable;
    try {
      brought = await bringTable(scan, system, folder, setProgress);
    } finally {
      setProgress(null);
    }
    const parts = [
      tn(
        brought.table.layout.terrain.length,
        "Saved {save} to your tables with {n} piece of terrain",
        "Saved {save} to your tables with {n} pieces of terrain",
        { save: scan.title },
      ),
      tn(brought.armies.length, "and {n} army to your shelf.", "and {n} armies to your shelf.", {}),
    ];
    if (brought.missing)
      parts.push(
        tn(
          brought.missing,
          "{n} model wasn't in your TTS folder and couldn't be downloaded.",
          "{n} models weren't in your TTS folder and couldn't be downloaded.",
        ),
      );
    if (brought.failed) parts.push(tn(brought.failed, "{n} couldn't be read.", "{n} couldn't be read."));
    if (brought.off)
      parts.push(
        tn(brought.off, "{n} thing stood off this game's table.", "{n} things stood off this game's table."),
      );
    onDone(parts.join(" "));
    if (play) {
      closeLibrary();
      openTtsGame(brought);
    }
  };

  return (
    <div className="tts-table">
      <h3>{t("The whole table")}</h3>
      <p className="small">
        {[
          tn(scan.terrain.length, "{n} piece of terrain", "{n} pieces of terrain"),
          tn(placed.length, "{n} unit on the table", "{n} units on the table"),
          ...(scan.units.length > placed.length
            ? [tn(scan.units.length - placed.length, "{n} still in a bag", "{n} still in bags")]
            : []),
          tn(sides, "{n} army", "{n} armies"),
        ].join(", ")}
        .{" "}
        {t(
          "Terrain and armies come in where they stand in TTS. Stats come from the models' descriptions where they can be read; anything else is for you to fill in.",
        )}
      </p>
      <div className="row wrap">
        <label>
          {t("Game")}{" "}
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            {listSystems().map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !!progress} onClick={() => void bring(true)}>
          {t("Open it as a game")}
        </button>
        <button className="quiet" disabled={busy || !!progress} onClick={() => void bring(false)}>
          {t("Save the table and armies")}
        </button>
      </div>
      {progress && <p className="muted small">{progress}</p>}
    </div>
  );
}
