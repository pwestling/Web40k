import { saveFile } from "../ui/files";
import { t } from "../i18n";
import { siteUrl } from "../share/site";
import { figureHeight, figureImage } from "./figures";
import { pdf, type PdfPage } from "./pdf";
import {
  deployDepth,
  mapSvg,
  statText,
  textBlocks,
  TERRAIN_COLORS,
  type RulebookDoc,
  type RulebookUnit,
} from "./rulebook";

/**
 * Print and play (#47): a game's rulebook as a PDF made in the browser. The
 * rules sheet, a card per unit (with wound boxes), tokens and gauges, a
 * quick-reference card, and cut-out stand-in figures with bases, all at true
 * size. Each page is drawn on a canvas at print resolution and written as
 * a PDF (pdf.ts).
 */

const PAPER = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};
/** Dots per inch the pages are drawn at: sharp in print, a few MB in all. */
const DPI = 200;
const MM = DPI / 25.4;
const MARGIN = 12;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const INK = "#1d1d1f";
const MUTED = "#5f6168";

type Ctx = CanvasRenderingContext2D;
type Picture = HTMLImageElement | HTMLCanvasElement;

/** Ink saver (UX 362): figures, bases and headers as outlines, no solid colour. Set for one run. */
let inkSaver = false;

/** A figure as an outline: white inside, a dark edge, a ghost of its shading. */
function outlined(img: HTMLImageElement): HTMLCanvasElement {
  const pad = 6;
  const c = document.createElement("canvas");
  c.width = img.width + 2 * pad;
  c.height = img.height + 2 * pad;
  const ctx = c.getContext("2d")!;
  const mask = (color: string) => {
    const m = document.createElement("canvas");
    m.width = c.width;
    m.height = c.height;
    const mc = m.getContext("2d")!;
    mc.drawImage(img, pad, pad);
    mc.globalCompositeOperation = "source-in";
    mc.fillStyle = color;
    mc.fillRect(0, 0, m.width, m.height);
    return m;
  };
  const edge = mask(INK);
  const d = Math.max(2, Math.round(img.width / 120));
  for (let a = 0; a < 16; a++)
    ctx.drawImage(
      edge,
      Math.round(Math.cos((a * Math.PI) / 8) * d),
      Math.round(Math.sin((a * Math.PI) / 8) * d),
    );
  ctx.drawImage(mask("#ffffff"), 0, 0);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(img, pad, pad);
  return c;
}

/** A figure's picture for the page, as an outline when saving ink. */
async function figurePicture(src: string): Promise<Picture> {
  const img = await load(src);
  return inkSaver ? outlined(img) : img;
}

/** The 1" check: printed at 100% this line is an inch long. */
function inchCheck(page: Page, x: number, y: number) {
  const { ctx } = page;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(x, y - 1.5);
  ctx.lineTo(x, y + 1.5);
  ctx.moveTo(x, y);
  ctx.lineTo(x + 25.4, y);
  ctx.moveTo(x + 25.4, y - 1.5);
  ctx.lineTo(x + 25.4, y + 1.5);
  ctx.stroke();
  page.font(6.5);
  ctx.fillStyle = MUTED;
  ctx.fillText(
    'This line should measure 1" (25.4 mm). If not, print at 100% (actual size).',
    x + 28,
    y + 1.2,
  );
  ctx.fillStyle = INK;
}

/** A page being drawn, in millimetres. */
class Page {
  readonly canvas = document.createElement("canvas");
  readonly ctx: Ctx;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas.width = Math.round(width * MM);
    this.canvas.height = Math.round(height * MM);
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.scale(MM, MM);
    this.ctx.textBaseline = "alphabetic";
  }
  font(size: number, weight = 400) {
    // Sizes in points; the page is in millimetres.
    this.ctx.font = `${weight} ${(size * 25.4) / 72}px ${FONT}`;
  }
}

