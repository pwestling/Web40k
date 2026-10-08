import { toggleGroup, updatePieces, useTableEdit } from "../tables/edit";
import { Sightlines } from "../tables/Sightlines";
import { FocusCamera } from "./FocusCamera";
import { playerShape } from "../ui/sides";
import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { ShowcaseCamera } from "./ShowcaseCamera";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  Color,
  Plane,
  Raycaster,
  RepeatWrapping,
  Vector2,
  Vector3,
  type Object3D,
} from "three";
import {
  baseSizeInches,
  maxWounds,
  modelHeight,
  settleZ,
  modelAt,
  rulerLength,
  standInHeight,
  footprintVisibility,
  type GameState,
  type Model,
  type Ruler,
  type TerrainPiece,
  type Vec2,
  isBlock,
  blockFrame,
} from "../core";
import {
  aliveModels,
  blockedMoves,
  carriers,
  ENGAGEMENT_RANGE,
  incoherentModels,
  moveAllowance,
  clampFraction,
  num,
  OBJECTIVE_MARKER_MM,
  OBJECTIVE_RANGE,
  objectiveControl,
  unitMoved,
  unitSight,
  type UnitSight,
} from "../systems/wh40k/rules";
import { useCanControl, useStore } from "../store";
import { useGame, useSelfSeat } from "../ui/hooks";
import { Miniatures, useFigureHeights } from "./Miniatures";
import { ModelInstances, type ModelDraw } from "./ModelInstances";
import { Trails, useTween, WatchEffects } from "./Watch";
import { CasterCamera } from "./CasterCamera";
import { Templates } from "./Templates";
import { TerrainModel } from "./TerrainModel";
import { Moment } from "./Moment";
import { TalkLayer } from "./TalkLayer";
import { carry, pickUp, setDown } from "./feel";
import { tick } from "../ui/sound";
import { FeelLayer } from "./FeelLayer";
import { useTalk, type Said } from "../talk/talk";
import { talkOrNote } from "../replay/notes";
import { NotesLayer } from "./NotesLayer";
import { BlockArcs, BlockMoveLabel } from "./Regiment";
import { useAssetSharing } from "../assets/share";
import { unitKeys, useAssets } from "../assets/store";
import { opposed, sidePlayers, zoneSlice } from "../core/teams";

/**
 * World axes: x = table width, z = table depth, y = up. One unit is one inch.
 * Game-state Vec2 {x, y} maps to world (x, 0, y).
 */
export function Board() {
  useAssetSharing();
  return (
    <Canvas shadows>
      <color attach="background" args={["#111318"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[20, 40, 10]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} />
      <Cameras />
      <CameraFit />
      <Scene />
      <FigureDrop />
      {import.meta.env.DEV && <PerfProbe />}
    </Canvas>
  );
}

/** Drop a model file onto a unit on the table to give the whole unit that figure. */
function FigureDrop() {
  const { gl, camera, scene } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(
        new Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      for (const hit of ray.intersectObjects(scene.children, true)) {
        // Model meshes are instanced: userData.modelIds maps instanceId to the model.
        const ids = hit.object.userData.modelIds as string[] | undefined;
        const modelId = ids && hit.instanceId !== undefined ? ids[hit.instanceId] : undefined;
        if (!modelId) continue;
        const { game, select } = useStore.getState();
        const model = game.models[modelId];
        const unit = model?.unitId ? game.units[model.unitId] : undefined;
        const models = unit ? unit.modelIds.flatMap((id) => game.models[id] ?? []) : model ? [model] : [];
        if (unit) select(unit.id);
        if (unit) void useAssets.getState().dressUnit(unit.id, unitKeys(models), file);
        return;
      }
    };
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("drop", drop);
    };
  }, [gl, camera, scene]);
  return null;
}

/** Hands the renderer to the dev perf harness (src/dev/perf.ts). */
function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    void import("../dev/perf").then(({ setPerfRenderer }) => setPerfRenderer(gl, scene));
  }, [gl, scene]);
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
  const reset = useStore((s) => s.cameraReset);
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
  if (view !== "top") {
    // Tuned for a 60" x 44" table; smaller tables (FSD's 36" x 24") bring the camera in.
    const k = Math.max(game.table.width / 60, game.table.depth / 44);
    return (
      <PerspectiveCamera
        key={`${reset}-${game.table.width}x${game.table.depth}`}
        makeDefault
        position={[0, 52 * k, 44 * k * side]}
        fov={45}
      />
    );
  }
  const zoom = Math.min(size.width / game.table.width, size.height / game.table.depth) * 0.85;
  // The tiny z offset keeps the camera's up vector defined and puts the
  // player's own edge at the bottom of the screen.
  return <OrthographicCamera key={reset} makeDefault position={[0, 100, 0.001 * side]} zoom={zoom} />;
}

