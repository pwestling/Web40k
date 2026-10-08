/**
 * Browsers' MediaRecorder writes WebM with no duration (it streams, so it
 * doesn't know it yet): players then show no length and can't seek. This puts
 * the duration into the file's Segment Info, the one change needed, since
 * recorders write the Segment with an unknown size and no index that would
 * shift.
 */

const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const DURATION = 0x4489;

/** An EBML variable-length number at `at`: its value and length in bytes. */
function vint(b: Uint8Array, at: number, keepMarker = false): { value: number; length: number } {
  const first = b[at]!;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + b[at + i]!;
  return { value, length };
}

/** The element at `at`: its id, where its data starts, and its size (-1 when unknown). */
function element(b: Uint8Array, at: number) {
  const id = vint(b, at, true);
  const size = vint(b, at + id.length);
  const unknown = size.value === Math.pow(2, 7 * size.length) - 1;
  return { id: id.value, start: at + id.length + size.length, size: unknown ? -1 : size.value };
}

/** A size as an 8-byte EBML number. */
function size8(n: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7; i >= 1; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}

export async function withDuration(blob: Blob, ms: number): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  try {
    // Skip the EBML header to the Segment.
    const header = element(b, 0);
    let at = header.start + header.size;
    const segment = element(b, at);
    if (segment.id !== SEGMENT) return blob;
    at = segment.start;
    while (at < b.length) {
      const el = element(b, at);
      if (el.size < 0) return blob;
      if (el.id === INFO) {
        // Info's children, without any Duration already there.
        const kids: Uint8Array[] = [];
        for (let k = el.start; k < el.start + el.size;) {
          const child = element(b, k);
          const end = child.start + child.size;
          if (child.id !== DURATION) kids.push(b.subarray(k, end));
          k = end;
        }
        const duration = new Uint8Array(11);
        duration.set([0x44, 0x89, 0x88]);
        new DataView(duration.buffer).setFloat64(3, ms);
        const body = [...kids, duration];
        const length = body.reduce((n, p) => n + p.length, 0);
        const info = [new Uint8Array([0x15, 0x49, 0xa9, 0x66]), size8(length), ...body];
        return new Blob([b.subarray(0, at), ...info, b.subarray(el.start + el.size)] as BlobPart[], {
          type: blob.type,
        });
      }
      at = el.start + el.size;
    }
  } catch {
    // Not what we expected: the clip as recorded still plays.
  }
  return blob;
}
