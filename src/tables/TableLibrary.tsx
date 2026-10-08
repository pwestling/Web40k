import { plainSystemName } from "../ui/systemLabels";
import { useEffect, useState } from "react";
import { getSystem } from "../core/content/systems";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { formatDate, t, tn } from "../i18n";
import { useStore } from "../store";
import { SavedNote } from "../ui/SavedNote";
import { useGame } from "../ui/hooks";
import { applyLayout, exportTable, importTableFile, saveTable } from "./actions";
import { deploymentLine, modelsLine, useTables, type SavedTable } from "./library";
import { starterLayout, starters } from "./starters";
import { TableThumb } from "./TableThumb";
import { SightlinesToggle } from "./SightlinesToggle";

const systemName = (id: string) => {
  try {
    return plainSystemName(getSystem(id).name);
  } catch {
    return id || t("another game");
  }
};

const saved = (table: SavedTable) =>
  formatDate(table.savedAt, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function useColors(): string[] {
  const players = useStore((s) => s.game.players);
  const out = ["#3b82f6", "#f97316", "#2dd4bf", "#fde047"];
  for (const p of Object.values(players)) if (p.seat !== undefined) out[p.seat] = p.color;
  return out;
}

/**
 * Before the battle, in the menu: the table this game is played on. Pick a
 * starter table for this game, or one from your library; it goes to every
 * player, terrain models included.
 */
export function TablePicker() {
  const game = useGame();
  const role = useStore((s) => s.role);
  const tables = useTables((s) => s.tables);
  const colors = useColors();
  const [seed, setSeed] = useState<Record<string, number>>({});
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  if (game.turn.round > 0 || role === "spectator") return null;
  const mine = Object.values(tables)
    .filter((tb) => tb.system === (game.system ?? DEFAULT_SYSTEM))
    .sort((a, b) => b.savedAt - a.savedAt);
  const all = starters();
  const pick = (value: string) => {
    if (value.startsWith("starter:")) {
      const id = value.slice(8);
      const s = all.find((x) => x.id === id);
      void applyLayout(starterLayout(game.system, game.table, id, seed[id] ?? 1), {
        key: value,
        name: s?.name ?? t("a starter table"),
      });
    } else if (value.startsWith("table:")) {
      const tb = tables[value.slice(6)];
      if (tb) void applyLayout(tb.layout, { key: value, name: tb.name });
    }
  };
  // The table everyone is on, as the game has it: named in the list when this device has it too.
  const source = game.tableSource;
  const listed =
    !!source &&
    !source.changed &&
    (source.key.startsWith("starter:")
      ? all.some((s) => `starter:${s.id}` === source.key)
      : mine.some((tb) => `table:${tb.id}` === source.key));
  const value = listed ? source.key : "";
  const starter = value.startsWith("starter:") ? value.slice(8) : null;
  const current = starter ? all.find((s) => s.id === starter) : undefined;
  const library = value.startsWith("table:") ? tables[value.slice(6)] : undefined;
  const blurb = current
    ? current.blurb
    : library
      ? [deploymentLine(library.layout.zones, library.table), modelsLine(library.layout)]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <div className="table-picker">
      <TableThumb
        layout={{ terrain: game.terrain, objectives: game.objectives, zones: game.zones }}
        table={game.table}
        colors={colors}
        width={84}
        label={t("This game's table from above")}
      />
      <div className="col">
        <select aria-label={t("Table")} value={value} onChange={(e) => pick(e.target.value)}>
          <option value="">
            {source
              ? source.changed
                ? t("Table: {name}, changed", { name: source.name })
                : t("Table: {name}", { name: source.name })
              : t("Table: as it is")}
          </option>
          <optgroup label={t("Starter tables")}>
            {all.map((s) => (
              <option key={s.id} value={`starter:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
          {mine.length > 0 && (
            <optgroup label={t("Your table library")}>
              {mine.map((tb) => (
                <option key={tb.id} value={`table:${tb.id}`}>
                  {tb.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {blurb && <span className="muted small">{blurb}</span>}
        <div className="row wrap">
          {starter && (
            <button
              className="small"
              onClick={() => {
                const next = (seed[starter] ?? 1) + 1;
                setSeed({ ...seed, [starter]: next });
                void applyLayout(starterLayout(game.system, game.table, starter, next), {
                  key: `starter:${starter}`,
                  name: current?.name ?? t("a starter table"),
                });
              }}
            >
              {t("Another like it")}
            </button>
          )}
        </div>
        <SightlinesToggle />
      </div>
    </div>
  );
}

/** The table library in the terrain editor: save this table, use or pass on a saved one. */
export function TableShelf() {
  const game = useGame();
  const { tables, loaded, remove } = useTables();
  const colors = useColors();
  const [name, setName] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  const all = Object.values(tables).sort((a, b) => b.savedAt - a.savedAt);
  const system = game.system ?? DEFAULT_SYSTEM;
  const same = (tb: SavedTable) => tb.system === system;
  const last = savedId ? tables[savedId] : undefined;
  return (
    <details className="fold table-shelf">
      <summary>{loaded ? t("Table library ({count})", { count: all.length }) : t("Table library")}</summary>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const id = saveTable(
            name || last?.name || t("My table"),
            last && (!name || name === last.name) ? last.id : undefined,
          );
          setSavedId(id);
          setNote(t("Saved to your table library."));
        }}
      >
        <input
          aria-label={t("Table name")}
          placeholder={last?.name ?? t("Name this table")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="small primary">
          {last && (!name || name === last.name) ? t("Update") : t("Save table")}
        </button>
      </form>
      <ul className="tables">
        {all.map((tb) => (
          <li key={tb.id} className={same(tb) ? "" : "other"}>
            <TableThumb
              layout={tb.layout}
              table={tb.table}
              colors={colors}
              width={72}
              label={t("{name} from above", { name: tb.name })}
            />
            <div className="col">
              <strong>{tb.name}</strong>
              <span className="muted small">
                {systemName(tb.system)} · {deploymentLine(tb.layout.zones, tb.table)} ·{" "}
                {tn(tb.layout.terrain.length, "{n} piece", "{n} pieces")} · {saved(tb)}
              </span>
              {modelsLine(tb.layout) && <span className="muted small">{modelsLine(tb.layout)}</span>}
              <span className="row">
                <button
                  className="small"
                  disabled={!same(tb)}
                  title={same(tb) ? t("Set this table up for everyone") : t("This table is for another game")}
                  onClick={() => {
                    void applyLayout(tb.layout);
                    setSavedId(tb.id);
                    setName("");
                  }}
                >
                  {t("Use")}
                </button>
                <button className="small" onClick={() => void exportTable(tb).then(setExported)}>
                  {t("Export")}
                </button>
                <button
                  className="quiet small"
                  onClick={() =>
                    confirm(t("Take {name} out of your library?", { name: tb.name })) && remove(tb.id)
                  }
                >
                  {t("Remove")}
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <label className="file button small">
        {t("Open a table file")}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void importTableFile(file).then((r) =>
                setNote(typeof r === "string" ? r : t("{name} is in your table library.", { name: r.name })),
              );
            e.target.value = "";
          }}
        />
      </label>
      {/* i18n-ignore */}
      {exported && <SavedNote file={exported} kind="table" />}
      {note && <p className="muted small">{note}</p>}
    </details>
  );
}
