import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Vec2 } from "../core";
import { lanternBell } from "../ui/sound";

/**
 * Lantern objectives (Rift Lanterns, PX item 1): a small iron lantern on the
 * table with a flame that glows in its holder's colour, flickers like a
 * candle and goes pale when contested, a soft pool of light around it with the
 * 3" ring players measure to, and a bell when it changes hands.
 *
 * Built to the perf budget (perf/budget.md, "Lights and glow"): no lights,
 * three instanced draws for every lantern on the table (iron, glow, pool), a
 * few hundred triangles, and one shared time uniform stepped at 30 Hz at most
 * (held still under reduced motion). The materials are made once, so a
 * lantern appearing mid-game compiles nothing.
 */

export interface LanternItem {
  id: string;
  position: Vec2;
  /** The holder's colour, or null when nobody holds it. */
  color: string | null;
  contested: boolean;
  label: string | null;
}

/** More than any mission puts down; instance counts change, never the meshes. */
const MAX = 8;
/** Lamplight when nobody holds it, and the pale light of a contested one. */
const LAMPLIGHT = new Color("#ffc46b");
const PALE = new Color("#f4efe2");
/** Lanterns stand a little taller than a trooper, so they read at table scale. */
const SCALE = 1.35;
const FLAME_Y = 0.65 * SCALE;

/** Base, four cage posts, a roof and a ring handle, as one mesh. */
function ironGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [new CylinderGeometry(0.45, 0.5, 0.2, 12).translate(0, 0.1, 0)];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    parts.push(new BoxGeometry(0.07, 0.9, 0.07).translate(Math.cos(a) * 0.32, 0.65, Math.sin(a) * 0.32));
  }
  parts.push(new ConeGeometry(0.5, 0.35, 4).rotateY(Math.PI / 4).translate(0, 1.27, 0));
  parts.push(new TorusGeometry(0.13, 0.035, 4, 8).translate(0, 1.55, 0));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!.scale(SCALE, SCALE, SCALE);
}

/** The candle flicker, slow and uneven (1–4 Hz layered), the same in both shaders. */
const FLICKER = /* glsl */ `
uniform float uTime;
attribute vec3 aColor;
attribute vec2 aInfo; // phase, contested
varying vec3 vColor;
varying float vLight;
varying vec2 vUv;
float flicker() {
  float t = uTime + aInfo.x;
  return 0.84 + 0.08 * sin(t * 6.3) * sin(t * 1.9 + 0.7) + 0.05 * sin(t * 13.1 + 2.0) * sin(t * 2.3) + 0.03 * sin(t * 24.0 + aInfo.x);
}
`;

const shared = { uTime: { value: 0 } };

function glowMaterial() {
  return new ShaderMaterial({
    uniforms: shared,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `${FLICKER}
      void main() {
        vUv = uv;
        vColor = aColor;
        float f = flicker();
        vLight = f * (aInfo.y > 0.5 ? 0.6 : 1.0);
        // A billboard: the quad turned to face the camera, centred on the flame.
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, ${FLAME_Y.toFixed(2)}, 0.0, 1.0);
        mv.xy += position.xy * (3.6 + 0.3 * f);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vLight;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        // A bright core and a soft, wide falloff (no bloom on phones, so the halo does the work).
        float core = 1.0 - smoothstep(0.0, 0.16, d);
        float halo = pow(max(0.0, 1.0 - d), 2.6);
        vec3 c = mix(vColor, vec3(1.0, 0.97, 0.9), core * 0.75);
        gl_FragColor = vec4(c * (halo * 0.95 + core) * vLight, 1.0);
      }`,
  });
}

