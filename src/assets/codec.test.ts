import { beforeAll, describe, expect, it } from "vitest";
import { decodeAsset, encodeAsset, fromBase64, toBase64 } from "./codec";
import { processMesh, ready } from "./pipeline";
import { synthMiniature } from "./synth";

beforeAll(() => ready);

describe("asset codec", () => {
  it("round-trips a processed asset through base64", () => {
    const asset = processMesh(synthMiniature(30_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    const back = decodeAsset(fromBase64(toBase64(encodeAsset(asset))));
    expect(back.id).toBe("abc");
    expect(back.figure).toEqual(asset.figure);
    expect(back.lods).toHaveLength(asset.lods.length);
    back.lods.forEach((l, i) => {
      expect(l.positions).toEqual(asset.lods[i]!.positions);
      expect(l.indices).toEqual(asset.lods[i]!.indices);
    });
    expect(back.proxy.indices).toEqual(asset.proxy.indices);
  });

  it("is small enough to send: a few hundred KB", () => {
    const asset = processMesh(synthMiniature(500_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    expect(encodeAsset(asset).byteLength).toBeLessThan(400_000);
  });

  it("rejects indices that point past the vertices", () => {
    const asset = processMesh(synthMiniature(2_000), { id: "abc", name: "blob.stl", kind: "miniature" });
    asset.lods[0]!.indices[0] = 1e6;
    expect(() => decodeAsset(encodeAsset(asset))).toThrow();
  });
});
