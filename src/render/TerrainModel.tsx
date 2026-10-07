import { Detailed } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { ModelAsset } from "../assets/types";
import { shadowMaterial, useAssetGeometries } from "./Miniatures";

/** Camera distances (inches) at which each level of detail takes over. */
const LOD_DISTANCES = [0, 40, 90];

/**
 * An uploaded terrain model, drawn in its piece's frame (local x across,
 * local y into the table as three's z, height up), at the scale the piece
 * was sized to. Levels of detail swap with camera distance; the rules still
 * use the piece's solids and hull.
 */
export function TerrainModel({
  asset,
  scale,
  xray,
  selected,
  handlers,
}: {
  asset: ModelAsset;
  scale: number;
  xray: boolean;
  selected: boolean;
  handlers: Partial<{
    onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
    onClick: (e: ThreeEvent<MouseEvent>) => void;
    raycast: () => null;
  }>;
}) {
  const geometries = useAssetGeometries(asset);
  return (
    <group scale={scale}>
      <Detailed distances={LOD_DISTANCES.slice(0, geometries.length)}>
        {geometries.map((g, i) => (
          <mesh key={i} geometry={g} receiveShadow {...handlers}>
            <meshStandardMaterial
              color={selected ? "#c08a3e" : "#8a8178"}
              roughness={0.9}
              transparent={xray}
              opacity={xray ? 0.25 : 1}
              depthWrite={!xray}
            />
          </mesh>
        ))}
      </Detailed>
      {/* Shadows from the coarsest level whatever the camera distance: invisible on screen. */}
      <mesh
        geometry={geometries[geometries.length - 1]}
        material={shadowMaterial}
        castShadow={!xray}
        raycast={() => null}
      />
    </group>
  );
}
