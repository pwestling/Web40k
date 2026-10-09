import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useGame } from "../ui/hooks";
import { onScreen, shot } from "./focus";

/**
 * While a clip records, where the table (and anything standing on it, up to 6") is on the canvas, in its
 * CSS pixels: a tall clip crops to it so the table fills the frame's width (UX 367).
 */
export function TableOnScreen() {
  const { camera, size, controls } = useThree();
  const { width, depth } = useGame().table;
  const v = new Vector3();
  useFrame(() => {
    // Development: where a point on the table is on screen, for browser tests of touch play (#60).
    if (import.meta.env.DEV) (window as { openBattleControls?: unknown }).openBattleControls = controls;
    if (import.meta.env.DEV)
      (window as { openBattleScreenOf?: unknown }).openBattleScreenOf = (x: number, y: number, z = 0) => {
        const p = new Vector3(x, z, y).project(camera);
        const r = document.querySelector("canvas")!.getBoundingClientRect();
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      };
    if (!shot.capturing) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const x of [-width / 2, width / 2])
      for (const z of [-depth / 2, depth / 2])
        for (const up of [0, 6]) {
          v.set(x, up, z).project(camera);
          const sx = ((v.x + 1) / 2) * size.width;
          const sy = ((1 - v.y) / 2) * size.height;
          x0 = Math.min(x0, sx);
          x1 = Math.max(x1, sx);
          y0 = Math.min(y0, sy);
          y1 = Math.max(y1, sy);
        }
    onScreen.table = {
      x0: Math.max(0, x0),
      y0: Math.max(0, y0),
      x1: Math.min(size.width, x1),
      y1: Math.min(size.height, y1),
    };
  });
  return null;
}
