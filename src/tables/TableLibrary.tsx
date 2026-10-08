import { useEffect, useState } from "react";
import { getSystem } from "../core/content/systems";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { useStore } from "../store";
import { SavedNote } from "../ui/SavedNote";
import { useGame } from "../ui/hooks";
import { applyLayout, exportTable, importTableFile, saveTable } from "./actions";
import { deploymentLine, modelsLine, useTables, type SavedTable } from "./library";
import { starterLayout, starters } from "./starters";
import { TableThumb } from "./TableThumb";
import { SightlinesToggle } from "./Sightlines";

const systemName = (id: string) => {
  try {
    return getSystem(id).name;
  } catch {
    return id || "another game";
  }
};

const saved = (t: SavedTable) =>
  new Date(t.savedAt).toLocaleString(undefined, {
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
  const [picked, setPicked] = useState("");
  useEffect(() => {
    void useTables.getState().load();
  }, []);
  if (game.turn.round > 0 || role === "spectator") return null;
  const mine = Object.values(tables)
    .filter((t) => t.system === (game.system ?? DEFAULT_SYSTEM))
    .sort((a, b) => b.savedAt - a.savedAt);
  const pick = (value: string) => {
    setPicked(value);
    if (value.startsWith("starter:")) {
      const id = value.slice(8);
      void applyLayout(starterLayout(game.system, game.table, id, seed[id] ?? 1));
    } else if (value.startsWith("table:")) {
      const t = tables[value.slice(6)];
      if (t) void applyLayout(t.layout);
    }
  };
  const starter = picked.startsWith("starter:") ? picked.slice(8) : null;
  return (
    <div className="table-picker">
      <TableThumb
        layout={{ terrain: game.terrain, objectives: game.objectives, zones: game.zones }}
        table={game.table}
        colors={colors}
        width={84}
        label="This game's table from above"
      />
      <div className="col">
        <select aria-label="Table" value={picked} onChange={(e) => pick(e.target.value)}>
          <option value="">Table: as it is</option>
          <optgroup label="Starter tables">
            {starters().map((s) => (
              <option key={s.id} value={`starter:${s.id}`}>
                {s.name} · {s.blurb.toLowerCase()}
              </option>
            ))}
          </optgroup>
          {mine.length > 0 && (
            <optgroup label="Your table library">
              {mine.map((t) => (
                <option key={t.id} value={`table:${t.id}`}>
                  {t.name} · {deploymentLine(t.layout.zones, t.table).toLowerCase()}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <div className="row wrap">
          {starter && (
            <button
              className="small"
              onClick={() => {
                const next = (seed[starter] ?? 1) + 1;
                setSeed({ ...seed, [starter]: next });
                void applyLayout(starterLayout(game.system, game.table, starter, next));
              }}
            >
              Another like it
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
  const same = (t: SavedTable) => t.system === system;
  const last = savedId ? tables[savedId] : undefined;
  return (
    <details className="fold table-shelf">
      <summary>Table library{loaded ? ` (${all.length})` : ""}</summary>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const id = saveTable(
            name || last?.name || "My table",
            last && (!name || name === last.name) ? last.id : undefined,
          );
          setSavedId(id);
          setNote(`Saved to your table library.`);
        }}
      >
        <input
          aria-label="Table name"
          placeholder={last?.name ?? "Name this table"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="small primary">
          {last && (!name || name === last.name) ? "Update" : "Save table"}
        </button>
      </form>
      <ul className="tables">
        {all.map((t) => (
          <li key={t.id} className={same(t) ? "" : "other"}>
            <TableThumb
              layout={t.layout}
              table={t.table}
              colors={colors}
              width={72}
              label={`${t.name} from above`}
            />
            <div className="col">
              <strong>{t.name}</strong>
              <span className="muted small">
                {systemName(t.system)} · {deploymentLine(t.layout.zones, t.table)} · {t.layout.terrain.length}{" "}
                pieces · {saved(t)}
              </span>
              {modelsLine(t.layout) && <span className="muted small">{modelsLine(t.layout)}</span>}
              <span className="row">
                <button
                  className="small"
                  disabled={!same(t)}
                  title={same(t) ? "Set this table up for everyone" : "This table is for another game"}
                  onClick={() => {
                    void applyLayout(t.layout);
                    setSavedId(t.id);
                    setName("");
                  }}
                >
                  Use
                </button>
                <button className="small" onClick={() => void exportTable(t).then(setExported)}>
                  Export
                </button>
                <button
                  className="quiet small"
                  onClick={() => confirm(`Take ${t.name} out of your library?`) && remove(t.id)}
                >
                  Remove
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <label className="file button small">
        Open a table file
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void importTableFile(file).then((r) =>
                setNote(typeof r === "string" ? r : `${r.name} is in your table library.`),
              );
            e.target.value = "";
          }}
        />
      </label>
      {exported && <SavedNote file={exported} kind="table" />}
      {note && <p className="muted small">{note}</p>}
    </details>
  );
}
