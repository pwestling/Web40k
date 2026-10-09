import { useEffect, useState } from "react";
import { DEFAULT_SYSTEM } from "../core";
import { getSystem } from "../core/content/systems";
import { automateArmy } from "../systems/wh40k/recognize";
import { RIFT_LANTERNS } from "../games/riftLanterns";
import { t, tn } from "../i18n";
import { ARMY_FORMAT, useShelf, type SavedArmy } from "../packages/shelf";
import { systemModule } from "../systems";
import type { ImportedRoster } from "../systems/wh40k/roster";
import type { Level } from "./player";
import { characterName, levelName } from "./solo";
import { matchPoints, pointsOf } from "./matchPoints";
import { startSolo } from "./startSolo";

/**
 * "Your army" (#56, PX dogfood 1): after How hard?, the army the player
 * fields against the computer: the sample army, one off their shelf, or a
 * roster read now. The computer fields its sample army. A big gap in points
 * is noted beside the army, never blocked.
 */
export function YourArmy({ system, level, onBack }: { system: string; level: Level; onBack: () => void }) {
  const { armies, load, put } = useShelf();
  const [error, setError] = useState<string | null>(null);
  // A roster just read: one line to check before the game starts (UX 408).
  const [picked, setPicked] = useState<ImportedRoster | null>(null);
  const [kept, setKept] = useState<SavedArmy | null>(null);
  useEffect(() => {
    void load();
  }, [load]);
  const shelf = Object.values(armies)
    // The default game's armies are shelved with no system named.
    .filter((a) => (a.system || DEFAULT_SYSTEM) === system)
    .sort((a, b) => b.savedAt - a.savedAt);
  // Rift Lanterns' module loads with the game; its warbands are close enough in size to need no note.
  const module = system === RIFT_LANTERNS ? null : systemModule(system);
  const sample = module?.sample(0);
  const theirs = module ? pointsOf(module.sample(1)) : 0;
  const gap = (pts: number) =>
    theirs && pts && Math.abs(pts - theirs) > 0.25 * Math.min(pts, theirs)
      ? t("the computer's army is {n} pts", { n: theirs })
      : null;
  const read = async (file: File) => {
    setError(null);
    try {
      // The BattleScribe reader loads only when a roster is picked.
      const parse = module?.importRoster ?? (await import("../systems/wh40k/roster")).parseRosterFile;
      const roster = await parse(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!roster.units.length) return setError(t("That file has no units this game can read."));
      setKept(null);
      setPicked(roster);
    } catch {
      setError(t("That file has no units this game can read."));
    }
  };
  if (picked) {
    const pts = pointsOf(picked);
    const keep = () => {
      let roster = picked;
      try {
        // Shelved, it keeps its rules ticked as a roster read at the table gets them (UX 370).
        if (picked.army) roster = { ...picked, army: automateArmy(picked.army, getSystem(system)) };
      } catch {
        // A game whose rules aren't loaded: the army goes on the shelf as read.
      }
      const army: SavedArmy = {
        format: ARMY_FORMAT,
        id: crypto.randomUUID(),
        name: picked.name,
        system: system === DEFAULT_SYSTEM ? "" : system,
        savedAt: Date.now(),
        roster,
        figures: {},
      };
      put(army);
      setKept(army);
    };
    const start = (cut?: ImportedRoster) =>
      startSolo(system, level, {
        ...(kept ? { roster: kept.roster, shelf: kept } : { roster: picked }),
        ...(cut ? { theirs: cut } : {}),
      });
    // About 2 to 1 either way is said in words, not left to the numbers (PX re-check of #56).
    const ratio = pts && theirs ? theirs / pts : 1;
    const times = Math.round(Math.max(ratio, 1 / ratio));
    const lopsided =
      ratio >= 1.8
        ? times === 2
          ? t("The computer's army is about twice yours.")
          : t("The computer's army is about {n} times yours.", { n: times })
        : ratio <= 1 / 1.8
          ? times === 2
            ? t("Your army is about twice the computer's.")
            : t("Your army is about {n} times the computer's.", { n: times })
          : null;
    const canMatch = !!module && ratio > 1.25;
    return (
      <div className="how-hard your-army" role="group" aria-label={t("Your army")}>
        <strong className="small">{t("Your army")}</strong>
        <p className="small army-check">
          {[
            picked.name,
            tn(picked.units.length, "{n} unit", "{n} units"),
            ...(pts ? [t("{points} pts", { points: pts })] : []),
            // Said once, here: the list's own total disagrees with what its units add up to.
            ...(picked.points && pts && picked.points !== pts
              ? [t("the list itself says {n} pts", { n: picked.points })]
              : []),
            ...(theirs ? [t("the computer's is {n} pts", { n: theirs })] : []),
          ].join(" · ")}
        </p>
        {lopsided && <p className="warn small">{lopsided}</p>}
        <button className="primary small" autoFocus onClick={() => start()}>
          {t("Start")}
        </button>
        {canMatch && (
          <button
            className="small"
            title={t("The computer fields part of its sample army, about as many points as yours")}
            onClick={() => start(matchPoints(module!.sample(1), pts))}
          >
            {t("Match my points")}
          </button>
        )}
        <button className="small" disabled={!!kept} onClick={keep}>
          {kept ? t("Saved to your shelf") : t("Save to shelf")}
        </button>
        <button className="quiet small" title={t("Back")} onClick={() => setPicked(null)}>
          ←
        </button>
      </div>
    );
  }
  return (
    <div className="how-hard your-army" role="group" aria-label={t("Your army")}>
      <strong className="small">
        {t("Your army")}{" "}
        <span className="muted">
          {t("against {who}", { who: `${characterName(level)} (${levelName(level)})` })}
        </span>
      </strong>
      <button className="primary small" autoFocus onClick={() => startSolo(system, level)}>
        {sample ? t("Sample army: {name}", { name: sample.name }) : t("A sample army")}{" "}
        {sample && pointsOf(sample) ? (
          <span className="muted small">{t("{points} pts", { points: pointsOf(sample) })}</span>
        ) : null}
      </button>
      {shelf.map((a) => {
        const pts = pointsOf(a.roster);
        const far = gap(pts);
        return (
          <button
            key={a.id}
            className="small"
            onClick={() => startSolo(system, level, { roster: a.roster, shelf: a })}
          >
            {a.name} {pts ? <span className="muted small">{t("{points} pts", { points: pts })}</span> : null}
            {far && <span className="muted small"> · {far}</span>}
          </button>
        );
      })}
      {system !== RIFT_LANTERNS && (
        <label className="file small">
          {t("Import a roster…")}
          <input
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
        </label>
      )}
      {error && <p className="warn small">{error}</p>}
      <button className="quiet small" title={t("Back")} onClick={onBack}>
        ←
      </button>
    </div>
  );
}
