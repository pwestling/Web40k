import { useEffect, useState } from "react";
import type { Model, Unit } from "../core";
import { bindingKey, restyleUnit, unitKeys, useAssets } from "../assets/store";
import { MODEL_EXTENSIONS } from "../assets/types";
import { dressFromLibrary } from "../figures/actions";
import { useFigures } from "../figures/library";
import { suggestions } from "../figures/match";
import { openLibrary } from "../figures/open";
import { t } from "../i18n";

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
      <summary>{t("Figures")}</summary>
      {editable && (
        <p className="muted small">
          {t("Everyone in the game sees uploaded figures. You can also drop a model file onto the unit.")}
        </p>
      )}
      {editable && keys.length > 1 && (
        <label className="check small">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />{" "}
          {t("Use for every model in this unit")}
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
      {figure && !asset && (
        <span className="muted small">{t("Fetching {name}…", { name: figure.name })}</span>
      )}
      {editable && (
        <label
          className="file button small"
          title={
            asset
              ? t("{name}: {triangles} triangles, drawn at {levels} depending on distance", {
                  name: asset.name,
                  triangles: k(asset.stats.sourceTriangles),
                  levels: asset.stats.lodTriangles.map(k).join(" / "),
                })
              : t("Model file: {extensions}", { extensions: MODEL_EXTENSIONS.join(", ") })
          }
        >
          {figure ? t("Replace…") : t("Upload…")}
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
      {editable && <FromLibrary unit={unit} label={label} keys={keys} current={figure?.asset} />}
      {editable && figure && (
        <>
          <button
            className="small"
            title={t("Turn the figure 90°")}
            onClick={() => restyle({ yaw: figure.yaw + Math.PI / 2 })}
          >
            ⟳
          </button>
          <button
            className="small"
            title={t("Smaller")}
            onClick={() => restyle({ scale: figure.scale / 1.1 })}
          >
            −
          </button>
          <button
            className="small"
            title={t("Bigger")}
            onClick={() => restyle({ scale: figure.scale * 1.1 })}
          >
            +
          </button>
          <button className="small" title={t("Back to the stand-in")} onClick={() => restyle(null)}>
            ✕
          </button>
        </>
      )}
      {!editable && figure && <span className="muted small">{figure.name}</span>}
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}

/** Dress the models from the figure library (#33): figures that fit the unit's name first. */
function FromLibrary({
  unit,
  label,
  keys,
  current,
}: {
  unit: Unit;
  label: string;
  keys: string[];
  current: string | undefined;
}) {
  const entries = useFigures((s) => s.entries);
  useEffect(() => void useFigures.getState().load(), []);
  const figures = Object.values(entries)
    .filter((e) => e.kind === "miniature")
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!figures.length) return null;
  const fits = suggestions(figures, label === unit.name ? unit.name : label);
  const rest = figures.filter((e) => !fits.includes(e));
  return (
    <select
      className="small"
      aria-label={t("Figure from the library for {name}", { name: label })}
      value=""
      onChange={(e) => {
        const id = e.target.value;
        if (id === "open") openLibrary();
        else if (id) void dressFromLibrary(unit.id, id, keys);
      }}
    >
      <option value="">{t("From the library…")}</option>
      {fits.length > 0 && (
        <optgroup label={t("Fits this unit")}>
          {fits.map((f) => (
            <option key={f.id} value={f.id} disabled={f.id === current}>
              {f.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={fits.length ? t("Everything else") : t("Your figures")}>
        {rest.map((f) => (
          <option key={f.id} value={f.id} disabled={f.id === current}>
            {f.name}
          </option>
        ))}
      </optgroup>
      <option value="open">{t("Open the figure library…")}</option>
    </select>
  );
}
