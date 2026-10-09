/**
 * Cutting a miniature out of a phone photo (#68), in the browser, with no
 * model to download: the photo is taken against a plain backdrop, so the
 * backdrop's colours are read from the photo's border, and a fill from the
 * border takes every pixel close to them, stopping at strong edges (the
 * miniature's outline). Enclosed gaps (between an arm and a body) go too when
 * they are plainly backdrop. The player fixes the rest with a brush.
 *
 * Pure functions over ImageData-shaped pixels, so they run in tests, a worker
 * or the page alike. A mask is one byte per pixel: 255 keep, 0 cut.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray | Uint8Array;
}

export type Mask = Uint8Array;

type Rgb = [number, number, number];

/** Perceptual-ish colour distance: weighted RGB (redmean), 0 to about 765. */
function distance(r: number, g: number, b: number, c: Rgb): number {
  const rm = (r + c[0]) / 2;
  const dr = r - c[0];
  const dg = g - c[1];
  const db = b - c[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** The pixels around the photo's edge, a few deep: the backdrop, as the miniature sits in the middle. */
function borderIndices(width: number, height: number, depth: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < depth || y < depth || x >= width - depth || y >= height - depth) out.push(y * width + x);
  return out;
}

/**
 * The backdrop's colours: k-means over the border pixels (a sheet of paper
 * lit from one side is two or three shades, and a shadow another).
 */
function backdropColours(img: Pixels, k = 3): Rgb[] {
  const depth = Math.max(2, Math.round(Math.min(img.width, img.height) * 0.02));
  const idx = borderIndices(img.width, img.height, depth);
  const px = (i: number): Rgb => [img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!];
  // Seeds spread through the border, by brightness.
  const sorted = [...idx].sort((a, b) => lum(px(a)) - lum(px(b)));
  let centres: Rgb[] = Array.from({ length: k }, (_, j) =>
    px(sorted[Math.floor(((j + 0.5) / k) * sorted.length)]!),
  );
  for (let round = 0; round < 8; round++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const i of idx) {
      const [r, g, b] = px(i);
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, j) => {
        const d = distance(r, g, b, c);
        if (d < bestD) [best, bestD] = [j, d];
      });
      const s = sums[best]!;
      s[0]! += r;
      s[1]! += g;
      s[2]! += b;
      s[3]! += 1;
    }
    centres = centres.map((c, j) => {
      const s = sums[j]!;
      return s[3] ? [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!] : c;
    });
  }
  return centres;
}

const lum = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Otsu's threshold over values 0..max: the split that best separates the two groups. */
function otsu(values: Float32Array, max: number, bins = 128): number {
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v / max) * bins))]!++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let split = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) [best, split] = [between, i];
  }
  return ((split + 1) / bins) * max;
}

/** Sobel gradient of brightness, per pixel. */
function edges(img: Pixels): Float32Array {
  const { width: w, height: h, data } = img;
  const l = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    l[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        l[i - w + 1]! + 2 * l[i + 1]! + l[i + w + 1]! - l[i - w - 1]! - 2 * l[i - 1]! - l[i + w - 1]!;
      const gy =
        l[i + w - 1]! + 2 * l[i + w]! + l[i + w + 1]! - l[i - w - 1]! - 2 * l[i - w]! - l[i - w + 1]!;
      out[i] = Math.hypot(gx, gy);
    }
  return out;
}

interface MaskOptions {
  /** How far from the backdrop's colours still counts as backdrop; by default worked out from the photo. */
  tolerance?: number;
  /** Nudge the worked-out tolerance: more backdrop (positive) or less (negative). */
  adjust?: number;
}

/**
 * The miniature, cut from a plain backdrop: a fill from the border through
 * backdrop-coloured pixels that stops at strong edges, enclosed backdrop gaps,
 * the biggest piece kept (with any big enough to be part of it), and holes in
 * the miniature filled.
 */