/** Width the right-hand panel (unit card, attack, terrain editor) takes when open. */
const RIGHT_PANEL = 412;

/**
 * Fit the table into the space between the side panels, by shifting and
 * zooming the camera's view. The right panel is assumed open, so selecting
 * and deselecting units never moves the table; the fit is worked out again
 * only when the view is reset, the left panel opens or closes, or the window
 * resizes, and it eases into place.
 */
function CameraFit() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const view = useStore((s) => s.view);
  const reset = useStore((s) => s.cameraReset);
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  const [left, setLeft] = useState(0);
  // The left panel's edge, checked now and then; it changes only when it is hidden or shown.
  useEffect(() => {
    const measure = () => {
      const l = Math.round(document.querySelector(".hud")?.getBoundingClientRect().right ?? 0);
      setLeft((old) => (Math.abs(old - l) > 40 ? l : old));
    };
    measure();
    const t = setInterval(measure, 500);
    return () => clearInterval(t);
  }, [reset]);
  const target = useMemo(() => {
    if (view === "eye" || !started) return { zoom: 1, centre: size.width / 2 };
    const gap = Math.max(300, size.width - left - RIGHT_PANEL);
    return { zoom: Math.min(1.6, Math.max(1, (size.width * 0.82) / gap)), centre: left + gap / 2 };
  }, [view, started, size.width, left, reset]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useRef({ zoom: 1, centre: size.width / 2 });
  useFrame(() => {
    const cam = camera as Object3D & {
      setViewOffset?: (fw: number, fh: number, x: number, y: number, w: number, h: number) => void;
      updateProjectionMatrix?: () => void;
    };
    if (!cam.setViewOffset) return;
    const c = current.current;
    const done = Math.abs(c.zoom - target.zoom) < 0.001 && Math.abs(c.centre - target.centre) < 0.5;
    if (done && (cam as { view?: { enabled: boolean } }).view?.enabled) return;
    c.zoom += (target.zoom - c.zoom) * 0.15;
    c.centre += (target.centre - c.centre) * 0.15;
    // Render a window `zoom` times the screen, placed so the table centre lands at `centre`.
    const { width: W, height: H } = size;
    const k = c.zoom;
    cam.setViewOffset(W, H, W / 2 - c.centre * k, (H / 2) * (1 - k), W * k, H * k);
    cam.updateProjectionMatrix?.();
  });
  return null;
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
  | { kind: "ruler"; fromModel?: string }
  /** Table talk: an arrow or an area being drawn. */
  | { kind: "talk"; tool: "arrow" | "area" }
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
    hoverUnit,
    hoverModels,
    plates,
    arcs,
    ranges,
    rangeWeapon: shownRangeWeapon,
    set: setUi,
  } = useStore();
  const canControl = useCanControl();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverModel, setHoverModel] = useState<string | null>(null);
  const [templateDrag, setTemplateDrag] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  useLayoutEffect(() => {
    dragRef.current = drag;
  });
  const { camera, gl, size } = useThree();
  const { width, depth } = game.table;
  const cameraReset = useStore((s) => s.cameraReset);
  const live = scrub === null;

  // A drag clears the hover tooltip (and hover rings) until it ends.
  const dragging = drag !== null;
  useEffect(() => {
    if (dragging) setUi({ hoverUnit: null });
  }, [dragging, setUi]);

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
      let to = { x: hit.x, y: hit.z };
      // Alt clamps a unit's move to what it is allowed this phase.
      if (e.altKey && d.kind === "models" && d.unitId) {
        const game = useStore.getState().game;
        const unit = game.units[d.unitId];
        const limit = unit ? moveAllowance(game, unit) : null;
        if (limit !== null) {
          const dx = to.x - d.grab.x;
          const dy = to.y - d.grab.y;
          const s = clampFraction(
            game,
            d.ids,
            (id, k) => {
              const p = { x: d.starts[id]!.x + dx * k, y: d.starts[id]!.y + dy * k };
              return { ...p, z: settleZ(game.terrain, p, d.startZ[id] ?? 0) };
            },
            limit,
          );
          to = { x: d.grab.x + dx * s, y: d.grab.y + dy * s };
        }
      }
      // A regiment block drags straight ahead or back; Shift moves it freely.
      if (d.kind === "models" && d.unitId && !e.shiftKey) {
        const game = useStore.getState().game;
        const unit = game.units[d.unitId];
        const frame = unit && isBlock(unit) && d.ids.length > 1 ? blockFrame(game, unit) : null;
        if (frame) {
          const fx = Math.sin(frame.facing);
          const fy = Math.cos(frame.facing);
          const along = (to.x - d.grab.x) * fx + (to.y - d.grab.y) * fy;
          to = { x: d.grab.x + fx * along, y: d.grab.y + fy * along };
        }
      }
      const moved = d.moved || Math.hypot(to.x - d.grab.x, to.y - d.grab.y) > 0.15;
      if (d.kind === "models") {
        // Picked up once it really moves (a click only selects); then it leans into the carry.
        if (moved && !d.moved) pickUp(d.ids);
        const t = performance.now();
        const last = hand.current;
        if (last && t > last.t)
          carry(((to.x - last.x) * 1000) / (t - last.t), ((to.y - last.y) * 1000) / (t - last.t));
        hand.current = { t, x: to.x, y: to.y };
      }
      setDrag({ ...d, to, moved });
    };
    const drop = () => {
      const d = dragRef.current;
      setDrag(null);
      hand.current = null;
      if (!d || !d.moved) return;
      const dx = d.to.x - d.grab.x;
      const dy = d.to.y - d.grab.y;
      const terrain = useStore.getState().game.terrain;
      if (d.kind === "models") {
        // Set down where they were let go; an over-limit drop knocks duller (advisory only).
        const game = useStore.getState().game;
        const unit = d.unitId ? game.units[d.unitId] : undefined;
        const limit = unit ? moveAllowance(game, unit) : null;
        // How far it has come this phase, as the move label measures it.
        const far = Math.max(
          ...d.ids.map((id) => {
            const from = game.models[id]?.phaseStart ?? d.starts[id]!;
            return Math.hypot(d.starts[id]!.x + dx - from.x, d.starts[id]!.y + dy - from.y);
          }),
        );
        setDown(
          d.ids,
          (id) => {
            const m = game.models[id];
            if (!m) return null;
            const to = { x: d.starts[id]!.x + dx, y: d.starts[id]!.y + dy };
            const { width, depth } = baseSizeInches(m.base);
            return { ...to, z: settleZ(terrain, to, d.startZ[id] ?? 0), radius: Math.max(width, depth) / 2 };
          },
          { dull: limit !== null && far > limit + 0.05 },
        );
      }
      if (d.kind === "talk") {
        talkOrNote(
          d.tool === "arrow"
            ? { kind: "arrow", from: d.grab, to: d.to }
            : { kind: "area", at: d.grab, radius: Math.hypot(dx, dy) },
        );
      } else if (d.kind === "ruler") {
        const game = useStore.getState().game;
        const toModel = modelAt(game, d.to);
        dispatch({
          type: "ruler/set",
          ruler: {
            by: "",
            from: d.grab,
            to: d.to,
            ...(d.fromModel ? { fromModel: d.fromModel } : {}),
            ...(toModel && toModel.id !== d.fromModel ? { toModel: toModel.id } : {}),
          },
        });
      } else if (d.kind === "models" && d.unitId && isBlock(useStore.getState().game.units[d.unitId])) {
        // A regiment moves as one rigid block.
        dispatch({
          type: "unit/move",
          id: d.unitId,
          pivot: d.grab,
          turn: 0,
          delta: { x: dx, y: dy },
          how: "drag",
          distance: Math.hypot(dx, dy),
        });
      } else if (d.kind === "models") {
        dispatch({
          type: "models/move",
          moves: d.ids.map((id) => {
            const to = { x: d.starts[id]!.x + dx, y: d.starts[id]!.y + dy };
            return { id, to, z: settleZ(terrain, to, d.startZ[id] ?? 0) };
          }),
        });
      } else if (d.kind === "terrain") {
        // The piece's group moves with it; with symmetry on, each twin moves the other way (#28).
        const { group } = useTableEdit.getState();
        const ids = group.includes(d.id) ? group : [d.id];
        updatePieces(
          terrain
            .filter((t) => ids.includes(t.id))
            .map((t) => ({
              before: t,
              after: { ...t, position: { x: t.position.x + dx, y: t.position.y + dy } },
            })),
        );
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
  // What is drawn: the same, but eased between moves (watch mode).
  const trailColor = useCallback(
    (id: string) => game.players[game.models[id]?.owner ?? ""]?.color ?? "#e5e7eb",
    [game.players, game.models],
  );
  const { shown, shownZ, trails } = useTween(positions, heights, drag?.kind === "models", trailColor);

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

  const measuring = useStore((s) => s.measuring) && live;
  const tool = useTalk((s) => s.tool);
  // The pointer's last place and time while carrying models, for their lean (feel.ts).
  const hand = useRef<{ t: number; x: number; y: number } | null>(null);
  // Table talk on a spot or a unit: a ping now, or the start of an arrow or area.
  const talkAt = (at: Vec2, unitId?: string) => {
    if (tool === "ping" || !tool) {
      talkOrNote({ kind: "ping", at, ...(unitId ? { unitId } : {}) });
      // One ping per press of the button, so the next click selects as usual (UX 120).
      if (tool) useTalk.setState({ tool: null });
    } else setDrag({ kind: "talk", tool, grab: at, to: at, moved: false, planeZ: 0 });
  };
  const startRuler = (at: Vec2, fromModel?: string) =>
    setDrag({
      kind: "ruler",
      grab: at,
      to: at,
      moved: false,
      planeZ: 0,
      ...(fromModel ? { fromModel } : {}),
    });

  const onModelDown = (m: Model, shift: boolean) => {
    if (tool) {
      talkAt(m.position, m.unitId);
      return;
    }
    if (measuring) {
      startRuler(m.position, m.id);
      return;
    }
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
  const group = useTableEdit((s) => s.group);
  const onTerrainDown = (piece: TerrainPiece, shift: boolean) => {
    if (!canEdit) return;
    // Shift-click: in or out of the group, no drag.
    if (shift) {
      toggleGroup(piece.id, useStore.getState().selectedTerrain);
      return;
    }
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
  // The weapon range shown for the unit a ruler starts from: the attack's weapon, or the shown ranges.
  const rulerRange = (fromModel?: string): number | null => {
    const unitId = fromModel ? game.models[fromModel]?.unitId : undefined;
    if (!unitId) return null;
    if (rangeWeapon?.kind === "ranged" && draft?.attackerId === unitId)
      return num(rangeWeapon.chars.RANGE) ?? null;
    if (ranges !== unitId) return null;
    const ranged = Object.values(game.units[unitId]?.sheet?.weapons ?? {}).filter(
      (w) => w.kind === "ranged" && num(w.chars.RANGE),
    );
    const w =
      ranged.find((x) => x.id === shownRangeWeapon) ??
      ranged.sort((x, y) => num(y.chars.RANGE)! - num(x.chars.RANGE)!)[0];
    return w ? (num(w.chars.RANGE) ?? null) : null;
  };

  // Line of sight: one answer per enemy unit, with lines only to the target in focus
  // (the attack's target, or the enemy unit under the mouse).
  const { sightLines, sightLabels } = useMemo(() => {
    const lines: { shooter?: Model; target: Model; state: "full" | "partial" | "none" }[] = [];
    const labels: {
      unitId: string;
      at: Vec2;
      z: number;
      text: string;
      state: "full" | "partial" | "none";
    }[] = [];
    const addLines = (sight: UnitSight) => {
      for (const t of sight.targets) {
        const target = game.models[t.modelId]!;
        const shooter = t.seenBy ? game.models[t.seenBy] : undefined;
        lines.push({
          shooter,
          target,
          state: !t.visible ? "none" : t.fully && !t.cover ? "full" : "partial",
        });
      }
    };
    if (draft?.targetId && draft.weaponId) {
      const attacker = game.units[draft.attackerId];
      const target = game.units[draft.targetId];
      if (attacker && target) addLines(unitSight(game, carriers(game, attacker, draft.weaponId), target));
    } else if (losFrom) {
      const from = game.units[losFrom];
      if (from)
        for (const u of Object.values(game.units)) {
          const models = aliveModels(game, u);
          if (!opposed(game, u.owner, from.owner) || !models.length) continue;
          const sight = unitSight(game, aliveModels(game, from), u);
          if (u.id === hoverUnit) addLines(sight);
          const n = models.length;
          const text = !sight.visible
            ? "Not visible"
            : `${sight.visible}/${n} visible${sight.inCover ? ` · ${sight.inCover} in cover` : ""}`;
          labels.push({
            unitId: u.id,
            at: {
              x: models.reduce((a, m) => a + m.position.x, 0) / n,
              y: models.reduce((a, m) => a + m.position.y, 0) / n,
            },
            z: Math.max(...models.map((m) => (m.z ?? 0) + modelHeight(m))),
            text,
            state: !sight.visible ? "none" : sight.visible === n && !sight.inCover ? "full" : "partial",
          });
        }
    }
    return { sightLines: lines, sightLabels: labels };
  }, [game, draft, losFrom, hoverUnit]);

  // The camera as last seen, so labels can be laid out on screen. Checked a
  // few times a second; only a real change re-lays them out.
  const [camKey, setCamKey] = useState("");
  useEffect(() => {
    const t = setInterval(() => {
      const key = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements]
        .map((v) => v.toFixed(3))
        .join(",");
      setCamKey((old) => (old === key ? old : key));
    }, 400);
    return () => clearInterval(t);
  }, [camera]);

  // Unit labels, lifted where they would overlap another label on screen.
  const unitLabels = useMemo(() => {
    const sightOf = new Map(sightLabels.map((l) => [l.unitId, l]));
    const out: {
      unitId: string;
      x: number;
      y: number;
      z: number;
      name?: string;
      shape?: string;
      color: string;
      sight?: (typeof sightLabels)[number];
    }[] = [];
    if (view === "eye") return out;
    const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const v = new Vector3();
    const rectAt = (x: number, y: number, z: number, w: number, h: number) => {
      v.set(x, z, y).project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      return { x0: sx - w / 2, x1: sx + w / 2, y0: sy - h / 2, y1: sy + h / 2 };
    };
    const hits = (r: (typeof rects)[number]) =>
      rects.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0);
    for (const u of Object.values(game.units)) {
      const models = aliveModels(game, u);
      const sight = sightOf.get(u.id);
      // The selected block's arcs carry their own labels; its plate would sit on top of them.
      const plate = plates && !(arcs && u.id === selected && isBlock(u));
      if (!models.length || (!plate && !sight)) continue;
      const n = models.length;
      const x = models.reduce((a, m) => a + positions[m.id]!.x, 0) / n;
      const y = models.reduce((a, m) => a + positions[m.id]!.y, 0) / n;
      let z = Math.max(...models.map((m) => (heights[m.id] ?? 0) + modelHeight(m))) + 1;
      // Rough label size in pixels, from its text.
      const chars = Math.max(plate ? u.name.length : 0, sight?.text.length ?? 0);
      const w = chars * 6.4 + 16;
      const h = (plate && sight ? 2 : 1) * 15 + 6;
      let r = rectAt(x, y, z, w, h);
      for (let i = 0; i < 12 && hits(r); i++) {
        z += 0.8;
        r = rectAt(x, y, z, w, h);
      }
      rects.push(r);
      out.push({
        unitId: u.id,
        x,
        y,
        z,
        ...(plate ? { name: u.name } : {}),
        color: game.players[u.owner]?.color ?? "#999",
        shape: playerShape(game, u.owner),
        ...(sight ? { sight } : {}),
      });
    }
    return out;
  }, [game, positions, heights, plates, arcs, selected, sightLabels, view, camKey, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const eyeTarget = eye?.at;
  const eyeUnit = eye ? game.models[eye.modelId]?.unitId : undefined;

  // Every model on the table as drawn this frame (dragged ones where they're held).
  const modelDraws = useMemo(
    () =>
      Object.values(game.models).flatMap((model): ModelDraw[] => {
        if (model.destroyed) return [];
        // In a model's eye view, its own unit is hidden so it doesn't block the view.
        if (view === "eye" && eyeUnit && (eye?.modelId === model.id || model.unitId === eyeUnit)) return [];
        const figure = figures[model.id];
        return [
          {
            model,
            position: shown[model.id] ?? positions[model.id]!,
            z: shownZ[model.id] ?? heights[model.id] ?? 0,
            // Waiting in reserve: faded, so it doesn't read as deployed.
            color: faded(
              game.players[model.owner]?.color ?? "#999",
              !!(model.unitId && game.units[model.unitId]?.status?.reserves),
            ),
            // The stand-in is as tall as the model's line-of-sight height.
            height: figure ?? Math.max(0.3, modelHeight(model) - 0.2),
            dressed: figure !== undefined,
            targetable: !!draft?.picking && model.unitId !== draft.attackerId,
          },
        ];
      }),
    [
      game.models,
      game.players,
      game.units,
      view,
      eyeUnit,
      eye,
      figures,
      shown,
      positions,
      shownZ,
      heights,
      draft,
    ],
  );

  return (
    <>
      {/* Remount on view change so the controls bind to the new camera. */}
      <OrbitControls
        key={`${view}-${eye?.modelId ?? ""}-${cameraReset}-${width}x${depth}`}
        enabled={!drag && !templateDrag}
        enableRotate={view !== "top"}
        // Never lower than about 25 degrees above the table, so the camera can't end up level with it.
        maxPolarAngle={view === "eye" ? Math.PI : (65 * Math.PI) / 180}
        maxDistance={view === "eye" ? undefined : 140}
        onChange={(e) => {
          if (view === "eye" || !e) return;
          // Keep the point the camera looks at over the table.
          const c = e.target;
          const tx = Math.max(-width / 2, Math.min(width / 2, c.target.x));
          const tz = Math.max(-depth / 2, Math.min(depth / 2, c.target.z));
          const dx = tx - c.target.x;
          const dz = tz - c.target.z;
          if (dx || dz) {
            c.target.set(tx, c.target.y, tz);
            c.object.position.x += dx;
            c.object.position.z += dz;
          }
        }}
        target={eyeTarget && view === "eye" ? [eyeTarget.x, eyeTarget.z, eyeTarget.y] : [0, 0, 0]}
        makeDefault
      />
      <mesh
        rotation-x={-Math.PI / 2}
        receiveShadow
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Alt-click pings a spot whatever else is going on.
          if (tool || e.altKey) {
            e.stopPropagation();
            talkAt({ x: e.point.x, y: e.point.z });
            return;
          }
          if (!measuring) return;
          e.stopPropagation();
          startRuler({ x: e.point.x, y: e.point.z });
        }}
        onClick={(e) => {
          if (tool || e.altKey || measuring || draft?.picking || e.delta >= 3) return;
          select(null);
          if (editing) setUi({ selectedTerrain: null });
        }}
      >
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#4b5a3a" />
      </mesh>
      <InchGrid width={width} depth={depth} />
      {(editing || game.turn.round === 0) && <Sightlines game={game} />}
      {/* In a team game each teammate's share of the side's zone shows in their own colour. */}
      {game.zones.flatMap((z) => {
        const team = sidePlayers(game, z.seat);
        return team.length > 1
          ? team.map((p, i) => (
              <ZoneShape
                key={`${z.seat}-${p.id}`}
                points={zoneSlice(z.points, i, team.length)}
                color={p.color}
              />
            ))
          : [<ZoneShape key={z.seat} points={z.points} color={seatColor(game, z.seat)} />];
      })}
      {terrain.map((t) => (
        <Terrain
          key={t.id}
          piece={t}
          xray={xray}
          editable={canEdit}
          selected={editing && t.id === selectedTerrain}
          footprint={game.settings.los === "footprint" ? footprintVisibility(t) : null}
          standIn={
            (t.sight ?? game.settings.los) === "heights" && (xray || editing) ? standInHeight(t) : null
          }
          grouped={editing && group.includes(t.id)}
          onDown={(shift) => onTerrainDown(t, shift)}
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

      <ModelInstances
        draws={modelDraws}
        hovered={drag ? null : hoverModel}
        onDown={(model, shift) => onModelDown(model, shift)}
        onHover={(model) => {
          // No hover tooltips mid-drag: they would sit on the drag's own label.
          if (dragRef.current) return;
          setHoverModel(model?.id ?? null);
          setUi({ hoverUnit: model?.unitId ?? null });
        }}
      />
      {modelDraws.map((d) =>
        (d.model.id === hoverModel && !drag) ||
        (!!d.model.unitId && d.model.unitId === selected) ||
        incoherent.has(d.model.id) ||
        (d.model.woundsLost ?? 0) > 0 ? (
          <ModelOverlay
            key={d.model.id}
            draw={d}
            selected={!!d.model.unitId && d.model.unitId === selected}
            incoherent={incoherent.has(d.model.id)}
            hover={d.model.id === hoverModel && !drag}
            unitName={d.model.unitId ? game.units[d.model.unitId]?.name : undefined}
          />
        ) : null,
      )}

      <Miniatures models={onTable} positions={shown} heights={shownZ} />
      <Trails trails={trails} />
      <WatchEffects />
      <Moment />
      {/* One label per unit: its name plate, with the line of sight answer as a second line. */}
      {unitLabels.map((l) => (
        <Html
          zIndexRange={LABEL_Z}
          key={`plate-${l.unitId}`}
          position={[l.x, l.z, l.y]}
          center
          className="plate"
          style={{ borderColor: l.color }}
        >
          {l.name && (
            <div>
              <span className="side-shape" style={{ color: l.color }} aria-hidden="true">
                {l.shape}
              </span>{" "}
              {l.name}
            </div>
          )}
          {l.sight && <div className={`sightlabel ${l.sight.state}`}>{l.sight.text}</div>}
        </Html>
      ))}
      {hoverUnit &&
        game.units[hoverUnit] &&
        aliveModels(game, game.units[hoverUnit]).map((m) => (
          <Ring key={`hover-${m.id}`} model={placed(m)} radius={0.12} color="#e5e7eb" opacity={0.8} />
        ))}

      {hoverModels?.flatMap((id) => {
        const m = game.models[id];
        return m && !m.destroyed
          ? [<Ring key={`point-${id}`} model={placed(m)} radius={0.2} color="#facc15" opacity={0.95} />]
          : [];
      })}

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
          .filter((m) => !m.destroyed && opposed(game, m.owner, dragUnit.owner))
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

      <TalkLayer game={game} preview={talkPreview(drag, game)} />
      <NotesLayer />
      <FeelLayer />
      <CasterCamera />
      <ShowcaseCamera />
      <FocusCamera />

      {/* The ruler being dragged, else the last one shared. */}
      {drag?.kind === "ruler" && drag.moved ? (
        <RulerLine
          game={game}
          range={rulerRange(drag.fromModel)}
          ruler={{
            by: "",
            from: drag.grab,
            to: drag.to,
            ...(drag.fromModel ? { fromModel: drag.fromModel } : {}),
            ...(modelAt(game, drag.to) && modelAt(game, drag.to)!.id !== drag.fromModel
              ? { toModel: modelAt(game, drag.to)!.id }
              : {}),
          }}
        />
      ) : (
        game.ruler && <RulerLine game={game} ruler={game.ruler} range={rulerRange(game.ruler.fromModel)} />
      )}

      {/* One outline per range around the whole chosen unit: its move and a weapon's range. */}
      {ranges &&
        game.units[ranges] &&
        (() => {
          const unit = game.units[ranges]!;
          const models = aliveModels(game, unit).map(placed);
          const move = moveAllowance(game, unit);
          const ranged = Object.values(unit.sheet?.weapons ?? {}).filter(
            (w) => w.kind === "ranged" && num(w.chars.RANGE),
          );
          const weapon =
            ranged.find((w) => w.id === shownRangeWeapon) ??
            ranged.reduce<(typeof ranged)[number] | undefined>(
              (best, w) => (!best || num(w.chars.RANGE)! > num(best.chars.RANGE)! ? w : best),
              undefined,
            );
          const carriers = weapon ? models.filter((m) => m.weapons?.includes(weapon.id)) : [];
          return (
            <>
              {move !== null && (
                <RangeOutline models={models} range={move} color="#38bdf8" label={`Move ${move}"`} />
              )}
              {weapon && carriers.length > 0 && (
                <RangeOutline
                  models={carriers}
                  range={num(weapon.chars.RANGE)!}
                  color="#facc15"
                  label={`${weapon.name} ${num(weapon.chars.RANGE)}"`}
                />
              )}
            </>
          );
        })()}

      {sightLines.map((l, i) => (
        <SightLine key={i} shooter={l.shooter} target={l.target} state={l.state} />
      ))}

      <BlockArcs />
      <Templates onDragging={setTemplateDrag} />
      {drag?.moved && dragUnit && isBlock(dragUnit) && (
        <BlockMoveLabel game={game} unit={dragUnit} grab={drag.grab} at={drag.to} />
      )}
      {drag?.moved && dragUnit && !isBlock(dragUnit) && (
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

/**
 * The outline of everywhere within `range` of any of the models' bases: the
 * outer edge of the union of their circles, with one label.
 */
function RangeOutline({
  models,
  range,
  color,
  label,
}: {
  models: Model[];
  range: number;
  color: string;
  label: string;
}) {
  const { segments, at } = useMemo(() => {
    const circles = models.map((m) => {
      const { width, depth } = baseSizeInches(m.base);
      return { x: m.position.x, y: m.position.y, z: m.z ?? 0, r: Math.max(width, depth) / 2 + range };
    });
    const inside = (x: number, y: number, skip: number) =>
      circles.some((c, i) => i !== skip && Math.hypot(x - c.x, y - c.y) < c.r - 1e-3);
    const pts: number[] = [];
    let at = { x: 0, y: -Infinity, z: 0 };
    const N = 96;
    circles.forEach((c, i) => {
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2;
        const a1 = ((k + 1) / N) * Math.PI * 2;
        const p0 = { x: c.x + Math.cos(a0) * c.r, y: c.y + Math.sin(a0) * c.r };
        const p1 = { x: c.x + Math.cos(a1) * c.r, y: c.y + Math.sin(a1) * c.r };
        if (inside(p0.x, p0.y, i) || inside(p1.x, p1.y, i)) continue;
        pts.push(p0.x, c.z + 0.06, p0.y, p1.x, c.z + 0.06, p1.y);
        if (p0.y > at.y) at = { x: p0.x, y: p0.y, z: c.z };
      }
    });
    return { segments: new Float32Array(pts), at };
  }, [models, range]);
  if (!segments.length) return null;
  return (
    <>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[segments, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <Html
        zIndexRange={LABEL_Z}
        position={[at.x, at.z + 0.4, at.y]}
        center
        className="ruler"
        style={{ color }}
      >
        {label}
      </Html>
    </>
  );
}

/** A measuring line with its length, in the colour of whoever measured. */
function RulerLine({ game, ruler, range }: { game: GameState; ruler: Ruler; range?: number | null }) {
  const a = ruler.fromModel ? game.models[ruler.fromModel] : undefined;
  const b = ruler.toModel ? game.models[ruler.toModel] : undefined;
  const from = a?.position ?? ruler.from;
  const to = b?.position ?? ruler.to;
  const za = (a?.z ?? 0) + 0.3;
  const zb = (b?.z ?? 0) + 0.3;
  const line = useMemo(
    () => new Float32Array([from.x, za, from.y, to.x, zb, to.y]),
    [from.x, from.y, to.x, to.y, za, zb],
  );
  const color = game.players[ruler.by]?.color ?? "#e5e7eb";
  const length = rulerLength(game, ruler);
  // Against a weapon's range shown for the measuring unit: how far in or out (a measurement, not odds).
  const short = range ? Number((range - length).toFixed(1)) : null;
  return (
    <>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[line, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <Html
        zIndexRange={LABEL_Z}
        position={[(from.x + to.x) / 2, Math.max(za, zb) + 0.6, (from.y + to.y) / 2]}
        center
        className={short !== null && Math.abs(short) <= 0.5 ? "ruler near" : "ruler"}
        style={{ borderBottom: `2px solid ${color}` }}
      >
        {`${length.toFixed(1)}"`}
        {a || b ? " base to base" : ""}
        {short !== null &&
          (short >= 0 ? ` · in by ${short.toFixed(1)}"` : ` · out by ${(-short).toFixed(1)}"`)}
      </Html>
    </>
  );
}

/** Labels over the table stay under the UI panels (z-index 20 and up). */
const LABEL_Z: [number, number] = [9, 0];

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
    Object.values(game.players).find((p) => p.seat === seat)?.color ?? (seat === 0 ? "#3b82f6" : "#f97316")
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
  // Within half an inch of the limit, the label gets tense (PX-3e).
  const near = !deploying && !over && allowed !== null && moved >= allowed - 0.5;
  useTapeTicks(near ? moved : null);
  const base = deploying ? `${moved.toFixed(1)}"` : `${moved.toFixed(1)}" / ${allowed ?? "?"}"`;
  const text = blocked.length
    ? `${base} · through ${blocked.map((p) => p.name.toLowerCase()).join(", ")}`
    : base;
  return (
    <SimpleLabel
      at={at}
      text={text}
      className={over || blocked.length ? "ruler over" : near ? "ruler near" : "ruler"}
    />
  );
}

function SimpleLabel({ at, text, className = "ruler" }: { at: Vec2; text: string; className?: string }) {
  return (
    <Html zIndexRange={LABEL_Z} position={[at.x, 2.5, at.y]} center className={className}>
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

export const FOOTPRINT_COLORS = { open: "#e5e7eb", obscuring: "#facc15", blocking: "#ef4444" };

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

function Terrain({
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

/** Rings and labels for one model, drawn only while something needs showing. */
function ModelOverlay({
  draw,
  selected,
  incoherent,
  hover,
  unitName,
}: {
  draw: ModelDraw;
  selected: boolean;
  incoherent: boolean;
  hover: boolean;
  unitName?: string;
}) {
  const { model, position, z, height } = draw;
  const { width, depth } = baseSizeInches(model.base);
  const wounds = maxWounds(model);
  const left = wounds - (model.woundsLost ?? 0);
  return (
    <group position={[position.x, z, position.y]} rotation-y={model.facing}>
      {(selected || incoherent) && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03} raycast={() => null}>
          <ringGeometry args={[Math.max(width, depth) / 2 + 0.05, Math.max(width, depth) / 2 + 0.25, 40]} />
          <meshBasicMaterial color={incoherent ? "#ef4444" : "#fde047"} />
        </mesh>
      )}
      {hover && (
        <Html zIndexRange={LABEL_Z} position={[0, height + 1.8, 0]} center className="ruler">
          {unitName && unitName !== model.label ? `${unitName}: ${model.label}` : model.label}
          {wounds > 1 ? ` (${left}/${wounds} W)` : ""}
        </Html>
      )}
      {wounds > 1 && left < wounds && (
        <Html zIndexRange={LABEL_Z} position={[0, height + 0.9, 0]} center className="wounds">
          {`${left}/${wounds}`}
        </Html>
      )}
    </group>
  );
}

/** The arrow or area being drawn, in this player's colour. */
function talkPreview(drag: Drag | null, game: ReturnType<typeof useGame>): Said | null {
  if (drag?.kind !== "talk" || !drag.moved) return null;
  const self = useStore.getState().session?.selfId ?? "";
  const color = game.players[self]?.color ?? "#a1a1aa";
  const base = { id: "draft", by: self, name: "", color, sentAt: Date.now() };
  return drag.tool === "arrow"
    ? { ...base, kind: "arrow", from: drag.grab, to: drag.to }
    : {
        ...base,
        kind: "area",
        at: drag.grab,
        radius: Math.hypot(drag.to.x - drag.grab.x, drag.to.y - drag.grab.y),
      };
}

const fadedCache = new Map<string, string>();
/** A colour washed towards the table's dark grey. */
function faded(color: string, on: boolean): string {
  if (!on) return color;
  let out = fadedCache.get(color);
  if (!out) {
    out = `#${new Color(color).lerp(new Color("#3f3f46"), 0.65).getHexString()}`;
    fadedCache.set(color, out);
  }
  return out;
}

/** A soft tape-measure tick for each tenth of an inch crossed near the limit (quiet; off when muted). */
function useTapeTicks(moved: number | null) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (moved === null) {
      last.current = null;
      return;
    }
    const tenth = Math.floor(moved * 10);
    if (last.current !== null && tenth !== last.current) tick();
    last.current = tenth;
  }, [moved]);
}
