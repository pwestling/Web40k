import { beforeAll, describe, expect, it } from "vitest";
import { decodeAsset, encodeAsset, fromBase64, toBase64 } from "./codec";
import { processMesh, ready } from "./pipeline";
import { synthMiniature } from "./synth";
import { assetBuffers, type ModelAsset } from "./types";

beforeAll(() => ready);

const close = (a: Float32Array, b: Float32Array, tolerance: number) => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  expect(worst).toBeLessThan(tolerance);
};

/** Triangles with each one's smallest index first: the index codec may rotate a triangle (winding kept). */
const tris = (indices: Uint32Array) => {
  const out: string[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const t = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    const k = t.indexOf(Math.min(...t));
    out.push([t[k], t[(k + 1) % 3], t[(k + 2) % 3]].join());
  }
  return out;
};

describe("asset codec", () => {
  it("round-trips a processed asset through base64 (positions to 16 bits)", async () => {
    const asset = processMesh(synthMiniature(30_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    const back = await decodeAsset(fromBase64(toBase64(await encodeAsset(asset))));
    expect(back.id).toBe("abc");
    expect(back.figure).toEqual(asset.figure);
    expect(back.lods).toHaveLength(asset.lods.length);
    back.lods.forEach((l, i) => {
      // 1/65535 of a ~1.4" figure.
      close(l.positions, asset.lods[i]!.positions, 1e-4);
      expect(tris(l.indices)).toEqual(tris(asset.lods[i]!.indices));
      expect(l.uvs).toBeUndefined();
    });
    expect(tris(back.proxy.indices)).toEqual(tris(asset.proxy.indices));
  });

  it("carries paint: uvs, colours and the texture", async () => {
    const asset = processMesh(synthMiniature(30_000, 25.4, true), {
      id: "p",
      name: "p.glb",
      kind: "miniature",
    });
    asset.texture = { bytes: new Uint8Array([1, 2, 3, 4, 5]), mime: "image/webp", width: 512, height: 512 };
    const back = await decodeAsset(await encodeAsset(asset));
    back.lods.forEach((l, i) => {
      close(l.uvs!, asset.lods[i]!.uvs!, 2e-5);
      expect(l.colors).toEqual(asset.lods[i]!.colors);
    });
    expect(back.proxy.uvs).toBeUndefined();
    expect(back.texture).toEqual(asset.texture);
  });

  it("shares levels that were one mesh, so a small model isn't stored once per level", async () => {
    const asset = processMesh(synthMiniature(400), { id: "s", name: "s.stl", kind: "miniature" });
    expect(new Set(asset.lods).size).toBe(1);
    const back = await decodeAsset(await encodeAsset(asset));
    expect(new Set(back.lods).size).toBe(1);
    expect(new Set(assetBuffers(back)).size).toBe(new Set(assetBuffers(asset)).size);
  });

  it("is small enough to send: about a third of the raw meshes", async () => {
    const asset = processMesh(synthMiniature(500_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    const raw = [...asset.lods, asset.proxy].reduce(
      (n, m) => n + m.positions.byteLength + m.indices.byteLength,
      0,
    );
    const sent = (await encodeAsset(asset)).byteLength;
    expect(sent).toBeLessThan(raw / 2.5);
    expect(sent).toBeLessThan(150_000);
  });

  it("still reads the first format, from older replay files", async () => {
    const asset = processMesh(synthMiniature(2_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    const back = await decodeAsset(encodeV1(asset));
    expect(back.lods[0]!.positions).toEqual(asset.lods[0]!.positions);
    expect(back.figure).toEqual(asset.figure);
  });

  it("rejects indices that point past the vertices, and truncated bytes", async () => {
    const asset = processMesh(synthMiniature(2_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    const good = await encodeAsset(asset);
    await expect(decodeAsset(good.subarray(0, good.length - 50))).rejects.toThrow();
    asset.lods[0]!.indices[0] = 1e6;
    await expect(decodeAsset(await encodeAsset(asset))).rejects.toThrow();
  });
});

/** The first format: JSON header, then float32 positions and uint32 indices per mesh. */
function encodeV1(asset: ModelAsset): Uint8Array {
  const { lods, proxy, ...meta } = asset;
  const meshes = [...lods, proxy];
  const json = new TextEncoder().encode(
    JSON.stringify({
      ...meta,
      meshes: meshes.map((m) => ({ vertices: m.positions.length / 3, indices: m.indices.length })),
    }),
  );
  const head = 4 + Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(
    head + meshes.reduce((n, m) => n + m.positions.byteLength + m.indices.byteLength, 0),
  );
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  let o = head;
  for (const m of meshes) {
    out.set(new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength), o);
    o += m.positions.byteLength;
    out.set(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), o);
    o += m.indices.byteLength;
  }
  return out;
}
