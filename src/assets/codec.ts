import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import type { AssetTexture, MeshData, ModelAsset } from "./types";

/** Largest processed asset accepted from a peer. */
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;
/** Most vertices and indices a peer's asset may unpack to, all meshes together. */
const MAX_VERTICES = 2_000_000;
const MAX_INDICES = 6_000_000;
const MIMES: AssetTexture["mime"][] = ["image/webp", "image/jpeg", "image/png"];

/** "OBA2": the meshopt-compressed format. Older files (replays) start with the header length. */
const MAGIC = 0x3241424f;

export const codecReady = Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]).then(() => undefined);

interface MeshHeader {
  vertices: number;
  indices: number;
  uvs: boolean;
  colors: boolean;
  /** Compressed bytes of each stream, in order: positions, indices, uvs, colours. */
  bytes: number[];
}

type Header = Omit<ModelAsset, "lods" | "proxy" | "texture"> & {
  meshes: MeshHeader[];
  /** Positions are 16-bit, quantised to this box. */
  box: { min: [number, number, number]; size: [number, number, number] };
  texture?: Omit<AssetTexture, "bytes"> & { bytes: number };
};

/**
 * A processed asset as bytes, for peers and replay files: a JSON header,
 * then each mesh (levels, then the proxy) as meshopt-compressed streams:
 * positions quantised to 16 bits in the asset's box (1/65535 of its size,
 * under 0.001" for a figure), uvs to 16 bits, colours as they are, indices
 * delta-coded; then the texture's own bytes. About a third of the raw size.
 */
export async function encodeAsset(asset: ModelAsset): Promise<Uint8Array> {
  await codecReady;
  const { lods, proxy, texture, ...meta } = asset;
  const meshes = [...lods, proxy];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i++) {
      const a = i % 3;
      min[a] = Math.min(min[a]!, m.positions[i]!);
      max[a] = Math.max(max[a]!, m.positions[i]!);
    }
  if (!Number.isFinite(min[0])) {
    min.fill(0);
    max.fill(0);
  }
  const size = max.map((x, a) => Math.max(x - min[a]!, 1e-6)) as [number, number, number];

  const streams: Uint8Array[] = [];
  const headers = meshes.map((m): MeshHeader => {
    const vertices = m.positions.length / 3;
    const q = new Uint16Array(vertices * 4);
    for (let v = 0; v < vertices; v++)
      for (let a = 0; a < 3; a++)
        q[v * 4 + a] = Math.round(((m.positions[v * 3 + a]! - min[a]!) / size[a]!) * 65535);
    const parts = [
      MeshoptEncoder.encodeVertexBuffer(new Uint8Array(q.buffer), vertices, 8),
      MeshoptEncoder.encodeIndexBuffer(bytesOf(m.indices), m.indices.length, 4),
    ];
    if (m.uvs) {
      const uv = new Uint16Array(vertices * 2);
      for (let i = 0; i < uv.length; i++) uv[i] = Math.round(Math.min(1, Math.max(0, m.uvs[i]!)) * 65535);
      parts.push(MeshoptEncoder.encodeVertexBuffer(new Uint8Array(uv.buffer), vertices, 4));
    }
    if (m.colors) parts.push(MeshoptEncoder.encodeVertexBuffer(m.colors, vertices, 4));
    streams.push(...parts);
    return {
      vertices,
      indices: m.indices.length,
      uvs: !!m.uvs,
      colors: !!m.colors,
      bytes: parts.map((p) => p.length),
    };
  });
  if (texture) streams.push(texture.bytes);

  const header: Header = {
    ...meta,
    meshes: headers,
    box: { min, size },
    ...(texture ? { texture: { ...texture, bytes: texture.bytes.byteLength } } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = 8 + Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(start + streams.reduce((n, s) => n + s.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.length, true);
  out.set(json, 8);
  let o = start;
  for (const s of streams) {
    out.set(s, o);
    o += s.length;
  }
  return out;
}

/** The inverse of encodeAsset. Throws on anything malformed: the bytes come from another peer or a file. */
export async function decodeAsset(bytes: Uint8Array): Promise<ModelAsset> {
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("Asset too large");
  if (bytes.byteLength < 8) throw new Error("Truncated asset");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) return decodeV1(bytes);
  await codecReady;
  const jsonLength = view.getUint32(4, true);
  if (8 + jsonLength > bytes.byteLength) throw new Error("Truncated asset");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jsonLength))) as Header;
  const { meshes: list, box, texture: tex, ...meta } = header;
  if (!Array.isArray(list) || list.length < 2) throw new Error("Bad asset header");
  if (!box || ![...box.min, ...box.size].every(Number.isFinite)) throw new Error("Bad asset box");
  let totalV = 0;
  let totalI = 0;
  for (const m of list) {
    if (!Number.isInteger(m.vertices) || !Number.isInteger(m.indices) || m.indices % 3 || m.vertices < 0)
      throw new Error("Bad mesh");
    totalV += m.vertices;
    totalI += m.indices;
  }
  if (totalV > MAX_VERTICES || totalI > MAX_INDICES) throw new Error("Asset too large");

  let o = 8 + Math.ceil(jsonLength / 4) * 4;
  const take = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || o + n > bytes.byteLength) throw new Error("Truncated asset");
    const s = bytes.subarray(o, o + n);
    o += n;
    return s;
  };
  const meshes = list.map((m): MeshData => {
    const sizes = m.bytes;
    if (!Array.isArray(sizes) || sizes.length !== 2 + (m.uvs ? 1 : 0) + (m.colors ? 1 : 0))
      throw new Error("Bad mesh");
    const q = new Uint16Array(m.vertices * 4);
    MeshoptDecoder.decodeVertexBuffer(new Uint8Array(q.buffer), m.vertices, 8, take(sizes[0]!));
    const indices = new Uint32Array(m.indices);
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), m.indices, 4, take(sizes[1]!));
    for (const i of indices) if (i >= m.vertices) throw new Error("Index out of range");
    const positions = new Float32Array(m.vertices * 3);
    for (let v = 0; v < m.vertices; v++)
      for (let a = 0; a < 3; a++) positions[v * 3 + a] = box.min[a]! + (q[v * 4 + a]! / 65535) * box.size[a]!;
    const mesh: MeshData = { positions, indices };
    let s = 2;
    if (m.uvs) {
      const uv = new Uint16Array(m.vertices * 2);
      MeshoptDecoder.decodeVertexBuffer(new Uint8Array(uv.buffer), m.vertices, 4, take(sizes[s++]!));
      mesh.uvs = Float32Array.from(uv, (x) => x / 65535);
    }
    if (m.colors) {
      mesh.colors = new Uint8Array(m.vertices * 4);
      MeshoptDecoder.decodeVertexBuffer(mesh.colors, m.vertices, 4, take(sizes[s]!));
    }
    return mesh;
  });
  const asset: ModelAsset = { ...meta, lods: meshes.slice(0, -1), proxy: meshes[meshes.length - 1]! };
  if (tex) {
    if (!MIMES.includes(tex.mime)) throw new Error("Bad texture type");
    if (![tex.width, tex.height].every((n) => Number.isInteger(n) && n > 0 && n <= 4096))
      throw new Error("Bad texture size");
    asset.texture = { mime: tex.mime, width: tex.width, height: tex.height, bytes: take(tex.bytes).slice() };
  }
  return asset;
}

