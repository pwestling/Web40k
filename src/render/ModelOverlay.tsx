import { useStore } from "../store";
import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { Color } from "three";
import { baseSizeInches, maxWounds, type Model, type Vec2 } from "../core";
import { type ModelDraw } from "./ModelInstances";
import { LABEL_Z } from "./boardLabels";

/** What is drawn on and over a model: selection and range rings, the drag ghost, its hover label and wounds. */

/** A flat ring `radius` inches out from a model's base edge. */
export function Ring({
  model,
  radius,
  color,
  opacity,
}: {
  model: Model;
  radius: number;
  color: string;
  opacity: number;
}) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.max(width, depth) / 2 + radius;
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[model.position.x, (model.z ?? 0) + 0.04, model.position.y]}
      raycast={() => null}
    >
      <ringGeometry args={[r - 0.08, r, 64]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

export function Ghost({
  from,
  fromZ,
  via = [],
  to,
  toZ,
  model,
}: {
  from: Vec2;
  fromZ: number;
  /** Corners of a move in legs (core/path.ts), drawn at the start's height. */
  via?: Vec2[];
  to: Vec2;
  toZ: number;
  model: Model;
}) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.max(width, depth) / 2;
  const line = useMemo(() => {
    const pts = [[from.x, fromZ, from.y], ...via.map((p) => [p.x, fromZ, p.y]), [to.x, toZ, to.y]];
    const out: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      out.push(a[0]!, a[1]! + 0.06, a[2]!, b[0]!, b[1]! + 0.06, b[2]!);
    }
    return new Float32Array(out);
  }, [from, fromZ, via, to, toZ]);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[from.x, fromZ + 0.05, from.y]} raycast={() => null}>
        <ringGeometry args={[r - 0.1, r, 32]} />
        <meshBasicMaterial color="#e5e7eb" transparent opacity={0.5} />
      </mesh>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[line, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#e5e7eb" transparent opacity={0.6} />
      </lineSegments>
      {via.map((p, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[p.x, fromZ + 0.06, p.y]} raycast={() => null}>
          <circleGeometry args={[0.12, 12]} />
          <meshBasicMaterial color="#e5e7eb" transparent opacity={0.8} />
        </mesh>
      ))}
    </>
  );
}

/** Rings and labels for one model, drawn only while something needs showing. */
export function ModelOverlay({
  draw,
  selected,
  incoherent,
  hover,
  unitName,
}: {
  draw: ModelDraw;
  selected: boolean;
  incoherent: boolean;
  hover: boolean;
  unitName?: string;
}) {
  const { model, position, z, height } = draw;
  const { width, depth } = baseSizeInches(model.base);
  const wounds = maxWounds(model);
  const left = wounds - (model.woundsLost ?? 0);
  const plates = useStore((s) => s.plates);
  return (
    <group position={[position.x, z, position.y]} rotation-y={model.facing}>
      {(selected || incoherent) && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03} raycast={() => null}>
          <ringGeometry args={[Math.max(width, depth) / 2 + 0.05, Math.max(width, depth) / 2 + 0.25, 40]} />
          <meshBasicMaterial color={incoherent ? "#ef4444" : "#fde047"} />
        </mesh>
      )}
      {/* Not a second copy of the unit's name plate: only what the plate doesn't say (PX solo 4, 5). */}
      {hover && (!plates || (unitName && unitName !== model.label) || wounds > 1) && (
        <Html zIndexRange={LABEL_Z} position={[0, height + 1.8, 0]} center className="ruler model-hover">
          {unitName && unitName !== model.label ? `${unitName}: ${model.label}` : model.label}
          {wounds > 1 ? ` (${left}/${wounds} W)` : ""}
        </Html>
      )}
      {wounds > 1 && left < wounds && (
        <Html zIndexRange={LABEL_Z} position={[0, height + 0.9, 0]} center className="wounds">
          {`${left}/${wounds}`}
        </Html>
      )}
    </group>
  );
}

const fadedCache = new Map<string, string>();
/** A colour washed towards the table's dark grey. */
export function faded(color: string, on: boolean): string {
  if (!on) return color;
  let out = fadedCache.get(color);
  if (!out) {
    out = `#${new Color(color).lerp(new Color("#3f3f46"), 0.65).getHexString()}`;
    fadedCache.set(color, out);
  }
  return out;
}
