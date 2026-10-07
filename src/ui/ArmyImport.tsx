import { Fragment, useState } from "react";
import { systemOf, type BaseShape, type PlayerId } from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { parseRosterFile, type ImportedRoster } from "../systems/wh40k/roster";
import { systemModule } from "../systems";
import { useStore } from "../store";

/** Common base sizes, so a player can fix a guessed base in one click. */
const BASES: { label: string; base: BaseShape }[] = [
  ...[25, 28, 32, 40, 50, 60, 80, 90, 100, 130, 160].map((d) => ({
    label: `${d}mm round`,
    base: { shape: "round", diameterMm: d } as BaseShape,
  })),
  ...[
    [60, 35],
    [75, 42],
    [90, 52],
    [105, 70],
    [120, 92],
    [170, 105],
  ].map(([w, d]) => ({
    label: `${w}×${d}mm oval`,
    base: { shape: "oval", widthMm: w!, depthMm: d! } as BaseShape,
  })),
  // Square and rectangular bases for rank-and-flank games.
  ...[
    [20, 20],
    [25, 25],
    [30, 30],
    [40, 40],
    [50, 50],
    [25, 50],
    [30, 60],
    [50, 75],
    [50, 100],
  ].map(([w, d]) => ({
    label: w === d ? `${w}mm square` : `${w}×${d}mm`,
    base: { shape: "rect", widthMm: w!, depthMm: d! } as BaseShape,
  })),
  ...[
    [70, 105],
    [90, 150],
    [110, 180],
  ].map(([w, d]) => ({
    label: `${w}×${d}mm hull`,
    base: { shape: "rect", widthMm: w!, depthMm: d! } as BaseShape,
  })),
];

const baseKey = (b: BaseShape) => JSON.stringify(b);

/**
 * Load a roster file (BattleScribe / New Recruit .ros, .rosz or .json) or a
 * sample army, check the guessed bases, then deploy it for a player.
 */
