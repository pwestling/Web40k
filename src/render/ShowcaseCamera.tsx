import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import { useShowcase } from "./showcase";

interface Controls {
  target: Vector3;
  object: { position: Vector3; lookAt(v: Vector3): void };
  enabled: boolean;
  update(): void;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const a = new Vector3();
const b = new Vector3();

/**
 * Drives the camera through the army showcase (PX-5a): low along each army,
 * then high over the table. The orbit controls step aside while it runs (they
 * would lift the camera off the low angle), and the view the player had comes
 * back when it ends.
 */
export function ShowcaseCamera() {
  const saved = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  useFrame((state) => {
    const controls = state.controls as unknown as Controls | null;
    if (!controls) return;
    const { on, shot } = useShowcase.getState();
    if (!on) {
      if (saved.current) {
        controls.object.position.copy(saved.current.position);
        controls.target.copy(saved.current.target);
        controls.enabled = true;
        controls.update();
        saved.current = null;
      }
      return;
    }
    saved.current ??= { position: controls.object.position.clone(), target: controls.target.clone() };
    controls.enabled = false;
    if (!shot) return;
    const t = ease(Math.max(0, Math.min(1, (performance.now() - shot.start) / shot.dur)));
    controls.object.position.copy(a.fromArray(shot.from).lerp(b.fromArray(shot.to), t));
    controls.object.lookAt(a.fromArray(shot.lookFrom).lerp(b.fromArray(shot.lookTo), t));
  });
  return null;
}
