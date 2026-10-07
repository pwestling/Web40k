import { useState } from "react";
import type { Model } from "../core";
import { unitKeys, useAssets } from "../assets/store";
import { MODEL_EXTENSIONS } from "../assets/parse";

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Upload a 3D figure for the unit, or one per kind of model in it. Figures
 * are stored in this browser and shown only here for now. A file can also
 * be dropped onto a unit on the table (see FigureDrop in Board).
 */
export function FigurePicker({ models, unitName }: { models: Model[]; unitName: string }) {
  const keys = unitKeys(models);
  const [whole, setWhole] = useState(true);
  const rows =
    whole || keys.length === 1
      ? [{ label: unitName, keys }]
      : keys.map((key) => ({ label: key, keys: [key] }));

  return (
    <details className="figures">
      <summary>Figures</summary>
      <p className="muted small">
        Only you see uploaded figures for now. You can also drop a model file onto the unit.
      </p>
      {keys.length > 1 && (
        <label className="check small">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Use for every
          model in this unit
        </label>
      )}
      {rows.map((row) => (
        <FigureRow key={row.label} label={row.label} keys={row.keys} />
      ))}
    </details>
  );
}

function FigureRow({ label, keys }: { label: string; keys: string[] }) {
  const { bindings, assets, status, importFor, setBinding } = useAssets();
  const b = bindings[keys[0]!];
  const asset = b && assets[b.asset];
  const message = keys.map((key) => status[key]).find(Boolean);
  const each = (fn: (key: string) => void) => keys.forEach(fn);
  return (
    <div className="row wrap figure">
      <span>{label}</span>
      <label
        className="file button small"
        title={
          asset
            ? `${asset.name}: ${k(asset.stats.sourceTriangles)} triangles, drawn at ${asset.stats.lodTriangles.map(k).join(" / ")} depending on distance`
            : `Model file: ${MODEL_EXTENSIONS.join(", ")}`
        }
      >
        {asset ? "Replace…" : "Upload…"}
        <input
          type="file"
          accept={MODEL_EXTENSIONS.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFor(keys, file);
          }}
        />
      </label>
      {asset && (
        <>
          <button
            className="small"
            title="Turn the figure 90°"
            onClick={() => each((key) => setBinding(key, { yaw: (bindings[key]?.yaw ?? 0) + Math.PI / 2 }))}
          >
            ⟳
          </button>
          <button
            className="small"
            title="Smaller"
            onClick={() => each((key) => setBinding(key, { scale: (bindings[key]?.scale ?? 1) / 1.1 }))}
          >
            −
          </button>
          <button
            className="small"
            title="Bigger"
            onClick={() => each((key) => setBinding(key, { scale: (bindings[key]?.scale ?? 1) * 1.1 }))}
          >
            +
          </button>
          <button
            className="small"
            title="Back to the stand-in"
            onClick={() => each((key) => setBinding(key, null))}
          >
            ✕
          </button>
        </>
      )}
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}
