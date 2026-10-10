import { useState } from "react";
import { t, tn } from "../i18n";
import { systemModule } from "../systems";
import { parseRosterFile, type ImportedRoster } from "../systems/wh40k/roster";
import { useStore } from "../store";
import { mergeWithRoster } from "./merge";

/**
 * On the army import, for an army with no points (one read from a Tabletop
 * Simulator save, #74): the player's list file brings the stats, points and
 * detachment, while the save's units and models stay (merge.ts says how).
 */
export function ListMerge({
  roster,
  setRoster,
}: {
  roster: ImportedRoster;
  setRoster: (r: ImportedRoster) => void;
}) {
  const system = useStore((s) => s.game.system);
  const [note, setNote] = useState("");
  // Only where lists are BattleScribe files, and only for an army that has no points of its own.
  if (systemModule(system).importRoster || roster.points || roster.units.some((u) => u.sheet.points))
    return note ? <p className="small">{note}</p> : null;
  const load = async (file: File) => {
    const read = systemModule(system).importRoster ?? parseRosterFile;
    const list = await read(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!list.units.length) return setNote(list.warnings.join(" ") || t("No units found in that list."));
    const merged = mergeWithRoster(roster, list);
    setRoster(merged.roster);
    setNote(
      [
        tn(
          merged.matched,
          "{n} unit takes its stats from the list.",
          "{n} units take their stats from the list.",
        ),
        merged.ttsOnly.length ? t("Not in the list: {names}.", { names: merged.ttsOnly.join(", ") }) : "",
        merged.rosterOnly.length
          ? t("Added from the list: {names}.", { names: merged.rosterOnly.join(", ") })
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };
  return (
    <p className="row wrap small">
      <span>
        {t("No points here. Your list file can bring the stats, points and detachment; the models stay.")}
      </span>
      <label className="file button quiet small">
        {t("Take stats from a list…")}
        <input
          type="file"
          accept=".ros,.rosz,.json,.xml,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void load(f);
          }}
        />
      </label>
    </p>
  );
}
