import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, Plane, Raycaster, Shape, Vector2, Vector3 } from "three";
import {
  templateEnd,
  templateHits,
  templateOutline,
  type GameState,
  type Template,
  type Vec2,
} from "../core";
import { useStore } from "../store";
import { useGame } from "../ui/hooks";

const LABEL_Z: [number, number] = [9, 0];

type Grab = { id: string; part: "body" | "end"; grab: Vec2; start: Template };

/**
 * Blast, flame and line templates on the table. Drag one to move it, or its
 * far end to aim a flame or a line. The label counts the models under it,
 * per unit: wholly under, and partly under.
 */
export function Templates({ onDragging }: { onDragging: (on: boolean) => void }) {
  const game = useGame();
  const dispatch = useStore((s) => s.dispatch);
  const live = useStore((s) => s.scrub === null && s.role !== "spectator");
  const { camera, gl } = useThree();
  const [held, setHeld] = useState<Template | null>(null);
  const grab = useRef<Grab | null>(null);

  useEffect(() => {
    if (!held) return;
    const ray = new Raycaster();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const at = (e: PointerEvent): Vec2 | null => {
      const r = gl.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : null;
    };
    const move = (e: PointerEvent) => {
      const g = grab.current;
      const p = at(e);
      if (!g || !p) return;
      setHeld(dragged(g, p));
    };
    const drop = (e: PointerEvent) => {
      const g = grab.current;
      grab.current = null;
      const p = at(e);
      setHeld(null);
      onDragging(false);
      if (!g || !p || Math.hypot(p.x - g.grab.x, p.y - g.grab.y) < 0.1) return;
      const { by: _by, ...template } = dragged(g, p);
      dispatch({ type: "template/set", id: g.id, template });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
    };
  }, [held !== null, camera, gl, dispatch, onDragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (t: Template, part: Grab["part"], p: Vec2) => {
    if (!live) return;
    grab.current = { id: t.id, part, grab: p, start: t };
    setHeld(t);
    onDragging(true);
  };

  return (
    <>
      {Object.values(game.templates ?? {}).map((stored) => {
        const t = held?.id === stored.id ? held : stored;
        return <TemplateMark key={t.id} game={game} t={t} onGrab={(part, p) => start(stored, part, p)} />;
      })}
    </>
  );
}

function dragged(g: Grab, p: Vec2): Template {
  const t = g.start;
  if (g.part === "end") return { ...t, to: p };
  const dx = p.x - g.grab.x;
  const dy = p.y - g.grab.y;
  const end = t.shape === "circle" ? undefined : templateEnd(t);
  return {
    ...t,
    at: { x: t.at.x + dx, y: t.at.y + dy },
    ...(end ? { to: { x: end.x + dx, y: end.y + dy } } : {}),
  };
}

function TemplateMark({
  game,
  t,
  onGrab,
}: {
  game: GameState;
  t: Template;
  onGrab: (part: "body" | "end", p: Vec2) => void;
}) {
  const outline = useMemo(() => templateOutline(t), [t]);
  const hits = useMemo(() => templateHits(game, t), [game, t]);
  const shape = useMemo(() => {
    if (t.shape === "line") return null;
    const s = new Shape();
    // The table's y runs along three's -z once the shape is laid flat.
    outline.forEach((p, i) => (i ? s.lineTo(p.x, -p.y) : s.moveTo(p.x, -p.y)));
    return s;
  }, [outline, t.shape]);
  const color = game.players[t.by]?.color ?? "#f59e0b";
  const end = t.shape === "circle" ? null : templateEnd(t);
  const labelAt = t.shape === "circle" ? t.at : t.shape === "flame" ? mid(t.at, end!) : end!;
  const text = hits
    .map((h) => {
      const name = h.unitId ? (game.units[h.unitId]?.name ?? "?") : "models";
      return t.shape === "line"
        ? `${name}: ${h.partial}`
        : `${name}: ${h.full}${h.partial ? ` + ${h.partial} partly` : ""}`;
    })
    .join(" · ");
  const down = (e: { stopPropagation(): void; point: Vector3; button?: number }, part: "body" | "end") => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    onGrab(part, { x: e.point.x, y: e.point.z });
  };
  return (
    <group>
      {shape ? (
        <mesh
          rotation-x={-Math.PI / 2}
          position-y={0.06}
          onPointerDown={(e) => down(e, "body")}
          onClick={(e) => e.stopPropagation()}
        >
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial color={color} transparent opacity={0.28} side={DoubleSide} depthWrite={false} />
        </mesh>
      ) : (
        <mesh
          position={[(t.at.x + end!.x) / 2, 0.06, (t.at.y + end!.y) / 2]}
          rotation-y={Math.atan2(end!.x - t.at.x, end!.y - t.at.y)}
          onPointerDown={(e) => down(e, "body")}
        >
          <boxGeometry args={[0.6, 0.02, Math.hypot(end!.x - t.at.x, end!.y - t.at.y)]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <Line
        points={[...(t.shape === "line" ? outline : [...outline, outline[0]!])].map(
          (p) => [p.x, 0.08, p.y] as [number, number, number],
        )}
        color={color}
        lineWidth={2}
      />
      {end && (
        <mesh position={[end.x, 0.15, end.y]} onPointerDown={(e) => down(e, "end")}>
          <cylinderGeometry args={[0.45, 0.45, 0.2, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
      <Html
        pointerEvents="none"
        zIndexRange={LABEL_Z}
        position={[labelAt.x, 1.2, labelAt.y]}
        center
        className="template-label"
      >
        <strong>{t.label ?? "Template"}</strong>
        {text ? ` · ${text}` : " · no models under it"}
      </Html>
    </group>
  );
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
