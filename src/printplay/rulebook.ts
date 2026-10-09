import type { GameSystem, TerrainCategoryDef } from "../core/content/schema";
import type { Layout, StandInLook } from "../core";
import type { Mission, Rulebook } from "../sdk";
import { expandLayout } from "../systems/packageLayout";

/**
 * A game's rulebook as data (#47): its own words (PackageApp.rulebook) round
 * tables made from its data, so the rules page in the app, the docs and the
 * print-and-play sheets all say what the game plays. Made from the module,
 * never written by hand: `pnpm rulebook` writes it to the game's folder
 * (rulebook.json, RULES.md, table.svg) and a test fails when they're stale.
 */

export interface RulebookUnit {
  name: string;
  count: number;
  /** Base diameter (mm) and figure height (inches), for stand-ins. */
  baseMm: number;
  height?: number;
  look: StandInLook;
  points: number;
  /** Characteristic id to value, as the card shows them. */
  stats: Record<string, string>;
  /** What the model is, when it isn't its name (a skirmish game's "Long-gun" called Ness). */
  role?: string;
  /** Its own rules besides its army's. */
  abilities?: { name: string; text: string }[];
}

export interface RulebookArmy {
  name: string;
  about?: string;
  color: string;
  points: number;
  rule: { name: string; text: string };
  units: RulebookUnit[];
}

export interface RulebookMission {
  id: string;
  name: string;
  summary: string;
  scoring: string[];
  objectives: { label: string; x: number; y: number }[];
}

export interface RulebookDoc {
  id: string;
  name: string;
  version: string;
  licence?: string;
  intro: string;
  sections: Rulebook["sections"];
  quickRef: string[];
  rounds: number | null;
  table: { width: number; depth: number };
  characteristics: { id: string; name: string; type: string; format?: string }[];
  terrain: { id: string; name: string; does: string }[];
  armies: RulebookArmy[];
  missions: RulebookMission[];
  /** The game's words for armies, units and markers (Rulebook.words); see `wordsOf`. */
  words?: NonNullable<Rulebook["words"]>;
  /** The map's colours by terrain category, over TERRAIN_COLORS. */
  terrainColors?: Record<string, string>;
  /** The starter table: footprints as rotated boxes, by terrain category. */
  map: {
    pieces: {
      name: string;
      category: string;
      x: number;
      y: number;
      width: number;
      depth: number;
      facing: number;
    }[];
    zones: { seat: number; points: { x: number; y: number }[] }[];
  };
}

/** What the generator reads from a module: its system, and its app's data. */
export interface RulebookSource {
  system: GameSystem;
  app: {
    armies?: unknown[];
    missions?: Mission[];
    layout(table: GameSystem["defaultTable"] & object): unknown;
    templateCategory?: Record<string, string>;
    rulebook?: Rulebook;
  };
  licence?: string;
}

const round1 = (n: number) => Math.round(n * 100) / 100;

/** What a terrain category does, in a few words. */
function does(t: TerrainCategoryDef): string {
  const bits = [
    t.cover ? "cover" : "",
    t.blocksMovement ? "can't be walked through" : "",
    t.blocksSight ? "blocks sight" : "",
    t.visibility === "obscuring" ? "seen past it, a target is in cover" : "",
  ].filter(Boolean);
  return bits.length ? bits.join("; ") : "no effect";
}

interface SourceUnit {
  name: string;
  base?: { diameterMm?: number };
  sheet?: { abilities?: { name: string; text: string }[]; points?: number };
  models: {
    profile?: { name?: string; chars?: Record<string, string> };
    look?: StandInLook;
    height?: number;
  }[];
}

