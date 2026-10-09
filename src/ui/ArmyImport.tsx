import { createPortal } from "react-dom";
import { photographNext, undressed } from "../standees/ask";
import { displayName, playerName } from "../i18n/names";
import { Fragment, useEffect, useMemo, useState } from "react";
import { armyFromGame, sameArmy, useShelf, type SavedArmy } from "../packages/shelf";
import { SavedNote } from "./SavedNote";
import { dressFromShelf, exportArmy, importArmyFile, saveToShelf, useDeployed } from "./shelfActions";
import { dressFromLibrary } from "../figures/actions";
import { useFigures } from "../figures/library";
import { suggestions } from "../figures/match";
import { systemOf, type BaseShape, type PlayerId } from "../core";
import { armyColor, spawnIntents } from "../systems/wh40k/deploy";
import { parseRosterFile, type ImportedRoster } from "../systems/wh40k/roster";
import { automateArmy } from "../systems/wh40k/recognize";
import { isPlaceholder } from "../core/content/systems";
import { systemModule } from "../systems";
import { formatDate, t, tn } from "../i18n";
import { useStore } from "../store";
import { DicePicker } from "./DicePicker";
import { ImportAutomation } from "./AutoAbilities";
import { addSpells, importedWizard, parseSpellList } from "../systems/tow/spells";

