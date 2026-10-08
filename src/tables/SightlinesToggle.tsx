import { useStore } from "../store";
import { t } from "../i18n";
import { useTableEdit } from "./edit";

/** The switch for the sightline view, with its key, before the battle or while editing terrain. */
export function SightlinesToggle() {
  const on = useTableEdit((s) => s.sightlines);
  const zones = useStore((s) => s.game.zones.length);
  const players = useStore((s) => s.game.players);
  if (!zones) return null;
  const seated = Object.values(players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!);
  return (
    <>
      <label className="check" title={t("What each deployment zone can see, from the terrain alone")}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => useTableEdit.setState({ sightlines: e.target.checked })}
        />{" "}
        {t("What each zone sees")}
      </label>
      {on && (
        <div className="legend sight-legend" role="note">
          {seated.map((p) => (
            <span key={p.id} style={{ ["--c" as string]: p.color }} className="seen-by">
              {t("In {name}'s colour: only {name}'s zone sees here", { name: p.name })}
            </span>
          ))}
          <span className="seen-both">{t("No tint: both zones see here")}</span>
          <span className="seen-none">{t("Dark: neither zone sees here")}</span>
        </div>
      )}
    </>
  );
}
