import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAssets } from "../assets/store";
import type { BaseShape, Unit } from "../core";
import { t } from "../i18n";
import { autoMask, baseTop, baseWidth, bounds, brush, type Mask } from "./cutout";
import { standeeBytes, STANDEE_EXTENSION } from "./file";

/**
 * Your painted army on the table (#68): photograph a miniature on a plain
 * backdrop (a sheet of paper does), and the app cuts it out and stands it on
 * its base. One photo dresses every model of the kind; a back photo is
 * optional. The cut-out is the player's to fix with a brush.
 */

/** Photos are worked at most this many pixels on their long side: plenty for a 512 px texture, quick to cut out. */
const WORK = 720;

interface Side {
  img: ImageData;
  mask: Mask;
  tolerance: number | undefined;
}

/** The base's frontage in millimetres: what the photo's base is scaled to. */
function frontageMm(base: BaseShape): number {
  return base.shape === "round" ? base.diameterMm : base.widthMm;
}

async function readPhoto(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, WORK / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return g.getImageData(0, 0, w, h);
}

/** The cut-out, cropped to the miniature with a small margin, as a transparent image. */
function cutout(side: Side): { url: string; box: { x: number; y: number } } | null {
  const { img, mask } = side;
  const box = bounds(mask, img.width, img.height);
  if (!box) return null;
  const pad = 2;
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(img.width, box.x + box.width + pad);
  const y1 = Math.min(img.height, box.y + box.height + pad);
  const c = document.createElement("canvas");
  c.width = x1 - x0;
  c.height = y1 - y0;
  const out = new ImageData(c.width, c.height);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * img.width + x;
      const o = ((y - y0) * c.width + (x - x0)) * 4;
      out.data[o] = img.data[i * 4]!;
      out.data[o + 1] = img.data[i * 4 + 1]!;
      out.data[o + 2] = img.data[i * 4 + 2]!;
      out.data[o + 3] = mask[i]!;
    }
  c.getContext("2d")!.putImageData(out, 0, 0);
  // WebP keeps the transparency small; browsers that can't write it give PNG.
  return { url: c.toDataURL("image/webp", 0.9), box: { x: x0, y: y0 } };
}

