import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Frustum,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Sphere,
  Texture,
  Vector3,
} from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { Model, ModelFigure, Vec2 } from "../core";
import { useAssets } from "../assets/store";
import { poseOf } from "./feel";
import { toLinear } from "../assets/paint";
import { batchable, StandeeBatch } from "./StandeeBatch";
import type { ModelAsset } from "../assets/types";

/** Top of the plastic base the figure stands on (see ModelInstances). */
const BASE_TOP = 0.2;

/**
 * On-screen height in pixels above which a figure gets each level. Below the
 * last threshold it gets the coarsest level.
 */
const LOD_PIXELS = [220, 70];

const CREASE = (40 * Math.PI) / 180;

const material = new MeshStandardMaterial({ color: "#c7ccd4", roughness: 0.75, metalness: 0.05 });
/** Shadows come from the coarsest level only: drawn into the shadow map, invisible on screen. */
export const shadowMaterial = new MeshStandardMaterial({ colorWrite: false, depthWrite: false });

export interface Entry {
  model: Model;
  binding: ModelFigure;
}

/** Figure height in inches for each model that has an uploaded figure. */
export function useFigureHeights(models: Model[]): Record<string, number> {
  const assets = useAssets((s) => s.assets);
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of models) {
      // Until a peer's figure arrives, the model keeps its stand-in.
      const asset = m.figure && assets[m.figure.asset];
      if (asset) out[m.id] = asset.bounds.max[1] * m.figure!.scale;
    }
    return out;
  }, [models, assets]);
}

/**
 * Every model with an uploaded figure, drawn as one instanced mesh per asset
 * and level of detail: draw calls scale with distinct sculpts, not models.
 */
export function Miniatures({
  models,
  positions,
  heights,
}: {
  models: Model[];
  positions: Record<string, Vec2>;
  /** Base heights above the table (standing on terrain floors), by model id. */
  heights: Record<string, number>;
}) {
  const assets = useAssets((s) => s.assets);
  const groups = useMemo(() => {
    const g = new Map<string, Entry[]>();
    for (const model of models) {
      const binding = model.figure;
      if (!binding || !assets[binding.asset]) continue;
      const list = g.get(binding.asset) ?? [];
      list.push({ model, binding });
      g.set(binding.asset, list);
    }
    return g;
  }, [models, assets]);

  // Photo standees (#68) all draw in one batch where the browser can multi-draw: one draw however many.
  const multiDraw = useThree((t) => t.gl.extensions.has("WEBGL_multi_draw"));
  const [batched, apart] = useMemo(() => {
    const photos: Entry[] = [];
    const rest = new Map<string, Entry[]>();
    for (const [id, entries] of groups)
      if (multiDraw && batchable(assets[id]!)) photos.push(...entries);
      else rest.set(id, entries);
    return [photos, rest];
  }, [groups, assets, multiDraw]);

  return (
    <>
      {batched.length > 0 && <StandeeBatch entries={batched} positions={positions} heights={heights} />}
      {[...apart].map(([id, entries]) => (
        <AssetInstances
          key={id}
          asset={assets[id]!}
          entries={entries}
          positions={positions}
          heights={heights}
        />
      ))}
    </>
  );
}

export function toGeometry(mesh: ModelAsset["lods"][number]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  if (mesh.uvs) g.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  if (mesh.colors) {
    // Stored as sRGB bytes; shaders want linear.
    const linear = new Float32Array((mesh.colors.length / 4) * 3);
    for (let v = 0; v < linear.length / 3; v++)
      for (let c = 0; c < 3; c++) linear[v * 3 + c] = SRGB_TO_LINEAR[mesh.colors[v * 4 + c]!]!;
    g.setAttribute("color", new BufferAttribute(linear, 3));
  }
  // Creased normals keep armour plates flat and edges sharp after decimation.
  const creased = toCreasedNormals(g, CREASE);
  g.dispose();
  return creased;
}

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));

interface Look {
  geometries: BufferGeometry[];
  /** Painted assets: their own material (texture and vertex colours). Others share the grey one. */
  material: MeshStandardMaterial;
  painted: boolean;
  dispose(): void;
}

/**
 * Render geometry and material per asset, shared by everything that draws it
 * (figures, and every terrain piece using the same upload) and freed when
 * the last user goes. Creased normals make each level about 3x its indexed
 * size, so building one copy per piece adds up quickly.
 */
const shared = new Map<string, { look: Look; users: number; timer?: ReturnType<typeof setTimeout> }>();

function makeLook(asset: ModelAsset): Look {
  // Levels the pipeline found no fewer triangles for are the same mesh (a standee's are all one): build each once.
  const built = new Map<ModelAsset["lods"][number], BufferGeometry>();
  const geometries = asset.lods.map((m) => built.get(m) ?? built.set(m, toGeometry(m)).get(m)!);
  const top = asset.lods[0];
  const painted = !!(asset.texture || top?.colors);
  if (!painted) return { geometries, material, painted, dispose: () => built.forEach((g) => g.dispose()) };
  // A photo standee (#68) carries the light it was photographed in: mostly its own, a little of the table's.
  const photo = asset.look === "photo";
  const own = new MeshStandardMaterial({
    color: photo ? "#8c8c8c" : "#ffffff",
    roughness: photo ? 1 : 0.75,
    metalness: photo ? 0 : 0.05,
    vertexColors: !!top?.colors,
    ...(photo ? { emissive: "#ffffff", emissiveIntensity: 0.55 } : {}),
  });
  let texture: Texture | null = null;
  let gone = false;
  if (asset.texture) {
    const { bytes, mime } = asset.texture;
    void createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
      .then((bitmap) => {
        if (gone) return bitmap.close();
        texture = new Texture(bitmap);
        // glTF uvs: v runs down the image, as ImageBitmap rows do.
        texture.flipY = false;
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        own.map = texture;
        if (photo) own.emissiveMap = texture;
        own.needsUpdate = true;
      })
      .catch(() => {
        // An image this browser can't decode: the figure keeps its colours.
      });
  }
  return {
    geometries,
    material: own,
    painted,
    dispose() {
      gone = true;
      built.forEach((g) => g.dispose());
      own.dispose();
      if (texture) {
        (texture.image as ImageBitmap).close();
        texture.dispose();
      }
    },
  };
}

