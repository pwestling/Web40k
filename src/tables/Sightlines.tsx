import { useEffect, useMemo } from "react";
import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";
import { terrainBlocksLine, type GameState, type Vec2, type Zone } from "../core";
import { useStore } from "../store";
import { useTableEdit } from "./edit";

/** Where a model's eyes are, and the middle of a target, for the table-wide view: infantry-sized. */
const EYE = 2.5;
const BODY = 1.2;
/** Inches between the points a zone looks from, and between the squares it looks at. */
const FROM_STEP = 3;
const CELL = 2;
/**
 * A square counts as seen from a zone when a third of the zone has a line to
 * it: almost anything is visible from some corner of a zone, so "any line at
 * all" would light up the whole table.
 */
const EXPOSED = 1 / 3;

function inPolygon(p: Vec2, points: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Points spread over a deployment zone, a model's eye height up. */
function lookouts(zone: Zone): Vec2[] {
  const xs = zone.points.map((p) => p.x);
  const ys = zone.points.map((p) => p.y);
  const out: Vec2[] = [];
  for (let x = Math.min(...xs) + FROM_STEP / 2; x < Math.max(...xs); x += FROM_STEP)
    for (let y = Math.min(...ys) + FROM_STEP / 2; y < Math.max(...ys); y += FROM_STEP)
      if (inPolygon({ x, y }, zone.points)) out.push({ x, y });
  return out;
}

export interface SightGrid {
  cols: number;
  rows: number;
  /** Per square, a bit per seat whose zone can see it. */
  seen: Uint8Array;
  seats: number[];
}

/**
 * What each deployment zone can see (#28), from the table's geometry alone:
 * a square is seen from a zone if model-height lines from a good part of the
 * zone reach the middle of a model standing there. No units, no odds.
 */
export function sightGrid(game: GameState): SightGrid {
  const { width, depth } = game.table;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(depth / CELL);
  const seen = new Uint8Array(cols * rows);
  const seats = [...new Set(game.zones.map((z) => z.seat))].sort().slice(0, 8);
  seats.forEach((seat, bit) => {
    const from = game.zones.filter((z) => z.seat === seat).flatMap(lookouts);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const to = { x: -width / 2 + (c + 0.5) * CELL, y: -depth / 2 + (r + 0.5) * CELL, z: BODY };
        let clear = 0;
        for (const p of from) if (!terrainBlocksLine(game, { ...p, z: EYE }, to)) clear++;
        if (from.length && clear / from.length >= EXPOSED) seen[r * cols + c]! |= 1 << bit;
      }
  });
  return { cols, rows, seen, seats };
}

/** The table, coloured by which zone sees each square: a side's colour, white for both, dark for neither. */
export function Sightlines({ game }: { game: GameState }) {
  const on = useTableEdit((s) => s.sightlines);
  const show = on && game.zones.length > 0;
  // Worked out again only when the table changes, not on every move.
  const { terrain, zones, table, settings } = game;
  const grid = useMemo(
    () => (show ? sightGrid({ terrain, zones, table, settings } as GameState) : null),
    [show, terrain, zones, table, settings],
  );
  const colors = useMemo(
    () =>
      grid?.seats.map((seat) => Object.values(game.players).find((p) => p.seat === seat)?.color ?? "#888"),
    [grid, game.players],
  );
  const texture = useMemo(() => {
    if (!grid || !colors) return null;
    const canvas = document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d")!;
    for (let r = 0; r < grid.rows; r++)
      for (let c = 0; c < grid.cols; c++) {
        const bits = grid.seen[r * grid.cols + c]!;
        const who = grid.seats.flatMap((_, i) => (bits & (1 << i) ? [i] : []));
        // Seen from both: left clear, so what stands out is what only one side sees, or nobody does.
        if (who.length > 1) continue;
        ctx.globalAlpha = who.length === 1 ? 0.7 : 0.8;
        ctx.fillStyle = who.length === 0 ? "#0a0a0e" : colors[who[0]!]!;
        ctx.fillRect(c, r, 1, 1);
      }
    const t = new CanvasTexture(canvas);
    t.magFilter = NearestFilter;
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [grid, colors]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.04} raycast={() => null} renderOrder={2}>
      <planeGeometry args={[game.table.width, game.table.depth]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** The switch for the sightline view, with its key, before the battle or while editing terrain. */
export function SightlinesToggle() {
  const on = useTableEdit((s) => s.sightlines);
  const zones = useStore((s) => s.game.zones.length);
  const players = useStore((s) => s.game.players);
  if (!zones) return null;
  const seated = Object.values(players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!);
  return (
    <>
      <label className="check" title="What each deployment zone can see, from the terrain alone">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => useTableEdit.setState({ sightlines: e.target.checked })}
        />{" "}
        What each zone sees
      </label>
      {on && (
        <div className="legend sight-legend" role="note">
          {seated.map((p) => (
            <span key={p.id} style={{ ["--c" as string]: p.color }} className="seen-by">
              In {p.name}'s colour: only {p.name}'s zone sees here
            </span>
          ))}
          <span className="seen-both">No tint: both zones see here</span>
          <span className="seen-none">Dark: neither zone sees here</span>
        </div>
      )}
    </>
  );
}
