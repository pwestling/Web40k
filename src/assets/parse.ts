import { MeshoptDecoder } from "meshoptimizer";
import { BufferGeometry, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type { MeshData } from "./types";

export const MODEL_EXTENSIONS = [".glb", ".gltf", ".stl", ".obj", ".ply"];

/**
 * Read an uploaded model file into one triangle soup, y up, in the file's own
 * units. Geometry only: textures and materials are dropped (see perf notes).
 * Uses no DOM, so it runs in a worker.
 */
export async function parseModelFile(name: string, bytes: ArrayBuffer): Promise<MeshData> {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  switch (ext) {
    case ".stl":
      // Print files are z up.
      return zUpToYUp(fromGeometry(new STLLoader().parse(bytes)));
    case ".ply":
      return zUpToYUp(fromGeometry(new PLYLoader().parse(bytes)));
    case ".obj":
      return fromObject(new OBJLoader().parse(new TextDecoder().decode(bytes)));
    case ".glb":
    case ".gltf": {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(withoutTextures(bytes), "");
      return fromObject(gltf.scene);
    }
    default:
      throw new Error(`Unsupported model format "${ext}". Use ${MODEL_EXTENSIONS.join(", ")}.`);
  }
}

function fromGeometry(geometry: BufferGeometry): MeshData {
  const mesh = new Mesh(geometry);
  return fromObject(mesh);
}

/** Merge every mesh under `root` into one, baking in their transforms. */
function fromObject(root: Object3D): MeshData {
  root.updateMatrixWorld(true);
  const parts: { positions: Float32Array; indices: Uint32Array }[] = [];
  let vertexCount = 0;
  let indexCount = 0;
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as BufferGeometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const matrix: Matrix4 = mesh.matrixWorld;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    const index = geometry.getIndex();
    const indices = index
      ? Uint32Array.from(index.array as ArrayLike<number>)
      : Uint32Array.from({ length: position.count - (position.count % 3) }, (_, i) => i);
    // Mirrored transforms flip the winding.
    if (matrix.determinant() < 0)
      for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    parts.push({ positions, indices });
    vertexCount += position.count;
    indexCount += indices.length;
  });
  if (!parts.length) throw new Error("The file has no meshes in it.");
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const part of parts) {
    positions.set(part.positions, vo * 3);
    for (let i = 0; i < part.indices.length; i++) indices[io + i] = part.indices[i]! + vo;
    vo += part.positions.length / 3;
    io += part.indices.length;
  }
  return { positions, indices };
}

function zUpToYUp(mesh: MeshData): MeshData {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1]!;
    p[i + 1] = p[i + 2]!;
    p[i + 2] = -y;
  }
  return mesh;
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/**
 * Strip images from a glTF before parsing. Decoding a sculpt's 4K textures
 * is wasted work when only the geometry is kept, and image decoding is the
 * part of GLTFLoader that needs a DOM on some browsers.
 */
function withoutTextures(bytes: ArrayBuffer): ArrayBuffer | string {
  const view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    return JSON.stringify(stripTextures(json));
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) return bytes;
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as Record<string, unknown>;
  let text = new TextEncoder().encode(JSON.stringify(stripTextures(json)));
  // Chunks are 4-byte aligned, padded with spaces.
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  text = padded;
  const rest = new Uint8Array(bytes, 20 + jsonLength);
  const out = new Uint8Array(20 + text.length + rest.length);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, text.length, true);
  outView.setUint32(16, JSON_CHUNK, true);
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  return out.buffer;
}

function stripTextures(json: Record<string, unknown>): Record<string, unknown> {
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const materials = (json.materials ?? []) as Record<string, unknown>[];
  for (const m of materials) {
    for (const key of Object.keys(m)) if (key.endsWith("Texture")) delete m[key];
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) for (const key of Object.keys(pbr)) if (key.endsWith("Texture")) delete pbr[key];
    // Texture-only extensions would point at the deleted textures.
    delete m.extensions;
  }
  const used = (json.extensionsUsed ?? []) as string[];
  json.extensionsUsed = used.filter((e) => !e.startsWith("KHR_texture") && !e.startsWith("KHR_materials") && e !== "EXT_texture_webp");
  json.extensionsRequired = ((json.extensionsRequired ?? []) as string[]).filter((e) =>
    (json.extensionsUsed as string[]).includes(e),
  );
  return json;
}
