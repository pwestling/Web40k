import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import { baseSizeInches, type Model, type Vec2 } from "../core";

/** One model as drawn: where it stands and how it looks. */
export interface ModelDraw {
  model: Model;
  position: Vec2;
  z: number;
  color: string;
  /** Stand-in height in inches (the figure's height when dressed). */
  height: number;
  /** Wearing an uploaded figure: the stand-in stays only as an invisible pick target. */
  dressed: boolean;
  targetable: boolean;
}

interface Handlers {
  onPointerDown(e: ThreeEvent<PointerEvent>): void;
  onClick(e: ThreeEvent<MouseEvent>): void;
  onPointerOver(e: ThreeEvent<PointerEvent>): void;
  onPointerOut(): void;
}

interface Props {
  draws: ModelDraw[];
  hovered: string | null;
  onDown(model: Model, shift: boolean): void;
  onHover(model: Model | null): void;
}

const BASE_HEIGHT = 0.2;
const TARGET = new Color("#facc15");

// Unit shapes, scaled per instance. Bases sit on y = 0 to 0.2.
const roundBase = new CylinderGeometry(1, 1, BASE_HEIGHT, 32).translate(0, BASE_HEIGHT / 2, 0);
const rectBase = new BoxGeometry(1, BASE_HEIGHT, 1).translate(0, BASE_HEIGHT / 2, 0);
const nub = new BoxGeometry(0.15, 0.1, 0.2);
const baseMaterial = new MeshStandardMaterial({ color: "#ffffff" });
const nubMaterial = new MeshStandardMaterial({ color: "#ffffff" });
const standInMaterial = {
  rect: new MeshStandardMaterial({ color: "#94a3b8" }),
  round: new MeshStandardMaterial({ color: "#cbd5e1" }),
};
const pickMaterial = new MeshStandardMaterial({ visible: false });

/** Stand-ins can't be scaled from one shape (capsule ends would stretch), so they're grouped by size. */
function standInKey(d: ModelDraw): string {
  const { width, depth } = baseSizeInches(d.model.base);
  const rect = d.model.base.shape === "rect";
  return `${rect ? "rect" : "round"}:${width.toFixed(2)}:${depth.toFixed(2)}:${d.height.toFixed(2)}:${d.dressed ? 1 : 0}`;
}

const standIns = new Map<string, BufferGeometry>();
function standInGeometry(d: ModelDraw): BufferGeometry {
  const key = standInKey(d);
  let g = standIns.get(key);
  if (!g) {
    const { width, depth } = baseSizeInches(d.model.base);
    const r = Math.min(width, depth) / 2;
    const h = d.height;
    g =
      d.model.base.shape === "rect"
        ? new BoxGeometry(width * 0.8, h, depth * 0.85)
        : new CapsuleGeometry(r * 0.45, Math.max(0.1, h - r * 0.9), 4, 12);
    g.translate(0, BASE_HEIGHT + h / 2, 0);
    standIns.set(key, g);
  }
  return g;
}

const m4 = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const p = new Vector3();
const s = new Vector3();
const offset = new Vector3();
const color = new Color();

/**
 * Every model's base, facing nub and stand-in as instanced meshes: a handful
 * of draw calls for the whole table instead of three or four per model.
 * Picking goes through instanceId, mapped back to the model.
 */
export function ModelInstances({ draws, hovered, onDown, onHover }: Props) {
  const round = useMemo(() => draws.filter((d) => d.model.base.shape !== "rect"), [draws]);
  const rect = useMemo(() => draws.filter((d) => d.model.base.shape === "rect"), [draws]);
  const kinds = useMemo(() => {
    const k = new Map<string, ModelDraw[]>();
    for (const d of draws) {
      const key = standInKey(d);
      k.set(key, [...(k.get(key) ?? []), d]);
    }
    return [...k];
  }, [draws]);

  const handlers = (list: ModelDraw[]): Handlers => ({
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      const d = e.instanceId === undefined ? undefined : list[e.instanceId];
      if (!d || e.button !== 0) return;
      e.stopPropagation();
      onDown(d.model, e.shiftKey);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      const d = e.instanceId === undefined ? undefined : list[e.instanceId];
      if (!d) return;
      e.stopPropagation();
      onHover(d.model);
    },
    onPointerOut: () => onHover(null),
  });

  return (
    <>
      <Instances
        geometry={roundBase}
        material={baseMaterial}
        list={round}
        castShadow
        hovered={hovered}
        handlers={handlers(round)}
        place={(d) => {
          const { width, depth } = baseSizeInches(d.model.base);
          return s.set(width / 2, 1, depth / 2);
        }}
      />
      <Instances
        geometry={rectBase}
        material={baseMaterial}
        list={rect}
        castShadow
        hovered={hovered}
        handlers={handlers(rect)}
        place={(d) => {
          const { width, depth } = baseSizeInches(d.model.base);
          return s.set(width * 0.98, 1, depth * 0.98);
        }}
      />
      <Instances
        geometry={nub}
        material={nubMaterial}
        list={draws}
        place={(d) => {
          // The nub sits on the front edge of the base.
          offset.set(0, 0.25, baseSizeInches(d.model.base).depth / 2 - 0.1).applyQuaternion(q);
          p.add(offset);
          return s.set(1, 1, 1);
        }}
      />
      {kinds.map(([key, list]) => (
        <Instances
          key={key}
          geometry={standInGeometry(list[0]!)}
          material={
            list[0]!.dressed
              ? pickMaterial
              : standInMaterial[list[0]!.model.base.shape === "rect" ? "rect" : "round"]
          }
          list={list}
          castShadow={!list[0]!.dressed}
          handlers={handlers(list)}
          place={() => s.set(1, 1, 1)}
        />
      ))}
    </>
  );
}

function Instances({
  geometry,
  material,
  list,
  castShadow = false,
  hovered,
  handlers,
  place,
}: {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  list: ModelDraw[];
  castShadow?: boolean;
  /** Bases only: tint the hovered target. Colors come from the owner. */
  hovered?: string | null;
  /** Pick handlers; without them the mesh ignores the pointer. */
  handlers?: Handlers;
  /** Sets the scale `s` for one model (and may nudge the position `p`, already rotated by `q`). */
  place: (d: ModelDraw) => Vector3;
}) {
  const ref = useRef<InstancedMesh>(null);
  // Capacity in powers of two, so the mesh isn't rebuilt every time a model dies or arrives.
  const cap = 2 ** Math.ceil(Math.log2(Math.max(16, list.length)));

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    list.forEach((d, i) => {
      q.setFromAxisAngle(up, d.model.facing);
      p.set(d.position.x, d.z, d.position.y);
      const scale = place(d);
      m4.compose(p, q, scale);
      mesh.setMatrixAt(i, m4);
      if (hovered !== undefined)
        mesh.setColorAt(i, d.targetable && hovered === d.model.id ? TARGET : color.set(d.color));
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  useEffect(() => () => ref.current?.dispose(), []);

  return (
    <instancedMesh
      key={cap}
      ref={ref}
      args={[geometry, material, cap]}
      castShadow={castShadow}
      receiveShadow
      userData={{ modelIds: list.map((d) => d.model.id) }}
      {...(handlers ?? { raycast: () => null })}
    />
  );
}