/** Common base sizes, so a player can fix a guessed base in one click. */
const bases = (): { label: string; base: BaseShape }[] => [
  ...[25, 28, 32, 40, 50, 60, 80, 90, 100, 130, 160].map((d) => ({
    label: t("{d}mm round", { d }),
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
    label: t("{w}×{d}mm oval", { w, d }),
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
    label: w === d ? t("{w}mm square", { w }) : t("{w}×{d}mm", { w, d }),
    base: { shape: "rect", widthMm: w!, depthMm: d! } as BaseShape,
  })),
  ...[
    [70, 105],
    [90, 150],
    [110, 180],
  ].map(([w, d]) => ({
    label: t("{w}×{d}mm hull", { w, d }),
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
      const r = await read(file.name, new Uint8Array(await file.arrayBuffer()));
      // The detachment's rules and stratagems the app can read start ticked (UX 370): untick to play one by hand.
      setRoster(r.army ? { ...r, army: automateArmy(r.army, systemOf(game)) } : r);
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
    // The detachment's rules and stratagems (#49): the text is the player's, shared with the table like their units.
    if (roster.army) dispatch({ type: "player/army", army: roster.army }, owner);
    const color = fromShelf ? null : armyColor(game, owner, roster.color);
    if (color) dispatch(color, owner);
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
        ? [
            tn(added.wizards, "{count} spells read for {n} wizard.", "{count} spells read for {n} wizards.", {
              count: spells.length,
            }),
          ]
        : []),
      ...problems,
    ]);
  };

  const ownerSeat = players.find((p) => p.id === owner)?.seat ?? 0;
  const BASES = bases();

  return (
    <div className="import">
      {players.length > 1 && (
        <label>
          {t("Army for")}{" "}
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* A package game's armies wait for its rules: without them the sample and the list reader aren't here yet. */}
      {game.system && isPlaceholder(game.system) ? (
        <p className="muted small">{t("Armies can be added once this game's rules package is running.")}</p>
      ) : (
        <div className="row">
          <label className="file button">
            {busy ? t("Reading…") : t("Import a list")}
            <input
              type="file"
              accept=".ros,.rosz,.json,.xml,.txt"
              onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
            />
          </label>
          {/* A game with factions offers each one's sample army; others, the side's own. */}
          {systemModule(game.system).armies?.length ? (
            <select
              aria-label={t("Sample army")}
              value=""
              onChange={(e) => {
                const army = systemModule(game.system).armies?.[Number(e.target.value)];
                if (!army) return;
                setFromShelf(null);
                setRoster(army);
              }}
            >
              <option value="">{t("Sample army…")}</option>
              {systemModule(game.system).armies!.map((a, i) => (
                <option key={i} value={i}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => {
                setFromShelf(null);
                setRoster(systemModule(game.system).sample(ownerSeat === 1 ? 1 : 0));
              }}
            >
              {t("Sample army")}
            </button>
          )}
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
      {owner && (
        <PhotoFigures
          owner={owner}
          name={players.length > 1 ? players.find((p) => p.id === owner)?.name : null}
        />
      )}
      {owner && <DicePicker key={owner} player={owner} />}
      {/* On the page itself: inside the side panel, the table talk dock sat over its buttons. */}
      {roster &&
        createPortal(
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
                    {tn(
                      open.length,
                      "Your figure library has figures that fit {n} unit.",
                      "Your figure library has figures that fit {n} units.",
                    )}
                  </span>
                  <button
                    className="small"
                    onClick={() => {
                      const next = { ...figs };
                      for (const i of open) next[i] = suggested[i]![0]!.id;
                      setFigs(next);
                    }}
                  >
                    {t("Use them")}
                  </button>
                </p>
              )}
              {Object.values(figs).some(Boolean) && open.length === 0 && (
                <p className="row wrap small">
                  <span className="muted">{t("Picked figures go on when the army is deployed.")}</span>
                  <button className="quiet small" onClick={() => setFigs({})}>
                    {t("Clear the figures")}
                  </button>
                </p>
              )}
              <table className="import-units">
                <thead>
                  <tr>
                    <th>{t("Unit")}</th>
                    <th>{t("Pts")}</th>
                    {ranked && <th>{t("Troop type")}</th>}
                    <th>{t("Models")}</th>
                    <th>{t("Base")}</th>
                    {ranked && <th title={t("Models in the front rank")}>{t("Frontage")}</th>}
                    {library.length > 0 && <th>{t("Figure")}</th>}
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
                              {t("Level {level} wizard:", { level: importedWizard(u) })}{" "}
                              {u.sheet.spells?.length
                                ? u.sheet.spells.map((sp) => sp.name).join(", ")
                                : t("no spells yet")}
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
                              <span className="muted small">{t("single")}</span>
                            ) : (
                              <>
                                <input
                                  type="number" // i18n-ignore: an input type
                                  className="frontage" // i18n-ignore: a class name
                                  aria-label={t("{unit} frontage", { unit: u.name })}
                                  min={1}
                                  max={u.models.length}
                                  disabled={skirmish(i, u)}
                                  value={frontage(i, u.models.length)}
                                  onChange={(e) =>
                                    setFiles({
                                      ...files,
                                      [i]: Math.max(
                                        1,
                                        Math.min(u.models.length, Number(e.target.value) || 1),
                                      ),
                                    })
                                  }
                                />
                                <label
                                  className="small"
                                  title={t("Deploy as a loose spread instead of a block")}
                                >
                                  <input
                                    type="checkbox"
                                    checked={skirmish(i, u)}
                                    onChange={(e) => setLoose({ ...loose, [i]: e.target.checked })}
                                  />{" "}
                                  {t("Skirmish")}
                                </label>
                              </>
                            )}
                          </td>
                        )}
                        {library.length > 0 && (
                          <td className="figure-pick">
                            {dressed(i) && !figs[i] ? (
                              <span className="muted small">{t("From your shelf")}</span>
                            ) : (
                              <select
                                aria-label={t("{unit} figure", { unit: u.name })}
                                value={figs[i] ?? ""}
                                onChange={(e) => setFigs({ ...figs, [i]: e.target.value })}
                              >
                                <option value="">
                                  {suggested[i]?.length
                                    ? t("Suggested: {name}", { name: suggested[i]![0]!.name })
                                    : t("Stand-ins")}
                                </option>
                                {suggested[i]?.length ? (
                                  <optgroup label={t("Fits this unit")}>
                                    {suggested[i]!.map((f) => (
                                      <option key={f.id} value={f.id}>
                                        {f.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                ) : null}
                                <optgroup label={t("Your figures")}>
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
                            <span className="warn small">{t("Not in the list, fill in:")} </span>
                            {u.missing.map((k) => (
                              <label key={k} className="stat-input">
                                {k}{" "}
                                <input
                                  aria-label={`${u.name} ${k}`}
                                  className={k === "Troop" ? "" : "frontage"}
                                  // i18n-ignore: a troop type as the game's rules write it
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
              {/* At a real table the models are on it already: their bases aren't the app's to guess (PX). */}
              {!game.settings.companion && (
                <p className="muted">
                  {ranked
                    ? t("Bases are a guess from each unit's troop type; check them against your models.")
                    : t("Bases are a guess from keywords and wounds; check them against your models.")}
                </p>
              )}
              <ImportAutomation roster={roster} setRoster={setRoster} />
              {ranked && wizards > 0 && (
                <div className="row wrap">
                  <label
                    className="file button"
                    title={t("A spell list file: names, casting values, ranges and kinds")}
                  >
                    {t("Add spells from a list")}
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
              <div className="row modal-actions">
                <button className="primary" disabled={!roster.units.length} onClick={deploy}>
                  {t("Deploy for {name}", { name: playerName(players.find((p) => p.id === owner)) })}
                </button>
                <button onClick={cancel}>{t("Cancel")}</button>
              </div>
            </div>
          </div>,
          document.body,
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
          aria-label={t("From your shelf")}
          className="shelf-select"
          value=""
          onChange={(e) => {
            const army = armies[e.target.value];
            if (army) onPick(army);
          }}
        >
          <option value="">{t("From your shelf…")}</option>
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
        <summary>
          {loaded ? t("Your army shelf ({count})", { count: all.length }) : t("Your army shelf")}
        </summary>
        <p className="muted small">
          {t(
            "Armies saved on this device. Save one after deploying it; pass one on as a file, figures included.",
          )}
        </p>
        <ul>
          {all.map((a) => (
            <li key={a.id}>
              <span>
                {a.name}
                <span className="muted small">
                  {" "}
                  · {shelfLine(a)}
                  {a.system !== system && ` · ${t("another game")}`}
                </span>
              </span>
              <span className="row">
                <button className="small" onClick={() => void exportArmy(a).then((f) => setExported(f))}>
                  {t("Export")}
                </button>
                <button
                  className="quiet small"
                  onClick={() => confirm(t("Take {name} off your shelf?", { name: a.name })) && remove(a.id)}
                >
                  {t("Remove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <label className="file button small">
          {t("Open an army file")}
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void importArmyFile(file).then((r) =>
                  setNote(typeof r === "string" ? r : t("{name} is on your shelf.", { name: r.name })),
                );
              e.target.value = "";
            }}
          />
        </label>
        {/* i18n-ignore */}
        {exported && <SavedNote file={exported} kind="army" />}
        {note && <p className="muted small">{note}</p>}
      </details>
    </>
  );
}

/** "5 units · saved 8 Oct, 03:12": enough to tell two saves of one army apart (UX 196). */
function shelfLine(a: SavedArmy): string {
  const when = formatDate(a.savedAt, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return tn(a.roster.units.length, "{n} unit · saved {when}", "{n} units · saved {when}", { when });
}

/** Save the army a player deployed in this game (its names, figures, dice and colour as they are now). */
function SaveToShelf({ owner, name }: { owner: PlayerId; name: string | null }) {
  const deployed = useDeployed((s) => s[owner]);
  const game = useStore((s) => s.game);
  const saved = useShelf((s) => (deployed?.shelfId ? s.armies[deployed.shelfId] : undefined));
  if (!deployed) return null;
  // On the shelf as it stands: say so, rather than offer a button that does nothing (UX 195, 196).
  if (saved && sameArmy(saved, { ...armyFromGame(game, owner, deployed, saved.id), savedAt: saved.savedAt }))
    return (
      <p className="muted small">
        ✓{" "}
        {name
          ? t("{name}'s army is on your shelf as it is now.", { name })
          : t("This army is on your shelf as it is now.")}
      </p>
    );
  return (
    <div className="row">
      <button
        className="small"
        title={t(
          "Keep this army on this device for later games, with its unit names, figures, dice and colour",
        )}
        onClick={() => saveToShelf(owner)}
      >
        {saved
          ? name
            ? t("Update {name}'s army on your shelf", { name })
            : t("Update it on your shelf")
          : name
            ? t("Save {name}'s army to your shelf", { name })
            : t("Save army to your shelf")}
      </button>
    </div>
  );
}

/** Your painted army on the table (#68, UX 471): photograph the units still in their stand-ins, one after another. */
export function PhotoFigures({ owner, name }: { owner: PlayerId; name?: string | null }) {
  const game = useStore((s) => s.game);
  const left = useMemo(() => undressed(game, owner).length, [game, owner]);
  if (!left) return null;
  return (
    <p className="row wrap small">
      <button
        className="small"
        title={t("Photograph your painted miniature and stand it on its base")}
        onClick={() => photographNext(owner)}
      >
        📷{" "}
        {name
          ? t("Photograph {name}'s painted figures", { name: displayName(name) })
          : t("Photograph your painted figures")}
      </button>
      <span className="muted">{tn(left, "{n} unit in its stand-in", "{n} units in their stand-ins")}</span>
    </p>
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
  return [...command, ...(mount ? [t("on {mount}", { mount })] : [])].join(", ");
}

/** One points figure: the roster's cost, with the units' sum beside it when they differ. */
function pointsLine(roster: ImportedRoster): string {
  const units = roster.units.reduce((a, u) => a + (u.sheet.points ?? 0), 0);
  if (!roster.points) return units ? t("({points} pts)", { points: units }) : "";
  return units && units !== roster.points
    ? t("({points} pts; units {units})", { points: roster.points, units })
    : t("({points} pts)", { points: roster.points });
}

/** A base the list of common sizes doesn't have, in words. */
function baseLabel(b: BaseShape): string {
  if (b.shape === "round") return t("{d}mm round", { d: b.diameterMm });
  return b.shape === "oval"
    ? t("{w}×{d}mm oval", { w: b.widthMm, d: b.depthMm })
    : t("{w}×{d}mm", { w: b.widthMm, d: b.depthMm });
}

/** The Old World's troop type, or Conquest's Type and Class ("Infantry, Medium"). */
function troopType(u: ImportedUnit): string {
  const c = u.models[0]?.profile.chars ?? {};
  return c.Troop ?? ([c.Type, c.Class].filter(Boolean).join(", ") || "–");
}