/** Text with **bold** runs, word-wrapped to `width` at (x, y); returns the y after it. */
function rich(
  page: Page,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  lead = 1.35,
): number {
  const { ctx } = page;
  const line = (size * 25.4 * lead) / 72;
  const words: { text: string; bold: boolean }[] = [];
  text.split(/\*\*(.+?)\*\*/g).forEach((bit, i) => {
    for (const w of bit.split(/(\s+)/)) if (w.trim()) words.push({ text: w, bold: i % 2 === 1 });
  });
  let cx = x;
  const space = () => {
    page.font(size);
    return ctx.measureText(" ").width;
  };
  for (const w of words) {
    page.font(size, w.bold ? 700 : 400);
    const wd = ctx.measureText(w.text).width;
    if (cx > x && cx + wd > x + width) {
      cx = x;
      y += line;
    }
    ctx.fillText(w.text, cx, y);
    cx += wd + space();
  }
  return y + line;
}

/** Pages that text flows across, a column at a time. */
class Flow {
  readonly pages: Page[] = [];
  page!: Page;
  y = 0;
  constructor(
    private readonly paper: { width: number; height: number },
    private readonly footer: string,
  ) {
    this.next();
  }
  get width() {
    return this.paper.width - 2 * MARGIN;
  }
  next() {
    this.page = new Page(this.paper.width, this.paper.height);
    this.pages.push(this.page);
    this.y = MARGIN + 4;
    this.page.font(7);
    this.page.ctx.fillStyle = MUTED;
    this.page.ctx.fillText(this.footer, MARGIN, this.paper.height - 6);
    this.page.ctx.fillStyle = INK;
  }
  /** Room for `h` mm, else a new page. */
  room(h: number) {
    if (this.y + h > this.paper.height - MARGIN) this.next();
  }
  heading(text: string, size = 13) {
    this.room(14);
    this.y += 3;
    this.page.font(size, 800);
    this.page.ctx.fillStyle = INK;
    this.page.ctx.fillText(text, MARGIN, this.y + (size * 25.4) / 72);
    this.y += (size * 25.4) / 72 + 3;
  }
  words(text: string, size = 9.5) {
    for (const b of textBlocks(text)) {
      const items = b.kind === "p" ? [b.text] : b.items;
      items.forEach((item, i) => {
        this.room(10);
        const bullet = b.kind === "ul" ? "•" : b.kind === "ol" ? `${i + 1}.` : "";
        const indent = bullet ? 5 : 0;
        if (bullet) {
          this.page.font(size, 700);
          this.page.ctx.fillText(bullet, MARGIN, this.y + (size * 25.4) / 72);
        }
        this.y =
          rich(this.page, item, MARGIN + indent, this.y + (size * 25.4) / 72, this.width - indent, size) -
          (size * 25.4) / 72 +
          1.5;
      });
      this.y += 1.5;
    }
  }
}

