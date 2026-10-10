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
  // Which army each unit is in, as the player has it: the split as read, swapped, units moved across (UX 473).
  // A new save mounts a new component (TtsImport keys it), so these start fresh.
  const [swapped, setSwapped] = useState(false);
  const [moved, setMoved] = useState<Set<number>>(new Set());
  if (!scan) return null;
  const placed = scan.units.filter((u) => u.placed);
  if (!scan.terrain.length && !scan.units.length) return null;
  const sideOf = (i: number): 0 | 1 => (scan.units[i]!.side ^ +swapped ^ +moved.has(i)) as 0 | 1;
  const chosen = { ...scan, units: scan.units.map((u, i) => ({ ...u, side: sideOf(i) })) };
  const sides = new Set(chosen.units.map((u) => u.side)).size;
  const move = (i: number) => {
    const next = new Set(moved);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setMoved(next);
  };

  const bring = async (play: boolean) => {
    let brought: BroughtTable;
    try {
      brought = await bringTable(chosen, system, folder, setProgress);
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
    if (brought.lost.length) {
      const names =
        brought.lost.length > 4
          ? t("{names} and {n} more", {
              names: brought.lost.slice(0, 4).join(", "),
              n: brought.lost.length - 4,
            })
          : brought.lost.join(", ");
      parts.push(
        tn(
          brought.lost.length,
          "{names} couldn't be downloaded or read: a figure stands in on a plain base, terrain is left out.",
          "{names} couldn't be downloaded or read: figures stand in on plain bases, terrain is left out.",
          { names },
        ),
      );
      if (brought.missing && !folder)
        parts.push(t("Pick your TTS folder after loading the save in TTS once, and they come from there."));
    }
    if (brought.off)
      parts.push(
        tn(brought.off, "{n} thing stood off this game's table.", "{n} things stood off this game's table."),
      );
    onDone(parts.join(" "));
    if (play) {
      // The game opens behind the library; with something to tell the player, the note stays up until they close it.
      if (!brought.lost.length && !brought.off) closeLibrary();
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
      {chosen.units.length > 0 && (
        <div className="tts-sides">
          {([0, 1] as const).map((side) => (
            <div key={side} className="row wrap small">
              <strong>{side === 0 ? t("Player 1:") : t("Player 2:")}</strong>
              {chosen.units.map((u, i) =>
                u.side === side ? (
                  <button
                    key={i}
                    className="chip small"
                    title={side === 0 ? t("Move to Player 2") : t("Move to Player 1")}
                    onClick={() => move(i)}
                  >
                    {u.placed ? u.name : t("{name} (in a bag)", { name: u.name })} ⇄
                  </button>
                ) : null,
              )}
              {!chosen.units.some((u) => u.side === side) && (
                <span className="muted">{t("the game's sample army")}</span>
              )}
            </div>
          ))}
          <button className="small" onClick={() => setSwapped(!swapped)}>
            {t("Swap sides")}
          </button>
        </div>
      )}
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
