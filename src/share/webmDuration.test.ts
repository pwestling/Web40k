import { describe, expect, it } from "vitest";
import { withDuration } from "./webmDuration";

/** A WebM shaped like a recorder's: EBML header, a Segment of unknown size, Info with no Duration, a Cluster. */
function recorderWebm(): Uint8Array {
  const header = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77];
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  // Info: TimecodeScale 1,000,000.
  const info = [0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x83, 0xe7, 0x81, 0x00];
  return new Uint8Array([...header, ...segment, ...info, ...cluster]);
}

describe("clip duration (#46)", () => {
  it("puts the duration into a recorder's WebM, keeping the rest", async () => {
    const before = recorderWebm();
    const out = new Uint8Array(
      await (await withDuration(new Blob([before as BlobPart]), 12_345)).arrayBuffer(),
    );
    const at = out.findIndex((_, i) => out[i] === 0x44 && out[i + 1] === 0x89 && out[i + 2] === 0x88);
    expect(at).toBeGreaterThan(0);
    expect(new DataView(out.buffer, at + 3, 8).getFloat64(0)).toBe(12_345);
    // The cluster still follows, untouched.
    expect([...out.slice(-8)]).toEqual([0x1f, 0x43, 0xb6, 0x75, 0x83, 0xe7, 0x81, 0x00]);
    // Info's new size covers TimecodeScale and Duration.
    const infoAt = out.findIndex((_, i) => out[i] === 0x15 && out[i + 1] === 0x49 && out[i + 2] === 0xa9);
    expect(out[infoAt + 4]).toBe(0x01);
    expect(out[infoAt + 11]).toBe(7 + 11);
  });

  it("leaves a file it doesn't understand alone", async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await withDuration(junk, 5)).toBe(junk);
  });
});
