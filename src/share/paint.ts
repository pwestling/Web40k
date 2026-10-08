/**
 * The page's overlays painted onto a clip's frames (#46): what sits over the
 * table as HTML (name plates, rulers, the dice tray and its banners, moment
 * cards, the round card, the replay caption) drawn into a 2D canvas, so a
 * clip shows what the screen did. A small painter, not a browser: boxes with
 * their background, border and corners, and text where the page laid it out,
 * word by word. Dice are drawn as dice, turned as they lie.
 */

/** What to paint, bottom to top. */
const LAYERS = [
  ".plate",
  ".ruler",
  ".wounds",
  ".talk-label",
  ".burst",
  ".moment-title",
  ".caption",
  ".round-card:not(.package-card)",
  ".moment-card",
];

/** Page pixels to canvas pixels: the table's place on the page and the scale. */
interface Frame {
  left: number;
  top: number;
  scale: number;
}

export function paintOverlays(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  root: ParentNode = document,
  /** A clip not the screen's shape: the tray goes bottom centre, at a size of its own, not in a cropped corner. */
  trayIn?: { width: number; height: number; below?: number },
): void {
  for (const sel of LAYERS)
    for (const el of root.querySelectorAll<HTMLElement>(sel))
      // A box with no words showing (a title between moments, a label whose text is hidden) would
      // show as a stray frame (UX 337); wound pips have no text.
      if (sel === ".wounds" || showsText(el)) paintBox(ctx, el, frame, 1);
  const tray = root.querySelector<HTMLElement>(".dice-tray.on");
  if (tray) paintTray(ctx, tray, trayIn ? (trayFrame(tray, trayIn) ?? frame) : frame);
}

/**
 * The frame that puts the tray's felt bottom centre of a `size` picture: in the band under the table
 * when there is room (a tall clip), else over the table's foot, as big as fits.
 */
function trayFrame(tray: HTMLElement, size: { width: number; height: number; below?: number }): Frame | null {
  const r = (tray.querySelector<HTMLElement>(".felt") ?? tray).getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const band = size.height - (size.below ?? size.height);
  const inBand = band > size.height * 0.12;
  const scale = inBand
    ? Math.min((size.width * 0.8) / r.width, (band * 0.85) / r.height)
    : Math.min((size.width * 0.7) / r.width, (size.height * 0.3) / r.height);
  const x = (size.width - r.width * scale) / 2;
  // Above the caption, which keeps its place at the table's foot.
  const y = inBand ? size.height - band / 2 - (r.height * scale) / 2 : size.height * 0.85 - r.height * scale;
  return { scale, left: r.left - x / scale, top: r.top - y / scale };
}

const visible = (style: CSSStyleDeclaration) =>
  style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.01;

const px = (v: string) => parseFloat(v) || 0;

/** Whether any of an element's words are on screen: laid out, and in a visible, not see-through box. */
function showsText(el: HTMLElement): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim() || !n.parentElement) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let ok = true;
    for (let p: HTMLElement | null = n.parentElement; p && ok; p = p === el ? null : p.parentElement)
      ok = visible(getComputedStyle(p));
    if (ok) return true;
  }
  return false;
}

function hasPaint(color: string): boolean {
  return !!color && color !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(color);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** An element's box, then its text and children, in page order. */
function paintBox(ctx: CanvasRenderingContext2D, el: HTMLElement, f: Frame, alpha: number): void {
  // Controls on the cards (Next, Skip, Close) are for the person at the screen, not the clip; a
  // label that is a button (a casualty pile's) is drawn like any label.
  if (
    (el.tagName === "BUTTON" || el.tagName === "INPUT") &&
    el.closest(".moment-card, .round-card, .dice-tray")
  )
    return;
  if (el.tagName === "INPUT") return;
  const style = getComputedStyle(el);
  if (!visible(style)) return;
  const a = alpha * Number(style.opacity || 1);
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return;
  const x = (r.left - f.left) * f.scale;
  const y = (r.top - f.top) * f.scale;
  const w = r.width * f.scale;
  const h = r.height * f.scale;
  const radius = px(style.borderTopLeftRadius) * f.scale;
  ctx.save();
  ctx.globalAlpha = a;
  if (hasPaint(style.backgroundColor)) {
    ctx.fillStyle = style.backgroundColor;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
  }
  const border = px(style.borderTopWidth) || px(style.borderLeftWidth);
  if (border > 0 && hasPaint(style.borderTopColor) && style.borderTopStyle !== "none") {
    ctx.strokeStyle = style.borderTopColor;
    ctx.lineWidth = border * f.scale;
    roundRect(
      ctx,
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      w - ctx.lineWidth,
      h - ctx.lineWidth,
      radius,
    );
    ctx.stroke();
  } else if (px(style.borderLeftWidth) > 0 && hasPaint(style.borderLeftColor)) {
    ctx.fillStyle = style.borderLeftColor;
    ctx.fillRect(x, y, px(style.borderLeftWidth) * f.scale, h);
  }
  ctx.restore();
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) paintText(ctx, node as Text, style, f, a);
    else if (node instanceof HTMLElement) paintBox(ctx, node, f, a);
  }
}

