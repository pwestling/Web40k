import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import {
  baseSizeInches,
  modelHeight,
  rulerLength,
  type GameState,
  type Model,
  type Ruler,
  type Vec2,
} from "../core";
import { aliveModels, blockedMoves, moveAllowance, unitMoved } from "../systems/wh40k/rules";
import { tick } from "../ui/sound";
import { t } from "../i18n";
import { Ring } from "./ModelOverlay";

/** Lines and labels drawn over the table: ranges, rulers, sight lines, move readouts. */

/**
 * The outline of everywhere within `range` of any of the models' bases: the
 * outer edge of the union of their circles, with one label.
 */
export function RangeOutline({
  models,
  range,
  color,
  label,
}: {
  models: Model[];
  range: number;
  color: string;
  label: string;
}) {
  const { segments, at } = useMemo(() => {
    const circles = models.map((m) => {
      const { width, depth } = baseSizeInches(m.base);
      return { x: m.position.x, y: m.position.y, z: m.z ?? 0, r: Math.max(width, depth) / 2 + range };
    });
    const inside = (x: number, y: number, skip: number) =>
      circles.some((c, i) => i !== skip && Math.hypot(x - c.x, y - c.y) < c.r - 1e-3);
    const pts: number[] = [];
    let at = { x: 0, y: -Infinity, z: 0 };
    const N = 96;
    circles.forEach((c, i) => {
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2;
        const a1 = ((k + 1) / N) * Math.PI * 2;
        const p0 = { x: c.x + Math.cos(a0) * c.r, y: c.y + Math.sin(a0) * c.r };
        const p1 = { x: c.x + Math.cos(a1) * c.r, y: c.y + Math.sin(a1) * c.r };
        if (inside(p0.x, p0.y, i) || inside(p1.x, p1.y, i)) continue;
        pts.push(p0.x, c.z + 0.06, p0.y, p1.x, c.z + 0.06, p1.y);
        if (p0.y > at.y) at = { x: p0.x, y: p0.y, z: c.z };
      }
    });
    return { segments: new Float32Array(pts), at };
  }, [models, range]);
  if (!segments.length) return null;
  return (
    <>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[segments, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <Html
        zIndexRange={LABEL_Z}
        position={[at.x, at.z + 0.4, at.y]}
        center
        className="ruler"
        style={{ color }}
      >
        {label}
      </Html>
    </>
  );
}

/** A measuring line with its length, in the colour of whoever measured. */
export function RulerLine({ game, ruler, range }: { game: GameState; ruler: Ruler; range?: number | null }) {
  const a = ruler.fromModel ? game.models[ruler.fromModel] : undefined;
  const b = ruler.toModel ? game.models[ruler.toModel] : undefined;
  const from = a?.position ?? ruler.from;
  const to = b?.position ?? ruler.to;
  const za = (a?.z ?? 0) + 0.3;
  const zb = (b?.z ?? 0) + 0.3;
  const line = useMemo(
    () => new Float32Array([from.x, za, from.y, to.x, zb, to.y]),
    [from.x, from.y, to.x, to.y, za, zb],
  );
  const color = game.players[ruler.by]?.color ?? "#e5e7eb";
  const length = rulerLength(game, ruler);
  // Against a weapon's range shown for the measuring unit: how far in or out (a measurement, not odds).
  const short = range ? Number((range - length).toFixed(1)) : null;
  return (
    <>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[line, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <Html
        zIndexRange={LABEL_Z}
        position={[(from.x + to.x) / 2, Math.max(za, zb) + 0.6, (from.y + to.y) / 2]}
        center
        className={short !== null && Math.abs(short) <= 0.5 ? "ruler near" : "ruler"}
        style={{ borderBottom: `2px solid ${color}` }}
      >
        {`${length.toFixed(1)}"`}
        {a || b ? t(" base to base") : ""}
        {short !== null &&
          (short >= 0
            ? t(' · in by {inches}"', { inches: short.toFixed(1) })
            : t(' · out by {inches}"', { inches: (-short).toFixed(1) }))}
      </Html>
    </>
  );
}

/** Labels over the table stay under the UI panels (z-index 20 and up). */
export const LABEL_Z: [number, number] = [9, 0];

const SIGHT_COLORS = { full: "#22c55e", partial: "#facc15", none: "#ef4444" };

/** A sight line from the shooter's eye to the target, or a red ring on an unseen target. */
export function SightLine({
  shooter,
  target,
  state,
}: {
  shooter?: Model;
  target: Model;
  state: "full" | "partial" | "none";
}) {
  const color = SIGHT_COLORS[state];
  const line = useMemo(() => {
    if (!shooter) return null;
    const a = [shooter.position.x, (shooter.z ?? 0) + modelHeight(shooter) * 0.9, shooter.position.y];
    const b = [target.position.x, (target.z ?? 0) + modelHeight(target) * 0.5, target.position.y];
    return new Float32Array([...a, ...b]);
  }, [shooter, target]);
  return (
    <>
      <Ring model={target} radius={0.15} color={color} opacity={0.9} />
      {line && (
        <lineSegments raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[line, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={color} transparent opacity={0.7} />
        </lineSegments>
      )}
    </>
  );
}

export function seatColor(game: GameState, seat: number): string {
  return (
    Object.values(game.players).find((p) => p.seat === seat)?.color ?? (seat === 0 ? "#3b82f6" : "#f97316")
  );
}

export function MoveLabel({
  game,
  unitId,
  positions,
  heights,
  at,
}: {
  game: GameState;
  unitId: string;
  positions: Record<string, Vec2>;
  heights: Record<string, number>;
  at: Vec2;
}) {
  const unit = game.units[unitId]!;
  const moved = unitMoved(aliveModels(game, unit), positions, heights);
  const blocked = blockedMoves(game, unit, positions);
  const allowed = moveAllowance(game, unit);
  const deploying = game.turn.round === 0;
  const over = !deploying && allowed !== null && moved > allowed + 0.05;
  // Within half an inch of the limit, the label gets tense (PX-3e).
  const near = !deploying && !over && allowed !== null && moved >= allowed - 0.5;
  useTapeTicks(near ? moved : null);
  const base = deploying ? `${moved.toFixed(1)}"` : `${moved.toFixed(1)}" / ${allowed ?? "?"}"`;
  const text = blocked.length
    ? t("{distance} · through {terrain}", {
        distance: base,
        terrain: blocked.map((p) => p.name.toLowerCase()).join(", "),
      })
    : base;
  return (
    <SimpleLabel
      at={at}
      text={text}
      className={over || blocked.length ? "ruler over" : near ? "ruler near" : "ruler"}
    />
  );
}

export function SimpleLabel({
  at,
  text,
  className = "ruler",
}: {
  at: Vec2;
  text: string;
  className?: string;
}) {
  return (
    <Html zIndexRange={LABEL_Z} position={[at.x, 2.5, at.y]} center className={className}>
      {text}
    </Html>
  );
}

/** A soft tape-measure tick for each tenth of an inch crossed near the limit (quiet; off when muted). */
function useTapeTicks(moved: number | null) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (moved === null) {
      last.current = null;
      return;
    }
    const tenth = Math.floor(moved * 10);
    if (last.current !== null && tenth !== last.current) tick();
    last.current = tenth;
  }, [moved]);
}
