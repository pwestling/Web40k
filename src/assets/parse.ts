import { MeshoptDecoder } from "meshoptimizer";
import { BufferGeometry, Matrix4, Mesh, Vector3, type Material, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { bakePaint, type Paint, type PaintMaterial, type PaintPart } from "./paint";
import type { MeshData } from "./types";

/** A parsed upload: one merged mesh, with its paint baked to uvs, colours and an atlas. */
export interface RawModel extends MeshData {
  atlas?: OffscreenCanvas;
  sourceTexture?: [number, number];
}

import { MODEL_EXTENSIONS } from "./types";

/**
 * Read an uploaded model file into one triangle soup, y up, in the file's own
 * units. glTF base colour textures and factors, and glTF or PLY vertex
 * colours, are baked into an atlas of `atlasSide` pixels (paint.ts); other
 * material properties are dropped. Uses no DOM, so it runs in a worker.
 */
export async function parseModelFile(name: string, bytes: ArrayBuffer, atlasSide = 512): Promise<RawModel> {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  switch (ext) {
    case ".stl":
      // Print files are z up.
      return zUpToYUp(merge(partsOf(new Mesh(new STLLoader().parse(bytes)))));
    case ".ply": {
      const parts = partsOf(new Mesh(new PLYLoader().parse(bytes)));
      return zUpToYUp(merge(parts, bakePaint(parts, [], atlasSide)));
    }
    case ".obj":
      return merge(partsOf(new OBJLoader().parse(new TextDecoder().decode(bytes))));
    case ".glb":
    case ".gltf": {
      const { json, buffer } = readGltf(bytes);
      const materials = await gltfMaterials(json, buffer);
      // Images are read here, not by GLTFLoader: its image path needs a DOM on some browsers.
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(withoutTextures(bytes), "");
      const index = (m: Material) => gltf.parser.associations.get(m)?.materials;
      const parts = partsOf(gltf.scene, index);
      return merge(parts, bakePaint(parts, materials, atlasSide));
    }
    default:
      throw new Error(`Unsupported model format "${ext}". Use ${MODEL_EXTENSIONS.join(", ")}.`);
  }
}

type Part = PaintPart & { positions: Float32Array; indices: Uint32Array };

/** Every mesh under `root`, transforms baked in, with its uvs, colours and glTF material. */
function partsOf(root: Object3D, materialIndex?: (m: Material) => number | undefined): Part[] {
  root.updateMatrixWorld(true);
  const parts: Part[] = [];
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
      for (let i = 0; i < indices.length; i += 3)
        [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    const part: Part = { positions, indices, vertices: position.count };
    const uv = geometry.getAttribute("uv");
    if (uv) {
      part.uvs = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) {
        part.uvs[i * 2] = uv.getX(i);
        part.uvs[i * 2 + 1] = uv.getY(i);
      }
    }
    const color = geometry.getAttribute("color");
    if (color) {
      part.colors = new Float32Array(color.count * 4);
      for (let i = 0; i < color.count; i++) {
        part.colors[i * 4] = color.getX(i);
        part.colors[i * 4 + 1] = color.getY(i);
        part.colors[i * 4 + 2] = color.getZ(i);
        part.colors[i * 4 + 3] = color.itemSize > 3 ? color.getW(i) : 1;
      }
    }
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (material && materialIndex) part.material = materialIndex(material);
    parts.push(part);
  });
  if (!parts.length) throw new Error("The file has no meshes in it.");
  return parts;
}

/** One mesh from the parts, with their paint. */
function merge(parts: Part[], paint: Paint = {}): RawModel {
  const vertexCount = parts.reduce((n, p) => n + p.vertices, 0);
  const indexCount = parts.reduce((n, p) => n + p.indices.length, 0);
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const part of parts) {
    positions.set(part.positions, vo * 3);
    for (let i = 0; i < part.indices.length; i++) indices[io + i] = part.indices[i]! + vo;
    vo += part.vertices;
    io += part.indices.length;
  }
  const out: RawModel = { positions, indices };
  if (paint.uvs) out.uvs = paint.uvs;
  if (paint.colors) out.colors = paint.colors;
  if (paint.atlas) out.atlas = paint.atlas;
  if (paint.source) out.sourceTexture = paint.source;
  return out;
}

