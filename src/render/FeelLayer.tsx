import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshBasicMaterial } from "three";
import { RING_DURATION, rings, stepFeel } from "./feel";

const POOL = 12;

/**
 * Drives the hand feel each frame (feel.ts) and draws the faint rings that
 * spread from bases as they are set down.
 */
export function FeelLayer() {
  const pool = useRef<(Mesh | null)[]>([]);
  useFrame((_, dt) => {
    const now = performance.now();
    stepFeel(dt, now);
    // Drop rings that have run their course.
    while (rings.length && now - rings[0]!.start > RING_DURATION) rings.shift();
    const live = rings.filter((r) => now >= r.start).slice(-POOL);
    pool.current.forEach((mesh, i) => {
      if (!mesh) return;
      const r = live[i];
      mesh.visible = !!r;
      if (!r) return;
      const t = (now - r.start) / RING_DURATION;
      mesh.position.set(r.x, r.z + 0.04, r.y);
      mesh.scale.setScalar(r.radius * (1 + t * 0.8));
      (mesh.material as MeshBasicMaterial).opacity = 0.4 * (1 - t);
    });
  });
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            pool.current[i] = m;
          }}
          rotation-x={-Math.PI / 2}
          visible={false}
          raycast={() => null}
        >
          <ringGeometry args={[0.92, 1, 40]} />
          <meshBasicMaterial color="#e5e7eb" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