export function ArmyImport({ players }: { players: { id: PlayerId; name: string; seat?: number }[] }) {
  const { game, dispatch } = useStore();
  const [roster, setRoster] = useState<ImportedRoster | null>(null);
  const [owner, setOwner] = useState<PlayerId>(players[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  // Rank-and-flank systems deploy units as blocks; the player picks each frontage.
  const ranked = systemOf(game).unitShape.kind === "ranked";
  const [files, setFiles] = useState<Record<number, number>>({});
  const frontage = (i: number, models: number) =>
    files[i] ?? roster?.units[i]?.files ?? Math.min(models, models >= 10 ? 5 : models);
  // Skirmishers deploy as a loose spread, not a block; the player can change it per unit.
  const [loose, setLoose] = useState<Record<number, boolean>>({});
  const skirmish = (i: number, u: ImportedRoster["units"][number]) => loose[i] ?? isSkirmisher(u);

  const load = async (file: File) => {
    setBusy(true);
    try {
      const read = systemModule(game.system).importRoster ?? parseRosterFile;
      setRoster(await read(file.name, new Uint8Array(await file.arrayBuffer())));
    } finally {
      setBusy(false);
    }
  };

  const deploy = () => {
    if (!roster) return;
    const prefix = `${owner}-${crypto.randomUUID().slice(0, 6)}`;
    const units = ranked
      ? roster.units.map((u, i) =>
          skirmish(i, u) ? { ...u, files: undefined } : { ...u, files: frontage(i, u.models.length) },
        )
      : roster.units;
    for (const intent of spawnIntents(game, owner, units, prefix, roster.name)) dispatch(intent, owner);
    setRoster(null);
    setFiles({});
    setLoose({});
  };

  /** Fill a characteristic the list left out, for every model of the unit that lacks it. */
  const setStat = (i: number, k: string, value: string) => {
    if (!roster) return;
    const units = roster.units.slice();
    const u = units[i]!;
    const blank = (m: (typeof u.models)[number]) =>
      !m.profile.chars[k] || m.profile.chars[k] === u.models[0]?.profile.chars[k];
    units[i] = {
      ...u,
      models: u.models.map((m) =>
        blank(m) ? { ...m, profile: { ...m.profile, chars: { ...m.profile.chars, [k]: value } } } : m,
      ),
    };
    setRoster({ ...roster, units });
  };

  const ownerSeat = players.find((p) => p.id === owner)?.seat ?? 0;

  return (
    <div className="import">
      {players.length > 1 && (
        <label>
          Army for{" "}
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <label className="file button">
          {busy ? "Reading…" : "Import army list"}
          <input
            type="file"
            accept=".ros,.rosz,.json,.xml"
            onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
          />
        </label>
        <button onClick={() => setRoster(systemModule(game.system).sample(ownerSeat === 1 ? 1 : 0))}>
          Sample army
        </button>
      </div>
      {roster && (
        <div className="modal-backdrop">
          <div className="panel modal">
            <h2>
              {roster.name} <span className="muted">{pointsLine(roster)}</span>
            </h2>
            {roster.warnings.map((w) => (
              <p key={w} className="warn">
                {w}
              </p>
            ))}
            <table className="import-units">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Pts</th>
                  {ranked && <th>Troop type</th>}
                  <th>Models</th>
                  <th>Base</th>
                  {ranked && <th title="Models in the front rank">Frontage</th>}
                </tr>
              </thead>
              <tbody>
                {roster.units.map((u, i) => (
                  <Fragment key={i}>
                    <tr>
                      <td>
                        {u.name}
                        {details(u) && <div className="muted small">{details(u)}</div>}
                      </td>
                      <td>{u.sheet.points ?? "–"}</td>
                      {ranked && <td className="small">{troopType(u)}</td>}
                      <td>{u.models.length}</td>
                      <td>
                        <select
                          value={baseKey(u.base)}
                          onChange={(e) => {
                            const units = roster.units.slice();
                            units[i] = { ...u, base: JSON.parse(e.target.value) as BaseShape };
                            setRoster({ ...roster, units });
                          }}
                        >
                          {!BASES.some((b) => baseKey(b.base) === baseKey(u.base)) && (
                            <option value={baseKey(u.base)}>{baseLabel(u.base)}</option>
                          )}
                          {BASES.map((b) => (
                            <option key={b.label} value={baseKey(b.base)}>
                              {b.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      {ranked && (
                        <td>
                          {u.models.length === 1 ? (
                            <span className="muted small">single</span>
                          ) : (
                            <>
                              <input
                                type="number"
                                className="frontage"
                                aria-label={`${u.name} frontage`}
                                min={1}
                                max={u.models.length}
                                disabled={skirmish(i, u)}
                                value={frontage(i, u.models.length)}
                                onChange={(e) =>
                                  setFiles({
                                    ...files,
                                    [i]: Math.max(1, Math.min(u.models.length, Number(e.target.value) || 1)),
                                  })
                                }
                              />
                              <label className="small" title="Deploy as a loose spread instead of a block">
                                <input
                                  type="checkbox"
                                  checked={skirmish(i, u)}
                                  onChange={(e) => setLoose({ ...loose, [i]: e.target.checked })}
                                />{" "}
                                Skirmish
                              </label>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                    {u.missing && u.missing.length > 0 && (
                      <tr className="missing-stats">
                        <td colSpan={ranked ? 6 : 4}>
                          <span className="warn small">Not in the list, fill in: </span>
                          {u.missing.map((k) => (
                            <label key={k} className="stat-input">
                              {k}{" "}
                              <input
                                aria-label={`${u.name} ${k}`}
                                className={k === "Troop" ? "" : "frontage"}
                                placeholder={k === "Troop" ? "Regular Infantry" : ""}
                                value={u.models[0]?.profile.chars[k] ?? ""}
                                onChange={(e) => setStat(i, k, e.target.value)}
                              />
                            </label>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="muted">
              {ranked
                ? "Bases are a guess from each unit's troop type"
                : "Bases are a guess from keywords and wounds"}
              ; check them against your models.
            </p>
            <div className="row">
              <button className="primary" disabled={!roster.units.length} onClick={deploy}>
                Deploy for {players.find((p) => p.id === owner)?.name}
              </button>
              <button onClick={() => setRoster(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ImportedUnit = ImportedRoster["units"][number];

/**
 * Light infantry with the Skirmishers rule (or a unit named as skirmishers)
 * deploys loose. The rule only lets other units choose it, so they start in
 * a block.
 */
function isSkirmisher(u: ImportedUnit): boolean {
  const rule = u.sheet.abilities.some((a) => /^skirmish/i.test(a.name));
  return /skirmish/i.test(u.name) || (rule && /light/i.test(u.models[0]?.profile.chars.Troop ?? ""));
}

/** The command models and mount under a unit's name, so the player can check the import. */
function details(u: ImportedUnit): string {
  const counts = new Map<string, number>();
  for (const m of u.models) counts.set(m.profile.name, (counts.get(m.profile.name) ?? 0) + 1);
  const command = u.models.length > 1 ? [...counts].filter(([, n]) => n === 1).map(([name]) => name) : [];
  const mount = u.models[0]?.profile.chars.Mount;
  return [...command, ...(mount ? [`on ${mount}`] : [])].join(", ");
}

/** One points figure: the roster's cost, with the units' sum beside it when they differ. */
function pointsLine(roster: ImportedRoster): string {
  const units = roster.units.reduce((a, u) => a + (u.sheet.points ?? 0), 0);
  if (!roster.points) return units ? `(${units} pts)` : "";
  return units && units !== roster.points
    ? `(${roster.points} pts; units ${units})`
    : `(${roster.points} pts)`;
}

/** A base the list of common sizes doesn't have, in words. */
function baseLabel(b: BaseShape): string {
  if (b.shape === "round") return `${b.diameterMm}mm round`;
  return `${b.widthMm}×${b.depthMm}mm${b.shape === "oval" ? " oval" : ""}`;
}

/** The Old World's troop type, or Conquest's Type and Class ("Infantry, Medium"). */
function troopType(u: ImportedUnit): string {
  const c = u.models[0]?.profile.chars ?? {};
  return c.Troop ?? ([c.Type, c.Class].filter(Boolean).join(", ") || "–");
}