function poolMaterial(ring: number) {
  return new ShaderMaterial({
    uniforms: { ...shared, uRing: { value: ring } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `${FLICKER}
      void main() {
        vUv = uv;
        vColor = aColor;
        vLight = flicker() * (aInfo.y > 0.5 ? 0.6 : 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRing;
      varying vec3 vColor;
      varying float vLight;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        if (d > 1.0) discard;
        // The pool fades out across the 3"; the ring at its edge stays steady to measure by.
        float pool = pow(1.0 - d, 1.6) * 0.32 * vLight;
        float edge = smoothstep(1.0 - uRing * 2.0, 1.0 - uRing, d) * (1.0 - smoothstep(1.0 - uRing * 0.3, 1.0, d));
        gl_FragColor = vec4(vColor * (pool + edge * 0.55), 1.0);
      }`,
  });
}

let made: { ironGeo: BufferGeometry; quadGeo: BufferGeometry; poolGeo: BufferGeometry } | null = null;
let materials: {
  iron: MeshStandardMaterial;
  glow: ShaderMaterial;
  pool: (r: number) => ShaderMaterial;
} | null = null;
const pools = new Map<number, ShaderMaterial>();
function parts() {
  made ??= {
    ironGeo: ironGeometry(),
    quadGeo: new PlaneGeometry(1, 1),
    poolGeo: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  materials ??= {
    iron: new MeshStandardMaterial({ color: "#3b3530", metalness: 0.4, roughness: 0.6 }),
    glow: glowMaterial(),
    pool: (r) => {
      let m = pools.get(r);
      if (!m) pools.set(r, (m = poolMaterial(r)));
      return m;
    },
  };
  return { ...made, ...materials };
}

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Every lantern objective on the table, `reach` inches across to the edge of its ring. */
export function Lanterns({
  items,
  reach,
  onDown,
}: {
  items: LanternItem[];
  reach: number;
  onDown?: (id: string) => void;
}) {
  const p = parts();
  // Each draw carries its own instance attributes (three keeps them per geometry, so one geometry each).
  const [geo] = useState(() => {
    const out = {
      glow: p.quadGeo.clone(),
      pool: p.poolGeo.clone(),
      color: new InstancedBufferAttribute(new Float32Array(MAX * 3), 3),
      info: new InstancedBufferAttribute(new Float32Array(MAX * 2), 2),
    };
    for (const g of [out.glow, out.pool]) {
      g.setAttribute("aColor", out.color);
      g.setAttribute("aInfo", out.info);
    }
    return out;
  });
  useEffect(() => {
    return () => {
      geo.glow.dispose();
      geo.pool.dispose();
    };
  }, [geo]);
  const iron = useRef<InstancedMesh>(null);
  const glow = useRef<InstancedMesh>(null);
  const pool = useRef<InstancedMesh>(null);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(
    () => place(items, reach, geo, [iron.current, glow.current, pool.current]),
    [items, reach, geo],
  );

  // A bell when a lantern changes hands (not on first sight).
  const last = useRef<Record<string, string | null>>({});
  useEffect(() => {
    let rang = false;
    for (const it of items) {
      const before = last.current[it.id];
      if (before !== undefined && before !== it.color && !rang) {
        lanternBell();
        rang = true;
      }
      last.current[it.id] = it.color;
    }
  }, [items]);

  // One shared clock for every flicker, stepped at 30 Hz; still under reduced motion.
  const tick = useRef(0);
  useFrame((_, delta) => {
    if (reducedMotion()) return;
    tick.current += delta;
    if (tick.current < 1 / 30) return;
    shared.uTime.value = (shared.uTime.value + tick.current) % 1000;
    tick.current = 0;
  });

  const hovered = hover !== null ? items[hover] : undefined;
  return (
    <group>
      <instancedMesh
        ref={iron}
        args={[p.ironGeo, p.iron, MAX]}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHover(e.instanceId ?? null);
        }}
        onPointerOut={() => setHover(null)}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          if (!onDown || e.instanceId === undefined || !items[e.instanceId]) return;
          e.stopPropagation();
          onDown(items[e.instanceId]!.id);
        }}
      />
      <instancedMesh ref={glow} args={[geo.glow, p.glow, MAX]} raycast={() => null} frustumCulled={false} />
      <instancedMesh
        ref={pool}
        args={[geo.pool, p.pool(Math.round((0.08 / reach) * 1000) / 1000), MAX]}
        raycast={() => null}
        renderOrder={-1}
      />
      {hovered?.label && (
        <Html
          zIndexRange={[9, 0]}
          position={[hovered.position.x, 2, hovered.position.y]}
          center
          className="ruler terrain-label"
        >
          {hovered.label}
        </Html>
      )}
    </group>
  );
}

/** Puts each lantern's instances in place, in its colour and state. */
function place(
  items: LanternItem[],
  reach: number,
  geo: { color: InstancedBufferAttribute; info: InstancedBufferAttribute },
  [iron, glow, pool]: (InstancedMesh | null)[],
) {
  const n = Math.min(items.length, MAX);
  const m = new Matrix4();
  const ring = new Matrix4();
  const c = new Color();
  items.slice(0, n).forEach((it, i) => {
    m.makeTranslation(it.position.x, 0, it.position.y);
    iron?.setMatrixAt(i, m);
    glow?.setMatrixAt(i, m);
    pool?.setMatrixAt(
      i,
      ring.makeScale(reach * 2, 1, reach * 2).setPosition(it.position.x, 0.02, it.position.y),
    );
    c.copy(it.contested ? PALE : it.color ? new Color(it.color) : LAMPLIGHT);
    geo.color.setXYZ(i, c.r, c.g, c.b);
    // A phase from the id, so the lanterns never pulse together.
    let h = 0;
    for (const ch of it.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
    geo.info.setXY(i, h / 37, it.contested ? 1 : 0);
  });
  for (const mesh of [iron, glow, pool]) {
    if (!mesh) continue;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  geo.color.needsUpdate = true;
  geo.info.needsUpdate = true;
}