/** The first format (float32 positions, uint32 indices, no paint), still in older replay files. */
function decodeV1(bytes: Uint8Array): ModelAsset {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const jsonLength = view.getUint32(0, true);
  if (4 + jsonLength > copy.byteLength) throw new Error("Truncated asset");
  const header = JSON.parse(new TextDecoder().decode(copy.subarray(4, 4 + jsonLength))) as Omit<
    ModelAsset,
    "lods" | "proxy"
  > & { meshes: { vertices: number; indices: number }[] };
  if (!Array.isArray(header.meshes) || header.meshes.length < 2) throw new Error("Bad asset header");
  let o = 4 + Math.ceil(jsonLength / 4) * 4;
  const meshes: MeshData[] = header.meshes.map(({ vertices, indices }) => {
    if (!Number.isInteger(vertices) || !Number.isInteger(indices) || indices % 3) throw new Error("Bad mesh");
    if (o + vertices * 12 + indices * 4 > copy.byteLength) throw new Error("Truncated asset");
    const positions = new Float32Array(copy.buffer, o, vertices * 3);
    o += vertices * 12;
    const idx = new Uint32Array(copy.buffer, o, indices);
    o += indices * 4;
    for (const i of idx) if (i >= vertices) throw new Error("Index out of range");
    for (const v of positions) if (!Number.isFinite(v)) throw new Error("Bad vertex");
    return { positions, indices: idx };
  });
  const { meshes: _m, ...meta } = header;
  return { ...meta, lods: meshes.slice(0, -1), proxy: meshes[meshes.length - 1]! };
}

const bytesOf = (a: Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

// Kept here for existing importers; the helpers live in base64.ts (no meshoptimizer).
export { fromBase64, toBase64 } from "./base64";
