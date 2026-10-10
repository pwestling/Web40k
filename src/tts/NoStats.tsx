import { useState } from "react";
import { type GameState, type ModelFigure, type PlayerId, type Unit } from "../core";
import { t, tn } from "../i18n";
import { useCanControl, useStore } from "../store";
import { systemModule } from "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { parseRosterFile } from "../systems/wh40k/roster";
import { useDeployed } from "../ui/shelfActions";
import { mergeWithRoster } from "./merge";

/** A unit with nothing in its stat line: it came from a TTS save whose descriptions said nothing readable. */
function statless(game: GameState, unit: Unit): boolean {
  const models = unit.modelIds.map((id) => game.models[id]).filter((m) => !!m?.profile);
  return (
    models.length > 0 && models.every((m) => !Object.values(m!.profile!.chars).some((v) => v && v !== "-"))
  );
}

/**
 * On a unit card with no stats (UX 476): before the battle, its owner can take
 * the stats from their list file for the whole army (#74's merge), and every
 * model stays where it stands in its figure. After that, a pointer that the
 * unit's numbers are the players' to work out.
 */
export function NoStats({ unit }: { unit: Unit }) {
  const game = useStore((s) => s.game);
  const mine = useCanControl()(unit.owner);
  const [note, setNote] = useState("");
  const deployed = useDeployed((d) => d[unit.owner]);
  if (!statless(game, unit)) return note ? <p className="small">{note}</p> : null;
  if (game.turn.round > 0 || !mine || !deployed || !unit.id.startsWith(`${deployed.prefix}-`))
    return <p className="muted small">{t("No stats on this unit yet: its rolls are yours to work out.")}</p>;
  return (
    <p className="row wrap small no-stats">
      <span>{t("No stats yet. Take them from your army list; every model stays where it stands.")}</span>
      <label className="file button small">
        {t("Take stats from a list…")}
        <input
          type="file"
          accept=".ros,.rosz,.json,.xml,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void restat(unit.owner, f).then(setNote);
          }}
        />
      </label>
      {note && <span>{note}</span>}
    </p>
  );
}

/** Re-deploy a player's army with its stats from a list file, every model where it stands now. */
async function restat(owner: PlayerId, file: File): Promise<string> {
  const deployed = useDeployed.getState()[owner];
  if (!deployed) return "";
  const { game } = useStore.getState();
  const read = systemModule(game.system).importRoster ?? parseRosterFile;
  const list = await read(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!list.units.length) return list.warnings.join(" ") || t("No units found in that list.");
  const merged = mergeWithRoster(deployed.roster, list);
  const old = (i: number, j: number) => game.models[`${deployed.prefix}-${i}-${j}`];
  const roster = {
    ...merged.roster,
    units: merged.roster.units.map((u, i) => ({
      ...u,
      models: u.models.map((m, j) => {
        const was = old(i, j);
        return was ? { ...m, at: { x: was.position.x, y: was.position.y, facing: was.facing } } : m;
      }),
    })),
  };
  const { dispatch } = useStore.getState();
  for (const id of Object.keys(game.units))
    if (id.startsWith(`${deployed.prefix}-`)) dispatch({ type: "unit/remove", id }, owner);
  const prefix = `${owner}-${crypto.randomUUID().slice(0, 6)}`;
  for (const intent of spawnIntents(useStore.getState().game, owner, roster.units, prefix, roster.name))
    dispatch(intent, owner);
  if (roster.army) dispatch({ type: "player/army", army: roster.army }, owner);
  // Each model keeps the figure it wore: grouped by the profile it has now.
  roster.units.forEach((u, i) => {
    const byFigure = new Map<string, { figure: ModelFigure; keys: Set<string> }>();
    u.models.forEach((m, j) => {
      const figure = old(i, j)?.figure;
      if (!figure) return;
      const k = JSON.stringify(figure);
      const entry = byFigure.get(k) ?? { figure, keys: new Set<string>() };
      entry.keys.add(m.profile.name);
      byFigure.set(k, entry);
    });
    for (const { figure, keys } of byFigure.values())
      dispatch({ type: "unit/figure", id: `${prefix}-${i}`, keys: [...keys], figure }, owner);
  });
  useDeployed.setState({ [owner]: { ...deployed, roster, prefix } });
  return [
    tn(
      merged.matched,
      "{n} unit takes its stats from the list.",
      "{n} units take their stats from the list.",
      {},
    ),
    merged.ttsOnly.length ? t("Not in the list: {names}.", { names: merged.ttsOnly.join(", ") }) : "",
    merged.rosterOnly.length
      ? t("Added from the list: {names}.", { names: merged.rosterOnly.join(", ") })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
