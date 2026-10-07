import { useFrame } from "@react-three/fiber";
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
  Sphere,
  Vector3,
} from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { Model, ModelFigure, Vec2 } from "../core";
import { useAssets } from "../assets/store";
import { poseOf } from "./feel";
import type { ModelAsset } from "../assets/types";

/** Top of the plastic base the figure stands on (see ModelInstances). */
export const BASE_TOP = 0.2;

/**
 * On-screen height in pixels above which a figure gets each level. Below the
 * last threshold it gets the coarsest level.
 */
export const LOD_PIXELS = [220, 70];

const CREASE = (40 * Math.PI) / 180;

const material = new MeshStandardMaterial({ color: "#c7ccd4", roughness: 0.75, metalness: 0.05 });
/** Shadows come from the coarsest level only: drawn into the shadow map, invisible on screen. */
export const shadowMaterial = new MeshStandardMaterial({ colorWrite: false, depthWrite: false });

interface Entry {
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

  return (
    <>
      {[...groups].map(([id, entries]) => (
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
  // Creased normals keep armour plates flat and edges sharp after decimation.
  const creased = toCreasedNormals(g, CREASE);
  g.dispose();
  return creased;
}

/**
 * Render geometry per asset, shared by everything that draws it (figures,
 * and every terrain piece using the same upload) and freed when the last
 * user goes. Creased normals make each level about 3x its indexed size, so
 * building one copy per piece adds up quickly.
 */
const shared = new Map<string, { geometries: BufferGeometry[]; users: number }>();

export function useAssetGeometries(asset: ModelAsset): BufferGeometry[] {
  const geometries = useMemo(() => {
    let entry = shared.get(asset.id);
    if (!entry) shared.set(asset.id, (entry = { geometries: asset.lods.map(toGeometry), users: 0 }));
    return entry.geometries;
  }, [asset]);
  useEffect(() => {
    const entry = shared.get(asset.id);
    if (!entry) return;
    entry.users++;
    return () => {
      if (--entry.users > 0) return;
      entry.geometries.forEach((g) => g.dispose());
      shared.delete(asset.id);
    };
  }, [asset]);
  return geometries;
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
  const geometries = useAssetGeometries(asset);
  const lodRefs = useRef<(InstancedMesh | null)[]>([]);
  const shadowRef = useRef<InstancedMesh | null>(null);
  const capacity = entries.length;
  const height = asset.bounds.max[1];
  const radius = Math.hypot(asset.bounds.max[0], asset.bounds.max[1] / 2, asset.bounds.max[2]);

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
      q.setFromAxisAngle(up, model.facing + binding.yaw);
      // Held, landing or settling (feel.ts).
      const pose = poseOf(model.id);
      if (pose && (pose.tiltX || pose.tiltZ))
        q.premultiply(tilt.setFromEuler(euler.set(pose.tiltX, 0, pose.tiltZ)));
      const z = BASE_TOP + (heights[model.id] ?? model.z ?? 0) + (pose?.lift ?? 0);
      v.set(p.x, z, p.y);
      s.setScalar(binding.scale);
      if (pose) s.y *= pose.squash;
      m4.compose(v, q, s);
      shadow?.setMatrixAt(i, m4);

      sphere.center.set(p.x, z + (height * binding.scale) / 2, p.y);
      sphere.radius = radius * binding.scale;
      if (!frustum.intersectsSphere(sphere)) return;
      const px = persp
        ? (height * binding.scale * persp) / Math.max(0.01, camera.position.distanceTo(sphere.center))
        : height * binding.scale * zoom;
      let lod = LOD_PIXELS.findIndex((t) => px > t);
      if (lod === -1) lod = geometries.length - 1;
      lod = Math.min(lod, geometries.length - 1);
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
      {geometries.map((g, lod) => (
        <instancedMesh
          // Capacity is fixed at creation; remount when it changes.
          key={`${lod}:${capacity}`}
          ref={(m) => {
            lodRefs.current[lod] = m;
          }}
          args={[g, material, capacity]}
          frustumCulled={false}
          receiveShadow
          raycast={() => null}
        />
      ))}
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
