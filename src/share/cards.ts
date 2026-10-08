import { sideName, sidePlayers, sides, systemOf, type GameRecord, type GameState } from "../core";
import { momentsOf, type Moment } from "../core/moments";
import { t, tn } from "../i18n";
import { displayName } from "../i18n/names";
import type { Highlight, RoundSummary } from "../ui/highlights";
import { systemLabel } from "../ui/systemLabels";
import { siteUrl } from "./site";
import { plainSystemName } from "../ui/systemLabels";

/**
 * Pictures to post (#46): the end-of-game card and a card for each round, as
 * PNGs at 1200 × 675, the size social sites show whole (16:9). The table as
 * it stands fills the back, dimmed, and the words sit over it: the armies,
 * VP, the decisive moment and, when the dice did something 1 in 1,000,
 * Against all odds. Drawn on a canvas from the game log, so every game
 * system gets them.
 */

const CARD = { width: 1200, height: 675 };

const INK = "#f4f1ea";
const MUTED = "#b9b4a8";
const GOLD = "#f5b942";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** A side as the cards show it: its name and colour, its armies, its VP. */
interface Side {
  name: string;
  color: string;
  armies: string[];
  vp: number;
}

function sidesOf(game: GameState): Side[] {
  return sides(game).map((seat) => {
    const players = sidePlayers(game, seat);
    const ids = new Set(players.map((p) => p.id));
    const armies = [
      ...new Set(
        Object.values(game.units)
          .filter((u) => ids.has(u.owner) && u.army)
          .map((u) => u.army!),
      ),
    ];
    return {
      name: sideName(game, seat),
      color: players[0]?.color ?? "#999",
      armies,
      vp: game.resources[players[0]?.id ?? ""]?.VP ?? 0,
    };
  });
}

function systemTitle(game: GameState): string {
  try {
    return plainSystemName(systemLabel(game.system, systemOf(game).name));
  } catch {
    return plainSystemName(game.system ?? "");
  }
}

/** The words' column on the left; the table's picture fills the rest, undimmed (UX 339). */
const COLUMN = 640;
const LEFT = 56;
/** The right edge of the words, where the scores line up. */
const RIGHT = COLUMN - 36;
const TEXT = RIGHT - LEFT;
const BG = "#111318";

/** A fresh card: the words' column, and the table's picture beside it. */
function backdrop(table: HTMLCanvasElement | null): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  if (table && table.width && table.height) {
    // Cover the picture's area, keeping the middle (where the shot was framed).
    const area = { x: COLUMN - 40, w: CARD.width - COLUMN + 40, h: CARD.height };
    const k = Math.max(area.w / table.width, area.h / table.height);
    const w = table.width * k;
    const h = table.height * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, 0, area.w, area.h);
    ctx.clip();
    ctx.drawImage(table, area.x + (area.w - w) / 2, (area.h - h) / 2, w, h);
    ctx.restore();
    // A soft seam into the column.
    const seam = ctx.createLinearGradient(area.x, 0, area.x + 80, 0);
    seam.addColorStop(0, BG);
    seam.addColorStop(1, "rgba(17, 19, 24, 0)");
    ctx.fillStyle = seam;
    ctx.fillRect(area.x, 0, 80, CARD.height);
  }
  return [canvas, ctx];
}

/** The biggest font (up to `size`) that fits `text` in `width`. */
function fit(ctx: CanvasRenderingContext2D, text: string, size: number, weight: number, width: number) {
  for (; size > 30; size -= 2) {
    font(ctx, size, weight);
    if (ctx.measureText(text).width <= width) return;
  }
}

