import {
  footprintVisibility,
  standInHeight,
  systemOf,
  type Layout,
  type TerrainCategory,
  type TerrainPiece,
} from "../core";
import { standardLayout, TEMPLATES, zones, makePiece, type ZonePreset } from "../systems/wh40k/layout";
import { systemModule } from "../systems";
import { CATEGORY_RULES } from "../systems/wh40k/rules";
import { useStore } from "../store";
import { useAssets } from "../assets/store";
import type { ModelAsset } from "../assets/types";
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

const MESH_FILES = ".glb,.gltf,.stl,.obj,.ply";
const UPLOAD = "terrain-upload";

/** A piece's shape taken from a processed terrain model, at a scale. */
function meshShape(
  asset: ModelAsset,
  scale: number,
): Pick<TerrainPiece, "width" | "depth" | "solids" | "hull" | "mesh"> {
  const { min, max } = asset.bounds;
  return {
    width: Math.max(0.5, (max[0] - min[0]) * scale),
    depth: Math.max(0.5, (max[2] - min[2]) * scale),
    solids: (asset.solids ?? []).map((b) => ({
      ...b,
      x: b.x * scale,
      y: b.y * scale,
      z: b.z * scale,
      w: b.w * scale,
      d: b.d * scale,
      h: b.h * scale,
    })),
    hull: asset.hull?.map((n) => n * scale),
    mesh: { asset: asset.id, name: asset.name, scale },
  };
}

/**
 * The terrain editor: add pieces, drag them on the table, rotate, change
 * their rules category, and save or load whole layouts.
 */
export function TerrainPanel() {
  const game = useGame();
  const { dispatch, selectedTerrain, set } = useStore();
  const piece = game.terrain.find((t) => t.id === selectedTerrain);
  // The game system's own terrain categories, or 40k's.
  const system = systemOf(game);
  const categories = system.terrain?.length
    ? system.terrain.map((c) => ({ id: c.id, label: c.name, help: categoryHelp(c) }))
    : Object.entries(CATEGORY_RULES).map(([id, r]) => ({ id, label: r.label, help: r.help }));
  const templateCategory = systemModule(game.system).templateCategory;

  const add = (name: string) => {
    const id = newId();
    dispatch({
      type: "terrain/add",
      piece: makePiece(name, id, { x: 0, y: 0 }, 0, templateCategory?.[name]),
    });
    set({ selectedTerrain: id });
  };
  const update = (patch: Partial<TerrainPiece>) =>
    piece && dispatch({ type: "terrain/update", piece: { ...piece, ...patch } });
  const uploadStatus = useAssets((a) => a.status[UPLOAD]);
  const meshAsset = useAssets((a) => (piece?.mesh ? a.assets[piece.mesh.asset] : undefined));
  /** Process a model file; on the selected piece it replaces the shape, otherwise it adds a piece. */
  const upload = async (file: File, onto?: TerrainPiece) => {
    const asset = await useAssets.getState().importFile(file, UPLOAD, "terrain");
    if (!asset) return;
    if (onto) {
      dispatch({ type: "terrain/update", piece: { ...onto, ...meshShape(asset, 1) } });
      return;
    }
    const id = newId();
    const base = makePiece("Ruin", id, { x: 0, y: 0 }, 0, templateCategory?.["Ruin"]);
    dispatch({
      type: "terrain/add",
      piece: { ...base, name: asset.name.replace(/\.[^.]+$/, ""), ...meshShape(asset, 1) },
    });
    set({ selectedTerrain: id });
  };
  const rescale = (scale: number) => {
    if (!piece?.mesh || !meshAsset || !(scale > 0)) return;
    update(meshShape(meshAsset, scale));
  };
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
        <label className="file button small" title="A .glb, .gltf, .stl, .obj or .ply terrain model">
          + From 3D model
          <input
            type="file"
            accept={MESH_FILES}
            onChange={(e) => {
              if (e.target.files?.[0]) void upload(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {uploadStatus && <p className="muted small">{uploadStatus}</p>}

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
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">{categories.find((c) => c.id === piece.category)?.help}</p>
          {game.settings.los === "footprint" ? (
            <label>
              Sight{" "}
              <select
                value={footprintVisibility(piece)}
                onChange={(e) => update({ visibility: e.target.value as "open" | "obscuring" | "blocking" })}
              >
                <option value="open">Open: no effect</option>
                <option value="obscuring">Obscuring: gives cover</option>
                <option value="blocking">Blocking: blocks sight</option>
              </select>
            </label>
          ) : (
            <label>
              Blocks sight by{" "}
              <select
                value={piece.sight ?? ""}
                onChange={(e) => update({ sight: (e.target.value || undefined) as TerrainPiece["sight"] })}
              >
                <option value="">Game setting</option>
                <option value="true">Its shape</option>
                <option value="heights">Stand-in height</option>
              </select>
            </label>
          )}
          {(piece.sight ?? game.settings.los) === "heights" && (
            <label>
              Stand-in height{" "}
              <input
                type="number"
                min={0}
                step={0.5}
                value={standInHeight(piece)}
                onChange={(e) => update({ losHeight: Math.max(0, Number(e.target.value)) })}
              />
              "
            </label>
          )}
          <div className="row wrap">
            <label className="file button small" title="Replace this piece's shape with a terrain model">
              {piece.mesh ? "Change 3D model" : "Use 3D model"}
              <input
                type="file"
                accept={MESH_FILES}
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0], piece);
                  e.target.value = "";
                }}
              />
            </label>
            {piece.mesh && (
              <label title="Scale the model; its footprint and line-of-sight shape follow">
                Scale{" "}
                <input
                  type="number"
                  className="frontage"
                  min={0.1}
                  step={0.1}
                  disabled={!meshAsset}
                  value={piece.mesh.scale}
                  onChange={(e) => rescale(Number(e.target.value))}
                />
                ×
              </label>
            )}
            {piece.mesh && (
              <span className="muted small">
                {Number(piece.width.toFixed(1))}" × {Number(piece.depth.toFixed(1))}"
              </span>
            )}
          </div>
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
    </div>
  );
}

/** One line on what a system's terrain category does. */
function categoryHelp(c: NonNullable<ReturnType<typeof systemOf>["terrain"]>[number]): string {
  const parts: string[] = [];
  if (c.cover)
    parts.push(`Cover${c.coverFor ? ` for ${c.coverFor.join(", ").toLowerCase()}` : ""} in or touching it.`);
  if (c.visibility === "blocking") parts.push("Blocks sight.");
  if (c.visibility === "obscuring") parts.push("Gives cover when between shooter and target.");
  if (c.blocksMovement) parts.push("Impassable.");
  return parts.join(" ") || "No effect.";
}
