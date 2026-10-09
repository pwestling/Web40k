import type { RawModel } from "../assets/parse";
import { bounds, type Box } from "./cutout";
import { readStandee } from "./file";
import { standeeShape } from "./mesh";

/**
 * A standee file into a model (#68), in the import worker: the card cut to
 * the front photo's outline, and an atlas with the front photo on its left
 * half and the back on its right. No back photo: the front, mirrored and in
 * shade, as a card seen from behind would show. The rest (levels, sight
 * proxy, cache, sharing) is the pipeline every figure goes through.
 */
export async function standeeModel(bytes: ArrayBuffer, atlasSide: number): Promise<RawModel> {
  const file = readStandee(bytes);
  if (!file) throw new Error("This isn't a standee file.");
  const front = await pixels(file.front);
  const mask = new Uint8Array(front.width * front.height);
  for (let i = 0; i < mask.length; i++) mask[i] = front.data[i * 4 + 3]! > 127 ? 255 : 0;
  const box = bounds(mask, front.width, front.height);
  if (!box) throw new Error("The photo has nothing cut out in it.");
  const scale = file.baseMm / 25.4 / file.basePx;
  const shape = standeeShape(mask, front.width, { box, scale });

  const atlas = new OffscreenCanvas(atlasSide, atlasSide);
  const g = atlas.getContext("2d")!;
  const half = atlasSide / 2;
  g.drawImage(front.bitmap, box.x, box.y, box.width, box.height, 0, 0, half, atlasSide);
  if (file.back) {
    const back = await pixels(file.back);
    const bm = new Uint8Array(back.width * back.height);
    for (let i = 0; i < bm.length; i++) bm[i] = back.data[i * 4 + 3]! > 127 ? 255 : 0;
    const bb: Box = bounds(bm, back.width, back.height) ?? {
      x: 0,
      y: 0,
      width: back.width,
      height: back.height,
    };
    g.drawImage(back.bitmap, bb.x, bb.y, bb.width, bb.height, half, 0, half, atlasSide);
  } else {
    g.save();
    g.translate(atlasSide, 0);
    g.scale(-1, 1);
    g.drawImage(front.bitmap, box.x, box.y, box.width, box.height, 0, 0, half, atlasSide);
    g.restore();
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(20, 20, 28, 0.45)";
    g.fillRect(half, 0, half, atlasSide);
    g.restore();
  }
  bleed(g, atlasSide);
  return {
    positions: shape.positions,
    indices: shape.indices,
    uvs: shape.uvs,
    atlas,
    sourceTexture: [front.width, front.height],
    look: "photo",
  };
}

async function pixels(url: string) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = c.getContext("2d")!;
  g.drawImage(bitmap, 0, 0);
  const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height);
  return { bitmap, width: bitmap.width, height: bitmap.height, data };
}

/**
 * Fill the see-through pixels with their neighbours' colours, then make the
 * atlas opaque: the outline is traced a little coarser than the photo, and
 * mipmaps blend in neighbours, so the backdrop must never show at the edge.
 */
function bleed(g: OffscreenCanvasRenderingContext2D, side: number): void {
  const img = g.getImageData(0, 0, side, side);
  const d = img.data;
  const filled = new Uint8Array(side * side);
  for (let i = 0; i < filled.length; i++) filled[i] = d[i * 4 + 3]! > 127 ? 1 : 0;
  // The outline's own pixels are part backdrop (the photo blends them): they take their inner neighbours' colours too.
  const rim: number[] = [];
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i]) continue;
    const x = i % side;
    const out = (j: number) => j < 0 || j >= filled.length || !filled[j];
    if ((x > 0 && out(i - 1)) || (x < side - 1 && out(i + 1)) || out(i - side) || out(i + side)) rim.push(i);
  }
  for (const i of rim) filled[i] = 0;
  let front: number[] = [];
  for (let i = 0; i < filled.length; i++) if (filled[i]) front.push(i);
  for (let pass = 0; pass < 24 && front.length; pass++) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % side;
      for (const j of [x > 0 ? i - 1 : -1, x < side - 1 ? i + 1 : -1, i - side, i + side]) {
        if (j < 0 || j >= filled.length || filled[j]) continue;
        filled[j] = 1;
        d[j * 4] = d[i * 4]!;
        d[j * 4 + 1] = d[i * 4 + 1]!;
        d[j * 4 + 2] = d[i * 4 + 2]!;
        next.push(j);
      }
    }
    front = next;
  }
  for (let i = 0; i < filled.length; i++) d[i * 4 + 3] = 255;
  g.putImageData(img, 0, 0);
}