export function StandeeMaker({
  unit,
  keys,
  label,
  base,
  onClose,
}: {
  unit: Unit;
  keys: string[];
  label: string;
  base: BaseShape;
  onClose: () => void;
}) {
  const [front, setFront] = useState<Side | null>(null);
  const [back, setBack] = useState<Side | null>(null);
  const [editing, setEditing] = useState<"front" | "back">("front");
  const [name, setName] = useState(label);
  const [trim, setTrim] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dressUnit = useAssets((s) => s.dressUnit);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const take = async (file: File | undefined, which: "front" | "back") => {
    if (!file) return;
    setError("");
    try {
      const img = await readPhoto(file);
      const side = { img, mask: autoMask(img), tolerance: undefined };
      (which === "front" ? setFront : setBack)(side);
      setEditing(which);
    } catch {
      setError(t("That photo couldn't be read. Try a JPEG or PNG."));
    }
  };

  const use = async () => {
    if (!front) return;
    const box = bounds(front.mask, front.img.width, front.img.height);
    if (!box) return setError(t("Nothing is left of the miniature: paint it back with Keep."));
    const basePx = baseWidth(front.mask, front.img.width, box);
    // The table draws the base: the photo's own is cut off, so the miniature stands on it.
    const trimmed = (side: Side, top: number) => {
      if (!trim) return side;
      const mask = side.mask.slice();
      mask.fill(0, top * side.img.width);
      return { ...side, mask };
    };
    const f = cutout(trimmed(front, baseTop(front.mask, front.img.width, box, basePx)));
    if (!f) return setError(t("Nothing is left of the miniature: paint it back with Keep."));
    setBusy(true);
    const backBox = back && bounds(back.mask, back.img.width, back.img.height);
    const b =
      back && backBox
        ? cutout(
            trimmed(
              back,
              baseTop(back.mask, back.img.width, backBox, baseWidth(back.mask, back.img.width, backBox)),
            ),
          )
        : null;
    const bytes = standeeBytes({
      name: name.trim() || label,
      basePx,
      baseMm: frontageMm(base),
      front: f.url,
      ...(b ? { back: b.url } : {}),
    });
    const file = new File([bytes as BlobPart], `${(name.trim() || label).slice(0, 60)}${STANDEE_EXTENSION}`);
    await dressUnit(unit.id, keys, file);
    setBusy(false);
    onClose();
  };

  const current = editing === "front" ? front : back;
  const setCurrent = editing === "front" ? setFront : setBack;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel modal standee-maker"
        role="dialog"
        aria-label={t("Photo standee for {name}", { name: label })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h3>{t("Photo standee for {name}", { name: label })}</h3>
          <button className="quiet" title={t("Close")} aria-label={t("Close")} onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">
          {t(
            "Stand the painted miniature on a plain sheet of paper and photograph it from the front, at its eye level, base and all. The app cuts it out and scales it to its base; one photo dresses every {name}.",
            { name: label },
          )}
        </p>
        <div className="row wrap">
          <PhotoButtons
            label={front ? t("Retake the front") : t("Front photo")}
            onFile={(f) => take(f, "front")}
          />
          {front && (
            <PhotoButtons
              label={back ? t("Retake the back") : t("Back photo (optional)")}
              onFile={(f) => take(f, "back")}
              quiet
            />
          )}
        </div>
        {front && back && (
          <div className="row tabs small" role="tablist">
            {(["front", "back"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={editing === s}
                className={editing === s ? "on" : ""}
                onClick={() => setEditing(s)}
              >
                {s === "front" ? t("Front") : t("Back")}
              </button>
            ))}
          </div>
        )}
        {current && <CutoutEditor side={current} onChange={setCurrent} />}
        {error && <p className="warn small">{error}</p>}
        {front && (
          <div className="row wrap">
            <label className="small">
              {t("Name")} <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="check small">
              <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />{" "}
              {t("Stand it on the table's base (cut the photo's base off)")}
            </label>
            <button className="primary" disabled={busy} onClick={() => void use()}>
              {busy ? t("Standing it up…") : t("Use for {name}", { name: label })}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Take a photo with the camera (phones) or choose one. */
function PhotoButtons({
  label,
  onFile,
  quiet,
}: {
  label: string;
  onFile: (f: File | undefined) => void;
  quiet?: boolean;
}) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    onFile(file);
  };
  return (
    <span className="row photo-buttons">
      <strong className="small">{label}</strong>
      <label className={`file button small${quiet ? "" : " primary"}`}>
        📷 {t("Take a photo")}
        <input type="file" accept="image/*" capture="environment" onChange={pick} />
      </label>
      <label className="file button small">
        {t("Choose a photo…")}
        <input type="file" accept="image/*" onChange={pick} />
      </label>
    </span>
  );
}

/** The photo with what's cut faded out; a brush to keep or cut, and how much counts as backdrop. */
function CutoutEditor({ side, onChange }: { side: Side; onChange: (s: Side) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [keep, setKeep] = useState(false);
  const [size, setSize] = useState(() => Math.round(Math.max(side.img.width, side.img.height) * 0.025));
  const painting = useRef(false);
  const { img, mask } = side;

  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const out = new ImageData(img.width, img.height);
    for (let i = 0; i < mask.length; i++) {
      const o = i * 4;
      if (mask[i]) {
        out.data[o] = img.data[o]!;
        out.data[o + 1] = img.data[o + 1]!;
        out.data[o + 2] = img.data[o + 2]!;
        out.data[o + 3] = 255;
      } else {
        // Cut: a faint red ghost, so a missing sword tip is easy to spot.
        out.data[o] = 200;
        out.data[o + 1] = 40;
        out.data[o + 2] = 40;
        out.data[o + 3] = 50;
      }
    }
    g.clearRect(0, 0, c.width, c.height);
    g.putImageData(out, 0, 0);
  };
  useEffect(draw);

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * img.width;
    const y = ((e.clientY - r.top) / r.height) * img.height;
    brush(mask, img.width, img.height, x, y, size, keep);
    draw();
  };

  const tolerance = side.tolerance ?? 0;
  return (
    <div className="cutout-editor">
      <canvas
        ref={canvas}
        width={img.width}
        height={img.height}
        className="checker"
        aria-label={t("The cut-out: paint to keep or cut")}
        onPointerDown={(e) => {
          painting.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          paint(e);
        }}
        onPointerMove={(e) => painting.current && paint(e)}
        onPointerUp={() => {
          painting.current = false;
          onChange({ ...side });
        }}
      />
      <div className="row wrap small">
        <span className="row" role="group" aria-label={t("Brush")}>
          <button className={keep ? "on" : ""} aria-pressed={keep} onClick={() => setKeep(true)}>
            {t("Keep")}
          </button>
          <button className={!keep ? "on" : ""} aria-pressed={!keep} onClick={() => setKeep(false)}>
            {t("Cut")}
          </button>
        </span>
        <label>
          {t("Brush size")}{" "}
          <input
            type="range"
            min={2}
            max={Math.round(Math.max(img.width, img.height) * 0.08)}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <label>
          {t("Backdrop")}{" "}
          <input
            type="range"
            min={-60}
            max={60}
            step={10}
            value={tolerance}
            title={t("Move right if bits of the backdrop are left, left if bits of the miniature are cut")}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ img, mask: autoMask(img, v ? { adjust: v } : {}), tolerance: v || undefined });
            }}
          />
        </label>
        <button
          className="quiet"
          onClick={() => onChange({ img, mask: autoMask(img), tolerance: undefined })}
        >
          {t("Start again")}
        </button>
      </div>
    </div>
  );
}
