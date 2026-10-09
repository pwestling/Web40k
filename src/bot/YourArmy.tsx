import { useEffect, useState } from "react";
import { DEFAULT_SYSTEM } from "../core";
import { RIFT_LANTERNS } from "../games/riftLanterns";
import { t } from "../i18n";
import { useShelf } from "../packages/shelf";
import { systemModule } from "../systems";
import type { ImportedRoster } from "../systems/wh40k/roster";
import type { Level } from "./player";
import { characterName, levelName } from "./solo";
import { startSolo } from "./startSolo";

/** An army's points: its own total, else its units'. */
function pointsOf(roster: ImportedRoster): number {
  return roster.points || roster.units.reduce((a, u) => a + (u.sheet.points ?? 0), 0);
}

/**
 * "Your army" (#56, PX dogfood 1): after How hard?, the army the player
 * fields against the computer: the sample army, one off their shelf, or a
 * roster read now. The computer fields its sample army. A big gap in points
 * is noted beside the army, never blocked.
 */
export function YourArmy({ system, level, onBack }: { system: string; level: Level; onBack: () => void }) {
  const { armies, load } = useShelf();
  const [error, setError] = useState<string | null>(null);
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
      startSolo(system, level, { roster });
    } catch {
      setError(t("That file has no units this game can read."));
    }
  };
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
