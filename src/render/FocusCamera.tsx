import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useFocus } from "./focus";

const EASE_S = 0.2;

/** Eases the camera to look at a requested point, keeping its angle and distance (src/render/focus.ts). */
export function FocusCamera() {
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    object: { position: Vector3 };
    update: () => void;
  } | null;
  useFrame((_, dt) => {
    const f = useFocus.getState();
    if (!f || !controls) return;
    const goal = new Vector3(f.x, controls.target.y, f.y);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ease = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) / EASE_S);
    const delta = goal.sub(controls.target).multiplyScalar(ease);
    controls.target.add(delta);
    controls.object.position.add(delta);
    controls.update();
    if (delta.lengthSq() < 1e-5 || performance.now() - f.at > 3000) useFocus.setState(null, true);
  });
  return null;
}
