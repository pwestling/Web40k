import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { baseSizeInches, maxWounds, type GameState, type Model, type TerrainPiece, type Vec2 } from "../core";
import {
  aliveModels,
  ENGAGEMENT_RANGE,
  incoherentModels,
  moveAllowance,
  num,
  OBJECTIVE_MARKER_MM,
  OBJECTIVE_RANGE,
  objectiveControl,
  unitMoved,
} from "../systems/wh40k/rules";
import { useCanControl, useStore } from "../store";
import { useGame, useSelfSeat } from "../ui/hooks";

/**
 * World axes: x = table width, z = table depth, y = up. One unit is one inch.
 * Game-state Vec2 {x, y} maps to world (x, 0, y).
 */
export function Board() {
  return (
    <Canvas shadows>
      <color attach="background" args={["#111318"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[20, 40, 10]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} />
      <Cameras />
      <Scene />
    </Canvas>
  );
}

/**
 * 3D is the main view, from the player's own table edge. Top-down is an
 * orthographic map view of the same scene for precise measuring.
 */
function Cameras() {
  const view = useStore((s) => s.view);
  const table = useGame().table;
  const size = useThree((s) => s.size);
  const seat = useSelfSeat();
  const side = seat === 1 ? -1 : 1;
  if (view === "3d") return <PerspectiveCamera makeDefault position={[0, 52, 44 * side]} fov={45} />;
  const zoom = Math.min(size.width / table.width, size.height / table.depth) * 0.85;
  // The tiny z offset keeps the camera's up vector defined and puts the
  // player's own edge at the bottom of the screen.
  return <OrthographicCamera makeDefault position={[0, 100, 0.001 * side]} zoom={zoom} />;
}

interface Drag {
  /** Models being dragged and where they started this drag. */
  ids: string[];
  starts: Record<string, Vec2>;
  grab: Vec2;
  to: Vec2;
  moved: boolean;
  unitId?: string;
}

const groundPlane = new Plane(new Vector3(0, 1, 0), 0);

function Scene() {
  const game = useGame();
  const { dispatch, view, selected, select, draft, setDraft, scrub } = useStore();
  const canControl = useCanControl();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  useLayoutEffect(() => {
    dragRef.current = drag;
  });
  const { camera, gl } = useThree();
  const { width, depth } = game.table;
  const live = scrub === null;

  // Track the pointer on the table plane while dragging, wherever it is.
  useEffect(() => {
    if (!drag) return;
    const ray = new Raycaster();
    const hit = new Vector3();
    const move = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(groundPlane, hit)) return;
      const d = dragRef.current;
      if (!d) return;
      const to = { x: hit.x, y: hit.z };
      const moved = d.moved || Math.hypot(to.x - d.grab.x, to.y - d.grab.y) > 0.15;
      setDrag({ ...d, to, moved });
    };
    const drop = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !d.moved) return;
      const dx = d.to.x - d.grab.x;
      const dy = d.to.y - d.grab.y;
      dispatch({
        type: "models/move",
        moves: d.ids.map((id) => ({ id, to: { x: d.starts[id]!.x + dx, y: d.starts[id]!.y + dy } })),
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
    };
  }, [drag !== null, camera, gl, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where each model is drawn: dragged models follow the pointer.
  const positions = useMemo(() => {
    const p: Record<string, Vec2> = {};
    for (const m of Object.values(game.models)) p[m.id] = m.position;
    if (drag)
      for (const id of drag.ids)
        p[id] = {
          x: drag.starts[id]!.x + drag.to.x - drag.grab.x,
          y: drag.starts[id]!.y + drag.to.y - drag.grab.y,
        };
    return p;
  }, [game.models, drag]);

  const placed = (m: Model): Model => ({ ...m, position: positions[m.id] ?? m.position });

  // Coherency, with dragged models where they are being held.
  const incoherent = useMemo(() => {
    const bad = new Set<string>();
    for (const u of Object.values(game.units)) {
      for (const id of incoherentModels(aliveModels(game, u).map(placed))) bad.add(id);
    }
    return bad;
  }, [game, positions]); // eslint-disable-line react-hooks/exhaustive-deps

  const onModelDown = (m: Model, shift: boolean) => {
    if (draft?.picking) {
      if (m.unitId && m.unitId !== draft.attackerId)
        setDraft({ ...draft, targetId: m.unitId, picking: false });
      return;
    }
    if (m.unitId) select(m.unitId);
    if (!live || !canControl(m.owner)) return;
    const unit = m.unitId ? game.units[m.unitId] : undefined;
    const ids = shift || !unit ? [m.id] : aliveModels(game, unit).map((x) => x.id);
    const starts: Record<string, Vec2> = {};
    for (const id of ids) starts[id] = game.models[id]!.position;
    setDrag({ ids, starts, grab: m.position, to: m.position, moved: false, unitId: unit?.id });
  };

  const selectedUnit = selected ? game.units[selected] : undefined;
  const dragUnit = drag?.unitId ? game.units[drag.unitId] : undefined;
  const control = useMemo(() => objectiveControl(game), [game]);
  const rangeWeapon = draft?.weaponId
    ? game.units[draft.attackerId]?.sheet?.weapons[draft.weaponId]
    : undefined;

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
      <mesh
        rotation-x={-Math.PI / 2}
        receiveShadow
        onClick={(e) => {
          if (!draft?.picking && e.delta < 3) select(null);
        }}
      >
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#4b5a3a" />
      </mesh>
      <InchGrid width={width} depth={depth} />
      {game.zones.map((z) => (
        <ZoneShape key={z.seat} points={z.points} color={seatColor(game, z.seat)} />
      ))}
      {game.terrain.map((t) => (
        <Terrain key={t.id} piece={t} />
      ))}
      {game.objectives.map((o) => {
        const c = control.find((x) => x.id === o.id);
        const color = c?.controller ? (game.players[c.controller]?.color ?? "#fff") : "#d4d4d8";
        return <ObjectiveMarker key={o.id} position={o.position} color={color} />;
      })}

      {Object.values(game.models).map((model) => {
        if (model.destroyed) return null;
        const owner = game.players[model.owner];
        const isSelected = !!model.unitId && model.unitId === selected;
        return (
          <ModelBase
            key={model.id}
            model={model}
            position={positions[model.id]!}
            color={owner?.color ?? "#999"}
            selected={isSelected}
            incoherent={incoherent.has(model.id)}
            targetable={!!draft?.picking && model.unitId !== draft.attackerId}
            onDown={(shift) => onModelDown(model, shift)}
          />
        );
      })}

      {/* Where the selected unit started this phase. */}
      {selectedUnit &&
        aliveModels(game, selectedUnit).map((m) => {
          const p = positions[m.id]!;
          const s = m.phaseStart;
          if (!s || Math.hypot(p.x - s.x, p.y - s.y) < 0.05) return null;
          return <Ghost key={m.id} from={s} to={p} model={m} />;
        })}

      {/* Engagement range around enemies while dragging. */}
      {dragUnit &&
        Object.values(game.models)
          .filter((m) => !m.destroyed && m.owner !== dragUnit.owner)
          .map((m) => <Ring key={m.id} model={m} radius={ENGAGEMENT_RANGE} color="#f97316" opacity={0.25} />)}

      {/* Weapon range around each carrier. */}
      {rangeWeapon &&
        rangeWeapon.kind === "ranged" &&
        aliveModels(game, game.units[draft!.attackerId])
          .filter((m) => m.weapons?.includes(draft!.weaponId!))
          .map((m) => (
            <Ring
              key={m.id}
              model={placed(m)}
              radius={num(rangeWeapon.chars.RANGE) ?? 0}
              color="#facc15"
              opacity={0.35}
            />
          ))}

      {drag?.moved && dragUnit && (
        <MoveLabel game={game} unitId={dragUnit.id} positions={positions} at={drag.to} />
      )}
      {drag?.moved && !dragUnit && (
        <SimpleLabel
          at={drag.to}
          text={`${Math.hypot(drag.to.x - drag.grab.x, drag.to.y - drag.grab.y).toFixed(1)}"`}
        />
      )}
    </>
  );
}

