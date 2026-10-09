import { PerspectiveCamera, Vector3 } from "three";

/**
 * How far back the opening 3D camera stands, as a scale on its tuned position. Tuned for a 60" x 44" table;
 * smaller tables (FSD's 36" x 24") bring the camera in. Upright, the whole table fits on screen, edge to edge
 * (contain, not cover: UX 421); wide, a narrow window backs off until the width fits (UX 327).
 */
export function openingScale(width: number, depth: number, screenW: number, screenH: number): number {
  const k0 = Math.max(width / 60, depth / 44);
  const aspect = screenW / Math.max(1, screenH);
  if (screenW < screenH) return portraitFit(width, depth, aspect, k0);
  // 28.2 is the half-width seen at k = 1.
  const across = 28.2 * k0 * aspect;
  return k0 * Math.max(1, (width * 0.52) / across);
}

/** Where the opening camera stands for a scale, on the player's side (`side` 1 or -1). */
export function openingPosition(k: number, narrow: boolean, side: number): [number, number, number] {
  return narrow ? [0, 62 * k, 30 * k * side] : [0, 52 * k, 44 * k * side];
}

/** How far the opening camera is from the table centre: the director's whole-table distance. */
export function openingDistance(width: number, depth: number, screenW: number, screenH: number): number {
  const narrow = screenW < screenH;
  const [, y, z] = openingPosition(openingScale(width, depth, screenW, screenH), narrow, 1);
  return Math.hypot(y, z);
}

/** How far back the upright camera stands so every corner of the table is on screen, with a margin. */
function portraitFit(width: number, depth: number, aspect: number, k0: number): number {
  const cam = new PerspectiveCamera(45, aspect, 0.1, 1000);
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => new Vector3((x * width) / 2, 0, (z * depth) / 2)),
  );
  const fits = (k: number) => {
    cam.position.set(0, 62 * k, 30 * k);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    return corners.every((c) => {
      const p = c.clone().project(cam);
      return Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.94;
    });
  };
  let k = k0;
  while (!fits(k) && k < k0 * 6) k *= 1.04;
  return k;
}
