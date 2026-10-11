import { toggleGroup, updatePieces, useTableEdit } from "../tables/edit";
import { tableDrag } from "./dragging";
import { Sightlines } from "../tables/Sightlines";
import { FocusCamera } from "./FocusCamera";
import { TtsKeys } from "./TtsKeys";
import { TableOnScreen } from "./TableOnScreen";
import { playerShape } from "../ui/sides";
import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { ShowcaseCamera } from "./ShowcaseCamera";
import { openingPosition, openingScale } from "./openingView";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MOUSE, Plane, Raycaster, TOUCH, Vector2, Vector3, type Camera, type Object3D } from "three";
import { pointerModel, removeAsCasualties, useTtsControls } from "../ui/ttsControls";
import { doTableVerb, tableVerb } from "../ui/tableVerbs";
import { tablePick, useHandTargets } from "../ui/tablePick";
import { MAX_CORNERS, movedSoFar } from "../core/path";
import type { GameState } from "../core";
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
import { MAX_LINE, useTalk, type Said } from "../talk/talk";
import { HOLD_MS, SLOP_PX, STILL_PX, useTouch } from "./touchState";
import { turnByTwist } from "./touchTurn";
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

/**
 * Drop a model file onto a unit on the table to give the whole unit that figure;
 * also tells the page what's under a screen point (`tablePick`, for the stratagem hand).
 */
function FigureDrop() {
  const { gl, camera, scene } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const modelAt = (x: number, y: number): string | null => {
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(
        new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1),
        camera,
      );
      for (const hit of ray.intersectObjects(scene.children, true)) {
        // Model meshes are instanced: userData.modelIds maps instanceId to the model.
        const ids = hit.object.userData.modelIds as string[] | undefined;
        const modelId = ids && hit.instanceId !== undefined ? ids[hit.instanceId] : undefined;
        if (modelId) return modelId;
      }
      return null;
    };
    const onCanvas = (x: number, y: number) => document.elementFromPoint(x, y) === el;
    tablePick.unitAt = (x, y) => {
      if (!onCanvas(x, y)) return null;
      const id = modelAt(x, y);
      return (id && useStore.getState().game.models[id]?.unitId) || null;
    };
    tablePick.onTable = onCanvas;
    tablePick.screenOf = (unitId) => {
      const { game } = useStore.getState();
      const models = (game.units[unitId]?.modelIds ?? []).flatMap((id) => {
        const m = game.models[id];
        return m && !m.destroyed ? [m] : [];
      });
      if (!models.length) return null;
      const at = new Vector3(
        models.reduce((n, m) => n + m.position.x, 0) / models.length,
        1,
        models.reduce((n, m) => n + m.position.y, 0) / models.length,
      ).project(camera);
      if (at.z > 1 || Math.abs(at.x) > 1 || Math.abs(at.y) > 1) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + ((at.x + 1) / 2) * rect.width, y: rect.top + ((1 - at.y) / 2) * rect.height };
    };
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      const modelId = modelAt(e.clientX, e.clientY);
      if (!modelId) return;
      const { game, select } = useStore.getState();
      const model = game.models[modelId];
      const unit = model?.unitId ? game.units[model.unitId] : undefined;
      const models = unit ? unit.modelIds.flatMap((id) => game.models[id] ?? []) : model ? [model] : [];
      if (unit) select(unit.id);
      if (unit) void useAssets.getState().dressUnit(unit.id, unitKeys(models), file);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    return () => {
      tablePick.unitAt = () => null;
      tablePick.onTable = () => false;
      tablePick.screenOf = () => null;
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
  // Upright screens differ a lot in shape (a tablet, a phone): each gets its own fit.
  const shape = Math.round((size.width / Math.max(1, size.height)) * 20);
  const k = useMemo(
    () => openingScale(game.table.width, game.table.depth, size.width, size.height),
    [narrow, narrow && shape, reset, game.table.width, game.table.depth], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
        key={`${reset}-${game.table.width}x${game.table.depth}-${narrow ? `n${shape}` : "w"}`}
        makeDefault
        position={openingPosition(k, narrow, side)}
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
    const middle = size.height / 2;
    if (view === "eye" || !started) return { zoom: 1, centre: size.width / 2, middle };
    // An upright phone's unit card is a sheet over the lower half, right where your own units stand: the
    // table sits in the upper part instead, so a selected unit can still be dragged (dogfood round 2).
    if (size.width < PHONE_WIDTH && size.width < size.height)
      return { zoom: 1, centre: size.width / 2, middle: size.height * 0.36 };
    // On a phone the card is a sheet over the table, so there is no side panel to fit around; a tablet held
    // upright has no room beside the table either, so the card sits over it there too (UX 420).
    if (size.width < PHONE_WIDTH || size.width < size.height)
      return { zoom: 1, centre: size.width / 2, middle };
    const gap = Math.max(300, size.width - left - RIGHT_PANEL);
    return { zoom: Math.min(1.6, Math.max(1, (size.width * 0.82) / gap)), centre: left + gap / 2, middle };
  }, [view, started, size.width, size.height, left, reset]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useRef({ zoom: 1, centre: size.width / 2, middle: size.height / 2 });
  useFrame(() => {
    const cam = camera as Object3D & {
      setViewOffset?: (fw: number, fh: number, x: number, y: number, w: number, h: number) => void;
      updateProjectionMatrix?: () => void;
    };
    if (!cam.setViewOffset) return;
    const c = current.current;
    const done =
      Math.abs(c.zoom - target.zoom) < 0.001 &&
      Math.abs(c.centre - target.centre) < 0.5 &&
      Math.abs(c.middle - target.middle) < 0.5;
    if (done && (cam as { view?: { enabled: boolean } }).view?.enabled) return;
    c.zoom += (target.zoom - c.zoom) * 0.15;
    c.centre += (target.centre - c.centre) * 0.15;
    c.middle += (target.middle - c.middle) * 0.15;
    // Render a window `zoom` times the screen, placed so the table centre lands at (`centre`, `middle`).
    const { width: W, height: H } = size;
    const k = c.zoom;
    cam.setViewOffset(W, H, W / 2 - c.centre * k, H / 2 - c.middle * k, W * k, H * k);
    cam.updateProjectionMatrix?.();
  });
  return null;
}