export function rulebookOf(source: RulebookSource): RulebookDoc {
  const { system, app } = source;
  const table = system.defaultTable ?? { width: 36, depth: 24 };
  const book = app.rulebook ?? { intro: "", sections: [] };
  const armies = (app.armies ?? []).map((raw) => {
    const a = raw as { name: string; about?: string; color?: string; points?: number; units: SourceUnit[] };
    const rule = a.units[0]?.sheet?.abilities?.[0] ?? { name: "", text: "" };
    return {
      name: a.name,
      ...(a.about ? { about: a.about } : {}),
      color: a.color ?? "#888888",
      points: a.points ?? a.units.reduce((n, u) => n + (u.sheet?.points ?? 0), 0),
      rule: { name: rule.name, text: rule.text },
      units: a.units.map((u) => {
        const m = u.models[0];
        const own = (u.sheet?.abilities ?? []).slice(1);
        return {
          name: u.name,
          count: u.models.length,
          baseMm: u.base?.diameterMm ?? 32,
          ...(m?.height ? { height: m.height } : {}),
          look: m?.look ?? { shape: "trooper" },
          points: u.sheet?.points ?? 0,
          stats: { ...(m?.profile?.chars ?? {}) },
          ...(m?.profile?.name && m.profile.name !== u.name ? { role: m.profile.name } : {}),
          ...(own.length ? { abilities: own.map((x) => ({ name: x.name, text: x.text })) } : {}),
        } as RulebookUnit;
      }),
    };
  });
  const missions = (app.missions ?? []).map((m) => {
    const setup = m.setup(table);
    return {
      id: m.id,
      name: m.name,
      summary: m.summary,
      scoring: m.scoring.map((r) => r.name),
      objectives: setup.objectives.map((o) => ({
        label: (o as { label?: string }).label ?? o.id,
        x: round1(o.position.x),
        y: round1(o.position.y),
      })),
    };
  });
  const layout: Layout = expandLayout(app.layout(table), app.templateCategory);
  return {
    id: system.id,
    name: system.name,
    version: system.version,
    ...(source.licence ? { licence: source.licence } : {}),
    intro: book.intro,
    sections: book.sections,
    quickRef: book.quickRef ?? [],
    rounds: typeof system.turn.rounds === "number" ? system.turn.rounds : null,
    table: { width: table.width, depth: table.depth },
    characteristics: system.characteristics
      .filter((c) => c.of === "model")
      .map((c) => ({ id: c.id, name: c.name, type: c.type, ...(c.format ? { format: c.format } : {}) })),
    terrain: (system.terrain ?? []).map((t) => ({ id: t.id, name: t.name, does: does(t) })),
    armies,
    missions,
    ...(book.words ? { words: book.words } : {}),
    ...(book.terrainColors ? { terrainColors: book.terrainColors } : {}),
    map: {
      pieces: layout.terrain.map((p) => ({
        name: p.name,
        category: p.category,
        x: round1(p.position.x),
        y: round1(p.position.y),
        width: round1(p.width),
        depth: round1(p.depth),
        facing: round1(p.facing),
      })),
      zones: layout.zones.map((z) => ({
        seat: z.seat ?? 0,
        points: z.points.map((p) => ({ x: round1(p.x), y: round1(p.y) })),
      })),
    },
  };
}

/** A characteristic's value as the tables show it: 5", 4+, or – for none. */
export function statText(doc: RulebookDoc, id: string, value: string | undefined): string {
  const c = doc.characteristics.find((x) => x.id === id);
  if (value === undefined || value === "" || value === "0") return id === "W" ? (value ?? "–") : "–";
  if (c?.format) return c.format.replace("{v}", value);
  if (c?.type === "distance") return `${value}"`;
  return value;
}

/** A game's words for its armies, units and markers: its own, or Rift Lanterns'. */
export function wordsOf(doc: RulebookDoc): NonNullable<Rulebook["words"]> {
  return (
    doc.words ?? {
      army: "warband",
      armies: "warbands",
      unit: "unit",
      units: "units",
      marker: "lantern",
      markers: "lanterns",
      reach: 3,
    }
  );
}

/** A terrain category's colour on the map and sheets. */
export function terrainColor(doc: RulebookDoc, category: string): string | undefined {
  return doc.terrainColors?.[category] ?? TERRAIN_COLORS[category];
}

