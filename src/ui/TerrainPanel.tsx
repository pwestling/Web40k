import type { Layout, TerrainCategory, TerrainPiece } from "../core";
import { standardLayout, TEMPLATES, zones, makePiece, type ZonePreset } from "../systems/wh40k/layout";
import { CATEGORY_RULES } from "../systems/wh40k/rules";
import { useStore } from "../store";
import { useGame } from "./hooks";

/** Rotate a terrain piece by `deg` degrees (Q / E while editing). */
export function rotateTerrain(id: string, deg: number) {
  const { game, dispatch } = useStore.getState();
  const piece = game.terrain.find((t) => t.id === id);
  if (piece)
    dispatch({ type: "terrain/update", piece: { ...piece, facing: piece.facing + (deg * Math.PI) / 180 } });
}

export function removeTerrain(id: string) {
  const { dispatch, set } = useStore.getState();
  dispatch({ type: "terrain/remove", id });
  set({ selectedTerrain: null });
}

const newId = () => `t-${crypto.randomUUID().slice(0, 8)}`;

/**
 * The terrain editor: add pieces, drag them on the table, rotate, change
 * their rules category, and save or load whole layouts.
 */
export function TerrainPanel() {
  const game = useGame();
  const { dispatch, selectedTerrain, set } = useStore();
  const piece = game.terrain.find((t) => t.id === selectedTerrain);

  const add = (name: string) => {
    const id = newId();
    dispatch({ type: "terrain/add", piece: makePiece(name, id, { x: 0, y: 0 }) });
    set({ selectedTerrain: id });
  };
  const update = (patch: Partial<TerrainPiece>) =>
    piece && dispatch({ type: "terrain/update", piece: { ...piece, ...patch } });
  const layout = (): Layout => ({ terrain: game.terrain, objectives: game.objectives, zones: game.zones });
  const save = () => {
    const blob = new Blob([JSON.stringify({ format: "open-battle/layout@1", ...layout() })], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "open-battle-layout.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const load = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Partial<Layout> & { format?: string };
      if (!Array.isArray(data.terrain)) throw new Error("no terrain");
      dispatch({
        type: "layout/set",
        layout: {
          terrain: data.terrain,
          objectives: data.objectives ?? game.objectives,
          zones: data.zones ?? game.zones,
        },
      });
    } catch {
      alert("That file is not an Open Battle layout.");
    }
  };
  const zonePreset: ZonePreset = !game.zones.length
    ? "none"
    : Math.abs(game.zones[0]!.points[0]!.y - game.zones[0]!.points[2]!.y) >= game.table.depth - 0.1
      ? "short"
      : "long";

  return (
    <div className="panel terrainpanel">
      <div className="row spread">
        <strong>Edit terrain</strong>
        <button onClick={() => set({ editing: false, selectedTerrain: null })}>Done</button>
      </div>
      <p className="muted small">
        Drag terrain and objectives on the table. Q / E rotate the selected piece, Delete removes it.
      </p>
      <div className="row wrap">
        {TEMPLATES.map((t) => (
          <button key={t.name} className="small" onClick={() => add(t.name)}>
            + {t.name}
          </button>
        ))}
      </div>

      {piece ? (
        <div className="selected-terrain">
          <div className="row spread">
            <strong>{piece.name}</strong>
            <span className="row">
              <button className="small" onClick={() => rotateTerrain(piece.id, -15)}>
                ⟲ 15°
              </button>
              <button className="small" onClick={() => rotateTerrain(piece.id, 15)}>
                ⟳ 15°
              </button>
              <button className="small" onClick={() => rotateTerrain(piece.id, 90)}>
                90°
              </button>
            </span>
          </div>
          <label>
            Category{" "}
            <select
              value={piece.category}
              onChange={(e) => update({ category: e.target.value as TerrainCategory })}
            >
              {Object.entries(CATEGORY_RULES).map(([k, r]) => (
                <option key={k} value={k}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">{CATEGORY_RULES[piece.category].help}</p>
          <div className="row">
            <button
              className="small"
              onClick={() => {
                const id = newId();
                dispatch({
                  type: "terrain/add",
                  piece: { ...piece, id, position: { x: piece.position.x + 2, y: piece.position.y + 2 } },
                });
                set({ selectedTerrain: id });
              }}
            >
              Duplicate
            </button>
            <button className="small danger" onClick={() => removeTerrain(piece.id)}>
              Delete
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small">Click a piece to select it.</p>
      )}

      <hr />
      <div className="row wrap">
        <label>
          Deployment{" "}
          <select
            value={zonePreset}
            onChange={(e) =>
              dispatch({
                type: "layout/set",
                layout: { ...layout(), zones: zones(e.target.value as ZonePreset) },
              })
            }
          >
            <option value="long">Long edges (12")</option>
            <option value="short">Short edges (18")</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <div className="row wrap">
        <button className="small" onClick={() => dispatch({ type: "layout/set", layout: standardLayout() })}>
          Standard table
        </button>
        <button
          className="small"
          onClick={() => dispatch({ type: "layout/set", layout: { ...layout(), terrain: [] } })}
        >
          Clear terrain
        </button>
        <button className="small" onClick={save}>
          Save layout
        </button>
        <label className="file button small">
          Load layout
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
          />
        </label>
      </div>
      <hr />
      <label>
        Cover{" "}
        <select
          value={game.settings.cover}
          onChange={(e) =>
            dispatch({ type: "settings/set", settings: { cover: e.target.value as "hit" | "save" } })
          }
        >
          <option value="hit">−1 to hit (11th edition, per research notes)</option>
          <option value="save">+1 to save (10th edition)</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={game.settings.modelsBlock}
          onChange={(e) => dispatch({ type: "settings/set", settings: { modelsBlock: e.target.checked } })}
        />
        Models from other units block line of sight
      </label>
    </div>
  );
}