export function autoMask(img: Pixels, options: MaskOptions = {}): Mask {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const bg = backdropColours(img);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    let m = Infinity;
    for (const c of bg) m = Math.min(m, distance(r, g, b, c));
    d[i] = m;
  }
  // How much the backdrop itself varies (its border, after its shades are taken out), with room to spare.
  const rim = borderIndices(w, h, Math.max(2, Math.round(Math.min(w, h) * 0.02)))
    .map((i) => d[i]!)
    .sort((a, b) => a - b);
  const spread = rim[Math.floor(rim.length * 0.98)] ?? 0;
  const tol = Math.max(
    10,
    (options.tolerance ?? Math.min(160, Math.max(28, spread * 2.5 + 12))) + (options.adjust ?? 0),
  );
  const grad = edges(img);
  const strong = Math.max(120, otsu(grad, 1500) * 1.2);

  // Fill from the border: backdrop-coloured, and not across a strong edge unless plainly backdrop.
  const cut = new Uint8Array(n);
  const stack: number[] = [];
  const take = (i: number) => {
    if (cut[i]) return;
    const close = d[i]! < tol;
    const plain = d[i]! < tol * 0.5;
    if (close && (plain || grad[i]! < strong)) {
      cut[i] = 1;
      stack.push(i);
    }
  };
  for (const i of borderIndices(w, h, 1)) take(i);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) take(i - 1);
    if (x < w - 1) take(i + 1);
    if (i >= w) take(i - w);
    if (i < n - w) take(i + w);
  }

  // Enclosed gaps that are plainly backdrop (a gap between legs), if they're not specks.
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = cut[i] ? 0 : 255;
  const gaps = components(n, w, h, (i) => mask[i] === 255 && d[i]! < tol * 0.6);
  const speck = n * 0.0015;
  for (const gap of gaps) if (gap.length > speck) for (const i of gap) mask[i] = 0;

  return tidy(mask, w, h);
}

/** Keep the biggest piece and any piece a fifth its size; fill holes inside them that aren't big. */
function tidy(mask: Mask, w: number, h: number): Mask {
  const n = w * h;
  const pieces = components(n, w, h, (i) => mask[i] === 255).sort((a, b) => b.length - a.length);
  const out = new Uint8Array(n);
  const biggest = pieces[0]?.length ?? 0;
  for (const p of pieces) if (p.length >= biggest / 5) for (const i of p) out[i] = 255;
  // Small holes (a missed glint on a sword) back in.
  const holes = components(n, w, h, (i) => out[i] === 0);
  for (const hole of holes) {
    const touches = hole.some((i) => {
      const x = i % w;
      const y = (i - x) / w;
      return x === 0 || y === 0 || x === w - 1 || y === h - 1;
    });
    if (!touches && hole.length < n * 0.0015) for (const i of hole) out[i] = 255;
  }
  return out;
}

/** 4-connected pieces of the pixels that pass `inside`. */
function components(n: number, w: number, h: number, inside: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || !inside(s)) continue;
    const piece: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
      for (const j of next)
        if (j >= 0 && !seen[j] && inside(j)) {
          seen[j] = 1;
          stack.push(j);
        }
    }
    out.push(piece);
  }
  void h;
  return out;
}

/** Paint the mask with a round brush: keep (255) or cut (0). In place. */
export function brush(
  mask: Mask,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
  keep: boolean,
): void {
  const r2 = radius * radius;
  for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(h - 1, Math.ceil(y + radius)); yy++)
    for (let xx = Math.max(0, Math.floor(x - radius)); xx <= Math.min(w - 1, Math.ceil(x + radius)); xx++)
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r2) mask[yy * w + xx] = keep ? 255 : 0;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The kept pixels' bounds, or null when nothing is kept. */
export function bounds(mask: Mask, w: number, h: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * How wide the base is in the photo, in pixels: the widest kept run in the
 * lowest few percent of the miniature, where its base sits. Scales the photo
 * to the base it stands on.
 */
export function baseWidth(mask: Mask, w: number, box: Box): number {
  const rows = Math.max(1, Math.round(box.height * 0.06));
  let widest = 0;
  for (let y = box.y + box.height - rows; y < box.y + box.height; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = box.x; x < box.x + box.width; x++)
      if (mask[y * w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    if (lo >= 0) widest = Math.max(widest, hi - lo + 1);
  }
  return widest || box.width;
}

/**
 * Where the miniature's base starts in the photo: going up from the bottom,
 * the last row still about as wide as the base. The table draws the base
 * itself, so the standee is cut off there and stands on it.
 */
export function baseTop(mask: Mask, w: number, box: Box, basePx: number): number {
  const width = (y: number) => {
    let lo = -1;
    let hi = -1;
    for (let x = box.x; x < box.x + box.width; x++)
      if (mask[y * w + x]) {
        if (lo < 0) lo = x;
        hi = x;
      }
    return lo < 0 ? 0 : hi - lo + 1;
  };
  // From the base's widest row near the bottom (its rim curves away below that), up while it stays as wide.
  const bottom = box.y + box.height - 1;
  let widest = bottom;
  for (let y = bottom; y >= bottom - Math.round(box.height * 0.15) && y >= box.y; y--)
    if (width(y) > width(widest)) widest = y;
  let top = widest;
  for (let y = widest - 1; y >= box.y && width(y) >= basePx * 0.8; y--) top = y;
  // Never more than a third of the miniature: a wide model isn't all base.
  return Math.max(top, box.y + Math.round(box.height * 0.67));
}
