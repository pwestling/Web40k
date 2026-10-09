import { toggleGroup, updatePieces, useTableEdit } from "../tables/edit";
import { Sightlines } from "../tables/Sightlines";
import { FocusCamera } from "./FocusCamera";
import { TableOnScreen } from "./TableOnScreen";
import { playerShape } from "../ui/sides";
import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { ShowcaseCamera } from "./ShowcaseCamera";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plane, Raycaster, Vector2, Vector3, type Object3D } from "three";
import {
  baseSizeInches,
  modelHeight,
  settleZ,
  modelAt,
  standInHeight,
  footprintVisibility,
  type Model,
  type TerrainPiece,
  type Vec2,
  isBlock,
  blockFrame,
} from "../core";
import {
  aliveModels,
  carriers,
  ENGAGEMENT_RANGE,
  incoherentModels,
  moveAllowance,
  clampFraction,
  num,
  OBJECTIVE_MARKER_MM,
  OBJECTIVE_RANGE,
  objectiveControl,
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
import { Moment } from "./Moment";
import { setTableCanvas } from "../share/capture";
import { displayName } from "../i18n/names";
import { Lanterns, type LanternItem } from "./Lanterns";
import { TalkLayer } from "./TalkLayer";
import { carry, pickUp, setDown } from "./feel";
import { FeelLayer } from "./FeelLayer";
import { useTalk, type Said } from "../talk/talk";
import { talkOrNote } from "../replay/notes";
import { NotesLayer } from "./NotesLayer";
import { BlockArcs, BlockMoveLabel } from "./Regiment";
import { useAssetSharing } from "../assets/share";
import { unitKeys, useAssets } from "../assets/store";
import { opposed, sidePlayers, zoneSlice } from "../core/teams";
import { t } from "../i18n";
import {
  RangeOutline,
  RulerLine,
  LABEL_Z,
  SightLine,
  seatColor,
  MoveLabel,
  SimpleLabel,
} from "./boardLabels";
import { InchGrid, ZoneShape, Terrain, ObjectiveMarker } from "./TablePieces";
import { Ring, Ghost, ModelOverlay, faded } from "./ModelOverlay";

/**
 * World axes: x = table width, z = table depth, y = up. One unit is one inch.
 * Game-state Vec2 {x, y} maps to world (x, 0, y).
 */
export function Board() {
  useAssetSharing();
  useEffect(() => () => setTableCanvas(null), []);
  return (
    <Canvas
      shadows
      // Checking every shader's compile log waits on the GPU, a third of a second on a phone at
      // start (perf/results.md); development keeps the check, where a broken shader shows.
      onCreated={({ gl }) => {
        gl.debug.checkShaderErrors = import.meta.env.DEV;
        // Shared as pictures and clips (src/share, #46).
        setTableCanvas(gl.domElement);
      }}
    >
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
  // Rebuilt (reset) only when the screen turns between tall and wide, not on every resize.
  const narrow = size.width < size.height;
  // Tuned for a 60" x 44" table; smaller tables (FSD's 36" x 24") bring the camera in. A tall,
  // narrow screen (a phone) sees less across: back off until the width fits, so both deployment
  // strips are in the opening view (UX 327). 28.2 is the half-width seen at k = 1.
  const k = useMemo(() => {
    const k0 = Math.max(game.table.width / 60, game.table.depth / 44);
    const across = 28.2 * k0 * (size.width / Math.max(1, size.height));
    return k0 * Math.max(1, (game.table.width * 0.52) / across);
  }, [narrow, reset, game.table.width, game.table.depth]); // eslint-disable-line react-hooks/exhaustive-deps
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
    return (
      <PerspectiveCamera
        key={`${reset}-${game.table.width}x${game.table.depth}-${narrow ? "n" : "w"}`}
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
/** Below this width the panels are sheets (styles.css). */
const PHONE_WIDTH = 700;

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
    // On a phone the card is a sheet over the table, so there is no side panel to fit around.
    if (size.width < PHONE_WIDTH) return { zoom: 1, centre: size.width / 2 };
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
    (id: string) => {
      const m = game.models[id];
      // Going into reserve or arriving from it isn't a move across the table: no trail (UX 268).
      const status = m?.unitId ? game.units[m.unitId]?.status : undefined;
      if (status?.reserves || status?.arrived) return null;
      return game.players[m?.owner ?? ""]?.color ?? "#e5e7eb";
    },
    [game.players, game.models, game.units],
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
  // Lantern objectives (Rift Lanterns) draw together, in the holder's colour, pale when contested.
  const draggedObjective = drag?.kind === "objective" ? drag : null;
  const lanterns = useMemo<LanternItem[]>(
    () =>
      game.objectives
        .filter((o) => o.look === "lantern")
        .map((o) => {
          const c = control.find((x) => x.id === o.id);
          const d = draggedObjective?.id === o.id ? draggedObjective : null;
          const holder = c?.controller ? game.players[c.controller] : undefined;
          const contested = !c?.controller && Object.values(c?.oc ?? {}).filter((v) => v > 0).length > 1;
          return {
            id: o.id,
            position: d ? { x: d.start.x + d.to.x - d.grab.x, y: d.start.y + d.to.y - d.grab.y } : o.position,
            color: holder?.color ?? null,
            contested,
            label: o.label
              ? holder
                ? t("{label}: held by {player}", { label: o.label, player: displayName(holder.name) })
                : contested
                  ? t("{label}: contested", { label: o.label })
                  : t("{label}: nobody holds it", { label: o.label })
              : null,
          };
        }),
    [game.objectives, game.players, control, draggedObjective],
  );
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
            ? t("Not visible")
            : sight.inCover
              ? t("{visible}/{n} visible · {cover} in cover", {
                  visible: sight.visible,
                  n,
                  cover: sight.inCover,
                })
              : t("{visible}/{n} visible", { visible: sight.visible, n });
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
        if (o.look === "lantern") return null;
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

      <Lanterns
        items={lanterns}
        reach={OBJECTIVE_MARKER_MM / 25.4 / 2 + OBJECTIVE_RANGE}
        onDown={
          canEdit
            ? (id) => {
                const o = game.objectives.find((x) => x.id === id);
                if (o)
                  setDrag({
                    kind: "objective",
                    id,
                    start: o.position,
                    grab: o.position,
                    to: o.position,
                    moved: false,
                    planeZ: 0,
                  });
              }
            : undefined
        }
      />

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
      <TableOnScreen />

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
                <RangeOutline
                  models={models}
                  range={move}
                  // A colour, not words. i18n-ignore
                  color="#38bdf8"
                  label={t('Move {inches}"', { inches: move })}
                />
              )}
              {weapon && carriers.length > 0 && (
                <RangeOutline
                  models={carriers}
                  range={num(weapon.chars.RANGE)!}
                  // A colour, not words. i18n-ignore
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
