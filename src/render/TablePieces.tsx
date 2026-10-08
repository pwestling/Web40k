import { Html } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { CanvasTexture, RepeatWrapping } from "three";
import { type TerrainPiece, type Vec2 } from "../core";
import { OBJECTIVE_MARKER_MM, OBJECTIVE_RANGE } from "../systems/wh40k/rules";
import { TerrainModel } from "./TerrainModel";
import { useAssets } from "../assets/store";
import { LABEL_Z } from "./boardLabels";

/** The table itself: its grid, deployment zones, terrain pieces and objective markers. */

/** One line per inch, a brighter line every 6". */
export function InchGrid({ width, depth }: { width: number; depth: number }) {
  const [minor, major] = useMemo(() => {
    const lines: [number[], number[]] = [[], []];
    for (let x = 0; x <= width; x++) {
      lines[x % 6 === 0 ? 1 : 0].push(x - width / 2, 0, -depth / 2, x - width / 2, 0, depth / 2);
    }
    for (let z = 0; z <= depth; z++) {
      lines[z % 6 === 0 ? 1 : 0].push(-width / 2, 0, z - depth / 2, width / 2, 0, z - depth / 2);
    }
    return lines.map((l) => new Float32Array(l));
  }, [width, depth]);

  return (
    <group position-y={0.01}>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[minor!, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#56653f" />
      </lineSegments>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[major!, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#77895c" />
      </lineSegments>
    </group>
  );
}

export function ZoneShape({ points, color }: { points: Vec2[]; color: string }) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0.015, (y0 + y1) / 2]} raycast={() => null}>
      <planeGeometry args={[x1 - x0, y1 - y0]} />
      <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
    </mesh>
  );
}

/** Diagonal stripes, for obscuring footprints. */
let hatch: CanvasTexture | null = null;
function hatchTexture(): CanvasTexture {
  if (hatch) return hatch;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#fff";
  g.lineWidth = 6;
  for (const o of [-32, 0, 32]) {
    g.beginPath();
    g.moveTo(o, 32);
    g.lineTo(o + 32, 0);
    g.stroke();
  }
  hatch = new CanvasTexture(c);
  hatch.wrapS = hatch.wrapT = RepeatWrapping;
  return hatch;
}

const FOOTPRINT_COLORS = { open: "#e5e7eb", obscuring: "#facc15", blocking: "#ef4444" };

