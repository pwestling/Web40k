import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import type { ModelAsset } from "../assets/types";
import { toGeometry } from "../render/Miniatures";

const SIDE = 160;
let renderer: WebGLRenderer | null = null;

/** A small picture of a model from the front quarter, as a WebP data URL; null where WebGL isn't available. */
export async function makeThumb(asset: ModelAsset): Promise<string | null> {
  try {
    if (!renderer) {
      const canvas = document.createElement("canvas");
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(SIDE, SIDE, false);
      renderer.outputColorSpace = SRGBColorSpace;
    }
    // The middle level is plenty at this size.
    const mesh = asset.lods[1] ?? asset.lods[0]!;
    const geometry = toGeometry(mesh);
    const material = new MeshStandardMaterial({
      color: asset.texture || mesh.colors ? "#ffffff" : "#9aa3ad",
      roughness: 0.7,
      metalness: 0.05,
      vertexColors: !!mesh.colors,
    });
    let texture: Texture | null = null;
    if (asset.texture && mesh.uvs) {
      const bitmap = await createImageBitmap(
        new Blob([asset.texture.bytes as BlobPart], { type: asset.texture.mime }),
      );
      texture = new Texture(bitmap);
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      material.map = texture;
    }
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    scene.add(new HemisphereLight("#ffffff", "#445066", 1.6));
    const sun = new DirectionalLight("#ffffff", 2.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    const { min, max } = asset.bounds;
    const centre = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radius = new Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]).length() / 2 || 1;
    const camera = new PerspectiveCamera(30, 1, radius / 100, radius * 100);
    const away = new Vector3(0.55, asset.kind === "terrain" ? 0.8 : 0.35, 1).normalize();
    camera.position.copy(centre).addScaledVector(away, (radius / Math.sin((15 * Math.PI) / 180)) * 1.02);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/webp", 0.82);

    geometry.dispose();
    material.dispose();
    if (texture) {
      (texture.image as ImageBitmap).close();
      texture.dispose();
    }
    return url.startsWith("data:image/") ? url : null;
  } catch {
    return null;
  }
}

/** Let go of the thumbnail renderer's WebGL context once the pictures are drawn; the table keeps its own. */
export function releaseThumbs(): void {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
}
