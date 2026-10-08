import type { AssetTexture, Budget } from "./types";

/**
 * Painted models: every material's base colour texture baked into one
 * square atlas, and colours (material factors times vertex colours) into a
 * per-vertex sRGB colour. One texture and one material per asset keeps an
 * army of painted figures to one draw call per sculpt and level, as before.
 * Uses OffscreenCanvas and createImageBitmap, which workers have; without
 * them (Node tests) the model keeps its colours and drops its textures.
 */

/** A glTF material as far as paint goes. */
export interface PaintMaterial {
  /** baseColorFactor, linear RGBA. */
  factor: [number, number, number, number];
  image?: ImageBitmap;
}

/** One mesh of the upload, in merge order. */
export interface PaintPart {
  vertices: number;
  /** TEXCOORD_0, glTF convention (v down). */
  uvs?: Float32Array;
  /** Vertex colours, linear RGBA 0..1. */
  colors?: Float32Array;
  material?: number;
}

export interface Paint {
  uvs?: Float32Array;
  colors?: Uint8Array;
  atlas?: OffscreenCanvas;
  /** The largest source image, for stats. */
  source?: [number, number];
}

/** Rows of white at the bottom of the atlas, for parts with no texture. */
const STRIP = 8;
/** UVs this far outside 0..1 mean a tiling texture, which an atlas cell can't hold. */
const WRAP = 0.01;

export function bakePaint(parts: PaintPart[], materials: PaintMaterial[], side: number): Paint {
  const canDraw = typeof OffscreenCanvas !== "undefined";
  const textured = parts.map((p) => {
    const image = p.material === undefined ? undefined : materials[p.material]?.image;
    return !!(canDraw && image && p.uvs && inUnitSquare(p.uvs));
  });
  // Tiling textures become their average colour.
  const average = new Map<ImageBitmap, [number, number, number]>();
  const tint = (p: PaintPart, i: number): [number, number, number, number] => {
    const m = p.material === undefined ? undefined : materials[p.material];
    const f = m?.factor ?? [1, 1, 1, 1];
    if (textured[i] || !m?.image || !canDraw) return f;
    let avg = average.get(m.image);
    if (!avg) average.set(m.image, (avg = averageColor(m.image)));
    return [f[0] * avg[0], f[1] * avg[1], f[2] * avg[2], f[3]];
  };

  const total = parts.reduce((n, p) => n + p.vertices, 0);
  const colors = new Uint8Array(total * 4);
  let white = true;
  let o = 0;
  parts.forEach((p, i) => {
    const f = tint(p, i);
    for (let v = 0; v < p.vertices; v++, o++)
      for (let c = 0; c < 4; c++) {
        const lin = f[c]! * (p.colors ? p.colors[v * 4 + c]! : 1);
        const byte = Math.round((c === 3 ? clamp01(lin) : toSrgb(lin)) * 255);
        colors[o * 4 + c] = byte;
        if (byte !== 255) white = false;
      }
  });

  const out: Paint = white ? {} : { colors };
  const images = [...new Set(parts.flatMap((p, i) => (textured[i] ? [materials[p.material!]!.image!] : [])))];
  if (!images.length) return out;

  const cols = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / cols);
  const strip = textured.every(Boolean) ? 0 : STRIP;
  const cw = side / cols;
  const ch = (side - strip) / rows;
  const atlas = new OffscreenCanvas(side, side);
  const g = atlas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.fillStyle = "#fff";
  g.fillRect(0, 0, side, side);
  const cells = new Map<ImageBitmap, [number, number]>();
  images.forEach((image, k) => {
    const x = (k % cols) * cw;
    const y = Math.floor(k / cols) * ch;
    g.drawImage(image, x, y, cw, ch);
    cells.set(image, [x, y]);
  });

  const uvs = new Float32Array(total * 2);
  // Map into the cell less a texel each side, so mip levels don't bleed in the neighbours.
  const pad = 1;
  o = 0;
  parts.forEach((p, i) => {
    const cell = textured[i] ? cells.get(materials[p.material!]!.image!)! : null;
    for (let v = 0; v < p.vertices; v++, o++) {
      if (cell) {
        uvs[o * 2] = (cell[0] + pad + p.uvs![v * 2]! * (cw - 2 * pad)) / side;
        uvs[o * 2 + 1] = (cell[1] + pad + p.uvs![v * 2 + 1]! * (ch - 2 * pad)) / side;
      } else {
        uvs[o * 2] = 0.5;
        uvs[o * 2 + 1] = (side - strip / 2) / side;
      }
    }
  });
  out.uvs = uvs;
  out.atlas = atlas;
  out.source = images.reduce<[number, number]>(
    (best, im) => (im.width * im.height > best[0] * best[1] ? [im.width, im.height] : best),
    [0, 0],
  );
  return out;
}

/**
 * Compress an atlas within the budget: WebP where the browser can encode it
 * (JPEG otherwise; Safari has no WebP encoder), lowering quality and then
 * halving the size until it fits.
 */
export async function encodeTexture(
  atlas: OffscreenCanvas,
  budget: Budget["texture"],
): Promise<AssetTexture> {
  let canvas = atlas;
  for (;;) {
    for (const quality of [0.85, 0.7, 0.55]) {
      let blob = await canvas.convertToBlob({ type: "image/webp", quality });
      if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (blob.size <= budget.bytes || canvas.width <= 64)
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mime: blob.type as AssetTexture["mime"],
          width: canvas.width,
          height: canvas.height,
        };
    }
    const half = new OffscreenCanvas(canvas.width / 2, canvas.height / 2);
    const g = half.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(canvas, 0, 0, half.width, half.height);
    canvas = half;
  }
}

function inUnitSquare(uvs: Float32Array): boolean {
  for (const x of uvs) if (!(x >= -WRAP && x <= 1 + WRAP)) return false;
  return true;
}

function averageColor(image: ImageBitmap): [number, number, number] {
  const c = new OffscreenCanvas(1, 1);
  const g = c.getContext("2d")!;
  g.drawImage(image, 0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  return [toLinear(r! / 255), toLinear(gr! / 255), toLinear(b! / 255)];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toSrgb = (x: number) => {
  x = clamp01(x);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
export const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
