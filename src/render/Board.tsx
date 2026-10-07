import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import {
  baseSizeInches,
  maxWounds,
  modelHeight,
  settleZ,
  type GameState,
  type Model,
  type TerrainPiece,
  type Unit,
  type Vec2,
} from "../core";
import {
  aliveModels,
  blockedMoves,
  carriers,
  ENGAGEMENT_RANGE,
  incoherentModels,
  moveAllowance,
  num,
  OBJECTIVE_MARKER_MM,
  OBJECTIVE_RANGE,
  objectiveControl,
  unitMoved,
  unitSight,
} from "../systems/wh40k/rules";
import { useCanControl, useStore } from "../store";
import { useGame, useSelfSeat } from "../ui/hooks";
import { Miniatures, useFigureHeights } from "./Miniatures";

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
      {import.meta.env.DEV && <PerfProbe />}
    </Canvas>
  );
}

/** Hands the renderer to the dev perf harness (src/dev/perf.ts). */
function PerfProbe() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    void import("../dev/perf").then(({ setPerfRenderer }) => setPerfRenderer(gl));
  }, [gl]);
  return null;
}

/**
 * 3D is the main view, from the player's own table edge. Top-down is an
 * orthographic map view of the same scene for precise measuring. The eye
 * view puts the camera at a model's eye line.
 */
function Cameras() {
  const view = useStore((s) => s.view);
  const eye = useStore((s) => s.eye);
  const game = useGame();
  const size = useThree((s) => s.size);
  const seat = useSelfSeat();
  const side = seat === 1 ? -1 : 1;
  const eyeModel = eye ? game.models[eye.modelId] : undefined;
  if (view === "eye" && eyeModel) {
    const z = (eyeModel.z ?? 0) + modelHeight(eyeModel) * 0.95 + 0.2;
    return (
      <PerspectiveCamera
        key={eyeModel.id}
        makeDefault
        position={[eyeModel.position.x, z, eyeModel.position.y]}
        fov={60}
        near={0.1}
      />
    );
  }
  if (view !== "top") return <PerspectiveCamera makeDefault position={[0, 52, 44 * side]} fov={45} />;
  const zoom = Math.min(size.width / game.table.width, size.height / game.table.depth) * 0.85;
  // The tiny z offset keeps the camera's up vector defined and puts the
  // player's own edge at the bottom of the screen.
  return <OrthographicCamera makeDefault position={[0, 100, 0.001 * side]} zoom={zoom} />;
}

type Drag = {
  grab: Vec2;
  to: Vec2;
  moved: boolean;
  /** Height of the plane the pointer is tracked on (the grabbed model's floor). */
  planeZ: number;
} & (
  | {
      kind: "models";
      ids: string[];
      starts: Record<string, Vec2>;
      startZ: Record<string, number>;
      unitId?: string;
    }
  | { kind: "terrain" | "objective"; id: string; start: Vec2 }
);