type Drag = {
  grab: Vec2;
  to: Vec2;
  moved: boolean;
  /** The unit actually under the press, when it was steered to the selected unit (UX 435). */
  tapped?: string;
  /** Height of the plane the pointer is tracked on (the grabbed model's floor). */
  planeZ: number;
} & (
  | {
      kind: "models";
      ids: string[];
      starts: Record<string, Vec2>;
      startZ: Record<string, number>;
      unitId?: string;
      /** Corners turned on this drag (Space, right-click, a second finger), where the pointer was. */
      corners: Vec2[];
    }
  | { kind: "terrain" | "objective"; id: string; start: Vec2 }
  /** `held`: started by a long press (#60); let go without moving, it opens the press's menu instead. */
  | { kind: "ruler"; fromModel?: string; held?: boolean; client?: Vec2 }
  /** Table talk: an arrow or an area being drawn; a freehand line with a stylus (#60). */
  | { kind: "talk"; tool: "arrow" | "area" }
  | { kind: "stroke"; points: Vec2[] }
  /** Select several (#60): a box drawn with a finger, from this client point. */
  | { kind: "box"; from: Vec2 }
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
  // For the canvas's own listeners, set up once: who may move what changes as seats are taken (PX re-check of #60).
  const canControlNow = useRef(canControl);
  useEffect(() => {
    canControlNow.current = canControl;
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  // TTS controls (PX): left drag picks with a box, right drag turns the camera.
  const tts = useTtsControls((s) => s.on);
  const [hoverModel, setHoverModel] = useState<string | null>(null);
  const [templateDrag, setTemplateDrag] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  useLayoutEffect(() => {
    dragRef.current = drag;
  });
  const { camera, gl, size } = useThree();
  // A game opens with the keyboard on the table, not the score steppers (PX TTS): arrows, Enter and (with TTS
  // controls) Tab work there. The front door's backdrop isn't a stop at all.
  const inGame = useStore((s) => s.session !== null);
  useEffect(() => {
    gl.domElement.setAttribute("tabindex", inGame ? "0" : "-1");
    gl.domElement.setAttribute("aria-label", t("The table"));
    const el = document.activeElement;
    if (inGame && (!el || el === document.body)) gl.domElement.focus({ preventScroll: true });
  }, [gl, inGame]);
  const controls = useThree((s) => s.controls) as {
    enabled?: boolean;
    getAzimuthalAngle?: () => number;
    setAzimuthalAngle?: (a: number) => void;
    update?: () => void;
  } | null;
  // Fingers on the table now, and a twist on a unit in progress (#60).
  const touchCount = useRef(0);
  // The model a finger came down on, if any: a long press there measures from it, or opens its unit's menu.
  const pressedModel = useRef<string | null>(null);
  const twisting = useTouch((s) => s.twist !== null);
  const { width, depth } = game.table;
  const cameraReset = useStore((s) => s.cameraReset);
  const live = scrub === null;

  // A drag clears the hover tooltip (and hover rings) until it ends.
  const dragging = drag !== null;
  useEffect(() => {
    tableDrag.active = dragging;
    if (dragging) setUi({ hoverUnit: null });
  }, [dragging, setUi]);

  // The pointer's last press, move and lift, always: a drag's listeners catch up from them.
  const recent = useRef<{ down: number; move: PointerEvent | null; up: PointerEvent | null }>({
    down: 0,
    move: null,
    up: null,
  });
  useEffect(() => {
    const down = (e: PointerEvent) => (recent.current = { down: e.timeStamp, move: null, up: null });
    const move = (e: PointerEvent) => (recent.current.move = e);
    const up = (e: PointerEvent) => (recent.current.up = e);
    window.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("pointermove", move, { capture: true });
    window.addEventListener("pointerup", up, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointermove", move, { capture: true });
      window.removeEventListener("pointerup", up, { capture: true });
    };
  }, []);

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
          // From the last corner turned, if any: the legs before it stand.
          const base = d.corners.at(-1) ?? d.grab;
          const dx = to.x - base.x;
          const dy = to.y - base.y;
          const s = clampFraction(
            game,
            d.ids,
            (id, k) => {
              const p = {
                x: d.starts[id]!.x + base.x - d.grab.x + dx * k,
                y: d.starts[id]!.y + base.y - d.grab.y + dy * k,
              };
              return { ...p, z: settleZ(game.terrain, p, d.startZ[id] ?? 0) };
            },
            limit,
            (id) => dragVia(game, d, id),
          );
          to = { x: base.x + dx * s, y: base.y + dy * s };
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
      if (d.kind === "box") {
        useTouch.setState({ box: { x0: d.from.x, y0: d.from.y, x1: e.clientX, y1: e.clientY } });
      }
      if (d.kind === "stroke") {
        const last = d.points.at(-1)!;
        if (Math.hypot(to.x - last.x, to.y - last.y) > 0.25 && d.points.length < MAX_LINE)
          return setDrag((dragRef.current = { ...d, to, moved, points: [...d.points, to] }));
      }
      if (d.kind === "models") {
        // Picked up once it really moves (a click only selects); then it leans into the carry.
        if (moved && !d.moved) pickUp(d.ids);
        const t = performance.now();
        const last = hand.current;
        if (last && t > last.t)
          carry(((to.x - last.x) * 1000) / (t - last.t), ((to.y - last.y) * 1000) / (t - last.t));
        hand.current = { t, x: to.x, y: to.y };
      }
      // Kept at once, not at the next render: a drop straight after reads it (catch-up below).
      setDrag((dragRef.current = { ...d, to, moved }));
    };
    const drop = () => {
      const d = dragRef.current;
      setDrag(null);
      hand.current = null;
      if (d?.kind === "box") pickInBox(camera, gl.domElement, canControl, select);
      // A tap (no drag) on the neighbour the press was steered away from selects the neighbour (UX 435).
      if (d?.kind === "models" && !d.moved && d.tapped) select(d.tapped);
      if (!d || !d.moved) return;
      const dx = d.to.x - d.grab.x;
      const dy = d.to.y - d.grab.y;
      const terrain = useStore.getState().game.terrain;
      if (d.kind === "models") {
        const game = useStore.getState().game;
        // Dropped off the table, as in Tabletop Simulator: a casualty, if the player says so (PX TTS).
        const { width, depth } = game.table;
        // A regiment block can flee off the table (The Old World): it moves as ever.
        const block = !!d.unitId && isBlock(game.units[d.unitId]);
        const off =
          !block &&
          d.ids.some((id) => {
            const p = d.starts[id]!;
            return Math.abs(p.x + dx) > width / 2 || Math.abs(p.y + dy) > depth / 2;
          });
        if (off) {
          setDown(d.ids, () => null, { sound: false });
          removeAsCasualties(d.ids);
          return;
        }
        // Set down where they were let go; an over-limit drop knocks duller (advisory only).
        const unit = d.unitId ? game.units[d.unitId] : undefined;
        const limit = unit ? moveAllowance(game, unit) : null;
        // How far it has come this phase, as the move label measures it.
        const far = Math.max(
          ...d.ids.map((id) => {
            const m = game.models[id];
            const to = { x: d.starts[id]!.x + dx, y: d.starts[id]!.y + dy };
            return m ? movedSoFar(m, to, dragVia(game, d, id)) : 0;
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
      if (d.kind === "stroke") {
        if (d.points.length > 1) talkOrNote({ kind: "line", points: d.points });
      } else if (d.kind === "box") {
        // Picked above.
      } else if (d.kind === "talk") {
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
            // The corners it went round on this drag (core/path.ts).
            const via = d.corners.map((c) => ({
              x: d.starts[id]!.x + c.x - d.grab.x,
              y: d.starts[id]!.y + c.y - d.grab.y,
            }));
            return { id, to, z: settleZ(terrain, to, d.startZ[id] ?? 0), ...(via.length ? { via } : {}) };
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
    // Turning a corner mid-drag (Porter, multi-leg moves): Space, a right-click, or a second finger's tap. The
    // move goes on from there and is measured along its legs. Not for a regiment block, which wheels instead.
    const corner = () => {
      const d = dragRef.current;
      if (d?.kind !== "models" || !d.moved) return false;
      if (d.unitId && isBlock(useStore.getState().game.units[d.unitId])) return false;
      const last = d.corners.at(-1) ?? d.grab;
      if (Math.hypot(d.to.x - last.x, d.to.y - last.y) < 0.25) return true;
      setDrag((dragRef.current = { ...d, corners: [...d.corners, d.to].slice(-MAX_CORNERS) }));
      return true;
    };
    const press = (e: PointerEvent) => {
      if ((e.button === 2 || (e.pointerType === "touch" && !e.isPrimary)) && corner()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && corner()) e.preventDefault();
    };
    const menu = (e: Event) => dragRef.current?.kind === "models" && e.preventDefault();
    window.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("keydown", key);
    window.addEventListener("contextmenu", menu);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    // On a slow device the pointer can move, or even lift, before these listeners are in (#60: a drag on a
    // tablet moved nothing): catch up with where it went since it came down.
    const r = recent.current;
    if (r.move && r.move.timeStamp > r.down) move(r.move);
    if (r.up && r.up.timeStamp > r.down) drop();
    return () => {
      window.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("keydown", key);
      window.removeEventListener("contextmenu", menu);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
    };
  }, [drag !== null, camera, gl, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Two fingers twisting (#60): on the selected unit a first finger came down on, it turns the unit
  // (a wheel for a block), set down when a finger lifts; anywhere else it orbits the camera.
  useEffect(() => {
    const el = gl.domElement;
    const pts = new Map<number, Vec2>();
    let twist: { unit: boolean; a0: number; az0: number } | null = null;
    const two = () => [...pts.values()].slice(0, 2) as [Vec2, Vec2];
    // A finger held still, anywhere on the table (#60): a ruler from there if it then moves, else its menu.
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The press being held, kept here: React may not have drawn its ruler by the time the finger lifts.
    let held: {
      id: number;
      client: Vec2;
      at: Vec2;
      since: number;
      prior: Drag | null;
      unitId?: string;
    } | null = null;
    const hold = (e: PointerEvent) => {
      clearTimeout(timer);
      held = null;
      pressedModel.current = null;
      const start = { x: e.clientX, y: e.clientY };
      // Frames drawn since the press: input waiting behind a slow frame is handled before the next one starts.
      let frames = 0;
      const count = () => {
        frames++;
        if (frames < 3) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      const fire = () => {
        // Not a press until the page has caught up with the finger: on a slow device its moves may still be queued.
        if (frames < 3) return void requestAnimationFrame(fire);
        const now = pts.get(e.pointerId);
        const d = dragRef.current;
        // Lifted, moved, a second finger (a pinch or twist), or a box being drawn: not a press.
        // Still means still: a finger already a few pixels on its way is a drag that a slow page hasn't caught up
        // with yet (UX 416: pans after a move came out as rulers), not a hold.
        if (!now || pts.size !== 1 || Math.hypot(now.x - start.x, now.y - start.y) > STILL_PX) return;
        if (useTouch.getState().twist || (d && (d.moved || d.kind === "box" || d.kind === "stroke"))) return;
        const s = useStore.getState();
        if (s.scrub !== null && !s.review) return;
        const rect = el.getBoundingClientRect();
        const ray = new Raycaster();
        ray.setFromCamera(
          new Vector2(
            ((start.x - rect.left) / rect.width) * 2 - 1,
            -((start.y - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        const hit = new Vector3();
        if (!ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), hit)) return;
        const model = pressedModel.current ? s.game.models[pressedModel.current] : undefined;
        const at = model ? model.position : { x: hit.x, y: hit.z };
        navigator.vibrate?.(12);
        held = {
          id: e.pointerId,
          client: start,
          at,
          since: e.timeStamp,
          prior: d,
          ...(model?.unitId ? { unitId: model.unitId } : {}),
        };
        setDrag(
          (dragRef.current = {
            kind: "ruler",
            grab: at,
            to: at,
            moved: false,
            planeZ: 0,
            held: true,
            client: start,
            ...(model ? { fromModel: model.id } : {}),
          }),
        );
      };
      timer = setTimeout(fire, HOLD_MS);
    };
    const angle = () => {
      const [a, b] = two();
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    const centre = () => {
      const [a, b] = two();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      // A stylus draws and moves things; it never swings the camera (that's for fingers).
      if (e.pointerType === "pen" && controls) controls.enabled = false;
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      touchCount.current = pts.size;
      if (pts.size === 1) hold(e);
      if (pts.size !== 2) {
        twist = null;
        return;
      }
      // A second finger: a pinch or twist, never a drag of what the first finger came down on.
      if (dragRef.current) setDrag((dragRef.current = null));
      useTouch.setState({ box: null });
      // The controls, off for that drag, take this finger now (this runs before they see it): a pinch, not nothing.
      if (controls) controls.enabled = true;
      const s = useStore.getState();
      const unit = s.selected ? s.game.units[s.selected] : undefined;
      // The selected unit under either finger or between them: the twist turns it (PX touch pass: a twist over
      // a small squad has both fingers on it, or straddles it).
      const rect = el.getBoundingClientRect();
      const fingers = [...two(), centre()];
      const under =
        !!unit &&
        aliveModels(s.game, unit).some((m) => {
          // The whole figure, foot to head: in 3D a finger lands on the model, well above its base (PX re-check).
          const at = (up: number) => {
            const v = new Vector3(m.position.x, (m.z ?? 0) + up, m.position.y).project(camera);
            return {
              x: rect.left + ((v.x + 1) / 2) * rect.width,
              y: rect.top + ((1 - v.y) / 2) * rect.height,
            };
          };
          const foot = at(0);
          const head = at(modelHeight(m));
          return fingers.some((f) => toSegment(f, foot, head) < 48);
        });
      if (unit && under && s.scrub === null && s.view !== "eye" && canControlNow.current(unit.owner)) {
        twist = { unit: true, a0: angle(), az0: 0 };
        if (controls) controls.enabled = false;
        useTouch.setState({ twist: { unitId: unit.id, angle: 0, ...centre() } });
      } else if (s.view !== "top" && controls?.getAzimuthalAngle)
        twist = { unit: false, a0: angle(), az0: controls.getAzimuthalAngle() };
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A busy page can run the hold timer before the moves that came first: the finger was dragging, not holding.
      const h = held;
      if (
        h?.id === e.pointerId &&
        e.timeStamp - h.since < HOLD_MS &&
        Math.hypot(e.clientX - h.client.x, e.clientY - h.client.y) > SLOP_PX
      ) {
        held = null;
        setDrag((dragRef.current = h.prior));
      }
      if (!twist || pts.size !== 2) return;
      let da = angle() - twist.a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (twist.unit) {
        const tw = useTouch.getState().twist;
        if (tw) useTouch.setState({ twist: { ...tw, angle: da, ...centre() } });
      } else {
        controls?.setAzimuthalAngle?.(twist.az0 + da);
        controls?.update?.();
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (!pts.size) {
        clearTimeout(timer);
        // A long press let go where it was: its menu, on the unit it was on, if any.
        const h = held;
        held = null;
        // A busy page can run the timer before a quick tap's lift arrives: the lift's own time says it was a tap.
        if (h && e.timeStamp - h.since < HOLD_MS) {
          if (dragRef.current?.kind === "ruler" && dragRef.current.held) setDrag((dragRef.current = null));
        } else if (
          h &&
          h.id === e.pointerId &&
          Math.hypot(e.clientX - h.client.x, e.clientY - h.client.y) <= SLOP_PX
        ) {
          setDrag(null);
          useTouch.setState({
            menu: { x: h.client.x, y: h.client.y, at: h.at, ...(h.unitId ? { unitId: h.unitId } : {}) },
          });
        }
      }
      touchCount.current = pts.size;
      if (pts.size >= 2) return;
      const tw = useTouch.getState().twist;
      if (twist?.unit && tw) {
        useTouch.setState({ twist: null });
        turnByTwist(tw.unitId, tw.angle);
      }
      twist = null;
    };
    el.addEventListener("pointerdown", down, { capture: true });
    // On the canvas, capturing: a touch stays with the canvas, and nothing on the way can swallow the finger moving.
    el.addEventListener("pointermove", move, { capture: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("pointerdown", down, { capture: true });
      el.removeEventListener("pointermove", move, { capture: true });
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, controls, camera]);

  // A mouse right-click that doesn't move (UX 84): the menu a touch hold opens, at the pointer, on the unit
  // under it. A right-drag still swings or slides the camera, and mid-move a right-click turns a corner.
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const press = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.button === 2) down = { x: e.clientX, y: e.clientY };
    };
    const release = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 2 || !down) return;
      const d = down;
      down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || dragRef.current) return;
      const s = useStore.getState();
      if (s.scrub !== null && !s.review) return;
      const rect = el.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(
        new Vector2(((d.x - rect.left) / rect.width) * 2 - 1, -((d.y - rect.top) / rect.height) * 2 + 1),
        camera,
      );
      const hit = new Vector3();
      if (!ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), hit)) return;
      const model = pointerModel.id ? s.game.models[pointerModel.id] : undefined;
      useTouch.setState({
        menu: {
          x: d.x,
          y: d.y,
          at: model ? model.position : { x: hit.x, y: hit.z },
          ...(model?.unitId ? { unitId: model.unitId } : {}),
          mouse: true,
        },
      });
    };
    const menu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("pointerup", release);
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("pointerup", release);
      el.removeEventListener("contextmenu", menu);
    };
  }, [gl, camera]);

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
  // The corners of the drag under way, for each dragged model (core/path.ts).
  const vias = useMemo(() => {
    const v: Record<string, Vec2[]> = {};
    if (drag?.kind === "models" && drag.corners.length)
      for (const id of drag.ids) v[id] = dragVia(game, drag, id);
    return v;
  }, [game, drag]);
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

  /** The enemy unit (of `attackerId`) with a model within a finger's width of a tap, if any. */
  const enemyNear = (e: MouseEvent, attackerId: string): string | null => {
    const attacker = game.units[attackerId];
    if (!attacker) return null;
    const rect = gl.domElement.getBoundingClientRect();
    let best: { id: string; d: number } | null = null;
    for (const u of Object.values(game.units)) {
      if (!opposed(game, u.owner, attacker.owner)) continue;
      for (const m of aliveModels(game, u)) {
        const v = new Vector3(m.position.x, (m.z ?? 0) + modelHeight(m) / 2, m.position.y).project(camera);
        const d = Math.hypot(
          e.clientX - (rect.left + ((v.x + 1) / 2) * rect.width),
          e.clientY - (rect.top + ((1 - v.y) / 2) * rect.height),
        );
        if (d < 32 && (!best || d < best.d)) best = { id: u.id, d };
      }
    }
    return best?.id ?? null;
  };

  /** A model of the selected unit within a finger's width of the press, if the press landed on another unit. */
  const selectedNear = (e: PointerEvent, hit: Model): Model | null => {
    const selected = useStore.getState().selected;
    const unit = selected && selected !== hit.unitId ? game.units[selected] : undefined;
    if (!unit) return null;
    const rect = gl.domElement.getBoundingClientRect();
    const slop = e.pointerType === "touch" ? 32 : 16;
    let best: { m: Model; d: number } | null = null;
    for (const m of aliveModels(game, unit)) {
      const v = new Vector3(m.position.x, (m.z ?? 0) + modelHeight(m) / 2, m.position.y).project(camera);
      const d = Math.hypot(
        e.clientX - (rect.left + ((v.x + 1) / 2) * rect.width),
        e.clientY - (rect.top + ((1 - v.y) / 2) * rect.height),
      );
      if (d < slop && (!best || d < best.d)) best = { m, d };
    }
    return best?.m ?? null;
  };

  const onModelDown = (hit: Model, shift: boolean, e?: PointerEvent) => {
    // With a unit selected, a press near its models picks it, not the neighbour drawn in front;
    // switching to the neighbour takes a tap on it first (UX 435).
    const m = (e && !useTouch.getState().picked.length && selectedNear(e, hit)) || hit;
    // A second finger is a pinch or twist, never a drag of the model it lands on (PX touch pass).
    if (e?.pointerType === "touch" && touchCount.current > 1) return;
    if (e?.pointerType === "touch") {
      useTouch.setState({ menu: null });
      pressedModel.current = m.id;
    }
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
    // An attack being set up: another enemy tapped is a new target, not a new selection that drops the attack (UX 417).
    if (draft && m.unitId && m.unitId !== draft.attackerId) {
      const attacker = game.units[draft.attackerId];
      if (attacker && opposed(game, m.owner, attacker.owner)) {
        setDraft({ ...draft, targetId: m.unitId });
        return;
      }
    }
    // One of your units picked and an enemy clicked: the phase's verb on it (UX 84); Shift does it anyway.
    // Not by touch yet: a tap there picks the enemy, as before (two taps with a tag is to come).
    if (
      !draft &&
      live &&
      e?.pointerType !== "touch" &&
      selected &&
      m.unitId &&
      game.units[selected] &&
      canControl(game.units[selected]!.owner)
    ) {
      const verb = tableVerb(game, selected, m.unitId);
      if (verb && (verb.ok || shift)) {
        doTableVerb(verb, selected, m.unitId);
        return;
      }
    }
    const { picked, oneModel } = useTouch.getState();
    const group = m.unitId && picked.length > 1 && picked.includes(m.unitId);
    if (m.unitId && !group) {
      select(m.unitId);
      if (picked.length) useTouch.setState({ picked: [] });
    }
    if (!live || !canControl(m.owner) || view === "eye") return;
    const unit = m.unitId ? game.units[m.unitId] : undefined;
    // Picked with Select several: all of them move together (#60); One model moves just this one.
    const ids = group
      ? picked.flatMap((id) =>
          game.units[id] && canControl(game.units[id]!.owner)
            ? aliveModels(game, game.units[id]!).map((x) => x.id)
            : [],
        )
      : shift || oneModel || !unit
        ? [m.id]
        : aliveModels(game, unit).map((x) => x.id);
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
      corners: [],
      grab: m.position,
      to: m.position,
      moved: false,
      planeZ: m.z ?? 0,
      ...(group ? {} : { unitId: unit?.id }),
      ...(m !== hit && hit.unitId ? { tapped: hit.unitId } : {}),
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
  const handTargets = useHandTargets((s) => s.ids);
  const handColor = useHandTargets((s) => s.color ?? "#facc15");

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
            targetable:
              (!!draft?.picking && model.unitId !== draft.attackerId) ||
              (!!model.unitId && !!handTargets?.includes(model.unitId)),
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
      handTargets,
      draft,
    ],
  );

  return (
    <>
      {/* Remount on view change so the controls bind to the new camera. */}
      <OrbitControls
        key={`${view}-${eye?.modelId ?? ""}-${cameraReset}-${width}x${depth}-${tts}`}
        enabled={!drag && !templateDrag && !twisting}
        // Fingers (#60): one pans the table, two pan and pinch (a twist orbits: TouchTwist).
        touches={{ ONE: view === "eye" ? TOUCH.ROTATE : TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
        {...(tts && view !== "eye"
          ? {
              mouseButtons: {
                LEFT: -1 as MOUSE,
                MIDDLE: MOUSE.PAN,
                RIGHT: view === "top" ? MOUSE.PAN : MOUSE.ROTATE,
              },
            }
          : {})}
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
          const at = { x: e.point.x, y: e.point.z };
          if (!measuring) {
            // A stylus draws on the table (#60); a finger draws a box with Select several, else pans.
            if (e.nativeEvent.pointerType === "pen" && view !== "eye") {
              e.stopPropagation();
              setDrag({ kind: "stroke", points: [at], grab: at, to: at, moved: false, planeZ: 0 });
              return;
            }
            const mouseBox = tts && e.nativeEvent.pointerType === "mouse" && view !== "eye";
            if (e.nativeEvent.pointerType === "touch" || mouseBox) {
              if (touchCount.current > 1) return;
              useTouch.setState({ menu: null });
              if (useTouch.getState().boxMode || mouseBox) {
                e.stopPropagation();
                const from = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
                useTouch.setState({ box: { x0: from.x, y0: from.y, x1: from.x, y1: from.y } });
                setDrag({ kind: "box", from, grab: at, to: at, moved: false, planeZ: 0 });
                return;
              }
            }
            return;
          }
          e.stopPropagation();
          startRuler(at);
        }}
        onClick={(e) => {
          // Picking a target: a tap near an enemy model (a finger's width) takes its unit (UX 417).
          if (draft?.picking && e.delta < 3) {
            const near = enemyNear(e.nativeEvent, draft.attackerId);
            if (near) setDraft({ ...draft, targetId: near, picking: false });
            return;
          }
          if (tool || e.altKey || measuring || e.delta >= 3) return;
          select(null);
          if (useTouch.getState().picked.length) useTouch.setState({ picked: [] });
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
        onDown={(model, shift, e) => onModelDown(model, shift, e)}
        onHover={(model) => {
          // No hover tooltips mid-drag: they would sit on the drag's own label.
          if (dragRef.current) return;
          setHoverModel(model?.id ?? null);
          pointerModel.id = model?.id ?? null;
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
            // Which unit it names, for browser tests of touch play (#60) and anything reading the page.
            <div data-unit={l.unitId}>
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

      {/* The units a stratagem card in hand could be played on (UX 499, PX: target rings). */}
      {handTargets?.flatMap((id) =>
        game.units[id]
          ? aliveModels(game, game.units[id]).map((m) => (
              <Ring key={`hand-${m.id}`} model={placed(m)} radius={0.18} color={handColor} opacity={0.85} />
            ))
          : [],
      )}

      {/* Where the selected unit started this phase. */}
      {selectedUnit &&
        aliveModels(game, selectedUnit).map((m) => {
          const p = positions[m.id]!;
          const s = m.phaseStart;
          const via = [...(m.phaseVia ?? []), ...(vias[m.id] ?? [])];
          if (
            !s ||
            (!via.length &&
              Math.hypot(p.x - s.x, p.y - s.y) + Math.abs((heights[m.id] ?? 0) - (m.phaseStartZ ?? 0)) < 0.05)
          )
            return null;
          return (
            <Ghost
              key={m.id}
              from={s}
              fromZ={m.phaseStartZ ?? 0}
              via={via}
              to={p}
              toZ={heights[m.id] ?? 0}
              model={m}
            />
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
      <TtsKeys />
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
        <MoveLabel
          game={game}
          unitId={dragUnit.id}
          positions={positions}
          heights={heights}
          via={vias}
          legs={drag.kind === "models" ? drag.corners.length : 0}
          at={drag.to}
        />
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
/** Select several (#60): the units of yours whose middle is inside the box drawn. */
function pickInBox(
  camera: Camera,
  el: HTMLElement,
  canControl: (owner: string) => boolean,
  select: (id: string | null) => void,
) {
  const box = useTouch.getState().box;
  useTouch.setState({ box: null });
  if (!box) return;
  const rect = el.getBoundingClientRect();
  const [x0, x1] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
  const [y0, y1] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
  const state = useStore.getState().game;
  const v = new Vector3();
  const picked = Object.values(state.units)
    .filter((u) => canControl(u.owner))
    .filter((u) => {
      const ms = aliveModels(state, u);
      if (!ms.length) return false;
      v.set(
        ms.reduce((a, m) => a + m.position.x, 0) / ms.length,
        0,
        ms.reduce((a, m) => a + m.position.y, 0) / ms.length,
      ).project(camera);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
    })
    .map((u) => u.id);
  useTouch.setState({ picked });
  select(picked[0] ?? null);
}

function talkPreview(drag: Drag | null, game: ReturnType<typeof useGame>): Said | null {
  if ((drag?.kind !== "talk" && drag?.kind !== "stroke") || !drag.moved) return null;
  const self = useStore.getState().session?.selfId ?? "";
  const color = game.players[self]?.color ?? "#a1a1aa";
  const base = { id: "draft", by: self, name: "", color, sentAt: Date.now() };
  if (drag.kind === "stroke") return { ...base, kind: "line", points: drag.points };
  return drag.tool === "arrow"
    ? { ...base, kind: "arrow", from: drag.grab, to: drag.to }
    : {
        ...base,
        kind: "area",
        at: drag.grab,
        radius: Math.hypot(drag.to.x - drag.grab.x, drag.to.y - drag.grab.y),
      };
}

/** A point's distance to a segment, in screen pixels. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k =
    dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

/**
 * A dragged model's corners so far, for measuring (core/path.ts): where it
 * stood when picked up, if it had already moved this phase, then the
 * drag's own corners. (The event sends only the drag's; the reducer adds
 * the first.)
 */
function dragVia(game: GameState, d: Extract<Drag, { kind: "models" }>, id: string): Vec2[] {
  if (!d.corners.length) return [];
  const m = game.models[id];
  const s = d.starts[id];
  if (!m || !s) return [];
  const start = m.phaseStart ?? m.position;
  const before = Math.hypot(m.position.x - start.x, m.position.y - start.y) > 0.05 || !!m.phaseVia?.length;
  return [
    ...(before ? [s] : []),
    ...d.corners.map((c) => ({ x: s.x + c.x - d.grab.x, y: s.y + c.y - d.grab.y })),
  ];
}
