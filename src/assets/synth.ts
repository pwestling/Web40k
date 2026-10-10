import type { MeshData } from "./types";

/**
 * A lumpy, spiky blob standing on y = 0 with roughly `triangles` triangles:
 * a stand-in for a dense sculpt in tests and benchmarks, since real
 * miniature files can't live in the repo. Height is in `units`
 * (25.4 per inch gives a millimetre file, like a print file).
 */
export function synthMiniature(triangles: number, units = 25.4, painted = false): MeshData {
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
  if (!painted) return { positions, indices };
  // Painted: uvs wrap the sphere (a seam where u goes 1 -> 0, like a real unwrap), and colour bands.
  const uvs = new Float32Array((rings + 1) * (segments + 1) * 2);
  const colors = new Uint8Array((rings + 1) * (segments + 1) * 4);
  for (let r = 0, v = 0; r <= rings; r++)
    for (let s = 0; s <= segments; s++, v++) {
      uvs[v * 2] = s / segments;
      uvs[v * 2 + 1] = r / rings;
      const band = Math.floor((r / rings) * 5) % 2;
      colors.set(band ? [200, 180, 150, 255] : [255, 255, 255, 255], v * 4);
    }
  return { positions, indices, uvs, colors };
}

/** Closed axis-aligned boxes (min corner x, y, z and size w, h, d), y up, in one mesh. */
export function synthBoxes(list: [number, number, number, number, number, number][]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x, y, z, w, h, d] of list) {
    const o = positions.length / 3;
    for (let i = 0; i < 8; i++) positions.push(x + (i & 1 ? w : 0), y + (i & 2 ? h : 0), z + (i & 4 ? d : 0));
    // prettier-ignore
    indices.push(0,2,1, 1,2,3, 4,5,6, 5,7,6, 0,1,4, 1,5,4, 2,6,3, 3,6,7, 0,4,2, 2,4,6, 1,3,5, 3,7,5);
    for (let i = indices.length - 36; i < indices.length; i++) indices[i]! += o;
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * A two-storey ruin in inches, the kind a TTS table is full of: a 10" × 6"
 * rubble-strewn base, an L of 0.4" walls with window holes, and an upper
 * floor at 3" over the back half. `rubble` small chunks lie on the floors.
 */
export function synthRuin(rubble = 120): MeshData {
  const parts: [number, number, number, number, number, number][] = [[0, 0, 0, 10, 0.25, 6]];
  // The back wall (z 5.6 to 6), 7" tall, windows 1.5" square at x 2–3.5 and 6.5–8 on each storey.
  const T = 0.4;
  const wall = (x0: number, x1: number, y0: number, y1: number) =>
    parts.push([x0, y0, 6 - T, x1 - x0, y1 - y0, T]);
  for (const [y0, y1] of [
    [0.25, 1],
    [2.5, 4],
    [5.5, 7],
  ] as const)
    wall(0, 10, y0, y1);
  for (const [y0, y1] of [
    [1, 2.5],
    [4, 5.5],
  ] as const) {
    wall(0, 2, y0, y1);
    wall(3.5, 6.5, y0, y1);
    wall(8, 10, y0, y1);
  }
  // The side wall (x 0 to 0.4), 5" tall, broken off towards the front.
  parts.push([0, 0.25, 0, T, 2, 6 - T], [0, 2.25, 2, T, 2.75, 4 - T]);
  // The upper floor over the back half.
  parts.push([T, 3, 3, 10 - T, 0.25, 3 - T]);
  // Rubble: a fixed scatter, so tests are repeatable.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < rubble; i++) {
    const s = 0.1 + rnd() * 0.25;
    const upper = i % 3 === 0;
    const x = 0.5 + rnd() * 9;
    const z = upper ? 3.1 + rnd() * 2.3 : 0.2 + rnd() * 5.2;
    parts.push([x, upper ? 3.25 : 0.25, z, s, s * 0.7, s]);
  }
  return synthBoxes(parts);
}
