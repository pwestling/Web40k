import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import { baseSizeInches, unitCentre } from "../core";
import { useStore } from "../store";
import { useGame } from "../ui/hooks";

/** How long the table celebrates a rare outcome. */
const MOMENT_MS = 3200;

/**
 * Against all odds on the table (PX-2): brass rings pulse on the unit's
 * bases and its title floats over it, then it clears itself. Display only.
 */
export function Moment() {
  const moment = useStore((s) => s.moment);
  const game = useGame();
  const rings = useRef<Group>(null);

  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => {
      if (useStore.getState().moment === moment) useStore.getState().set({ moment: null });
    }, MOMENT_MS);
    return () => clearTimeout(t);
  }, [moment]);

  useFrame(() => {
    if (!rings.current || !moment) return;
    const t = (Date.now() - moment.at) / 1000;
    const pulse = (t * 1.4) % 1;
    rings.current.children.forEach((ring) => {
      ring.scale.setScalar(1 + pulse * 0.6);
      const mat = (ring as unknown as { material: { opacity: number } }).material;
      mat.opacity = (1 - pulse) * 0.9;
    });
  });

  const unit = moment ? game.units[moment.unitId] : undefined;
  if (!moment || !unit) return null;
  const models = unit.modelIds.map((id) => game.models[id]).filter((m) => m && !m.destroyed);
  const at = unitCentre(game, unit);
  const top = Math.max(0, ...models.map((m) => m!.z ?? 0));
  const color = moment.lucky ? "#e0b354" : "#c9a0dc";
  return (
    <>
      <group ref={rings}>
        {models.map((m) => {
          const { width, depth } = baseSizeInches(m!.base);
          const r = Math.max(width, depth) / 2 + 0.15;
          return (
            <mesh
              key={m!.id}
              rotation-x={-Math.PI / 2}
              position={[m!.position.x, (m!.z ?? 0) + 0.05, m!.position.y]}
              raycast={() => null}
            >
              <ringGeometry args={[r - 0.12, r, 48]} />
              <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
            </mesh>
          );
        })}
      </group>
      <Html position={[at.x, top + 4, at.y]} center zIndexRange={[9, 0]} className="moment-title">
        <div className={moment.lucky ? "" : "cursed"}>
          <strong>{moment.title}</strong>
          <span>{moment.line}</span>
        </div>
      </Html>
    </>
  );
}
