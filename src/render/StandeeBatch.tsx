import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
  BatchedMesh,
  BufferAttribute,
  type BufferGeometry,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  SRGBColorSpace,
} from "three";
import type { Vec2 } from "../core";
import { useAssets } from "../assets/store";
import type { ModelAsset } from "../assets/types";
import { type Entry, placeFigure, toGeometry } from "./Miniatures";

/**
 * Every photo standee on the table (#68) in one draw, and one more for their
 * shadows: a BatchedMesh holding each standee's card once, and a texture
 * array holding each one's photos as a layer the card's vertices name. A
 * standee is a few hundred triangles, so a full table of them costs the GPU
 * little; what it would cost is a draw (and a shadow draw) per standee, which
 * phones feel first (perf/budget.md, Photo standees).
 */

/** A standee's card has one level and uvs into its photos: it can join the batch. */
export function batchable(asset: ModelAsset): boolean {
  return asset.look === "photo" && !!asset.texture && !!asset.lods[0]?.uvs && !asset.lods[0].colors;
}

/** Layers past this many drop to half size, so a table of many standees keeps to the texture budget. */
const FULL_LAYERS = 24;
const FULL_SIDE = 512;

const m4 = new Matrix4();

/** Lit like a standee's own material (Miniatures makeLook): mostly the light it was photographed in. */
function photoMaterial(map: DataArrayTexture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: "#5a5a5a",
    roughness: 1,
    metalness: 0,
    emissive: "#ffffff",
    emissiveIntensity: 0.8,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.photoMap = { value: map };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float photoLayer;\nvarying vec2 vPhotoUv;\nvarying float vPhotoLayer;",
      )
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvPhotoUv = uv;\nvPhotoLayer = photoLayer;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform highp sampler2DArray photoMap;\nvarying vec2 vPhotoUv;\nvarying float vPhotoLayer;",
      )
      .replace(
        "#include <map_fragment>",
        "vec4 photo = texture( photoMap, vec3( vPhotoUv, floor( vPhotoLayer + 0.5 ) ) );\ndiffuseColor *= photo;",
      )
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= photo.rgb;");
  };
  material.customProgramCacheKey = () => "photo-standee";
  return material;
}

/** Each standee's photos into its layer, decoded off the frame; resolves once all are in. */
async function fillLayers(texture: DataArrayTexture, assets: ModelAsset[], side: number): Promise<void> {
  const data = texture.image.data as Uint8Array;
  const canvas = new OffscreenCanvas(side, side);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const [layer, asset] of assets.entries()) {
    const { bytes, mime } = asset.texture!;
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      g.clearRect(0, 0, side, side);
      g.drawImage(bitmap, 0, 0, side, side);
      bitmap.close();
      data.set(g.getImageData(0, 0, side, side).data, layer * side * side * 4);
    } catch {
      // A photo this browser can't decode: that standee shows grey.
      data.fill(140, layer * side * side * 4, (layer + 1) * side * side * 4);
    }
  }
  texture.needsUpdate = true;
}

const users = new WeakMap<object, { count: number; timer?: ReturnType<typeof setTimeout> }>();

/**
 * Count a render's use of `thing` and free it a moment after the last use
 * ends, so a remount (React's dev double effects) keeps it rather than
 * drawing with something already freed. Returns the release.
 */
function holdWhileUsed(thing: object, free: () => void): () => void {
  const entry = users.get(thing) ?? { count: 0 };
  users.set(thing, entry);
  entry.count++;
  clearTimeout(entry.timer);
  return () => {
    if (--entry.count > 0) return;
    entry.timer = setTimeout(() => entry.count === 0 && free(), 1000);
  };
}

export function StandeeBatch({
  entries,
  positions,
  heights,
}: {
  entries: Entry[];
  positions: Record<string, Vec2>;
  heights: Record<string, number>;
}) {
  const all = useAssets((s) => s.assets);
  // The distinct standees, in a stable order: the batch is rebuilt only when that set changes.
  const key = [...new Set(entries.map((e) => e.binding.asset))].sort().join("|");
  const assets = useMemo(() => key.split("|").map((id) => all[id]!), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // The texture whose photos are all in: the batch shows once its own are.
  const [loaded, setLoaded] = useState<DataArrayTexture | null>(null);
  const look = useMemo(() => {
    const side = assets.length <= FULL_LAYERS ? FULL_SIDE : FULL_SIDE / 2;
    const texture = new DataArrayTexture(
      new Uint8Array(side * side * 4 * assets.length),
      side,
      side,
      assets.length,
    );
    // glTF uvs: v runs down the photo, as its rows do.
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = 4;
    const geometries: BufferGeometry[] = assets.map((asset, layer) => {
      const g = toGeometry(asset.lods[0]!);
      g.setAttribute(
        "photoLayer",
        new BufferAttribute(new Float32Array(g.attributes.position!.count).fill(layer), 1),
      );
      return g;
    });
    const filled = fillLayers(texture, assets, side);
    return { texture, geometries, filled, material: photoMaterial(texture) };
  }, [assets]);
  useEffect(() => {
    let gone = false;
    void look.filled.then(() => !gone && setLoaded(look.texture));
    const release = holdWhileUsed(look, () => {
      look.texture.dispose();
      look.material.dispose();
      look.geometries.forEach((g) => g.dispose());
    });
    return () => {
      gone = true;
      release();
    };
  }, [look]);

  // Which card each instance wears: a move or a dice roll keeps the batch, a model coming or going rebuilds it.
  const wearing = entries.map((e) => e.binding.asset).join("|");
  const mesh = useMemo(() => {
    const vertices = look.geometries.reduce((n, g) => n + g.attributes.position!.count, 0);
    const batch = new BatchedMesh(Math.max(1, entries.length), vertices, 0, look.material);
    const geometryIds = new Map(assets.map((a, i) => [a.id, batch.addGeometry(look.geometries[i]!)]));
    for (const { binding } of entries) batch.addInstance(geometryIds.get(binding.asset)!);
    batch.castShadow = true;
    batch.receiveShadow = true;
    // The batch's own bounds go stale as models move; each card is culled on its own instead.
    batch.frustumCulled = false;
    batch.raycast = () => {};
    return batch;
  }, [look, wearing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => holdWhileUsed(mesh, () => mesh.dispose()), [mesh]);

  useFrame(() => {
    entries.forEach(({ model, binding }, i) => {
      placeFigure(model, binding, positions, heights, m4);
      mesh.setMatrixAt(i, m4);
    });
  });

  return <primitive object={mesh} visible={loaded === look.texture} />;
}
