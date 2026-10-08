import { sideName, sidePlayers, sides, systemOf, type GameRecord, type GameState } from "../core";
import { momentsOf, type Moment } from "../core/moments";
import { t, tn } from "../i18n";
import { displayName } from "../i18n/names";
import type { Highlight, RoundSummary } from "../ui/highlights";
import { systemLabel } from "../ui/systemLabels";

/**
 * Pictures to post (#46): the end-of-game card and a card for each round, as
 * PNGs at 1200 × 675, the size social sites show whole (16:9). The table as
 * it stands fills the back, dimmed, and the words sit over it: the armies,
 * VP, the decisive moment and, when the dice did something 1 in 1,000,
 * Against all odds. Drawn on a canvas from the game log, so every game
 * system gets them.
 */

export const CARD = { width: 1200, height: 675 };

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
    return systemLabel(game.system, systemOf(game).name);
  } catch {
    return game.system ?? "";
  }
}

/** A fresh card with the table behind it, dimmed most where the words go (the left). */
function backdrop(table: HTMLCanvasElement | null): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#111318";
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  if (table && table.width && table.height) {
    // Cover the card, keeping the table's middle.
    const k = Math.max(CARD.width / table.width, CARD.height / table.height);
    const w = table.width * k;
    const h = table.height * k;
    // Shifted right, out from under the words.
    ctx.drawImage(table, (CARD.width - w) / 2 + CARD.width * 0.18, (CARD.height - h) / 2, w, h);
  }
  const shade = ctx.createLinearGradient(0, 0, CARD.width, 0);
  shade.addColorStop(0, "rgba(10, 11, 15, 0.94)");
  shade.addColorStop(0.55, "rgba(10, 11, 15, 0.78)");
  shade.addColorStop(1, "rgba(10, 11, 15, 0.3)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  return [canvas, ctx];
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
  ctx.fillText(bits.join("  ·  ").toUpperCase(), 64, 76);
}

/** One row a side: a colour bar, its name and armies, and its VP on the right. */
function sideRows(ctx: CanvasRenderingContext2D, rows: Side[], y: number, right: string[]): number {
  for (const [i, s] of rows.entries()) {
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.roundRect(64, y - 34, 10, 66, 5);
    ctx.fill();
    font(ctx, 34, 700);
    ctx.fillStyle = INK;
    ctx.fillText(displayName(s.name), 92, y);
    font(ctx, 22);
    ctx.fillStyle = MUTED;
    wrap(ctx, s.armies.join(", ") || " ", 92, y + 30, 520, 26, 1);
    font(ctx, 44, 800);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.fillText(right[i] ?? "", 760, y + 8);
    ctx.textAlign = "left";
    y += 96;
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
  ctx.fillText(`${star ? "★ " : ""}${label}`.toUpperCase(), 64, y);
  font(ctx, 28, 700);
  ctx.fillStyle = INK;
  y = wrap(ctx, m.title, 64, y + 36, 700, 34, 1);
  font(ctx, 22);
  ctx.fillStyle = MUTED;
  return wrap(ctx, m.line, 64, y + 2, 700, 28, 2) + 18;
}

function footer(ctx: CanvasRenderingContext2D, text: string) {
  font(ctx, 18);
  ctx.fillStyle = MUTED;
  ctx.fillText(text, 64, CARD.height - 36);
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
  const best = Math.max(...rows.map((s) => s.vp));
  const winners = rows.filter((s) => s.vp === best);
  font(ctx, 64, 800);
  ctx.fillStyle = INK;
  const head = !scored
    ? tn(Math.max(1, game.turn.round - 1), "{n} round played", "{n} rounds played")
    : winners.length === 1
      ? t("{side} wins", { side: displayName(winners[0]!.name) })
      : t("A draw");
  wrap(ctx, head, 64, 156, 1000, 70, 1);
  const lost = (s: Side) =>
    Object.values(game.models).filter(
      (m) => m.destroyed && sidePlayers(game, sides(game)[rows.indexOf(s)]!).some((p) => p.id === m.owner),
    ).length;
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
  footer(ctx, t("Played on Open Battle"));
  return canvas;
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
  font(ctx, 64, 800);
  ctx.fillStyle = INK;
  ctx.fillText(t("Round {n}", { n: summary.round }), 64, 156);
  let y = 250;
  for (const p of summary.players) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.roundRect(64, y - 34, 10, 66, 5);
    ctx.fill();
    font(ctx, 34, 700);
    ctx.fillStyle = INK;
    ctx.fillText(displayName(p.name), 92, y);
    font(ctx, 22);
    ctx.fillStyle = MUTED;
    const bits = [
      p.vpGained ? t("+{n} VP this round", { n: p.vpGained }) : "",
      p.modelsLost ? tn(p.modelsLost, "{n} model lost", "{n} models lost") : t("no losses"),
      p.unitsLost.length ? t("wiped out: {units}", { units: p.unitsLost.join(", ") }) : "",
    ].filter(Boolean);
    wrap(ctx, bits.join(" · "), 92, y + 30, 560, 26, 1);
    font(ctx, 44, 800);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.fillText(t("{vp} VP", { vp: p.vp }), 760, y + 8);
    ctx.textAlign = "left";
    y += 96;
  }
  y += 8;
  font(ctx, 20, 700);
  ctx.fillStyle = MUTED;
  if (happened.length) ctx.fillText(t("What happened").toUpperCase(), 64, y);
  y += 36;
  for (const h of happened.slice(0, 3)) {
    const rare = "kind" in h && h.kind === "rare";
    font(ctx, 24, "line" in h ? 600 : 400);
    ctx.fillStyle = rare ? GOLD : INK;
    const text = "line" in h ? `${rare ? "★ " : ""}${h.title}: ${h.line}` : h.text;
    y = wrap(ctx, text, 64, y, 760, 30, 2) + 6;
    if (y > CARD.height - 80) break;
  }
  footer(ctx, t("Played on Open Battle"));
  return canvas;
}

export function pngOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"),
  );
}

/** Save a file the browser's way. */
export function saveFile(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** "open-battle-2026-10-08-1342": a file name for this moment. */
export function stamp(): string {
  return `open-battle-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}`;
}