/** An image into the page, waiting for it to load. */
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** The rules sheet: the words, the warbands, the missions, the table. */
async function rulesPages(
  doc: RulebookDoc,
  paper: { width: number; height: number },
  footer: string,
): Promise<Page[]> {
  const f = new Flow(paper, footer);
  const { ctx } = f.page;
  f.page.font(24, 800);
  ctx.fillText(doc.name, MARGIN, f.y + 8);
  f.y += 12;
  f.page.font(8);
  ctx.fillStyle = MUTED;
  ctx.fillText(
    `Version ${doc.version}${doc.licence ? ` · ${doc.licence}, Open Battle contributors` : ""}`,
    MARGIN,
    f.y,
  );
  ctx.fillStyle = INK;
  inchCheck(f.page, MARGIN, f.y + 5);
  f.y += 10;
  f.words(doc.intro, 10.5);
  for (const s of doc.sections) {
    f.heading(s.title);
    f.words(s.text);
  }
  f.heading("The warbands");
  f.words(
    `Each warband is about ${doc.armies[0]?.points ?? 100} points. Its rule works for every unit in it.`,
  );
  for (const a of doc.armies) {
    f.room(12);
    f.page.ctx.fillStyle = a.color;
    f.page.ctx.fillRect(MARGIN, f.y + 0.5, 2, 8);
    f.page.ctx.fillStyle = INK;
    f.y =
      rich(
        f.page,
        `**${a.name}.** ${a.about ?? ""} **${a.rule.name}:** ${a.rule.text}`,
        MARGIN + 4,
        f.y + 3.5,
        f.width - 4,
        9,
      ) + 1.5;
  }
  f.words("Each unit's numbers are on its card (the unit cards pages).", 8.5);
  f.heading("Missions");
  f.words(
    `Both players deploy in a strip ${deployDepth(doc)}" deep along their long edge of a ${doc.table.width}" x ${doc.table.depth}" table. Pick a mission:`,
  );
  f.words(doc.missions.map((m) => `- **${m.name}.** ${m.summary}`).join("\n"));
  f.heading("The starter table");
  const map = await load(`data:image/svg+xml;utf8,${encodeURIComponent(mapSvg(doc, { scale: 20 }))}`);
  const mw = f.width * 0.75;
  const mh = (mw * doc.table.depth) / doc.table.width;
  f.room(mh + 4);
  f.page.ctx.drawImage(map, MARGIN, f.y, mw, mh);
  // The key, beside the map.
  let ky = f.y + 4;
  for (const t of doc.terrain.filter((x) => TERRAIN_COLORS[x.id])) {
    f.page.ctx.fillStyle = TERRAIN_COLORS[t.id]!;
    f.page.ctx.fillRect(MARGIN + mw + 4, ky - 3, 4, 4);
    f.page.ctx.fillStyle = INK;
    ky = rich(f.page, `**${t.name}:** ${t.does}`, MARGIN + mw + 10, ky, f.width - mw - 10, 7.5) + 1;
  }
  f.y += mh + 4;
  return f.pages;
}

/** The size of a unit card: a playing card, 63 x 88 mm. */
const CARD = { width: 63, height: 88 };

function cutMarks(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = "#b0b0b0";
  ctx.lineWidth = 0.15;
  ctx.setLineDash([1, 1]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** One unit's card: name, picture, numbers, rule and a box per wound. */
function unitCard(
  page: Page,
  x: number,
  y: number,
  a: RulebookDoc["armies"][number],
  u: RulebookUnit,
  figure: Picture | null,
  doc: RulebookDoc,
) {
  const { ctx } = page;
  cutMarks(ctx, x, y, CARD.width, CARD.height);
  header(ctx, x, y, a.color, "#ffffff");
  page.font(11, 800);
  ctx.fillText(u.name, x + 3, y + 7.5, CARD.width - 6);
  ctx.fillStyle = INK;
  page.font(6.5);
  ctx.fillStyle = MUTED;
  ctx.fillText(
    `${a.name} · ${u.count} ${u.count === 1 ? "model" : "models"} · ${u.points} pts`,
    x + 3,
    y + 15,
  );
  ctx.fillStyle = INK;
  if (figure) {
    const h = 30;
    const w = (figure.width / figure.height) * h;
    ctx.drawImage(figure, x + (CARD.width - w) / 2, y + 17, w, h);
  }
  // The numbers, a box each.
  const stats = doc.characteristics;
  const bw = (CARD.width - 6) / stats.length;
  stats.forEach((c, i) => {
    const bx = x + 3 + i * bw;
    ctx.strokeStyle = "#c9c9c9";
    ctx.lineWidth = 0.2;
    ctx.strokeRect(bx, y + 49, bw, 10);
    page.font(5, 600);
    ctx.fillStyle = MUTED;
    ctx.textAlign = "center";
    ctx.fillText(c.id, bx + bw / 2, y + 52);
    page.font(8.5, 800);
    ctx.fillStyle = INK;
    ctx.fillText(statText(doc, c.id, u.stats[c.id]), bx + bw / 2, y + 57.5);
    ctx.textAlign = "left";
  });
  rich(page, `**${a.rule.name}:** ${a.rule.text}`, x + 3, y + 64, CARD.width - 6, 6.5, 1.25);
  // A group of wound boxes per model, side by side, to tick off.
  const wounds = Number(u.stats.W) || 1;
  const box = 3.2;
  const group = wounds * (box + 0.6) + 2.4;
  const across = Math.max(1, Math.floor((CARD.width - 6 + 2.4) / group));
  const lines = Math.ceil(u.count / across);
  const top = y + CARD.height - 3 - lines * (box + 1);
  page.font(5.5);
  ctx.fillStyle = MUTED;
  ctx.fillText(u.count > 1 ? "Wounds, a group per model" : "Wounds", x + 3, top - 0.8);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.25;
  for (let m = 0; m < u.count; m++)
    for (let k = 0; k < wounds; k++)
      ctx.strokeRect(
        x + 3 + (m % across) * group + k * (box + 0.6),
        top + Math.floor(m / across) * (box + 1),
        box,
        box,
      );
  ctx.fillStyle = INK;
}

/** The quick-reference card, card-sized. */
/** A card's title bar: filled, or outlined in its colour with the title in it when saving ink. */
function header(ctx: Ctx, x: number, y: number, color: string, text: string) {
  if (inkSaver) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.6;
    ctx.strokeRect(x + 0.3, y + 0.3, CARD.width - 0.6, 10.4);
    ctx.fillStyle = color;
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, CARD.width, 11);
    ctx.fillStyle = text;
  }
}

