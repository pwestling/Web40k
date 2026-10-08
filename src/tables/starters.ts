import type { Layout, Table, TerrainPiece } from "../core";
import { t } from "../i18n";
import { systemModule } from "../systems";
import { makePiece, TEMPLATES } from "../systems/wh40k/layout";

/**
 * Starter tables (#28): a few generated layouts per game system, built from
 * the shared terrain templates in that system's categories, point-symmetric
 * so both sides get the same table. The system's own layout supplies the
 * deployment zones and objectives. The same seed always gives the same table.
 */

interface Starter {
  id: string;
  /** Templates for one half of the table (each gets a twin), for a 60" x 44" table. */
  half: string[];
}

const STARTERS: Starter[] = [
  {
    id: "close",
    half: ["Tall ruin", "Ruin", "Ruin", "Small ruin", "Small ruin", "Container", "Barricade"],
  },
  {
    id: "broken",
    half: ["Ruin", "Small ruin", "Woods", "Hill", "Crater", "Barricade"],
  },
  {
    id: "open",
    half: ["Hill", "Woods", "Crater", "Barricade"],
  },
];

/** A small seeded random generator (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const radius = (name: string) => {
  const t = TEMPLATES.find((x) => x.name === name)!;
  return Math.hypot(t.width, t.depth) / 2;
};

/** One starter layout: pieces placed at random in the left half, each mirrored through the centre. */
export function starterLayout(system: string | undefined, table: Table, starterId: string, seed = 1): Layout {
  const starter = STARTERS.find((s) => s.id === starterId) ?? STARTERS[0]!;
  const mod = systemModule(system);
  const base = mod.layout(table) as Layout;
  const categories = mod.templateCategory;
  // Fewer pieces on a smaller table, and smaller ones first to go.
  const scale = Math.min(1, (table.width * table.depth) / (60 * 44));
  const shrink = Math.min(1, Math.sqrt(scale) * 1.15);
  const count = Math.max(2, Math.round(starter.half.length * scale));
  const names = [...starter.half].sort((a, b) => radius(b) - radius(a)).slice(0, count);
  const rand = random(seed * 9973 + starterId.length * 131);
  const hx = table.width / 2;
  const hy = table.depth / 2;
  const placed: { x: number; y: number; r: number }[] = [];
  const terrain: TerrainPiece[] = [];
  names.forEach((name, i) => {
    const r = radius(name) * shrink;
    for (let tries = 0; tries < 200; tries++) {
      const x = -hx + r + 1 + rand() * Math.max(0, hx - 2 * r - 2);
      const y = -hy + r + 1 + rand() * Math.max(0, table.depth - 2 * r - 2);
      // Clear of every piece so far and of every twin (including its own, across the centre).
      const clear = [...placed, ...placed.map((p) => ({ ...p, x: -p.x, y: -p.y }))].every(
        (p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 1.5,
      );
      if (!clear || Math.hypot(x, y) < r + 1) continue;
      placed.push({ x, y, r });
      const facing = Math.round(rand() * 8) * (Math.PI / 4);
      const piece = scaled(
        makePiece(name, `${starter.id}-${i}a`, { x, y }, facing, categories?.[name]),
        shrink,
      );
      terrain.push(piece, {
        ...piece,
        id: `${starter.id}-${i}b`,
        position: { x: -x, y: -y },
        facing: facing + Math.PI,
      });
      break;
    }
  });
  return { terrain, objectives: base.objectives, zones: base.zones };
}

/** A template piece shrunk for a small table (Full Spectrum Dominance's 36" x 24"). */
function scaled(piece: TerrainPiece, k: number): TerrainPiece {
  if (k >= 0.999) return piece;
  return {
    ...piece,
    width: piece.width * k,
    depth: piece.depth * k,
    solids: piece.solids.map((s) => ({ ...s, x: s.x * k, y: s.y * k, w: s.w * k, d: s.d * k, h: s.h * k })),
  };
}

/** The starters' names and blurbs, in the chosen language. */
const text = (): Record<string, { name: string; blurb: string }> => ({
  close: { name: t("Close quarters"), blurb: t("Dense ruins and short sightlines") },
  broken: { name: t("Broken ground"), blurb: t("A mix of ruins, woods and hills") },
  open: { name: t("Open field"), blurb: t("Room to manoeuvre: a few hills, woods and walls") },
});

export const starters = (): { id: string; name: string; blurb: string }[] => {
  const words = text();
  return STARTERS.map(({ id }) => ({ id, name: words[id]!.name, blurb: words[id]!.blurb }));
};