function Scene() {
  const game = useGame();
  const {
    dispatch,
    view,
    selected,
    select,
    draft,
    setDraft,
    scrub,
    editing,
    selectedTerrain,
    xray,
    losFrom,
    eye,
    set: setUi,
  } = useStore();
  const canControl = useCanControl();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  useLayoutEffect(() => {
    dragRef.current = drag;
  });
  const { camera, gl } = useThree();
  const { width, depth } = game.table;
  const live = scrub === null;

  // Track the pointer on a horizontal plane while dragging, wherever it is.
  useEffect(() => {
    if (!drag) return;
    const ray = new Raycaster();
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), -drag.planeZ);
    const move = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
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
      const terrain = useStore.getState().game.terrain;
      if (d.kind === "models") {
        dispatch({
          type: "models/move",
          moves: d.ids.map((id) => {
            const to = { x: d.starts[id]!.x + dx, y: d.starts[id]!.y + dy };
            return { id, to, z: settleZ(terrain, to, d.startZ[id] ?? 0) };
          }),
        });
      } else if (d.kind === "terrain") {
        const piece = terrain.find((t) => t.id === d.id);
        if (piece)
          dispatch({
            type: "terrain/update",
            piece: { ...piece, position: { x: d.start.x + dx, y: d.start.y + dy } },
          });
      } else dispatch({ type: "objective/move", id: d.id, to: { x: d.start.x + dx, y: d.start.y + dy } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
    };
  }, [drag !== null, camera, gl, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Terrain and objectives as shown: a dragged piece follows the pointer.
  const terrain = useMemo(() => {
    if (drag?.kind !== "terrain") return game.terrain;
    return game.terrain.map((t) =>
      t.id === drag.id
        ? {
            ...t,
            position: {
              x: drag.start.x + drag.to.x - drag.grab.x,
              y: drag.start.y + drag.to.y - drag.grab.y,
            },
          }
        : t,
    );
  }, [game.terrain, drag]);

  // Where each model is drawn: dragged models follow the pointer and settle on floors.
  const [positions, heights] = useMemo(() => {
    const p: Record<string, Vec2> = {};
    const h: Record<string, number> = {};
    for (const m of Object.values(game.models)) {
      p[m.id] = m.position;
      h[m.id] = m.z ?? 0;
    }
    if (drag?.kind === "models")
      for (const id of drag.ids) {
        const to = {
          x: drag.starts[id]!.x + drag.to.x - drag.grab.x,
          y: drag.starts[id]!.y + drag.to.y - drag.grab.y,
        };
        p[id] = to;
        h[id] = settleZ(game.terrain, to, drag.startZ[id] ?? 0);
      }
    return [p, h];
  }, [game.models, game.terrain, drag]);

  const onTable = useMemo(() => Object.values(game.models).filter((m) => !m.destroyed), [game.models]);
  const figures = useFigureHeights(onTable);

  const placed = (m: Model): Model => ({
    ...m,
    position: positions[m.id] ?? m.position,
    z: heights[m.id] ?? m.z,
  });

  // Coherency, with dragged models where they are being held.
  const incoherent = useMemo(() => {
    const bad = new Set<string>();
    for (const u of Object.values(game.units)) {
      for (const id of incoherentModels(aliveModels(game, u).map(placed))) bad.add(id);
    }
    return bad;
  }, [game, positions, heights]); // eslint-disable-line react-hooks/exhaustive-deps

  const onModelDown = (m: Model, shift: boolean) => {
    if (draft?.picking) {
      if (m.unitId && m.unitId !== draft.attackerId)
        setDraft({ ...draft, targetId: m.unitId, picking: false });
      return;
    }
    if (m.unitId) select(m.unitId);
    if (!live || !canControl(m.owner) || view === "eye") return;
    const unit = m.unitId ? game.units[m.unitId] : undefined;
    const ids = shift || !unit ? [m.id] : aliveModels(game, unit).map((x) => x.id);
    const starts: Record<string, Vec2> = {};
    const startZ: Record<string, number> = {};
    for (const id of ids) {
      starts[id] = game.models[id]!.position;
      startZ[id] = game.models[id]!.z ?? 0;
    }
    setDrag({
      kind: "models",
      ids,
      starts,
      startZ,
      grab: m.position,
      to: m.position,
      moved: false,
      planeZ: m.z ?? 0,
      unitId: unit?.id,
    });
  };

  const canEdit = editing && live && useStore.getState().role !== "spectator";
  const onTerrainDown = (piece: TerrainPiece) => {
    if (!canEdit) return;
    setUi({ selectedTerrain: piece.id });
    setDrag({
      kind: "terrain",
      id: piece.id,
      start: piece.position,
      grab: piece.position,
      to: piece.position,
      moved: false,
      planeZ: 0,
    });
  };

  const selectedUnit = selected ? game.units[selected] : undefined;
  const dragUnit = drag?.kind === "models" && drag.unitId ? game.units[drag.unitId] : undefined;
  const control = useMemo(() => objectiveControl(game), [game]);
  const rangeWeapon = draft?.weaponId
    ? game.units[draft.attackerId]?.sheet?.weapons[draft.weaponId]
    : undefined;

  // Line of sight: the attack being set up, or everything a chosen unit can see.
  const sightLines = useMemo(() => {
    const out: { shooter?: Model; target: Model; state: "full" | "partial" | "none" }[] = [];
    const addUnit = (shooters: Model[], target: Unit) => {
      const sight = unitSight(game, shooters, target);
      for (const t of sight.targets) {
        const target = game.models[t.modelId]!;
        const shooter = t.seenBy ? game.models[t.seenBy] : undefined;
        out.push({ shooter, target, state: !t.visible ? "none" : t.fully && !t.cover ? "full" : "partial" });
      }
    };
    if (draft?.targetId && draft.weaponId) {
      const attacker = game.units[draft.attackerId];
      const target = game.units[draft.targetId];
      if (attacker && target) addUnit(carriers(game, attacker, draft.weaponId), target);
    } else if (losFrom) {
      const from = game.units[losFrom];
      if (from)
        for (const u of Object.values(game.units))
          if (u.owner !== from.owner && aliveModels(game, u).length) addUnit(aliveModels(game, from), u);
    }
    return out;
  }, [game, draft, losFrom]);

  const eyeTarget = eye?.at;

  return (
    <>
      {/* Remount on view change so the controls bind to the new camera. */}
      <OrbitControls
        key={`${view}-${eye?.modelId ?? ""}`}
        enabled={!drag}
        enableRotate={view !== "top"}
        maxPolarAngle={view === "eye" ? Math.PI : Math.PI / 2.1}
        target={eyeTarget && view === "eye" ? [eyeTarget.x, eyeTarget.z, eyeTarget.y] : [0, 0, 0]}
        makeDefault
      />
      <mesh
        rotation-x={-Math.PI / 2}
        receiveShadow
        onClick={(e) => {
          if (draft?.picking || e.delta >= 3) return;
          select(null);
          if (editing) setUi({ selectedTerrain: null });
        }}
      >
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#4b5a3a" />
      </mesh>
      <InchGrid width={width} depth={depth} />
      {game.zones.map((z) => (
        <ZoneShape key={z.seat} points={z.points} color={seatColor(game, z.seat)} />
      ))}
      {terrain.map((t) => (
        <Terrain
          key={t.id}
          piece={t}
          xray={xray}
          editable={canEdit}
          selected={editing && t.id === selectedTerrain}
          onDown={() => onTerrainDown(t)}
        />
      ))}
      {game.objectives.map((o) => {
        const c = control.find((x) => x.id === o.id);
        const color = c?.controller ? (game.players[c.controller]?.color ?? "#fff") : "#d4d4d8";
        const position =
          drag?.kind === "objective" && drag.id === o.id
            ? { x: drag.start.x + drag.to.x - drag.grab.x, y: drag.start.y + drag.to.y - drag.grab.y }
            : o.position;
        return (
          <ObjectiveMarker
            key={o.id}
            position={position}
            color={color}
            onDown={
              canEdit
                ? () =>
                    setDrag({
                      kind: "objective",
                      id: o.id,
                      start: o.position,
                      grab: o.position,
                      to: o.position,
                      moved: false,
                      planeZ: 0,
                    })
                : undefined
            }
          />
        );
      })}

      {Object.values(game.models).map((model) => {
        if (model.destroyed) return null;
        if (view === "eye" && eye?.modelId === model.id) return null;
        const owner = game.players[model.owner];
        const isSelected = !!model.unitId && model.unitId === selected;
        return (
          <ModelBase
            key={model.id}
            model={model}
            position={positions[model.id]!}
            z={heights[model.id] ?? 0}
            color={owner?.color ?? "#999"}
            selected={isSelected}
            incoherent={incoherent.has(model.id)}
            targetable={!!draft?.picking && model.unitId !== draft.attackerId}
            unitName={model.unitId ? game.units[model.unitId]?.name : undefined}
            figure={figures[model.id]}
            onDown={(shift) => onModelDown(model, shift)}
          />
        );
      })}

      <Miniatures models={onTable} positions={positions} heights={heights} />

      {/* Where the selected unit started this phase. */}
      {selectedUnit &&
        aliveModels(game, selectedUnit).map((m) => {
          const p = positions[m.id]!;
          const s = m.phaseStart;
          if (
            !s ||
            Math.hypot(p.x - s.x, p.y - s.y) + Math.abs((heights[m.id] ?? 0) - (m.phaseStartZ ?? 0)) < 0.05
          )
            return null;
          return (
            <Ghost key={m.id} from={s} fromZ={m.phaseStartZ ?? 0} to={p} toZ={heights[m.id] ?? 0} model={m} />
          );
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

      {sightLines.map((l, i) => (
        <SightLine key={i} shooter={l.shooter} target={l.target} state={l.state} />
      ))}

      {drag?.moved && dragUnit && (
        <MoveLabel game={game} unitId={dragUnit.id} positions={positions} heights={heights} at={drag.to} />
      )}
      {drag?.moved && drag.kind === "models" && !dragUnit && (
        <SimpleLabel
          at={drag.to}
          text={`${Math.hypot(drag.to.x - drag.grab.x, drag.to.y - drag.grab.y).toFixed(1)}"`}
        />
      )}
    </>
  );
}

const SIGHT_COLORS = { full: "#22c55e", partial: "#facc15", none: "#ef4444" };

/** A sight line from the shooter's eye to the target, or a red ring on an unseen target. */
function SightLine({
  shooter,
  target,
  state,
}: {
  shooter?: Model;
  target: Model;
  state: "full" | "partial" | "none";
}) {
  const color = SIGHT_COLORS[state];
  const line = useMemo(() => {
    if (!shooter) return null;
    const a = [shooter.position.x, (shooter.z ?? 0) + modelHeight(shooter) * 0.9, shooter.position.y];
    const b = [target.position.x, (target.z ?? 0) + modelHeight(target) * 0.5, target.position.y];
    return new Float32Array([...a, ...b]);
  }, [shooter, target]);
  return (
    <>
      <Ring model={target} radius={0.15} color={color} opacity={0.9} />
      {line && (
        <lineSegments raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[line, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={color} transparent opacity={0.7} />
        </lineSegments>
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
  heights,
  at,
}: {
  game: GameState;
  unitId: string;
  positions: Record<string, Vec2>;
  heights: Record<string, number>;
  at: Vec2;
}) {
  const unit = game.units[unitId]!;
  const moved = unitMoved(aliveModels(game, unit), positions, heights);
  const blocked = blockedMoves(game, unit, positions);
  const allowed = moveAllowance(game, unit);
  const deploying = game.turn.round === 0;
  const over = !deploying && allowed !== null && moved > allowed + 0.05;
  const base = deploying ? `${moved.toFixed(1)}"` : `${moved.toFixed(1)}" / ${allowed ?? "?"}"`;
  const text = blocked.length
    ? `${base} · through ${blocked.map((p) => p.name.toLowerCase()).join(", ")}`
    : base;
  return <SimpleLabel at={at} text={text} className={over || blocked.length ? "ruler over" : "ruler"} />;
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

const CATEGORY_COLORS: Record<TerrainPiece["category"], string> = {
  exposed: "#6f6450",
  light: "#6b6257",
  dense: "#3d5a32",
  solid: "#4b4b52",
};

function Terrain({
  piece,
  xray,
  editable,
  selected,
  onDown,
}: {
  piece: TerrainPiece;
  xray: boolean;
  editable: boolean;
  selected: boolean;
  onDown: () => void;
}) {
  const handlers = editable
    ? {
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onDown();
        },
        onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
      }
    : { raycast: () => null };
  const opacity = xray ? 0.2 : 0.95;
  return (
    <group position={[piece.position.x, 0, piece.position.y]} rotation-y={piece.facing}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} receiveShadow {...handlers}>
        <planeGeometry args={[piece.width, piece.depth]} />
        <meshStandardMaterial
          color={selected ? "#a16207" : CATEGORY_COLORS[piece.category]}
          transparent
          opacity={0.8}
        />
      </mesh>
      {piece.solids.map((s, i) =>
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
        <Html position={[0, 0.5, 0]} center className="ruler">
          {piece.name} · {piece.category}
        </Html>
      )}
    </group>
  );
}

function ObjectiveMarker({
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
      position={[model.position.x, (model.z ?? 0) + 0.04, model.position.y]}
      raycast={() => null}
    >
      <ringGeometry args={[r - 0.08, r, 64]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Ghost({
  from,
  fromZ,
  to,
  toZ,
  model,
}: {
  from: Vec2;
  fromZ: number;
  to: Vec2;
  toZ: number;
  model: Model;
}) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.max(width, depth) / 2;
  const line = useMemo(
    () => new Float32Array([from.x, fromZ + 0.06, from.y, to.x, toZ + 0.06, to.y]),
    [from, fromZ, to, toZ],
  );
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[from.x, fromZ + 0.05, from.y]} raycast={() => null}>
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
  z: number;
  color: string;
  selected: boolean;
  incoherent: boolean;
  targetable: boolean;
  unitName?: string;
  /** Height of the uploaded figure standing on this base, if there is one. */
  figure?: number;
  onDown: (shift: boolean) => void;
}

function ModelBase({
  model,
  position,
  z,
  color,
  selected,
  incoherent,
  targetable,
  unitName,
  figure,
  onDown,
}: ModelBaseProps) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.min(width, depth) / 2;
  const rect = model.base.shape === "rect";
  const wounds = maxWounds(model);
  const left = wounds - (model.woundsLost ?? 0);
  // The stand-in is as tall as the model's line-of-sight height.
  const height = figure ?? Math.max(0.3, modelHeight(model) - 0.2);
  const [hover, setHover] = useState(false);
  return (
    <group position={[position.x, z, position.y]} rotation-y={model.facing}>
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
      {/* Stand-in for the miniature until one is uploaded (see Miniatures); the nub shows facing. */}
      {figure !== undefined ? null : rect ? (
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
      {hover && (
        <Html position={[0, height + 1.8, 0]} center className="ruler">
          {unitName && unitName !== model.label ? `${unitName}: ${model.label}` : model.label}
          {wounds > 1 ? ` (${left}/${wounds} W)` : ""}
        </Html>
      )}
      {wounds > 1 && left < wounds && (
        <Html position={[0, height + 0.9, 0]} center className="wounds">
          {`${left}/${wounds}`}
        </Html>
      )}
    </group>
  );
}
