import { Fragment, useEffect, useMemo, useState } from "react";
import { armyFromGame, sameArmy, useShelf, type SavedArmy } from "../packages/shelf";
import { SavedNote } from "./SavedNote";
import { dressFromShelf, exportArmy, importArmyFile, saveToShelf, useDeployed } from "./shelfActions";
import { dressFromLibrary } from "../figures/actions";
import { useFigures } from "../figures/library";
import { suggestions } from "../figures/match";
import { systemOf, type BaseShape, type PlayerId } from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { parseRosterFile, type ImportedRoster } from "../systems/wh40k/roster";
import { isPlaceholder } from "../core/content/systems";
import { systemModule } from "../systems";
import { useStore } from "../store";
import { DicePicker } from "./DicePicker";
import { addSpells, importedWizard, parseSpellList } from "../systems/tow/spells";

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
  // The shelf army being deployed, if the roster came from the shelf (#27).
  const [fromShelf, setFromShelf] = useState<SavedArmy | null>(null);
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
  // Figures from the library (#33), by unit index: suggested by name, assigned on deploy.
  const [figs, setFigs] = useState<Record<number, string>>({});
  const entries = useFigures((s) => s.entries);
  useEffect(() => {
    if (roster) void useFigures.getState().load();
  }, [roster]);
  const library = useMemo(
    () =>
      Object.values(entries)
        .filter((e) => e.kind === "miniature")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );
  const suggested = useMemo(
    () => (roster ? roster.units.map((u) => suggestions(library, u.name)) : []),
    [roster, library],
  );
  // A shelf army already wears its own figures; suggestions are for the units that don't.
  const dressed = (i: number) => !!fromShelf && Object.keys(fromShelf.figures[i] ?? {}).length > 0;
  const open = suggested.flatMap((s, i) => (s[0] && !dressed(i) && figs[i] !== s[0].id ? [i] : []));

  const load = async (file: File) => {
    setBusy(true);
    try {
      const read = systemModule(game.system).importRoster ?? parseRosterFile;
      setFromShelf(null);
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
    useDeployed.setState({ [owner]: { roster: { ...roster, units }, prefix, shelfId: fromShelf?.id } });
    const shelf = fromShelf;
    const picks = Object.entries(figs).filter(([, id]) => id);
    void (async () => {
      if (shelf) await dressFromShelf(shelf, owner, prefix);
      for (const [i, id] of picks) await dressFromLibrary(`${prefix}-${i}`, id);
    })();
    setFromShelf(null);
    setFigs({});
    // On one screen, the next army is for whoever has none yet (UX 155).
    const next = players.find(
      (p) => p.id !== owner && !Object.values(game.units).some((u) => u.owner === p.id),
    );
    if (next) setOwner(next.id);
    setRoster(null);
    setFiles({});
    setLoose({});
  };
  const cancel = () => {
    setRoster(null);
    setFromShelf(null);
    setFigs({});
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

  // Rank-and-flank magic (#32): the player's own spell list, for the roster's wizards.
  const [spellNote, setSpellNote] = useState<string[]>([]);
  const wizards = roster?.units.filter((u) => importedWizard(u) > 0).length ?? 0;
  const loadSpells = async (file: File) => {
    if (!roster) return;
    const { spells, problems } = parseSpellList(await file.text());
    const added = addSpells(roster, spells);
    setRoster(added.roster);
    setSpellNote([
      ...(spells.length
        ? [`${spells.length} spells read for ${added.wizards} ${added.wizards === 1 ? "wizard" : "wizards"}.`]
        : []),
      ...problems,
    ]);
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
      {/* A package game's armies wait for its rules: without them the sample and the list reader aren't here yet. */}
      {game.system && isPlaceholder(game.system) ? (
        <p className="muted small">Armies can be added once this game's rules package is running.</p>
      ) : (
        <div className="row">
          <label className="file button">
            {busy ? "Reading…" : "Import a list"}
            <input
              type="file"
              accept=".ros,.rosz,.json,.xml"
              onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
            />
          </label>
          <button
            onClick={() => {
              setFromShelf(null);
              setRoster(systemModule(game.system).sample(ownerSeat === 1 ? 1 : 0));
            }}
          >
            Sample army
          </button>
        </div>
      )}
      {!(game.system && isPlaceholder(game.system)) && (
        <ShelfSelect
          system={game.system ?? ""}
          onPick={(army) => {
            setFromShelf(army);
            setRoster(army.roster);
          }}
        />
      )}
      <ShelfManager system={game.system ?? ""} />
      {players.map((p) => (
        <SaveToShelf key={p.id} owner={p.id} name={players.length > 1 ? p.name : null} />
      ))}
      {owner && <DicePicker key={owner} player={owner} />}
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
            {open.length > 0 && (
              <p className="row wrap">
                <span className="small">
                  Your figure library has figures that fit {open.length}{" "}
                  {open.length === 1 ? "unit" : "units"}.
                </span>
                <button
                  className="small"
                  onClick={() => {
                    const next = { ...figs };
                    for (const i of open) next[i] = suggested[i]![0]!.id;
                    setFigs(next);
                  }}
                >
                  Use them
                </button>
              </p>
            )}
            {Object.values(figs).some(Boolean) && open.length === 0 && (
              <p className="row wrap small">
                <span className="muted">Picked figures go on when the army is deployed.</span>
                <button className="quiet small" onClick={() => setFigs({})}>
                  Clear the figures
                </button>
              </p>
            )}
            <table className="import-units">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Pts</th>
                  {ranked && <th>Troop type</th>}
                  <th>Models</th>
                  <th>Base</th>
                  {ranked && <th title="Models in the front rank">Frontage</th>}
                  {library.length > 0 && <th>Figure</th>}
                </tr>
              </thead>
              <tbody>
                {roster.units.map((u, i) => (
                  <Fragment key={i}>
                    <tr>
                      <td>
                        {u.name}
                        {details(u) && <div className="muted small">{details(u)}</div>}
                        {importedWizard(u) > 0 && (
                          <div className="muted small">
                            Level {importedWizard(u)} wizard:{" "}
                            {u.sheet.spells?.length
                              ? u.sheet.spells.map((sp) => sp.name).join(", ")
                              : "no spells yet"}
                          </div>
                        )}
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
                      {library.length > 0 && (
                        <td className="figure-pick">
                          {dressed(i) && !figs[i] ? (
                            <span className="muted small">From your shelf</span>
                          ) : (
                            <select
                              aria-label={`${u.name} figure`}
                              value={figs[i] ?? ""}
                              onChange={(e) => setFigs({ ...figs, [i]: e.target.value })}
                            >
                              <option value="">
                                {suggested[i]?.length ? `Suggested: ${suggested[i]![0]!.name}` : "Stand-ins"}
                              </option>
                              {suggested[i]?.length ? (
                                <optgroup label="Fits this unit">
                                  {suggested[i]!.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              <optgroup label="Your figures">
                                {library.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          )}
                        </td>
                      )}
                    </tr>
                    {u.missing && u.missing.length > 0 && (
                      <tr className="missing-stats">
                        <td colSpan={(ranked ? 6 : 4) + (library.length > 0 ? 1 : 0)}>
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
            {ranked && wizards > 0 && (
              <div className="row wrap">
                <label
                  className="file button"
                  title="A spell list file: names, casting values, ranges and kinds"
                >
                  Add spells from a list
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => e.target.files?.[0] && void loadSpells(e.target.files[0])}
                  />
                </label>
                {spellNote.map((n) => (
                  <span key={n} className="muted small">
                    {n}
                  </span>
                ))}
              </div>
            )}
            <div className="row">
              <button className="primary" disabled={!roster.units.length} onClick={deploy}>
                Deploy for {players.find((p) => p.id === owner)?.name}
              </button>
              <button onClick={cancel}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "From your shelf": armies saved on this device for this game (#27). */
function ShelfSelect({ system, onPick }: { system: string; onPick: (army: SavedArmy) => void }) {
  const { armies, load } = useShelf();
  useEffect(() => {
    void load();
  }, [load]);
  const here = Object.values(armies)
    .filter((a) => a.system === system)
    .sort((a, b) => b.savedAt - a.savedAt);
  return (
    <>
      {here.length > 0 && (
        <select
          aria-label="From your shelf"
          className="shelf-select"
          value=""
          onChange={(e) => {
            const army = armies[e.target.value];
            if (army) onPick(army);
          }}
        >
          <option value="">From your shelf…</option>
          {here.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {shelfLine(a)}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

/** The shelf itself: every saved army, to export or remove, and a way in for army files. */
function ShelfManager({ system }: { system: string }) {
  const { armies, loaded, remove } = useShelf();
  const [note, setNote] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const all = Object.values(armies).sort((a, b) => b.savedAt - a.savedAt);
  return (
    <>
      <details className="fold shelf">
        <summary>Your army shelf{loaded ? ` (${all.length})` : ""}</summary>
        <p className="muted small">
          Armies saved on this device. Save one after deploying it; pass one on as a file, figures included.
        </p>
        <ul>
          {all.map((a) => (
            <li key={a.id}>
              <span>
                {a.name}
                <span className="muted small">
                  {" "}
                  · {shelfLine(a)}
                  {a.system !== system && " · another game"}
                </span>
              </span>
              <span className="row">
                <button className="small" onClick={() => void exportArmy(a).then((f) => setExported(f))}>
                  Export
                </button>
                <button
                  className="quiet small"
                  onClick={() => confirm(`Take ${a.name} off your shelf?`) && remove(a.id)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <label className="file button small">
          Open an army file
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void importArmyFile(file).then((r) =>
                  setNote(typeof r === "string" ? r : `${r.name} is on your shelf.`),
                );
              e.target.value = "";
            }}
          />
        </label>
        {exported && <SavedNote file={exported} kind="army" />}
        {note && <p className="muted small">{note}</p>}
      </details>
    </>
  );
}

/** "5 units · saved 8 Oct, 03:12": enough to tell two saves of one army apart (UX 196). */
function shelfLine(a: SavedArmy): string {
  const when = new Date(a.savedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${a.roster.units.length} unit${a.roster.units.length === 1 ? "" : "s"} · saved ${when}`;
}

/** Save the army a player deployed in this game (its names, figures, dice and colour as they are now). */
function SaveToShelf({ owner, name }: { owner: PlayerId; name: string | null }) {
  const deployed = useDeployed((s) => s[owner]);
  const game = useStore((s) => s.game);
  const saved = useShelf((s) => (deployed?.shelfId ? s.armies[deployed.shelfId] : undefined));
  if (!deployed) return null;
  const whose = name ? `${name}'s army` : "This army";
  // On the shelf as it stands: say so, rather than offer a button that does nothing (UX 195, 196).
  if (saved && sameArmy(saved, { ...armyFromGame(game, owner, deployed, saved.id), savedAt: saved.savedAt }))
    return <p className="muted small">✓ {whose} is on your shelf as it is now.</p>;
  return (
    <div className="row">
      <button
        className="small"
        title="Keep this army on this device for later games, with its unit names, figures, dice and colour"
        onClick={() => saveToShelf(owner)}
      >
        {saved
          ? `Update ${name ? `${name}'s army` : "it"} on your shelf`
          : `Save ${name ? `${name}'s army` : "army"} to your shelf`}
      </button>
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