export function useAssetLook(asset: ModelAsset): Look {
  const look = useMemo(() => {
    let entry = shared.get(asset.id);
    if (!entry) shared.set(asset.id, (entry = { look: makeLook(asset), users: 0 }));
    return entry.look;
  }, [asset]);
  useEffect(() => {
    const entry = shared.get(asset.id);
    if (!entry) return;
    entry.users++;
    clearTimeout(entry.timer);
    return () => {
      if (--entry.users > 0) return;
      // Freed a moment later, so a remount (React's dev double effects, a figure swapped
      // between units) keeps the loaded texture instead of throwing it away.
      entry.timer = setTimeout(() => {
        if (entry.users > 0) return;
        entry.look.dispose();
        shared.delete(asset.id);
      }, 1000);
    };
  }, [asset]);
  return look;
}

const m4 = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const v = new Vector3();
const s = new Vector3();
const sphere = new Sphere();
const frustum = new Frustum();
const projScreen = new Matrix4();
const tilt = new Quaternion();
const euler = new Euler();

/** Where a figure stands this frame, into `out`: position, facing and its pose (held, landing or settling; feel.ts). Returns its base's height. */
export function placeFigure(
  model: Model,
  binding: ModelFigure,
  positions: Record<string, Vec2>,
  heights: Record<string, number>,
  out: Matrix4,
): number {
  const p = positions[model.id] ?? model.position;
  q.setFromAxisAngle(up, model.facing + binding.yaw);
  const pose = poseOf(model.id);
  if (pose && (pose.tiltX || pose.tiltZ))
    q.premultiply(tilt.setFromEuler(euler.set(pose.tiltX, 0, pose.tiltZ)));
  const z = BASE_TOP + (heights[model.id] ?? model.z ?? 0) + (pose?.lift ?? 0);
  v.set(p.x + (pose?.dx ?? 0), z, p.y + (pose?.dy ?? 0));
  s.setScalar(binding.scale);
  if (pose) s.y *= pose.squash;
  out.compose(v, q, s);
  return z;
}

function AssetInstances({
  asset,
  entries,
  positions,
  heights,
}: {
  asset: ModelAsset;
  entries: Entry[];
  positions: Record<string, Vec2>;
  heights: Record<string, number>;
}) {
  const { geometries, material: look } = useAssetLook(asset);
  const lodRefs = useRef<(InstancedMesh | null)[]>([]);
  const shadowRef = useRef<InstancedMesh | null>(null);
  const capacity = entries.length;
  const height = asset.bounds.max[1];
  const radius = Math.hypot(asset.bounds.max[0], asset.bounds.max[1] / 2, asset.bounds.max[2]);
  // A level sharing its mesh with a finer one draws in that one's instances: one draw, not one per level.
  const drawn = useMemo(() => geometries.map((g) => geometries.indexOf(g)), [geometries]);

  useFrame(({ camera, size }) => {
    const meshes = lodRefs.current;
    const counts = geometries.map(() => 0);
    const shadow = shadowRef.current;
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    // Pixels per inch at unit distance (perspective) or everywhere (orthographic).
    const persp = (camera as PerspectiveCamera).isPerspectiveCamera
      ? size.height / (2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360))
      : 0;
    const zoom = (camera as OrthographicCamera).zoom;

    entries.forEach(({ model, binding }, i) => {
      const p = positions[model.id] ?? model.position;
      const z = placeFigure(model, binding, positions, heights, m4);
      shadow?.setMatrixAt(i, m4);

      sphere.center.set(p.x, z + (height * binding.scale) / 2, p.y);
      sphere.radius = radius * binding.scale;
      if (!frustum.intersectsSphere(sphere)) return;
      const px = persp
        ? (height * binding.scale * persp) / Math.max(0.01, camera.position.distanceTo(sphere.center))
        : height * binding.scale * zoom;
      let lod = LOD_PIXELS.findIndex((t) => px > t);
      if (lod === -1) lod = geometries.length - 1;
      lod = drawn[Math.min(lod, geometries.length - 1)]!;
      const mesh = meshes[lod];
      if (!mesh) return;
      mesh.setMatrixAt(counts[lod]!++, m4);
    });

    meshes.forEach((mesh, lod) => {
      if (!mesh) return;
      mesh.count = counts[lod]!;
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (shadow) {
      shadow.count = entries.length;
      shadow.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {geometries.map((g, lod) =>
        drawn[lod] !== lod ? null : (
          <instancedMesh
            // Capacity is fixed at creation; remount when it changes.
            key={`${lod}:${capacity}`}
            ref={(m) => {
              lodRefs.current[lod] = m;
            }}
            args={[g, look, capacity]}
            frustumCulled={false}
            receiveShadow
            raycast={() => null}
          />
        ),
      )}
      <instancedMesh
        key={`shadow:${capacity}`}
        ref={shadowRef}
        args={[geometries[geometries.length - 1], shadowMaterial, capacity]}
        frustumCulled={false}
        castShadow
        raycast={() => null}
      />
    </>
  );
}
