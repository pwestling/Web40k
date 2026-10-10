import { inchText } from "./distance";
import {
  footprintVisibility,
  standInHeight,
  systemOf,
  type Layout,
  type TerrainCategory,
  type TerrainPiece,
} from "../core";
import { TEMPLATES, zones, makePiece, type ZonePreset } from "../systems/wh40k/layout";
import { systemModule } from "../systems";
import { CATEGORY_RULES } from "../systems/wh40k/rules";
import { t, tn } from "../i18n";
import { useStore } from "../store";
import { useAssets } from "../assets/store";
import type { ModelAsset } from "../assets/types";
import { useGame } from "./hooks";
import {
  addPiece,
  duplicatePieces,
  mirrorPiece,
  removePieces,
  twinOf,
  atCentre,
  unpaired,
  updatePiece,
  updatePieces,
  useTableEdit,
} from "../tables/edit";
import { TableShelf } from "../tables/TableLibrary";
import { meshShape } from "../tables/meshShape";
import { SightlinesToggle } from "../tables/SightlinesToggle";

/** Rotate a terrain piece (and its group) by `deg` degrees (Q / E while editing). */
export function rotateTerrain(id: string, deg: number) {
  const terrain = useStore.getState().game.terrain;
  const { group } = useTableEdit.getState();
  const ids = group.includes(id) ? group : [id];
  updatePieces(
    terrain
      .filter((t) => ids.includes(t.id))
      .map((t) => ({ before: t, after: { ...t, facing: t.facing + (deg * Math.PI) / 180 } })),
  );
}

/** Delete a piece (or the group it's in). */
export function removeTerrain(id: string) {
  const { group } = useTableEdit.getState();
  removePieces(group.includes(id) ? group : [id]);
}

const newId = () => `t-${crypto.randomUUID().slice(0, 8)}`;

const MESH_FILES = ".glb,.gltf,.stl,.obj,.ply";
const UPLOAD = "terrain-upload";

/**
 * How big an uploaded model came in, and how its file was read (millimetres
 * or inches), with a one-press fix when that makes it figure-sized or huge.
 */