function seatColor(game: GameState, seat: number): string {
  return (
    Object.values(game.players).find((p) => p.seat === seat)?.color ?? (seat === 0 ? "#3b82f6" : "#ef4444")
  );
}

function MoveLabel({
  game,
  unitId,
  positions,
  at,
}: {
  game: GameState;
  unitId: string;
  positions: Record<string, Vec2>;
  at: Vec2;
}) {
  const unit = game.units[unitId]!;
  const moved = unitMoved(aliveModels(game, unit), positions);
  const allowed = moveAllowance(game, unit);
  const deploying = game.turn.round === 0;
  const over = !deploying && allowed !== null && moved > allowed + 0.05;
  const text = deploying ? `${moved.toFixed(1)}"` : `${moved.toFixed(1)}" / ${allowed ?? "?"}"`;
  return <SimpleLabel at={at} text={text} className={over ? "ruler over" : "ruler"} />;
}

function SimpleLabel({ at, text, className = "ruler" }: { at: Vec2; text: string; className?: string }) {
  return (
    <Html position={[at.x, 2.5, at.y]} center className={className}>
      {text}
    </Html>
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

function ZoneShape({ points, color }: { points: Vec2[]; color: string }) {
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

function Terrain({ piece }: { piece: TerrainPiece }) {
  return (
    <group position={[piece.position.x, 0, piece.position.y]} rotation-y={piece.facing}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} raycast={() => null} receiveShadow>
        <planeGeometry args={[piece.width, piece.depth]} />
        <meshStandardMaterial color="#6b6257" transparent opacity={0.75} />
      </mesh>
      {piece.walls.map((w, i) => {
        const len = Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y);
        const angle = Math.atan2(w.to.x - w.from.x, w.to.y - w.from.y);
        return (
          <mesh
            key={i}
            position={[(w.from.x + w.to.x) / 2, w.height / 2, (w.from.y + w.to.y) / 2]}
            rotation-y={angle}
            castShadow
            receiveShadow
            raycast={() => null}
          >
            <boxGeometry args={[0.35, w.height, len]} />
            <meshStandardMaterial color="#8a8178" transparent opacity={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

function ObjectiveMarker({ position, color }: { position: Vec2; color: string }) {
  const r = OBJECTIVE_MARKER_MM / 25.4 / 2;
  return (
    <group position={[position.x, 0, position.y]}>
      <mesh position-y={0.05} raycast={() => null}>
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

/** A flat ring `radius` inches out from a model's base edge. */
function Ring({
  model,
  radius,
  color,
  opacity,
}: {
  model: Model;
  radius: number;
  color: string;
  opacity: number;
}) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.max(width, depth) / 2 + radius;
  return (
    <mesh
      rotation-x={-Math.PI / 2}
      position={[model.position.x, 0.04, model.position.y]}
      raycast={() => null}
    >
      <ringGeometry args={[r - 0.08, r, 64]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Ghost({ from, to, model }: { from: Vec2; to: Vec2; model: Model }) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.max(width, depth) / 2;
  const line = useMemo(() => new Float32Array([from.x, 0.06, from.y, to.x, 0.06, to.y]), [from, to]);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[from.x, 0.05, from.y]} raycast={() => null}>
        <ringGeometry args={[r - 0.1, r, 32]} />
        <meshBasicMaterial color="#e5e7eb" transparent opacity={0.5} />
      </mesh>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[line, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#e5e7eb" transparent opacity={0.6} />
      </lineSegments>
    </>
  );
}

interface ModelBaseProps {
  model: Model;
  position: Vec2;
  color: string;
  selected: boolean;
  incoherent: boolean;
  targetable: boolean;
  onDown: (shift: boolean) => void;
}

function ModelBase({ model, position, color, selected, incoherent, targetable, onDown }: ModelBaseProps) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.min(width, depth) / 2;
  const big = Math.max(width, depth);
  const rect = model.base.shape === "rect";
  const wounds = maxWounds(model);
  const left = wounds - (model.woundsLost ?? 0);
  const height = rect ? Math.min(3, 0.8 + big * 0.3) : Math.min(4, 0.9 + r * 1.4);
  const [hover, setHover] = useState(false);
  return (
    <group position={[position.x, 0, position.y]} rotation-y={model.facing}>
      <mesh
        castShadow
        position-y={0.1}
        // Oval bases are a unit cylinder stretched to size.
        scale={rect ? 1 : [width / 2, 1, depth / 2]}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onDown(e.shiftKey);
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        {rect ? (
          <boxGeometry args={[width * 0.98, 0.2, depth * 0.98]} />
        ) : (
          <cylinderGeometry args={[1, 1, 0.2, 32]} />
        )}
        <meshStandardMaterial color={color} emissive={targetable && hover ? "#facc15" : "#000"} />
      </mesh>
      {/* Stand-in for the miniature until real models are loaded; the nub shows facing. */}
      {rect ? (
        <mesh castShadow position-y={0.2 + height / 2} raycast={() => null}>
          <boxGeometry args={[width * 0.8, height, depth * 0.85]} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
      ) : (
        <mesh castShadow position-y={0.2 + height / 2} raycast={() => null}>
          <capsuleGeometry args={[r * 0.45, Math.max(0.1, height - r * 0.9), 4, 12]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      )}
      <mesh position={[0, 0.25, depth / 2 - 0.1]} raycast={() => null}>
        <boxGeometry args={[0.15, 0.1, 0.2]} />
        <meshStandardMaterial color="white" />
      </mesh>
      {(selected || incoherent) && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03} raycast={() => null}>
          <ringGeometry args={[Math.max(width, depth) / 2 + 0.05, Math.max(width, depth) / 2 + 0.25, 40]} />
          <meshBasicMaterial color={incoherent ? "#ef4444" : "#fde047"} />
        </mesh>
      )}
      {wounds > 1 && left < wounds && (
        <Html position={[0, height + 0.9, 0]} center className="wounds">
          {`${left}/${wounds}`}
        </Html>
      )}
    </group>
  );
}