/** The terrain colours the map and sheets use, by category, unless a game gives its own. */
const TERRAIN_COLORS: Record<string, string> = {
  ruin: "#8c877d",
  thicket: "#4f7a3a",
  wreck: "#7a4a2b",
  open: "#b9b089",
};

/** The starter table as SVG (seat 0 at the top), for the docs and the rules page. */
export function mapSvg(doc: RulebookDoc, opts: { scale?: number; labels?: boolean } = {}): string {
  const k = opts.scale ?? 20;
  const { width, depth } = doc.table;
  const X = (x: number) => round1((x + width / 2) * k);
  const Y = (y: number) => round1((depth / 2 - y) * k);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width * k} ${depth * k}" width="${width * k}" height="${depth * k}" font-family="system-ui, sans-serif">`,
  );
  out.push(`<rect width="${width * k}" height="${depth * k}" fill="#5e7d4a"/>`);
  // A 6" grid, to measure by.
  for (let x = 6; x < width; x += 6)
    out.push(
      `<line x1="${x * k}" y1="0" x2="${x * k}" y2="${depth * k}" stroke="#ffffff" stroke-opacity="0.12"/>`,
    );
  for (let y = 6; y < depth; y += 6)
    out.push(
      `<line x1="0" y1="${y * k}" x2="${width * k}" y2="${y * k}" stroke="#ffffff" stroke-opacity="0.12"/>`,
    );
  for (const z of doc.map.zones) {
    const pts = z.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
    out.push(`<polygon points="${pts}" fill="${z.seat === 0 ? "#3b82f6" : "#f97316"}" fill-opacity="0.18"/>`);
  }
  for (const p of doc.map.pieces) {
    const deg = round1((-p.facing * 180) / Math.PI);
    out.push(
      `<rect x="${round1((-p.width * k) / 2)}" y="${round1((-p.depth * k) / 2)}" width="${round1(p.width * k)}" height="${round1(p.depth * k)}" rx="${p.category === "thicket" ? round1(Math.min(p.width, p.depth) * k * 0.45) : 2}" fill="${terrainColor(doc, p.category) ?? "#999"}" stroke="#1f2937" stroke-opacity="0.5" transform="translate(${X(p.x)} ${Y(p.y)}) rotate(${deg})"/>`,
    );
  }
  const lanterns = doc.missions[0]?.objectives ?? [];
  for (const o of lanterns) {
    out.push(
      `<circle cx="${X(o.x)}" cy="${Y(o.y)}" r="${wordsOf(doc).reach * k}" fill="#ffe9b0" fill-opacity="0.18" stroke="#ffe9b0" stroke-dasharray="6 5"/>`,
    );
    out.push(`<circle cx="${X(o.x)}" cy="${Y(o.y)}" r="${0.6 * k}" fill="#ffd36b" stroke="#3b2f1a"/>`);
  }
  if (opts.labels !== false) {
    const label = (text: string, y: number) =>
      out.push(
        `<text x="${(width * k) / 2}" y="${y}" text-anchor="middle" font-size="${0.8 * k}" fill="#ffffff" fill-opacity="0.85">${text}</text>`,
      );
    label("Player 1 deploys here", 1.4 * k);
    label("Player 2 deploys here", depth * k - 0.7 * k);
  }
  out.push("</svg>");
  return out.join("\n");
}

/** The rulebook's words a line each: list items stay together, everything else is its own paragraph. */
export function textBlocks(
  text: string,
): ({ kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] })[] {
  const out: ({ kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] })[] = [];
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const item = /^(- |\d+\. )(.*)$/.exec(line);
    const kind = item ? (item[1] === "- " ? "ul" : "ol") : "p";
    const last = out.at(-1);
    if (item && last && last.kind !== "p" && last.kind === kind) last.items.push(item[2]!);
    else out.push(item ? { kind: kind as "ul" | "ol", items: [item[2]!] } : { kind: "p", text: line });
  }
  return out;
}