function quickCard(page: Page, x: number, y: number, doc: RulebookDoc) {
  const { ctx } = page;
  cutMarks(ctx, x, y, CARD.width, CARD.height);
  header(ctx, x, y, "#26282e", "#ffd36b");
  page.font(10, 800);
  ctx.fillText("Quick reference", x + 3, y + 7.5);
  ctx.fillStyle = INK;
  let yy = y + 16;
  for (const q of doc.quickRef) yy = rich(page, q, x + 3, yy, CARD.width - 6, 6.6, 1.25) + 0.8;
}

/** A mission on a card: what to set up and how it scores, for the table edge. */
function missionCard(page: Page, x: number, y: number, doc: RulebookDoc, m: RulebookDoc["missions"][number]) {
  const { ctx } = page;
  cutMarks(ctx, x, y, CARD.width, CARD.height);
  header(ctx, x, y, "#7a5a12", "#ffffff");
  page.font(10, 800);
  ctx.fillText(m.name, x + 3, y + 7.5, CARD.width - 6);
  ctx.fillStyle = MUTED;
  page.font(6.5);
  ctx.fillText(`Mission · ${doc.name}`, x + 3, y + 15);
  ctx.fillStyle = INK;
  const yy = rich(page, m.summary, x + 3, y + 21, CARD.width - 6, 7.2, 1.3) + 1.5;
  rich(
    page,
    `**Deploy:** a strip ${deployDepth(doc)}" deep along your long edge. **Lanterns:** ${m.objectives.length}, as on the map.`,
    x + 3,
    yy,
    CARD.width - 6,
    6.6,
    1.25,
  );
}

