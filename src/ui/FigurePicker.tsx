import type { Model } from "../core";
import { bindingKey, useAssets } from "../assets/store";
import { MODEL_EXTENSIONS } from "../assets/parse";

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Upload a 3D figure for each kind of model in the unit. Figures are stored
 * in this browser and shown only here for now; opponents still see stand-ins.
 */
export function FigurePicker({ models }: { models: Model[] }) {
  const { bindings, assets, status, importFor, setBinding } = useAssets();
  const kinds = new Map<string, Model>();
  for (const m of models) if (!kinds.has(bindingKey(m))) kinds.set(bindingKey(m), m);

  return (
    <details className="figures">
      <summary>Figures</summary>
      {[...kinds.keys()].map((key) => {
        const b = bindings[key];
        const asset = b && assets[b.asset];
        return (
          <div key={key} className="row wrap figure">
            <span>{key}</span>
            <label className="file button small">
              {asset ? "Replace…" : "Upload…"}
              <input
                type="file"
                accept={MODEL_EXTENSIONS.join(",")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importFor(key, file);
                }}
              />
            </label>
            {asset && (
              <>
                <button
                  className="small"
                  title="Turn the figure 90°"
                  onClick={() => setBinding(key, { yaw: b.yaw + Math.PI / 2 })}
                >
                  ⟳
                </button>
                <button
                  className="small"
                  title="Smaller"
                  onClick={() => setBinding(key, { scale: b.scale / 1.1 })}
                >
                  −
                </button>
                <button
                  className="small"
                  title="Bigger"
                  onClick={() => setBinding(key, { scale: b.scale * 1.1 })}
                >
                  +
                </button>
                <button className="small" title="Back to the stand-in" onClick={() => setBinding(key, null)}>
                  ✕
                </button>
                <span
                  className="muted small"
                  title={`Levels: ${asset.stats.lodTriangles.map(k).join(" / ")} triangles; processed in ${asset.stats.ms} ms`}
                >
                  {k(asset.stats.sourceTriangles)} → {k(asset.stats.lodTriangles[0]!)} tris
                </span>
              </>
            )}
            {status[key] && <span className="muted small">{status[key]}</span>}
          </div>
        );
      })}
    </details>
  );
}