/** The words as Markdown, a blank line between blocks. */
const md = (text: string) =>
  textBlocks(text)
    .map((b) =>
      b.kind === "p"
        ? b.text
        : b.items.map((x, i) => `${b.kind === "ol" ? `${i + 1}.` : "-"} ${x}`).join("\n"),
    )
    .join("\n\n");

/** How deep the first deployment zone is (inches). */
export function deployDepth(doc: RulebookDoc): number {
  const ys = doc.map.zones[0]?.points.map((p) => p.y) ?? [0];
  return round1(Math.max(...ys) - Math.min(...ys));
}

/** The rulebook as Markdown, for the game's RULES.md. */
export function rulebookMarkdown(doc: RulebookDoc): string {
  const lines: string[] = [];
  const stats = doc.characteristics;
  lines.push(
    `<!-- Made by \`pnpm rulebook\` from the ${doc.id} module (version ${doc.version}). Don't edit by hand. -->`,
  );
  lines.push("");
  lines.push(`# ${doc.name}: the rules`);
  lines.push("");
  lines.push(md(doc.intro));
  lines.push("");
  for (const s of doc.sections) {
    lines.push(`## ${s.title}`, "", md(s.text), "");
  }
  const w = wordsOf(doc);
  const Cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  lines.push(`## The ${w.armies}`, "");
  lines.push(
    `Each ${w.army} is about ${doc.armies[0]?.points ?? 100} points, ${doc.armies[0]?.units.length ?? 3} ${w.units}.`,
    "",
  );
  lines.push(`| ${Cap(w.army)} | Rule |`, "| --- | --- |");
  for (const a of doc.armies)
    lines.push(
      `| **${a.name}**${a.about ? `: ${a.about.replace(/\.$/, "").toLowerCase()}` : ""} | **${a.rule.name}.** ${a.rule.text} |`,
    );
  lines.push("");
  // A skirmish game's named models: what each is and its own rules, in place of a model count.
  const roles = doc.armies.some((a) => a.units.some((u) => u.role || u.abilities));
  const head = roles ? `${Cap(w.unit)} | ${Cap(w.army)} | Role` : `Unit | ${Cap(w.army)} | Models`;
  const tail = roles ? " | Points | Rules |" : " | Points |";
  lines.push(`| ${head} | ${stats.map((c) => c.name).join(" | ")}${tail}`);
  lines.push(`| --- | --- | --- | ${stats.map(() => "---").join(" | ")} | ---${roles ? " | --- |" : " |"}`);
  for (const a of doc.armies)
    for (const u of a.units)
      lines.push(
        `| ${u.name} | ${a.name} | ${roles ? (u.role ?? "") : u.count} | ${stats.map((c) => statText(doc, c.id, u.stats[c.id])).join(" | ")} | ${u.points} |${roles ? ` ${(u.abilities ?? []).map((x) => x.name).join(", ")} |` : ""}`,
      );
  lines.push("");
  const abilities = new Map(
    doc.armies.flatMap((a) => a.units.flatMap((u) => u.abilities ?? [])).map((x) => [x.name, x.text]),
  );
  if (abilities.size) {
    for (const [name, text] of abilities) lines.push(`- **${name}.** ${text}`);
    lines.push("");
  }
  lines.push("## Missions", "");
  lines.push(
    `Both players deploy in a strip ${deployDepth(doc)}" deep along their long edge of a ${doc.table.width}" x ${doc.table.depth}" table.`,
    "",
  );
  for (const m of doc.missions) lines.push(`- **${m.name}.** ${m.summary}`);
  lines.push("");
  lines.push("## The starter table", "");
  lines.push(
    `![The starter table: deployment strips at the top and bottom, the ${w.markers} across the middle](table.svg)`,
    "",
  );
  for (const t of doc.terrain) lines.push(`- **${t.name}**: ${t.does}.`);
  lines.push("");
  if (doc.quickRef.length) {
    lines.push("## Quick reference", "");
    for (const q of doc.quickRef) lines.push(`- ${q}`);
    lines.push("");
  }
  return lines.join("\n");
}
