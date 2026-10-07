import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { baseSizeInches, distance, type Model, type UnitId, type Vec2 } from "../core";
import { useStore } from "../store";

/**
 * World axes: x = table width, z = table depth, y = up. One unit is one inch.
 * Game-state Vec2 {x, y} maps to world (x, 0, y).
 */
export function Board() {
  return (
    <Canvas shadows>
      <color attach="background" args={["#111318"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 40, 10]} intensity={1.4} castShadow />
      <Cameras />
      <Scene />
    </Canvas>
  );
}

/**
 * 3D is the main view. Top-down is an orthographic map view of the same
 * scene for precise measuring; it pans and zooms but does not rotate.
 */
function Cameras() {
  const view = useStore((s) => s.view);
  const table = useStore((s) => s.game.table);
  const size = useThree((s) => s.size);
  if (view === "3d") return <PerspectiveCamera makeDefault position={[0, 45, 40]} fov={45} />;
  // Fit the whole table with a small margin. The tiny z offset keeps the
  // camera's up vector well defined when looking straight down.
  const zoom = Math.min(size.width / table.width, size.height / table.depth) * 0.9;
  return <OrthographicCamera makeDefault position={[0, 100, 0.001]} zoom={zoom} />;
}

function Scene() {
  const { game, session, dispatch, view } = useStore();
  // Dragging a model in a ranked unit drags the whole block.
  const [drag, setDrag] = useState<{ id: string; unitId?: UnitId; from: Vec2; to: Vec2 } | null>(null);
  const { width, depth } = game.table;

  const onTableMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    setDrag({ ...drag, to: { x: e.point.x, y: e.point.z } });
  };

  // Drop on any pointer release, even one outside the table.
  useEffect(() => {
    if (!drag) return;
    const drop = () => {
      if (drag.unitId) {
        const delta = { x: drag.to.x - drag.from.x, y: drag.to.y - drag.from.y };
        dispatch({ type: "unit/move", id: drag.unitId, pivot: drag.from, turn: 0, delta });
      } else {
        dispatch({ type: "model/move", id: drag.id, to: drag.to });
      }
      setDrag(null);
    };
    window.addEventListener("pointerup", drop);
    return () => window.removeEventListener("pointerup", drop);
  }, [drag, dispatch]);

  return (
    <>
      {/* Remount on view change so the controls bind to the new camera. */}
      <OrbitControls
        key={view}
        enabled={!drag}
        enableRotate={view === "3d"}
        maxPolarAngle={Math.PI / 2.1}
        makeDefault
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow onPointerMove={onTableMove}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#4b5a3a" />
      </mesh>
      <InchGrid width={width} depth={depth} />

      {Object.values(game.models).map((model) => {
        const owner = game.players[model.owner];
        const dragged = drag && (drag.id === model.id || (drag.unitId && drag.unitId === model.unitId));
        const position = dragged
          ? {
              x: model.position.x + drag.to.x - drag.from.x,
              y: model.position.y + drag.to.y - drag.from.y,
            }
          : model.position;
        return (
          <ModelBase
            key={model.id}
            model={model}
            position={position}
            color={owner?.color ?? "#999"}
            draggable={model.owner === session?.selfId}
            onGrab={() => {
              const unit = model.unitId ? game.units[model.unitId] : undefined;
              const unitId = unit?.formation.kind === "ranked" ? unit.id : undefined;
              setDrag({ id: model.id, unitId, from: model.position, to: model.position });
            }}
          />
        );
      })}

      {drag && <MoveRuler from={drag.from} to={drag.to} />}
    </>
  );
}

/** One line per inch, a brighter line every 6". */
function InchGrid({ width, depth }: { width: number; depth: number }) {
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

interface ModelBaseProps {
  model: Model;
  position: Vec2;
  color: string;
  draggable: boolean;
  onGrab: () => void;
}

function ModelBase({ model, position, color, draggable, onGrab }: ModelBaseProps) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.min(width, depth) / 2;
  return (
    <group position={[position.x, 0, position.y]} rotation-y={model.facing}>
      <mesh
        castShadow
        position-y={0.1}
        // Oval bases are a unit cylinder stretched to size.
        scale={model.base.shape === "rect" ? 1 : [width / 2, 1, depth / 2]}
        onPointerDown={(e) => {
          if (!draggable) return;
          e.stopPropagation();
          onGrab();
        }}
      >
        {model.base.shape === "rect" ? (
          <boxGeometry args={[width * 0.98, 0.2, depth * 0.98]} />
        ) : (
          <cylinderGeometry args={[1, 1, 0.2, 32]} />
        )}
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Stand-in for the miniature until real models are loaded; the nub shows facing. */}
      <mesh castShadow position-y={0.2 + 0.6} raycast={() => null}>
        <capsuleGeometry args={[r * 0.45, 0.6, 4, 12]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <mesh position={[0, 0.25, depth / 2 - 0.1]} raycast={() => null}>
        <boxGeometry args={[0.15, 0.1, 0.2]} />
        <meshStandardMaterial color="white" />
      </mesh>
    </group>
  );
}

function MoveRuler({ from, to }: { from: Vec2; to: Vec2 }) {
  return (
    <Html position={[to.x, 2, to.y]} center className="ruler">
      {`${distance(from, to).toFixed(1)}"`}
    </Html>
  );
}
