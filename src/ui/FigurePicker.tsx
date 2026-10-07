import { useState } from "react";
import type { Model, Unit } from "../core";
import { bindingKey, restyleUnit, unitKeys, useAssets } from "../assets/store";
import { MODEL_EXTENSIONS } from "../assets/parse";

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Upload a 3D figure for the unit, or one per kind of model in it. Everyone
 * in the game sees it once the simplified meshes reach them. A file can also
 * be dropped onto a unit on the table (see FigureDrop in Board).
 */
export function FigurePicker({ unit, models, editable }: { unit: Unit; models: Model[]; editable: boolean }) {
  const keys = unitKeys(models);
  const [whole, setWhole] = useState(true);
  const rows =
    whole || keys.length === 1
      ? [{ label: unit.name, keys }]
      : keys.map((key) => ({ label: key, keys: [key] }));
  if (!editable && !models.some((m) => m.figure)) return null;

  return (
    <details className="figures">
      <summary>Figures</summary>
      {editable && (
        <p className="muted small">
          Everyone in the game sees uploaded figures. You can also drop a model file onto the unit.
        </p>
      )}
      {editable && keys.length > 1 && (
        <label className="check small">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Use for every
          model in this unit
        </label>
      )}
      {rows.map((row) => (
        <FigureRow
          key={row.label}
          unit={unit}
          label={row.label}
          keys={row.keys}
          models={models.filter((m) => row.keys.includes(bindingKey(m)))}
          editable={editable}
        />
      ))}
    </details>
  );
}

function FigureRow({
  unit,
  label,
  keys,
  models,
  editable,
}: {
  unit: Unit;
  label: string;
  keys: string[];
  models: Model[];
  editable: boolean;
}) {
  const { assets, status, dressUnit } = useAssets();
  const figure = models.find((m) => m.figure)?.figure;
  const asset = figure && assets[figure.asset];
  const message = status[unit.id];
  const restyle = (patch: Parameters<typeof restyleUnit>[2]) => restyleUnit(unit.id, keys, patch);
  return (
    <div className="row wrap figure">
      <span>{label}</span>
      {figure && !asset && <span className="muted small">Fetching {figure.name}…</span>}
      {editable && (
        <label
          className="file button small"
          title={
            asset
              ? `${asset.name}: ${k(asset.stats.sourceTriangles)} triangles, drawn at ${asset.stats.lodTriangles.map(k).join(" / ")} depending on distance`
              : `Model file: ${MODEL_EXTENSIONS.join(", ")}`
          }
        >
          {figure ? "Replace…" : "Upload…"}
          <input
            type="file"
            accept={MODEL_EXTENSIONS.join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void dressUnit(unit.id, keys, file);
            }}
          />
        </label>
      )}
      {editable && figure && (
        <>
          <button
            className="small"
            title="Turn the figure 90°"
            onClick={() => restyle({ yaw: figure.yaw + Math.PI / 2 })}
          >
            ⟳
          </button>
          <button className="small" title="Smaller" onClick={() => restyle({ scale: figure.scale / 1.1 })}>
            −
          </button>
          <button className="small" title="Bigger" onClick={() => restyle({ scale: figure.scale * 1.1 })}>
            +
          </button>
          <button className="small" title="Back to the stand-in" onClick={() => restyle(null)}>
            ✕
          </button>
        </>
      )}
      {!editable && figure && <span className="muted small">{figure.name}</span>}
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}
