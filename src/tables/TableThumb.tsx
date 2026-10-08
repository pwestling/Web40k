import { toWorld, type Layout, type TerrainPiece } from "../core";
import { t } from "../i18n";

const FILL: Record<string, string> = {
  blocking: "#6b7280",
  obscuring: "#4d7c0f",
  open: "#a8a29e",
};

/** A piece's footprint as an SVG polygon's points (+y, seat 0's edge, at the bottom as on screen). */
function corners(t: TerrainPiece): string {
  return [
    [-t.width / 2, -t.depth / 2],
    [t.width / 2, -t.depth / 2],
    [t.width / 2, t.depth / 2],
    [-t.width / 2, t.depth / 2],
  ]
    .map(([x, y]) => toWorld(t, { x: x!, y: y! }))
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/** What a piece looks like from above: woods green, solid things grey, the rest light. */
function shade(t: TerrainPiece): string {
  if (t.mesh) return "#94a3b8";
  if (t.solids.some((s) => s.kind === "foliage")) return FILL.obscuring!;
  if (!t.solids.length || t.solids.every((s) => s.h <= 2.2)) return FILL.open!;
  return FILL.blocking!;
}

/**
 * A table from above (#28): deployment zones in the sides' colours, terrain
 * footprints and objectives. Drawn from the layout, so it is never stale.
 */
export function TableThumb({
  layout,
  table,
  colors = ["#3b82f6", "#f97316", "#2dd4bf", "#fde047"],
  width = 120,
  label,
}: {
  layout: Layout;
  table: { width: number; depth: number };
  colors?: string[];
  width?: number;
  label?: string;
}) {
  const hx = table.width / 2;
  const hy = table.depth / 2;
  return (
    <svg
      className="table-thumb"
      width={width}
      height={(width * table.depth) / table.width}
      viewBox={`${-hx} ${-hy} ${table.width} ${table.depth}`}
      role="img"
      aria-label={label ?? t("The table from above")}
    >
      <rect x={-hx} y={-hy} width={table.width} height={table.depth} fill="#3f4a33" />
      {layout.zones.map((z, i) => (
        <polygon
          key={`z${i}`}
          points={z.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={colors[z.seat] ?? "#888"}
          fillOpacity={0.28}
        />
      ))}
      {layout.terrain.map((t) => (
        <polygon key={t.id} points={corners(t)} fill={shade(t)} stroke="#111318" strokeWidth={0.3} />
      ))}
      {layout.objectives.map((o) => (
        <circle
          key={o.id}
          cx={o.position.x}
          cy={o.position.y}
          r={1.2}
          fill="#fde68a"
          stroke="#111318"
          strokeWidth={0.3}
        />
      ))}
    </svg>
  );
}
