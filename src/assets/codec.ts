import type { MeshData, ModelAsset } from "./types";

/** Largest processed asset accepted from a peer. */
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;

type Header = Omit<ModelAsset, "lods" | "proxy"> & { meshes: { vertices: number; indices: number }[] };

/**
 * A processed asset as bytes, for sending to peers: a JSON header, then
 * each mesh's float32 positions and uint32 indices (LODs first, then the
 * proxy), 4-byte aligned.
 */
export function encodeAsset(asset: ModelAsset): Uint8Array {
  const { lods, proxy, ...meta } = asset;
  const meshes = [...lods, proxy];
  const header: Header = {
    ...meta,
    meshes: meshes.map((m) => ({ vertices: m.positions.length / 3, indices: m.indices.length })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headerBytes = 4 + Math.ceil(json.length / 4) * 4;
  const body = meshes.reduce((n, m) => n + m.positions.byteLength + m.indices.byteLength, 0);
  const out = new Uint8Array(headerBytes + body);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  let o = headerBytes;
  for (const m of meshes) {
    out.set(new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength), o);
    o += m.positions.byteLength;
    out.set(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), o);
    o += m.indices.byteLength;
  }
  return out;
}

/** The inverse of encodeAsset. Throws on anything malformed: the bytes come from another peer. */
export function decodeAsset(bytes: Uint8Array): ModelAsset {
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("Asset too large");
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const jsonLength = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(copy.subarray(4, 4 + jsonLength))) as Header;
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

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
