import { useMemo, useState } from "react";
import { listSystems } from "../core/content";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { closeLibrary } from "../figures/open";
import type { TtsFolder } from "../figures/tts";
import { t, tn } from "../i18n";
import { bringTable, type BroughtTable } from "./bring";
import { hostTtsOnline } from "./online";
import { openTtsGame } from "./open";
import { readScriptedUnit } from "./scripted";
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
}: {
  save: unknown;
  folder: TtsFolder | null;
  busy: boolean;
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
  // What's saved already (UX 484): the next step plays it without importing again.
  const [saved, setSaved] = useState<{ brought: BroughtTable; note: string } | null>(null);
  // A Yellowscribe unit goes by the name in its script, as the game will call it (UX 490).
  const names = useMemo(
    () => scan?.units.map((u) => readScriptedUnit(u.models)?.name || u.name) ?? [],
    [scan],
  );
  if (!scan) return null;
  // What can't come across at all, said up front and on the game (PX TTS 3).
  const bundles = scan.bundles ?? [];
  const bundle = bundles.length
    ? tn(
        bundles.length,
        "{n} piece ({names}) is a Unity asset bundle and can't come across.",
        "{n} pieces ({names}) are Unity asset bundles and can't come across.",
        { names: bundles.map((b) => b || t("unnamed")).join(", ") },
      )
    : "";
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
    setSaved(null);
  };

  const play = (how: "here" | "online", brought: BroughtTable, note: string) => {
    // The table must be touchable at once (UX 478): the library closes and anything to tell goes on the game.
    closeLibrary();
    if (how === "here") openTtsGame(brought, note);
    else void hostTtsOnline(brought, note);
  };

  const bring = async (how: "here" | "online" | "save") => {
    if (saved && how !== "save") return play(how, saved.brought, saved.note);
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
    if (bundle) parts.push(bundle);
    if (brought.off)
      parts.push(
        tn(brought.off, "{n} thing stood off this game's table.", "{n} things stood off this game's table."),
      );
    const note = brought.lost.length || brought.off || bundle ? parts.slice(2).join(" ") : "";
    if (how === "save") setSaved({ brought, note: parts.join(" ") });
    else play(how, brought, note);
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
        . {bundle && `${bundle} `}
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
                    {u.placed ? names[i] : t("{name} (in a bag)", { name: names[i] })} ⇄
                  </button>
                ) : null,
              )}
              {!chosen.units.some((u) => u.side === side) && (
                <span className="muted">{t("the game's sample army")}</span>
              )}
            </div>
          ))}
          <button
            className="small"
            onClick={() => {
              setSwapped(!swapped);
              setSaved(null);
            }}
          >
            {t("Swap sides")}
          </button>
        </div>
      )}
      <div className="row wrap">
        <label>
          {t("Game")}{" "}
          <select
            value={system}
            onChange={(e) => {
              setSystem(e.target.value);
              setSaved(null);
            }}
          >
            {listSystems().map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy || !!progress} onClick={() => void bring("online")}>
          {t("Play it online with a friend")}
        </button>
        <button disabled={busy || !!progress} onClick={() => void bring("here")}>
          {t("Open it as a game")}
        </button>
        {!saved && (
          <button className="quiet" disabled={busy || !!progress} onClick={() => void bring("save")}>
            {t("Save the table and armies")}
          </button>
        )}
      </div>
      {progress && <p className="muted small">{progress}</p>}
      {saved && (
        <p className="small tts-saved" role="status">
          {saved.note}{" "}
          {t(
            "They're in the table library and on your army shelf: play it online or here, or pick them when you host.",
          )}
        </p>
      )}
    </div>
  );
}