/** A text node word by word, each where the page put it (so wrapping matches). */
function paintText(
  ctx: CanvasRenderingContext2D,
  node: Text,
  style: CSSStyleDeclaration,
  f: Frame,
  alpha: number,
) {
  const text = node.data;
  if (!text.trim()) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style.color;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${px(style.fontSize) * f.scale}px ${style.fontFamily}`;
  ctx.textBaseline = "alphabetic";
  const range = document.createRange();
  const words = /\S+/g;
  for (let m = words.exec(text); m; m = words.exec(text)) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const b = range.getBoundingClientRect();
    if (!b.width) continue;
    // The baseline sits about a fifth of the line box up from its bottom.
    const base = b.bottom - (b.height - px(style.fontSize)) / 2 - px(style.fontSize) * 0.2;
    ctx.fillText(m[0], (b.left - f.left) * f.scale, (base - f.top) * f.scale);
  }
  range.detach();
  ctx.restore();
}

/** The dice tray: its felt, each die turned as it lies with its pips or number, then caption and banner. */
function paintTray(ctx: CanvasRenderingContext2D, tray: HTMLElement, f: Frame): void {
  const felt = tray.querySelector<HTMLElement>(".felt");
  if (felt) paintBox(ctx, felt, f, Number(getComputedStyle(tray).opacity || 1));
  for (const die of tray.querySelectorAll<HTMLElement>(".die:not(.gone)")) paintDie(ctx, die, f);
  for (const el of tray.querySelectorAll<HTMLElement>(".tray-caption, .tray-banner.on"))
    paintBox(ctx, el, f, 1);
}

function paintDie(ctx: CanvasRenderingContext2D, die: HTMLElement, f: Frame): void {
  const style = getComputedStyle(die);
  if (!visible(style)) return;
  const body = die.querySelector<HTMLElement>(".body");
  if (!body) return;
  const box = body.getBoundingClientRect();
  if (!box.width) return;
  const size = (px(style.getPropertyValue("--s")) || box.width) * f.scale;
  const m = /matrix\(([^,]+),\s*([^,]+)/.exec(style.transform);
  const angle = m ? Math.atan2(Number(m[2]), Number(m[1])) : 0;
  const cx = (box.left + box.width / 2 - f.left) * f.scale;
  const cy = (box.top + box.height / 2 - f.top) * f.scale;
  ctx.save();
  ctx.globalAlpha = die.classList.contains("fail") ? 0.35 : 1;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = style.getPropertyValue("--c").trim() || "#eee";
  roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.18);
  ctx.fill();
  if (die.classList.contains("crit")) {
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = Math.max(2, size * 0.06);
    ctx.stroke();
  }
  ctx.restore();
  const pip = style.getPropertyValue("--p").trim() || "#111";
  if (body.classList.contains("numeric")) {
    ctx.save();
    ctx.fillStyle = pip;
    ctx.font = `700 ${size * 0.5}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(body.dataset.n ?? "", cx, cy);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = die.classList.contains("fail") ? 0.35 : 1;
  ctx.fillStyle = pip;
  for (const p of body.querySelectorAll<HTMLElement>(".pip.on")) {
    const b = p.getBoundingClientRect();
    ctx.beginPath();
    ctx.arc(
      (b.left + b.width / 2 - f.left) * f.scale,
      (b.top + b.height / 2 - f.top) * f.scale,
      size * 0.09,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}
