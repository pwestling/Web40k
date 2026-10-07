import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Mesh, MeshBasicMaterial } from "three";
import type { GameState } from "../core";
import { LIFETIME, useTalk, type Said } from "../talk/talk";

const LABEL_Z: [number, number] = [9, 0];
/** Drawn just above the table and over terrain, so a mark is never hidden. */
const Y = 0.08;
const FADE_MS = 8000;

type Vec2 = { x: number; y: number };

/** Pings, arrows and areas from table talk, in each sender's colour. */
export function TalkLayer({ game, preview }: { game: GameState; preview: Said | null }) {
  const items = useTalk((s) => s.items);
  // Drawings fade over their last seconds: a coarse clock is enough for that.
  const [now, setNow] = useState(() => Date.now());
  const drawings = items.some((i) => i.kind === "arrow" || i.kind === "area");
  useEffect(() => {
    if (!drawings) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [drawings]);
  const opacity = (i: Said) => Math.max(0, Math.min(1, (LIFETIME[i.kind] - (now - i.sentAt)) / FADE_MS));
  return (
    <group renderOrder={10}>
      {items.map((i) =>
        i.kind === "ping" ? (
          <Ping key={`${i.by}:${i.id}`} item={i} at={pingAt(game, i)} />
        ) : i.kind === "arrow" ? (
          <Arrow key={`${i.by}:${i.id}`} from={i.from} to={i.to} color={i.color} opacity={opacity(i)} />
        ) : i.kind === "area" ? (
          <Area key={`${i.by}:${i.id}`} at={i.at} radius={i.radius} color={i.color} opacity={opacity(i)} />
        ) : null,
      )}
      {preview?.kind === "arrow" && (
        <Arrow from={preview.from} to={preview.to} color={preview.color} opacity={0.8} />
      )}
      {preview?.kind === "area" && (
        <Area at={preview.at} radius={preview.radius} color={preview.color} opacity={0.8} />
      )}
    </group>
  );
}

/** A unit ping follows the unit's middle; a spot ping stays put. */
function pingAt(game: GameState, i: Extract<Said, { kind: "ping" }>): Vec2 {
  const unit = i.unitId ? game.units[i.unitId] : undefined;
  const ms = unit?.modelIds.map((id) => game.models[id]).filter((m) => m && !m.destroyed) ?? [];
  if (!ms.length) return i.at;
  return {
    x: ms.reduce((t, m) => t + m!.position.x, 0) / ms.length,
    y: ms.reduce((t, m) => t + m!.position.y, 0) / ms.length,
  };
}

/** Rings that pulse out from the spot, with the sender's name. */
function Ping({ item, at }: { item: Said; at: Vec2 }) {
  const first = useRef<Mesh>(null);
  const second = useRef<Mesh>(null);
  useFrame(() => {
    const age = Date.now() - item.sentAt;
    [first.current, second.current].forEach((mesh, k) => {
      if (!mesh) return;
      const t = (((age / 1100 + k * 0.5) % 1) + 1) % 1;
      mesh.scale.setScalar(0.6 + t * 4);
      (mesh.material as MeshBasicMaterial).opacity = (1 - t) * Math.min(1, (LIFETIME.ping - age) / 800);
    });
  });
  return (
    <group position={[at.x, Y, at.y]}>
      <mesh ref={first} rotation-x={-Math.PI / 2} renderOrder={10}>
        <ringGeometry args={[0.8, 1, 48]} />
        <meshBasicMaterial color={item.color} transparent depthTest={false} />
      </mesh>
      <mesh ref={second} rotation-x={-Math.PI / 2} renderOrder={10}>
        <ringGeometry args={[0.8, 1, 48]} />
        <meshBasicMaterial color={item.color} transparent depthTest={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={10}>
        <circleGeometry args={[0.35, 24]} />
        <meshBasicMaterial color={item.color} transparent opacity={0.9} depthTest={false} />
      </mesh>
      <Html zIndexRange={LABEL_Z} position={[0, 2, 0]} center className="talk-label">
        <span style={{ borderColor: item.color }}>{item.name}</span>
      </Html>
    </group>
  );
}

function Arrow({ from, to, color, opacity }: { from: Vec2; to: Vec2; color: string; opacity: number }) {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 0.2) return null;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const head = Math.min(2, len / 3);
  const wing = (s: number): [number, number, number] => [
    to.x - ux * head + -uy * head * 0.6 * s,
    Y,
    to.y - uy * head + ux * head * 0.6 * s,
  ];
  const common = { color, lineWidth: 5, transparent: true, opacity, depthTest: false, renderOrder: 10 };
  return (
    <>
      <Line
        points={[
          [from.x, Y, from.y],
          [to.x, Y, to.y],
        ]}
        {...common}
      />
      <Line points={[wing(1), [to.x, Y, to.y], wing(-1)]} {...common} />
    </>
  );
}

function Area({ at, radius, color, opacity }: { at: Vec2; radius: number; color: string; opacity: number }) {
  if (radius < 0.2) return null;
  const points = Array.from({ length: 65 }, (_, k): [number, number, number] => {
    const a = (k / 64) * Math.PI * 2;
    return [at.x + Math.cos(a) * radius, Y, at.y + Math.sin(a) * radius];
  });
  return (
    <>
      <mesh position={[at.x, Y, at.y]} rotation-x={-Math.PI / 2} renderOrder={10}>
        <circleGeometry args={[radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.15 * opacity} depthTest={false} />
      </mesh>
      <Line
        points={points}
        color={color}
        lineWidth={3}
        transparent
        opacity={opacity}
        depthTest={false}
        renderOrder={10}
      />
    </>
  );
}
