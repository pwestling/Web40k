import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { DoubleSide } from "three";
import {
  arcOf,
  blockCentre,
  blockCorners,
  blockFrame,
  blockToWorld,
  BLOCK_LEFT,
  rotate,
  type BlockFrame,
  type GameState,
  type Unit,
  type Vec2,
} from "../core";
import { useStore } from "../store";
import { blockMoveUsed, blockSummary, offTable } from "../ui/regiment";
import { useGame } from "../ui/hooks";
import { t } from "../i18n";

/** Labels sit under the side panels (see Board's LABEL_Z). */
const LABEL_Z: [number, number] = [9, 0];
const REACH = 24;

/**
 * The selected regiment's arcs: lines out from its corners at 45 degrees,
 * the front arc shaded, and the arcs named. A hovered enemy regiment shows
 * its arcs too, with which one the selected unit stands in.
 */
export function BlockArcs() {
  const game = useGame();
  const selected = useStore((s) => s.selected);
  const hover = useStore((s) => s.hoverUnit);
  const on = useStore((s) => s.arcs);
  if (!on) return null;
  const sel = selected ? game.units[selected] : undefined;
  const hov = hover && hover !== selected ? game.units[hover] : undefined;
  const selFrame = sel ? blockFrame(game, sel) : null;
  const hovFrame = hov ? blockFrame(game, hov) : null;
  const relation = sel && hov && hovFrame ? arcOf(hovFrame, unitPoint(game, sel, selFrame)) : null;
  return (
    <>
      {sel && selFrame && (
        <Arcs frame={selFrame} table={game.table} color={game.players[sel.owner]?.color ?? "#fff"} names />
      )}
      {hov && hovFrame && (
        <>
          <Arcs
            frame={hovFrame}
            table={game.table}
            color={game.players[hov.owner]?.color ?? "#fff"}
            names={false}
          />
          {relation && (
            <Html
              zIndexRange={LABEL_Z}
              position={[blockCentre(hovFrame).x, 3, blockCentre(hovFrame).y]}
              center
              className="ruler arc-note"
            >
              {relation === "front"
                ? t("{unit} is in its front", { unit: sel!.name })
                : relation === "left"
                  ? t("{unit} is in its left flank", { unit: sel!.name })
                  : relation === "right"
                    ? t("{unit} is in its right flank", { unit: sel!.name })
                    : t("{unit} is in its rear", { unit: sel!.name })}
            </Html>
          )}
        </>
      )}
    </>
  );
}

function unitPoint(game: GameState, unit: Unit, frame: BlockFrame | null): Vec2 {
  if (frame) return frame.front;
  const ms = unit.modelIds.flatMap((id) => game.models[id] ?? []).filter((m) => !m.destroyed);
  const n = Math.max(1, ms.length);
  return { x: ms.reduce((a, m) => a + m.position.x, 0) / n, y: ms.reduce((a, m) => a + m.position.y, 0) / n };
}