/** Footprint line of sight: clear outline for open, stripes for obscuring, solid for blocking. */
function FootprintTint({
  width,
  depth,
  kind,
  strong,
}: {
  width: number;
  depth: number;
  kind: "open" | "obscuring" | "blocking";
  strong: boolean;
}) {
  const map = useMemo(() => {
    if (kind !== "obscuring") return null;
    const t = hatchTexture().clone();
    t.repeat.set(width / 1.5, depth / 1.5);
    t.needsUpdate = true;
    return t;
  }, [kind, width, depth]);
  const outline = useMemo(() => {
    const [w, d] = [width / 2, depth / 2];
    return new Float32Array([-w, 0, -d, w, 0, -d, w, 0, -d, w, 0, d, w, 0, d, -w, 0, d, -w, 0, d, -w, 0, -d]);
  }, [width, depth]);
  const color = FOOTPRINT_COLORS[kind];
  return (
    <group position-y={0.05}>
      {kind !== "open" && (
        <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial
            color={color}
            {...(map ? { map } : {})}
            transparent
            opacity={(kind === "blocking" ? 0.35 : 0.5) * (strong ? 1.6 : 1)}
            depthWrite={false}
          />
        </mesh>
      )}
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[outline, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

const CATEGORY_COLORS: Record<TerrainPiece["category"], string> = {
  exposed: "#6f6450",
  light: "#6b6257",
  dense: "#3d5a32",
  solid: "#4b4b52",
  // Other games' categories.
  open: "#6f6450",
  broken: "#6f6450",
  traversable: "#6b6257",
  obscuring: "#3d5a32",
  blocking: "#4b4b52",
};

export function Terrain({
  piece,
  xray,
  editable,
  selected,
  standIn,
  footprint,
  grouped,
  onDown,
}: {
  piece: TerrainPiece;
  xray: boolean;
  editable: boolean;
  selected: boolean;
  /** Stand-in height to draw as a see-through block, in "heights" line of sight. */
  standIn: number | null;
  /** Sight class to tint the footprint with, in "footprint" line of sight. */
  footprint: "open" | "obscuring" | "blocking" | null;
  grouped?: boolean;
  onDown: (shift: boolean) => void;
}) {
  const handlers = editable
    ? {
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onDown(e.shiftKey);
        },
        onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
      }
    : { raycast: () => null };
  const opacity = xray ? 0.2 : 0.95;
  // An uploaded model replaces the solids' boxes once its meshes are here; until then the boxes stand in.
  const model = useAssets((a) => (piece.mesh ? a.assets[piece.mesh.asset] : undefined));
  return (
    <group position={[piece.position.x, 0, piece.position.y]} rotation-y={piece.facing}>
      {model && (
        <TerrainModel
          asset={model}
          scale={piece.mesh!.scale}
          xray={xray}
          selected={selected}
          handlers={handlers}
        />
      )}
      {standIn !== null && standIn > 0 && (
        <mesh position-y={standIn / 2} raycast={() => null}>
          <boxGeometry args={[piece.width, standIn, piece.depth]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.15} depthWrite={false} />
        </mesh>
      )}
      {footprint && <FootprintTint width={piece.width} depth={piece.depth} kind={footprint} strong={xray} />}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} receiveShadow {...handlers}>
        <planeGeometry args={[piece.width, piece.depth]} />
        <meshStandardMaterial
          color={selected ? "#a16207" : grouped ? "#7c3aed" : (CATEGORY_COLORS[piece.category] ?? "#6b6257")}
          transparent
          opacity={0.8}
        />
      </mesh>
      {!model &&
        piece.solids.map((s, i) =>
          s.kind === "foliage" ? (
            <group key={i} position={[s.x, s.z, s.y]}>
              <mesh position-y={0.6} raycast={() => null}>
                <cylinderGeometry args={[0.15, 0.2, 1.2, 8]} />
                <meshStandardMaterial color="#5b4630" />
              </mesh>
              <mesh position-y={1.2 + (s.h - 1.2) / 2} castShadow raycast={() => null}>
                <coneGeometry args={[s.w / 2, s.h - 1.2, 10]} />
                <meshStandardMaterial color="#2f5d2a" transparent opacity={xray ? 0.25 : 1} />
              </mesh>
            </group>
          ) : (
            <mesh key={i} position={[s.x, s.z + s.h / 2, s.y]} castShadow={!xray} receiveShadow {...handlers}>
              <boxGeometry args={[s.w, s.h, s.d]} />
              <meshStandardMaterial
                color={
                  s.kind === "floor"
                    ? "#9a8f80"
                    : s.kind === "block"
                      ? piece.name === "Hill"
                        ? "#5f6e45"
                        : "#7a5c3c"
                      : "#8a8178"
                }
                transparent
                opacity={opacity}
                depthWrite={!xray}
              />
            </mesh>
          ),
        )}
      {selected && (
        <Html zIndexRange={LABEL_Z} position={[0, 0.5, 0]} center className="ruler terrain-label">
          {piece.name} · {piece.category}
        </Html>
      )}
    </group>
  );
}

export function ObjectiveMarker({
  position,
  color,
  onDown,
}: {
  position: Vec2;
  color: string;
  onDown?: () => void;
}) {
  const r = OBJECTIVE_MARKER_MM / 25.4 / 2;
  return (
    <group position={[position.x, 0, position.y]}>
      <mesh
        position-y={0.05}
        {...(onDown
          ? {
              onPointerDown: (e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                onDown();
              },
              onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
            }
          : { raycast: () => null })}
      >
        <cylinderGeometry args={[r, r, 0.1, 32]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} raycast={() => null}>
        <ringGeometry args={[r + OBJECTIVE_RANGE - 0.08, r + OBJECTIVE_RANGE, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}