function font(ctx: CanvasRenderingContext2D, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Text wrapped to `width`, at most `lines` lines (the last ends in … if cut); returns the y after it. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  lines = 3,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
      continue;
    }
    if (n === lines - 1) {
      let cut = line;
      while (cut && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
      ctx.fillText(`${cut}…`, x, y);
      return y + lineHeight;
    }
    ctx.fillText(line, x, y);
    y += lineHeight;
    n++;
    line = words[i]!;
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** The small line at the top: the app, the game and the mission. */
function kicker(ctx: CanvasRenderingContext2D, game: GameState, extra?: string) {
  font(ctx, 22, 600);
  ctx.fillStyle = GOLD;
  const bits = ["Open Battle", systemTitle(game), game.mission?.name, extra].filter(Boolean); // i18n-ignore
  wrap(ctx, bits.join("  ·  ").toUpperCase(), LEFT, 76, TEXT, 26, 1);
}

/** One row a side: a colour bar, its name and armies, and its VP on the right. */
function sideRows(ctx: CanvasRenderingContext2D, rows: Side[], y: number, right: string[]): number {
  for (const [i, s] of rows.entries()) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.roundRect(LEFT, y - 34, 10, 66, 5);
    ctx.fill();
    // The score first (right-aligned beside the name), so the name gets what's left.
    font(ctx, 40, 800);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.fillText(right[i] ?? "", RIGHT, y + 4);
    const scoreWidth = ctx.measureText(right[i] ?? "").width + 20;
    ctx.textAlign = "left";
    font(ctx, 32, 700);
    wrap(ctx, displayName(s.name), LEFT + 26, y, TEXT - 26 - scoreWidth, 34, 1);
    font(ctx, 20);
    ctx.fillStyle = MUTED;
    wrap(ctx, s.armies.join(", ") || " ", LEFT + 26, y + 28, TEXT - 26 - scoreWidth, 24, 1);
    y += 90;
  }
  return y;
}

/** A labelled panel: "Decisive moment · Round 3" over a title and its line. */
function momentBlock(
  ctx: CanvasRenderingContext2D,
  label: string,
  m: Moment,
  y: number,
  star = false,
): number {
  font(ctx, 20, 700);
  ctx.fillStyle = star ? GOLD : MUTED;
  wrap(ctx, `${star ? "★ " : ""}${label}`.toUpperCase(), LEFT, y, TEXT, 24, 1);
  font(ctx, 26, 700);
  ctx.fillStyle = INK;
  y = wrap(ctx, m.title, LEFT, y + 34, TEXT, 32, 1);
  font(ctx, 20);
  ctx.fillStyle = MUTED;
  return wrap(ctx, m.line, LEFT, y + 2, TEXT, 26, 2) + 16;
}

/** "Played on Open Battle", and where: the address people can type. */
function footer(ctx: CanvasRenderingContext2D) {
  font(ctx, 18);
  ctx.fillStyle = MUTED;
  ctx.fillText(t("Played on Open Battle"), LEFT, CARD.height - 36);
  font(ctx, 18, 700);
  ctx.fillStyle = GOLD;
  ctx.textAlign = "right";
  // On a dark pill, readable over any picture.
  const url = siteUrl();
  const w = ctx.measureText(url).width;
  ctx.fillStyle = "rgba(10, 11, 15, 0.82)";
  ctx.beginPath();
  ctx.roundRect(CARD.width - 48 - w - 16, CARD.height - 62, w + 32, 38, 19);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillText(url, CARD.width - 48, CARD.height - 36);
  ctx.textAlign = "left";
}

/** The biggest story of the game, and the rarest roll if there was one. */
export function standouts(record: GameRecord): { decisive?: Moment; rare?: Moment } {
  const all = momentsOf(record);
  const rare = all.find((m) => m.kind === "rare");
  const decisive = [...all]
    .filter((m) => m.kind !== "mvp" && m.kind !== "rare")
    .sort((a, b) => b.score - a.score)[0];
  return { decisive, rare };
}

/** The end-of-game card: who won and by how much, each side's armies, the decisive moment, Against all odds. */
export function endCard(
  record: GameRecord,
  game: GameState,
  table: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const [canvas, ctx] = backdrop(table);
  const rows = sidesOf(game);
  kicker(ctx, game);
  const scored = rows.some((s) => s.vp) || !!game.mission;
  const lost = (s: Side) =>
    Object.values(game.models).filter(
      (m) => m.destroyed && sidePlayers(game, sides(game)[rows.indexOf(s)]!).some((p) => p.id === m.owner),
    ).length;
  const head = headline(rows, scored, lost);
  fit(ctx, head, 60, 800, TEXT);
  ctx.fillStyle = INK;
  wrap(ctx, head, LEFT, 152, TEXT, 64, 1);
  let y = sideRows(
    ctx,
    rows,
    250,
    rows.map((s) => (scored ? t("{vp} VP", { vp: s.vp }) : tn(lost(s), "{n} lost", "{n} lost"))),
  );
  const { decisive, rare } = standouts(record);
  y += 8;
  if (decisive) y = momentBlock(ctx, t("Decisive moment · {when}", { when: decisive.when }), decisive, y);
  if (rare && y < CARD.height - 120) momentBlock(ctx, t("Against all odds"), rare, y, true);
  footer(ctx);
  return canvas;
}