async function cardPages(
  doc: RulebookDoc,
  paper: { width: number; height: number },
  footer: string,
): Promise<Page[]> {
  const cols = Math.floor((paper.width - 2 * MARGIN) / CARD.width);
  const rows = Math.floor((paper.height - 2 * MARGIN - 6) / CARD.height);
  const ox = (paper.width - cols * CARD.width) / 2;
  const oy = MARGIN + 4;
  const slots: ((page: Page, x: number, y: number) => void)[] = [];
  for (const a of doc.armies)
    for (const u of a.units) {
      let figure: Picture | null = null;
      try {
        figure = await figurePicture(figureImage(u, a.color, { px: 160 }));
      } catch {
        // No WebGL: the card does without its picture.
      }
      slots.push((p, x, y) => unitCard(p, x, y, a, u, figure, doc));
    }
  // A quick-reference card for each player, and each mission on a card (PX: no half-empty page).
  slots.push(
    (p, x, y) => quickCard(p, x, y, doc),
    (p, x, y) => quickCard(p, x, y, doc),
    ...doc.missions.map((m) => (p: Page, x: number, y: number) => missionCard(p, x, y, doc, m)),
  );
  // The last page's spare places: more quick references, one for the table edge.
  while (slots.length % (cols * rows)) slots.push((p, x, y) => quickCard(p, x, y, doc));
  const pages: Page[] = [];
  slots.forEach((draw, i) => {
    const at = i % (cols * rows);
    if (at === 0) {
      const page = new Page(paper.width, paper.height);
      page.font(7);
      page.ctx.fillStyle = MUTED;
      page.ctx.fillText(`${doc.name}: unit cards. Cut along the dotted lines. ${footer}`, MARGIN, MARGIN);
      pages.push(page);
    }
    draw(pages.at(-1)!, ox + (at % cols) * CARD.width, oy + Math.floor(at / cols) * CARD.height);
  });
  return pages;
}

/** A ruler strip in inches, `inches` long, numbered from `from` (the second half of a 12" ruler starts at 6). */
function ruler(page: Page, x: number, y: number, inches: number, label: string, from = 0) {
  const { ctx } = page;
  const w = inches * 25.4;
  if (!inkSaver) {
    ctx.fillStyle = "#fff8e6";
    ctx.fillRect(x, y, w, 9);
  }
  cutMarks(ctx, x, y, w, 9);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.25;
  ctx.setLineDash([]);
  for (let i = 0; i <= inches * 4; i++) {
    const tx = x + i * 6.35;
    const len = i % 4 === 0 ? 4 : i % 2 === 0 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(tx, y);
    ctx.lineTo(tx, y + len);
    ctx.stroke();
    if (i % 4 === 0 && i > 0 && i < inches * 4) {
      page.font(6, 700);
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.fillText(String(from + i / 4), tx, y + 7.2);
      ctx.textAlign = "left";
    }
  }
  // Above the strip, clear of its numbers (UX 362).
  page.font(5.5);
  ctx.fillStyle = MUTED;
  ctx.fillText(label, x, y - 0.8);
  ctx.fillStyle = INK;
}