function ModelSize({
  asset,
  scale,
  rescale,
}: {
  asset: ModelAsset;
  scale: number;
  rescale: (scale: number) => void;
}) {
  const { min, max } = asset.bounds;
  const across = Math.max(max[0] - min[0], max[2] - min[2]);
  const tall = max[1] - min[1];
  const size = t("{width} × {depth}, {height} tall", {
    width: inchText((max[0] - min[0]) * scale),
    depth: inchText((max[2] - min[2]) * scale),
    height: inchText(tall * scale),
  });
  const small = across * scale < 2;
  const big = across * scale > 24;
  /** A scale that makes it 6" across, a typical ruin or crate stack. */
  const fit = across > 0 ? Number((6 / across).toFixed(2)) : 1;
  return (
    <p className="muted small model-size">
      {scale !== 1
        ? t("Now {size} (scale {scale}×).", { size, scale })
        : asset.stats.unitScale === 1
          ? t("Came in at {size}: the file was read as inches.", { size })
          : t("Came in at {size}: the file was read as millimetres.", { size })}
      {small && <> {t("That's figure-sized for terrain.")}</>}
      {big && <> {t("That's bigger than most terrain.")}</>}
      {(small || big) && (
        <>
          {" "}
          <button className="small" onClick={() => rescale(fit)}>
            {t('Make it 6" across')}
          </button>
        </>
      )}
      {scale !== 1 && (
        <>
          {" "}
          <button className="small" onClick={() => rescale(1)}>
            {t("As it came in")}
          </button>
        </>
      )}
    </p>
  );
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
    const id = addPiece(makePiece(name, newId(), { x: 0, y: 0 }, 0, templateCategory?.[name]));
    set({ selectedTerrain: id });
  };
  const update = (patch: Partial<TerrainPiece>) => piece && updatePiece(piece, patch);
  const uploadStatus = useAssets((a) => a.status[UPLOAD]);
  const meshAsset = useAssets((a) => (piece?.mesh ? a.assets[piece.mesh.asset] : undefined));
  /** Process a model file; on the selected piece it replaces the shape, otherwise it adds a piece. */
  const upload = async (file: File, onto?: TerrainPiece) => {
    const asset = await useAssets.getState().importFile(file, UPLOAD, "terrain");
    if (!asset) return;
    if (onto) {
      updatePiece(onto, meshShape(asset, 1));
      return;
    }
    const base = makePiece("Ruin", newId(), { x: 0, y: 0 }, 0, templateCategory?.["Ruin"]);
    const id = addPiece({ ...base, name: asset.name.replace(/\.[^.]+$/, ""), ...meshShape(asset, 1) });
    set({ selectedTerrain: id });
  };
  const rescale = (scale: number) => {
    if (!piece?.mesh || !meshAsset || !(scale > 0)) return;
    update(meshShape(meshAsset, scale));
  };
  const layout = (): Layout => ({ terrain: game.terrain, objectives: game.objectives, zones: game.zones });
  const { symmetry, snap, group } = useTableEdit();
  const inGroup = !!piece && group.includes(piece.id);
  const lone = symmetry ? unpaired(game.terrain) : [];
  const zonePreset: ZonePreset = !game.zones.length
    ? "none"
    : Math.abs(game.zones[0]!.points[0]!.y - game.zones[0]!.points[2]!.y) >= game.table.depth - 0.1
      ? "short"
      : "long";

  return (
    <div className="panel terrainpanel">
      <div className="row spread">
        <strong>{t("Edit terrain")}</strong>
        <button onClick={() => set({ editing: false, selectedTerrain: null })}>{t("Done")}</button>
      </div>
      <p className="muted small">
        {t(
          "Drag terrain and objectives on the table. Q / E rotate the selected piece, Delete removes it. Shift-click pieces to group them.",
        )}
      </p>
      <div className="row wrap edit-aids">
        <label
          className="check"
          title={t(
            "Every change is made to the piece's twin across the table centre too, so both halves stay the same",
          )}
        >
          <input
            type="checkbox"
            checked={symmetry}
            onChange={(e) => useTableEdit.setState({ symmetry: e.target.checked })}
          />{" "}
          {t("Symmetry")}
        </label>
        <label className="check" title={t("Pieces land on the half inch and turn in 15° steps")}>
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => useTableEdit.setState({ snap: e.target.checked })}
          />{" "}
          {t("Snap")}
        </label>
        <SightlinesToggle />
        {symmetry && lone.length > 0 && (
          <span className="muted small">
            {tn(lone.length, "{n} piece has no twin", "{n} pieces have no twin")}
          </span>
        )}
        {group.length > 0 && (
          <button className="small quiet" onClick={() => useTableEdit.setState({ group: [] })}>
            {t("Ungroup ({count})", { count: group.length })}
          </button>
        )}
      </div>
      <div className="row wrap">
        {TEMPLATES.map((tpl) => (
          <button key={tpl.name} className="small" onClick={() => add(tpl.name)}>
            + {tpl.name}
          </button>
        ))}
        <label className="file button small" title={t("A .glb, .gltf, .stl, .obj or .ply terrain model")}>
          {t("+ From 3D model")}
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
            {t("Category")}{" "}
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
              {t("Sight")}{" "}
              <select
                value={footprintVisibility(piece)}
                onChange={(e) => update({ visibility: e.target.value as "open" | "obscuring" | "blocking" })}
              >
                <option value="open">{t("Open: no effect")}</option>
                <option value="obscuring">{t("Obscuring: gives cover")}</option>
                <option value="blocking">{t("Blocking: blocks sight")}</option>
              </select>
            </label>
          ) : (
            <label>
              {t("Blocks sight by")}{" "}
              <select
                value={piece.sight ?? ""}
                onChange={(e) => update({ sight: (e.target.value || undefined) as TerrainPiece["sight"] })}
              >
                <option value="">{t("Game setting")}</option>
                <option value="true">{t("Its shape")}</option>
                <option value="heights">{t("Stand-in height")}</option>
              </select>
            </label>
          )}
          {(piece.sight ?? game.settings.los) === "heights" && (
            <label>
              {t("Stand-in height")}{" "}
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
            <label className="file button small" title={t("Replace this piece's shape with a terrain model")}>
              {piece.mesh ? t("Change 3D model") : t("Use 3D model")}
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
              <label title={t("Scale the model; its footprint and line-of-sight shape follow")}>
                {t("Scale")}{" "}
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
          {piece.mesh && meshAsset && (
            <ModelSize asset={meshAsset} scale={piece.mesh.scale} rescale={rescale} />
          )}
          <div className="row wrap">
            <button className="small" onClick={() => duplicatePieces(inGroup ? group : [piece.id])}>
              {inGroup ? t("Duplicate the group ({count})", { count: group.length }) : t("Duplicate")}
            </button>
            {symmetry && !atCentre(piece) && !twinOf(game.terrain, piece) && (
              <button
                className="small"
                title={t("Add the same piece across the table centre")}
                onClick={() => mirrorPiece(piece)}
              >
                {t("Give it a twin")}
              </button>
            )}
            <button className="small danger" onClick={() => removeTerrain(piece.id)}>
              {inGroup ? t("Delete the group ({count})", { count: group.length }) : t("Delete")}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small">{t("Click a piece to select it.")}</p>
      )}

      <hr />
      <div className="row wrap">
        <label>
          {t("Deployment")}{" "}
          <select
            value={zonePreset}
            onChange={(e) =>
              dispatch({
                type: "layout/set",
                layout: {
                  ...layout(),
                  zones: zones(e.target.value as ZonePreset, game.table.width, game.table.depth),
                },
              })
            }
          >
            <option value="long">{t('Long edges ({depth}")', { depth: 12 })}</option>
            <option value="short">{t('Short edges ({width}")', { width: 18 })}</option>
            <option value="none">{t("None")}</option>
          </select>
        </label>
      </div>
      <div className="row wrap">
        <button
          className="small"
          onClick={() =>
            dispatch({ type: "layout/set", layout: systemModule(game.system).layout(game.table) as Layout })
          }
        >
          {t("Standard table")}
        </button>
        <button
          className="small"
          onClick={() => dispatch({ type: "layout/set", layout: { ...layout(), terrain: [] } })}
        >
          {t("Clear terrain")}
        </button>
      </div>
      <TableShelf />
    </div>
  );
}

/** One line on what a system's terrain category does. */
function categoryHelp(c: NonNullable<ReturnType<typeof systemOf>["terrain"]>[number]): string {
  const parts: string[] = [];
  if (c.cover)
    parts.push(
      c.coverFor
        ? t("Cover for {kinds} in or touching it.", { kinds: c.coverFor.join(", ").toLowerCase() })
        : t("Cover in or touching it."),
    );
  if (c.visibility === "blocking") parts.push(t("Blocks sight."));
  if (c.visibility === "obscuring") parts.push(t("Gives cover when between shooter and target."));
  if (c.blocksMovement) parts.push(t("Impassable."));
  return parts.join(" ") || t("No effect.");
}