/** A game's result in a line, and what it was (a clip's end frame). */
export function result(game: GameState): { title: string; line: string } {
  const rows = sidesOf(game);
  const scored = rows.some((s) => s.vp) || !!game.mission;
  const lost = (s: Side) =>
    Object.values(game.models).filter(
      (m) => m.destroyed && sidePlayers(game, sides(game)[rows.indexOf(s)]!).some((p) => p.id === m.owner),
    ).length;
  return {
    title: headline(rows, scored, lost),
    line: [systemTitle(game), game.mission?.name].filter(Boolean).join("  ·  "),
  };
}

/**
 * The result, as people post it (PX share 1): "Player 1 wins 12–7", "Draw,
 * 3–3"; with no VP, on losses: "Player 1 wins on losses: 0 to 2".
 */
function headline(rows: Side[], scored: boolean, lost: (s: Side) => number): string {
  const score = (s: Side) => (scored ? s.vp : -lost(s));
  const order = [...rows].sort((a, b) => score(b) - score(a));
  const [first, second] = order;
  if (!first || !second) return first ? displayName(first.name) : "";
  const vps = order.map((s) => s.vp).join("–");
  const losses = order.map(lost).join(t(" to "));
  if (score(first) === score(second))
    return scored ? t("Draw, {score}", { score: vps }) : t("Draw on losses: {score}", { score: losses });
  const side = displayName(first.name);
  // Against the computer the player's side is "You" (solo): "You win", not "You wins" (PX solo 5).
  if (side === t("You"))
    return scored ? t("You win {score}", { score: vps }) : t("You win on losses: {score}", { score: losses });
  return scored
    ? t("{side} wins {score}", { side, score: vps })
    : t("{side} wins on losses: {score}", { side, score: losses });
}

/** A round's card: each side's VP and what it lost, and what happened that round. */
export function roundCard(
  game: GameState,
  summary: RoundSummary,
  happened: (Highlight | Moment)[],
  table: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const [canvas, ctx] = backdrop(table);
  kicker(ctx, game);
  font(ctx, 60, 800);
  ctx.fillStyle = INK;
  ctx.fillText(t("Round {n}", { n: summary.round }), LEFT, 152);
  let y = 240;
  for (const p of summary.players) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.roundRect(LEFT, y - 34, 10, 66, 5);
    ctx.fill();
    font(ctx, 40, 800);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    const vp = t("{vp} VP", { vp: p.vp });
    ctx.fillText(vp, RIGHT, y + 4);
    const scoreWidth = ctx.measureText(vp).width + 20;
    ctx.textAlign = "left";
    font(ctx, 32, 700);
    wrap(ctx, displayName(p.name), LEFT + 26, y, TEXT - 26 - scoreWidth, 34, 1);
    font(ctx, 20);
    ctx.fillStyle = MUTED;
    const bits = [
      p.vpGained ? t("+{n} VP this round", { n: p.vpGained }) : "",
      p.modelsLost ? tn(p.modelsLost, "{n} model lost", "{n} models lost") : t("no losses"),
      p.unitsLost.length ? t("wiped out: {units}", { units: p.unitsLost.join(", ") }) : "",
    ].filter(Boolean);
    wrap(ctx, bits.join(" · "), LEFT + 26, y + 28, TEXT - 26 - scoreWidth, 24, 1);
    y += 90;
  }
  y += 8;
  font(ctx, 20, 700);
  ctx.fillStyle = MUTED;
  if (happened.length) ctx.fillText(t("What happened").toUpperCase(), LEFT, y);
  y += 34;
  for (const h of happened.slice(0, 3)) {
    const rare = "kind" in h && h.kind === "rare";
    font(ctx, 22, "line" in h ? 600 : 400);
    ctx.fillStyle = rare ? GOLD : INK;
    const text = "line" in h ? `${rare ? "★ " : ""}${h.title}. ${h.line}` : h.text;
    y = wrap(ctx, text, LEFT, y, TEXT, 28, 2) + 6;
    if (y > CARD.height - 80) break;
  }
  footer(ctx);
  return canvas;
}

export function pngOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"),
  );
}

/** "open-battle-2026-10-08-1342": a file name for this moment. */
export function stamp(): string {
  return `open-battle-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}`;
}