/** Lanterns, wound and activation tokens, the round and VP tracks, and rulers. */
function tokenPage(doc: RulebookDoc, paper: { width: number; height: number }, footer: string): Page {
  const page = new Page(paper.width, paper.height);
  const { ctx } = page;
  page.font(16, 800);
  ctx.fillText(`${doc.name}: tokens and gauges`, MARGIN, MARGIN + 6);
  page.font(7);
  ctx.fillStyle = MUTED;
  ctx.fillText(`Cut out along the dotted lines. ${footer}`, MARGIN, MARGIN + 11);
  ctx.fillStyle = INK;
  inchCheck(page, MARGIN, MARGIN + 16);
  let y = MARGIN + 24;
  const circle = (cx: number, cy: number, r: number, fill: string, text: string, sub = "") => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.setLineDash([1, 1]);
    ctx.strokeStyle = "#9a9a9a";
    ctx.lineWidth = 0.2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    page.font(r > 8 ? 8 : 5.5, 800);
    ctx.fillText(text, cx, cy + (sub ? -0.5 : 1.2));
    if (sub) {
      page.font(4.5);
      ctx.fillText(sub, cx, cy + 3.5);
    }
    ctx.textAlign = "left";
  };
  // Lanterns: a token for each, 40 mm across, with their names.
  page.font(10, 800);
  ctx.fillText("Lanterns", MARGIN, y);
  y += 4;
  const names = [...new Set(doc.missions.flatMap((m) => m.objectives.map((o) => o.label)))];
  names.forEach((n, i) => {
    const cx = MARGIN + 20 + i * 44;
    circle(cx, y + 20, 20, inkSaver ? "#ffffff" : "#ffe9b0", "Lantern", n);
    ctx.beginPath();
    ctx.arc(cx, y + 11, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffb938";
    if (inkSaver) {
      ctx.strokeStyle = "#e09a20";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else ctx.fill();
    ctx.fillStyle = INK;
  });
  y += 46;
  // Wounds and "had its go" markers.
  page.font(10, 800);
  ctx.fillText("Wound and activation markers", MARGIN, y);
  y += 4;
  for (let i = 0; i < 16; i++) circle(MARGIN + 7 + i * 11.5, y + 7, 5.5, "#f3c7c7", "1", "wound");
  y += 16;
  for (let i = 0; i < 16; i++)
    circle(
      MARGIN + 7 + i * 11.5,
      y + 7,
      5.5,
      i < 8 ? "#cfe0fb" : "#fbdcc4",
      "Gone",
      i < 8 ? "Player 1" : "Player 2",
    );
  y += 20;
  // Round and VP tracks.
  page.font(10, 800);
  ctx.fillText("Round and victory points", MARGIN, y);
  y += 4;
  for (let r = 1; r <= (doc.rounds ?? 5); r++) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.3;
    ctx.strokeRect(MARGIN + (r - 1) * 16, y, 14, 14);
    page.font(5.5);
    ctx.fillStyle = MUTED;
    ctx.fillText("Round", MARGIN + (r - 1) * 16 + 2, y + 4);
    page.font(12, 800);
    ctx.fillStyle = INK;
    ctx.fillText(String(r), MARGIN + (r - 1) * 16 + 5, y + 12);
  }
  y += 18;
  for (let v = 0; v <= 15; v++) {
    ctx.strokeStyle = INK;
    ctx.strokeRect(MARGIN + v * 11.5, y, 10, 10);
    page.font(8, 700);
    ctx.textAlign = "center";
    ctx.fillText(String(v), MARGIN + v * 11.5 + 5, y + 6.8);
    ctx.textAlign = "left";
  }
  y += 12;
  page.font(6.5);
  ctx.fillStyle = MUTED;
  ctx.fillText("Each player puts a marker on their VP.", MARGIN, y + 2);
  ctx.fillStyle = INK;
  y += 8;
  // Rulers: 6" strips (tape two together for 12"), and the 3" a lantern reaches.
  page.font(10, 800);
  ctx.fillText("Rulers", MARGIN, y);
  y += 7;
  const fit = Math.floor((paper.width - 2 * MARGIN) / 25.4);
  const strip = Math.min(6, fit);
  // A 12" ruler in two strips: the second's tab goes under the first's end (PX print and play).
  ruler(page, MARGIN, y, strip, `${strip * 2}" ruler, part 1 of 2`);
  const tab = 8;
  ruler(
    page,
    MARGIN + tab,
    y + 13,
    strip,
    `${strip * 2}" ruler, part 2: glue the tab under part 1's end`,
    strip,
  );
  ctx.setLineDash([1, 1]);
  ctx.strokeStyle = "#9a9a9a";
  ctx.lineWidth = 0.2;
  ctx.strokeRect(MARGIN, y + 13, tab, 9);
  ctx.setLineDash([]);
  page.font(4.5);
  ctx.fillStyle = MUTED;
  ctx.fillText("glue", MARGIN + 1.5, y + 18.5);
  ctx.fillStyle = INK;
  ruler(page, MARGIN, y + 27, 3, `3": a lantern's reach`);
  ruler(page, MARGIN + 3 * 25.4 + 6, y + 27, 1, `1": in a fight`);
  y += 44;
  // Lantern standees: fold-over, like the figures, to stand on the table where the lanterns are.
  page.font(10, 800);
  ctx.fillText("Lantern standees", MARGIN, y);
  y += 4;
  const W = 18;
  const H = 38;
  names.forEach((n, i) => {
    const x = MARGIN + i * (2 * W + 6);
    for (const side of [0, 1]) {
      const sx = x + side * W;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx + W / 2, y + H - 2);
      ctx.lineTo(sx + W / 2, y + 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx + W / 2, y + 10, 5, 0, Math.PI * 2);
      if (inkSaver) {
        ctx.strokeStyle = "#e09a20";
        ctx.stroke();
      } else {
        ctx.fillStyle = "#ffb938";
        ctx.fill();
      }
      page.font(5, 700);
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.fillText(n, sx + W / 2, y + H - 4, W - 2);
      ctx.textAlign = "left";
    }
    ctx.setLineDash([1, 1]);
    ctx.strokeStyle = "#8a8a8a";
    ctx.lineWidth = 0.2;
    ctx.strokeRect(x, y, 2 * W, H);
    ctx.strokeRect(x, y + H, 2 * W, 7);
    ctx.setLineDash([2, 1]);
    ctx.beginPath();
    ctx.moveTo(x + W, y);
    ctx.lineTo(x + W, y + H + 7);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  return page;
}

/** Cut-out stand-ins: each model as a fold-over standee at true height, and a base to slot it in. */
async function figurePages(
  doc: RulebookDoc,
  paper: { width: number; height: number },
  footer: string,
): Promise<Page[]> {
  const pages: Page[] = [];
  const TAB = 8;
  const GAP = 4;
  for (const a of doc.armies) {
    const items: { u: RulebookUnit; img: Picture | null; w: number; h: number }[] = [];
    for (const u of a.units) {
      let img: Picture | null = null;
      try {
        img = await figurePicture(figureImage(u, a.color, { px: 300, upright: true }));
      } catch {
        // No WebGL: an outline the right size instead.
      }
      const h = figureHeight(u) * 25.4;
      const w = img ? (img.width / img.height) * (h + 2.54) : u.baseMm * 1.25;
      for (let i = 0; i < u.count; i++) items.push({ u, img, w, h: h + 2.54 });
    }
    let page: Page | null = null;
    let x = 0;
    let y = 0;
    let rowH = 0;
    const start = () => {
      page = new Page(paper.width, paper.height);
      pages.push(page);
      const { ctx } = page;
      page.font(14, 800);
      ctx.fillStyle = a.color;
      ctx.fillText(`${a.name}: stand-ins`, MARGIN, MARGIN + 5);
      page.font(7);
      ctx.fillStyle = MUTED;
      ctx.fillText(
        `Cut out each figure, fold along the dashed line, glue back to back. Fold the tabs out and glue them under a base (or slot through it). ${footer}`,
        MARGIN,
        MARGIN + 10,
        paper.width - 2 * MARGIN,
      );
      ctx.fillStyle = INK;
      x = MARGIN;
      y = MARGIN + 15;
      rowH = 0;
    };
    start();
    for (const it of items) {
      const W = it.w * 2;
      const H = it.h + TAB;
      if (x + W > paper.width - MARGIN) {
        x = MARGIN;
        y += rowH + GAP;
        rowH = 0;
      }
      if (y + H > paper.height - MARGIN) {
        start();
      }
      const p = page as unknown as Page;
      const { ctx } = p;
      // Front, and the back mirrored beside it: folded on the line between, they meet back to back.
      if (it.img) {
        ctx.drawImage(it.img, x, y, it.w, it.h);
        ctx.save();
        ctx.translate(x + 2 * it.w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(it.img, 0, 0, it.w, it.h);
        ctx.restore();
      }
      ctx.strokeStyle = "#8a8a8a";
      ctx.lineWidth = 0.2;
      ctx.setLineDash([1, 1]);
      ctx.strokeRect(x, y, W, it.h);
      ctx.setLineDash([2, 1]);
      ctx.beginPath();
      ctx.moveTo(x + it.w, y);
      ctx.lineTo(x + it.w, y + H);
      ctx.stroke();
      // The tabs.
      ctx.setLineDash([1, 1]);
      ctx.strokeRect(x, y + it.h, W, TAB);
      ctx.setLineDash([]);
      p.font(4.5);
      ctx.fillStyle = MUTED;
      ctx.textAlign = "center";
      ctx.fillText("tab", x + it.w / 2, y + it.h + TAB / 2 + 1);
      ctx.fillText("tab", x + it.w * 1.5, y + it.h + TAB / 2 + 1);
      ctx.fillText(it.u.name, x + W / 2, y - 0.8);
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      x += W + GAP;
      rowH = Math.max(rowH, H + 3);
    }
    // The bases, at true size, a slot across each: below the figures, or on a page of their own when they don't fit.
    const bases = a.units.flatMap((u) => Array.from({ length: u.count }, () => u.baseMm));
    let need = 0;
    let rowW = paper.width;
    let rowMax = 0;
    for (const d of bases) {
      if (rowW + d > paper.width - 2 * MARGIN) {
        need += rowMax + 2;
        rowW = 0;
        rowMax = 0;
      }
      rowW += d + 2;
      rowMax = Math.max(rowMax, d);
    }
    need += rowMax + 8;
    let by = y + rowH + GAP + 6;
    if (by + need > paper.height - MARGIN) {
      start();
      by = y + 8;
    }
    const p = page as unknown as Page;
    const { ctx } = p;
    let bx = MARGIN;
    p.font(8, 800);
    ctx.fillText("Bases", MARGIN, by - 2);
    let tallest = 0;
    for (const u of a.units)
      for (let i = 0; i < u.count; i++) {
        const r = u.baseMm / 2;
        if (bx + 2 * r > paper.width - MARGIN) {
          bx = MARGIN;
          by += tallest + 2;
          tallest = 0;
        }
        tallest = Math.max(tallest, 2 * r);
        ctx.beginPath();
        ctx.arc(bx + r, by + r, r, 0, Math.PI * 2);
        if (inkSaver) {
          ctx.strokeStyle = a.color;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        } else {
          ctx.fillStyle = "#3a3d44";
          ctx.fill();
          ctx.fillStyle = a.color;
          ctx.beginPath();
          ctx.arc(bx + r, by + r, r * 0.86, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = inkSaver ? INK : "#ffffff";
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(bx + r * 0.45, by + r);
        ctx.lineTo(bx + r * 1.55, by + r);
        ctx.stroke();
        ctx.fillStyle = INK;
        bx += 2 * r + 2;
      }
  }
  return pages;
}

/** Make the print-and-play PDF and save it, saying how far it has got (UX 361). */
export async function printAndPlay(
  doc: RulebookDoc,
  paperName: "a4" | "letter",
  opts: { inkSaver?: boolean; progress?: (text: string) => void } = {},
): Promise<void> {
  const paper = PAPER[paperName];
  const say = opts.progress ?? (() => {});
  const footer = `${doc.name} ${doc.version}${doc.licence ? `, ${doc.licence}` : ""} · ${siteUrl()}`;
  inkSaver = !!opts.inkSaver;
  // A beat between steps, so the progress line paints.
  const step = async (text: string) => {
    say(text);
    await new Promise((r) => setTimeout(r, 0));
  };
  try {
    await step(t("Drawing the rules…"));
    const pages = [...(await rulesPages(doc, paper, footer))];
    await step(t("Drawing the unit cards…"));
    pages.push(...(await cardPages(doc, paper, footer)), tokenPage(doc, paper, footer));
    await step(t("Drawing the figures…"));
    pages.push(...(await figurePages(doc, paper, footer)));
    const out: PdfPage[] = [];
    for (const [i, p] of pages.entries()) {
      await step(t("Saving page {n} of {total}…", { n: i + 1, total: pages.length }));
      const blob = await new Promise<Blob>((resolve, reject) =>
        p.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("page"))), "image/jpeg", 0.88),
      );
      out.push({
        width: (paper.width / 25.4) * 72,
        height: (paper.height / 25.4) * 72,
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        pixels: { width: p.canvas.width, height: p.canvas.height },
      });
    }
    const name = `${doc.id}-print-and-play-${paperName}${inkSaver ? "-ink-saver" : ""}.pdf`;
    saveFile(pdf(out, `${doc.name}: print and play`), name);
  } finally {
    inkSaver = false;
  }
}