function Arcs({
  frame,
  table,
  color,
  names,
}: {
  frame: BlockFrame;
  table: { width: number; depth: number };
  color: string;
  names: boolean;
}) {
  const { lines, wedge, labels } = useMemo(() => {
    const c = blockCorners(frame);
    // Local +x is the block's left (BLOCK_LEFT).
    const dir = (left: number, ahead: number) =>
      rotate({ x: left * BLOCK_LEFT * Math.SQRT1_2, y: ahead * Math.SQRT1_2 }, frame.facing);
    // Each line stops at the table edge.
    const hx = table.width / 2;
    const hy = table.depth / 2;
    const out = (p: Vec2, d: Vec2) => {
      let t = REACH;
      if (d.x) t = Math.min(t, ((d.x > 0 ? hx : -hx) - p.x) / d.x);
      if (d.y) t = Math.min(t, ((d.y > 0 ? hy : -hy) - p.y) / d.y);
      t = Math.max(0, t);
      return { x: p.x + d.x * t, y: p.y + d.y * t };
    };
    const fl = out(c.frontLeft, dir(1, 1));
    const fr = out(c.frontRight, dir(-1, 1));
    const rl = out(c.rearLeft, dir(1, -1));
    const rr = out(c.rearRight, dir(-1, -1));
    const y = 0.06;
    const seg = (a: Vec2, b: Vec2) => [a.x, y, a.y, b.x, y, b.y];
    const lines = new Float32Array([
      ...seg(c.frontLeft, fl),
      ...seg(c.frontRight, fr),
      ...seg(c.rearLeft, rl),
      ...seg(c.rearRight, rr),
    ]);
    const tri = (a: Vec2, b: Vec2, d: Vec2) => [a.x, y, a.y, b.x, y, b.y, d.x, y, d.y];
    const wedge = new Float32Array([...tri(c.frontLeft, fl, fr), ...tri(c.frontLeft, fr, c.frontRight)]);
    // Labels stay on the table.
    const at = (x: number, yy: number) => {
      const p = blockToWorld(frame, { x, y: yy });
      return { x: Math.max(-hx + 3, Math.min(hx - 3, p.x)), y: Math.max(-hy + 1.5, Math.min(hy - 1.5, p.y)) };
    };
    const w = frame.width / 2;
    const labels: { text: string; p: Vec2 }[] = [
      { text: "Front", p: at(0, 6) },
      { text: "Rear", p: at(0, -frame.depth - 6) },
      { text: "Left flank", p: at((w + 6) * BLOCK_LEFT, -frame.depth / 2) },
      { text: "Right flank", p: at(-(w + 6) * BLOCK_LEFT, -frame.depth / 2) },
    ];
    return { lines, wedge, labels };
  }, [frame, table]);
  return (
    <group>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.85} />
      </lineSegments>
      <mesh raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[wedge, 3]} />
        </bufferGeometry>
        <meshBasicMaterial color={color} transparent opacity={0.12} side={DoubleSide} depthWrite={false} />
      </mesh>
      {names &&
        labels.map((l) => (
          <Html
            key={l.text}
            zIndexRange={LABEL_Z}
            position={[l.p.x, 0.5, l.p.y]}
            center
            className="arc-label"
          >
            {l.text}
          </Html>
        ))}
    </group>
  );
}

/** While a block is dragged: how far ahead and sideways, and its move so far this phase. */
export function BlockMoveLabel({
  game,
  unit,
  grab,
  at,
}: {
  game: GameState;
  unit: Unit;
  grab: Vec2;
  at: Vec2;
}) {
  const record = useStore((s) => s.record);
  const frame = blockFrame(game, unit);
  const summary = blockSummary(game, unit);
  if (!frame || !summary) return null;
  const d = { x: at.x - grab.x, y: at.y - grab.y };
  const local = rotate(d, -frame.facing);
  const dist = Math.hypot(d.x, d.y);
  const used = blockMoveUsed(record, unit.id) + dist;
  const marching = unit.status?.marching === true;
  const allowed = marching ? summary.march : summary.move;
  const sideways = Math.abs(local.x) > 0.25;
  const over = game.turn.round > 0 && allowed !== null && used > allowed + 0.05;
  const moved: Record<string, Vec2> = {};
  for (const id of unit.modelIds) {
    const p = game.models[id]?.position;
    if (p) moved[id] = { x: p.x + d.x, y: p.y + d.y };
  }
  const off = offTable(game, unit, moved);
  const parts = [
    local.y >= 0
      ? t('{inches}" ahead', { inches: Math.abs(local.y).toFixed(1) })
      : t('{inches}" back', { inches: Math.abs(local.y).toFixed(1) }),
    ...(sideways ? [t('{inches}" sideways', { inches: Math.abs(local.x).toFixed(1) })] : []),
    ...(game.turn.round > 0 && allowed !== null
      ? [t('{used}" of {allowed}"', { used: used.toFixed(1), allowed: String(allowed) })]
      : []),
    ...(off ? [t("off the table")] : []),
  ];
  return (
    <Html
      zIndexRange={LABEL_Z}
      position={[at.x, 2.5, at.y]}
      center
      className={
        over || off || (sideways && game.turn.round > 0)
          ? "ruler over"
          : game.turn.round > 0 && allowed !== null && used >= allowed - 0.5
            ? "ruler near"
            : "ruler"
      }
    >
      {parts.join(" · ")}
      {game.turn.round > 0 && (sideways || local.y < -0.25)
        ? t(" · moving back or sideways halves Movement")
        : ""}
    </Html>
  );
}
