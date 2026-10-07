import type { MeshData } from "./types";

/**
 * A lumpy, spiky blob standing on y = 0 with roughly `triangles` triangles:
 * a stand-in for a dense sculpt in tests and benchmarks, since real
 * miniature files can't live in the repo. Height is in `units`
 * (25.4 per inch gives a millimetre file, like a print file).
 */
export function synthMiniature(triangles: number, units = 25.4): MeshData {
  // A UV sphere with `rings` x `segments` quads has ~2 * rings * segments triangles.
  const n = Math.max(4, Math.round(Math.sqrt(triangles / 4)));
  const rings = n;
  const segments = 2 * n;
  const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
  let p = 0;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const bump =
        1 +
        0.12 * Math.sin(phi * 9) * Math.cos(theta * 7) +
        0.05 * Math.sin(phi * 31 + theta * 17) +
        0.02 * Math.sin(phi * 97) * Math.sin(theta * 89);
      // Taller than wide, like an infantry model: about 1.4" by 1".
      positions[p++] = Math.sin(phi) * Math.cos(theta) * 0.5 * bump * units;
      positions[p++] = (1 - Math.cos(phi)) * 0.7 * bump * units;
      positions[p++] = Math.sin(phi) * Math.sin(theta) * 0.5 * bump * units;
    }
  }
  const indices = new Uint32Array(rings * segments * 6);
  let i = 0;
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      indices[i++] = a;
      indices[i++] = a + 1;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = a + 1;
      indices[i++] = b + 1;
    }
  }
  return { positions, indices };
}
