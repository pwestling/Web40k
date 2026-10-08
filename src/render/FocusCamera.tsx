import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { cameraForward, shot, useFocus } from "./focus";

const EASE_S = 0.2;

/** Eases the camera to look at a requested point, keeping its angle and distance (src/render/focus.ts). */
export function FocusCamera() {
  const saved = useRef<{ target: Vector3; position: Vector3 } | null>(null);
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    object: { position: Vector3 };
    update: () => void;
  } | null;
  useFrame((_, dt) => {
    if (controls && shot.request) {
      // A picture's still: jump there, remembering where the camera was.
      const { x, y, span } = shot.request;
      shot.request = null;
      saved.current ??= { target: controls.target.clone(), position: controls.object.position.clone() };
      const offset = controls.object.position.clone().sub(controls.target);
      controls.target.set(x, controls.target.y, y);
      offset.setLength(Math.max(18, span * 1.6 + 12));
      controls.object.position.copy(controls.target).add(offset);
      controls.update();
    } else if (controls && shot.restore) {
      shot.restore = false;
      if (saved.current) {
        controls.target.copy(saved.current.target);
        controls.object.position.copy(saved.current.position);
        controls.update();
        saved.current = null;
      }
    }
    if (controls) {
      const dx = controls.target.x - controls.object.position.x;
      const dy = controls.target.z - controls.object.position.z;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        cameraForward.x = dx / len;
        cameraForward.y = dy / len;
      }
    }
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