function zUpToYUp<T extends MeshData>(mesh: T): T {
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
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as Record<
    string,
    unknown
  >;
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
  json.extensionsUsed = used.filter(
    (e) => !e.startsWith("KHR_texture") && !e.startsWith("KHR_materials") && e !== "EXT_texture_webp",
  );
  json.extensionsRequired = ((json.extensionsRequired ?? []) as string[]).filter((e) =>
    (json.extensionsUsed as string[]).includes(e),
  );
  return json;
}

type Json = Record<string, unknown>;

/** A glTF's JSON and a reader for its buffers (the GLB binary chunk, or data: URIs). */
function readGltf(bytes: ArrayBuffer): { json: Json; buffer: (i: number) => Uint8Array | undefined } {
  const view = new DataView(bytes);
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as Json;
    const binAt = 20 + jsonLength;
    const bin =
      binAt + 8 <= bytes.byteLength && view.getUint32(binAt + 4, true) === BIN_CHUNK
        ? new Uint8Array(
            bytes,
            binAt + 8,
            Math.min(view.getUint32(binAt, true), bytes.byteLength - binAt - 8),
          )
        : undefined;
    const buffers = (json.buffers ?? []) as { uri?: string }[];
    return { json, buffer: (i) => (i === 0 && !buffers[0]?.uri ? bin : dataUri(buffers[i]?.uri)) };
  }
  const json = JSON.parse(new TextDecoder().decode(bytes)) as Json;
  const buffers = (json.buffers ?? []) as { uri?: string }[];
  return { json, buffer: (i) => dataUri(buffers[i]?.uri) };
}

const BIN_CHUNK = 0x004e4942;

function dataUri(uri: string | undefined): Uint8Array | undefined {
  const m = uri?.match(/^data:[^,]*;base64,(.*)$/);
  if (!m) return undefined;
  const s = atob(m[1]!);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Each glTF material's base colour factor and decoded base colour image. */
async function gltfMaterials(
  json: Json,
  buffer: (i: number) => Uint8Array | undefined,
): Promise<PaintMaterial[]> {
  const images = (json.images ?? []) as { uri?: string; bufferView?: number; mimeType?: string }[];
  const textures = (json.textures ?? []) as {
    source?: number;
    extensions?: Record<string, { source?: number }>;
  }[];
  const views = (json.bufferViews ?? []) as { buffer: number; byteOffset?: number; byteLength: number }[];
  const decoded = new Map<number, Promise<ImageBitmap | undefined>>();
  const decode = (i: number): Promise<ImageBitmap | undefined> => {
    if (!decoded.has(i))
      decoded.set(
        i,
        (async () => {
          if (typeof createImageBitmap === "undefined") return undefined;
          const image = images[i];
          if (!image) return undefined;
          let data: Uint8Array | undefined;
          if (image.bufferView !== undefined) {
            const bv = views[image.bufferView];
            const buf = bv && buffer(bv.buffer);
            if (buf) data = buf.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
          } else data = dataUri(image.uri);
          if (!data) return undefined;
          try {
            return await createImageBitmap(new Blob([data as BlobPart], { type: image.mimeType ?? "" }));
          } catch {
            // A format this browser can't decode (KTX2, say): the part keeps its colour.
            return undefined;
          }
        })(),
      );
    return decoded.get(i)!;
  };
  const materials = (json.materials ?? []) as {
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number; texCoord?: number };
    };
  }[];
  return Promise.all(
    materials.map(async (m) => {
      const pbr = m.pbrMetallicRoughness ?? {};
      const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
      const out: PaintMaterial = { factor: [f[0] ?? 1, f[1] ?? 1, f[2] ?? 1, f[3] ?? 1] };
      const t = pbr.baseColorTexture;
      const texture = t && !t.texCoord ? textures[t.index] : undefined;
      const source =
        texture?.source ??
        texture?.extensions?.EXT_texture_webp?.source ??
        texture?.extensions?.EXT_texture_avif?.source;
      if (source !== undefined) out.image = await decode(source);
      return out;
    }),
  );
}
