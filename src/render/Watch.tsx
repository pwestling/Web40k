import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LineBasicMaterial, MeshBasicMaterial } from "three";
import { Vector3 } from "three";
import {
  baseSizeInches,
  modelHeight,
  type AttackState,
  type GameEvent,
  type GameState,
  type Model,
  type Vec2,
} from "../core";
import { useHold } from "../ui/hold";
import { useStore } from "../store";
import { useGame } from "../ui/hooks";

/**
 * Watch mode: what makes a game readable to someone who didn't make the
 * move. Models glide to new positions and leave a fading trail, shots draw
 * tracers, dice results pop up over the target, casualties fade out, and an
 * optional director camera follows the action. Everything is driven by the
 * event log, so it works the same live, for spectators and in replays.
 */

const TWEEN_MS = 350;
/** How long a trail takes to fade once another unit moves. */
const TRAIL_FADE_MS = 700;
const EFFECT_MS = 1600;

export interface Trail {
  id: string;
  from: Vec2;
  to: Vec2;
  z: number;
  start: number;
  color: string;
  /** When it began to fade (the next move); unset while it is the latest. */
  end?: number;
}

/**
 * Positions to draw models at: they ease from where they were drawn to where
 * the game says they are. Moves made by dragging land with no tween (the
 * player already saw them), and long jumps (scrubbing a replay) snap.
 */
export function useTween(
  positions: Record<string, Vec2>,
  heights: Record<string, number>,
  dragging: boolean,
  /** Trail colour for a model (its player's). */
  colorOf: (id: string) => string = () => "#e5e7eb",
): { shown: Record<string, Vec2>; shownZ: Record<string, number>; trails: Trail[] } {
  const color = useRef(colorOf);
  useEffect(() => {
    color.current = colorOf;
  }, [colorOf]);
  type Frame = { p: Record<string, Vec2>; z: Record<string, number> };
  type Input = Frame & { dragging: boolean };
  const [initial] = useState<Input>(() => ({ p: positions, z: heights, dragging }));
  const input = useRef<Input>(initial);
  useEffect(() => {
    input.current = { p: positions, z: heights, dragging };
  }, [positions, heights, dragging]);
  const seen = useRef<Input>(initial);
  const drawn = useRef<Frame>({ p: positions, z: heights });
  const anim = useRef<{ from: Frame; start: number } | null>(null);
  const settleUntil = useRef(0);
  const [frame, setFrame] = useState<Frame>({ p: positions, z: heights });
  const [trails, setTrails] = useState<Trail[]>([]);

  const show = (f: Frame) => {
    drawn.current = f;
    anim.current = null;
    setFrame(f);
  };

  // Changes are picked up here rather than in an effect so a new position is
  // first drawn where the model was, then eased.
  useFrame(() => {
    const cur = input.current;
    const now = performance.now();
    if (cur !== seen.current) {
      const prev = seen.current;
      seen.current = cur;
      if (cur.dragging) show(cur);
      else if (prev.dragging) {
        // Just dropped: keep the models where they were let go while the host
        // confirms the move, then show whatever the game says, with no tween.
        settleUntil.current = now + 1500;
      } else if (now < settleUntil.current) {
        settleUntil.current = 0;
        show(cur);
      } else {
        const from = drawn.current;
        const moved = Object.keys(cur.p).filter((id) => {
          const a = from.p[id];
          const b = cur.p[id]!;
          return a && Math.hypot(a.x - b.x, a.y - b.y) > 0.05;
        });
        const far = moved.some((id) => {
          const a = from.p[id]!;
          const b = cur.p[id]!;
          return Math.hypot(a.x - b.x, a.y - b.y) > 40;
        });
        if (!moved.length) show(cur);
        else if (far || moved.length > 60) {
          // A jump (scrubbing, a replay opening): no tween, and old trails go.
          show(cur);
          setTrails([]);
        } else {
          anim.current = { from, start: now };
          // The last move's trail stays until the next one, then fades.
          setTrails((old) => [
            ...old
              .filter((t) => !t.end || now - t.end < TRAIL_FADE_MS)
              .map((t) => (t.end ? t : { ...t, end: now })),
            ...moved.map((id) => ({
              id,
              from: from.p[id]!,
              to: cur.p[id]!,
              z: cur.z[id] ?? 0,
              start: now,
              color: color.current(id),
            })),
          ]);
        }
      }
    }
    if (settleUntil.current && now >= settleUntil.current) {
      settleUntil.current = 0;
      show(cur);
    }
    const a = anim.current;
    if (!a) return;
    const t = Math.min(1, (now - a.start) / TWEEN_MS);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const p: Record<string, Vec2> = {};
    const z: Record<string, number> = {};
    for (const id of Object.keys(cur.p)) {
      const to = cur.p[id]!;
      const f = a.from.p[id] ?? to;
      p[id] = { x: f.x + (to.x - f.x) * e, y: f.y + (to.y - f.y) * e };
      const tz = cur.z[id] ?? 0;
      const fz = a.from.z[id] ?? tz;
      z[id] = fz + (tz - fz) * e;
    }
    drawn.current = { p, z };
    setFrame({ p, z });
    if (t >= 1) anim.current = null;
  });

  // While dragging, the pointer is in charge. Models added since the last
  // frame show where they are.
  const shown = useMemo(
    () => (dragging ? positions : { ...positions, ...frame.p }),
    [dragging, positions, frame.p],
  );
  const shownZ = useMemo(
    () => (dragging ? heights : { ...heights, ...frame.z }),
    [dragging, heights, frame.z],
  );
  return { shown, shownZ, trails };
}

/** Ribbons from where models were to where they went, in their player's colour. */
export function Trails({ trails }: { trails: Trail[] }) {
  return (
    <>
      {trails.map((t) => (
        <Ribbon key={`${t.id}-${t.start}`} trail={t} />
      ))}
    </>
  );
}

function Ribbon({ trail }: { trail: Trail }) {
  const material = useRef<MeshBasicMaterial>(null);
  const dx = trail.to.x - trail.from.x;
  const dy = trail.to.y - trail.from.y;
  const length = Math.hypot(dx, dy);
  useFrame(() => {
    if (!material.current) return;
    const t = trail.end ? (performance.now() - trail.end) / TRAIL_FADE_MS : 0;
    material.current.opacity = Math.max(0, 0.55 * (1 - t));
    material.current.visible = t < 1;
  });
  return (
    <group
      position={[(trail.from.x + trail.to.x) / 2, trail.z + 0.05, (trail.from.y + trail.to.y) / 2]}
      rotation-y={Math.atan2(dx, dy)}
    >
      <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
        <planeGeometry args={[0.35, length]} />
        <meshBasicMaterial ref={material} color={trail.color} transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  );
}

function FadingLine({
  points,
  color,
  start,
  duration,
  opacity,
}: {
  points: number[];
  color: string;
  start: number;
  duration: number;
  opacity: number;
}) {
  const array = useMemo(() => new Float32Array(points), [points]);
  const material = useRef<LineBasicMaterial>(null);
  useFrame(() => {
    if (!material.current) return;
    const t = (performance.now() - start) / duration;
    material.current.opacity = Math.max(0, opacity * (1 - t));
    material.current.visible = t < 1;
  });
  return (
    <lineSegments raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[array, 3]} />
      </bufferGeometry>
      <lineBasicMaterial ref={material} color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

type Effect =
  | { kind: "tracer"; key: string; start: number; points: number[] }
  | { kind: "burst"; key: string; start: number; at: [number, number, number]; text: string }
  | { kind: "ghost"; key: string; start: number; model: Model };

const centre = (models: Model[]): { x: number; y: number; z: number } => {
  const n = Math.max(1, models.length);
  return {
    x: models.reduce((a, m) => a + m.position.x, 0) / n,
    y: models.reduce((a, m) => a + m.position.y, 0) / n,
    z: Math.max(0, ...models.map((m) => (m.z ?? 0) + modelHeight(m))),
  };
};

const alive = (g: GameState, unitId: string) =>
  (g.units[unitId]?.modelIds ?? []).flatMap((id) => {
    const m = g.models[id];
    return m && !m.destroyed ? [m] : [];
  });

/** What the dice just did, in a few words, for the pop-up over the target. */
function stageResult(a: AttackState): string | null {
  switch (a.stage) {
    case "wound":
      return `${a.hits ?? 0} hit${a.hits === 1 ? "" : "s"}`;
    case "save":
      return `${a.wounds ?? 0} wound${a.wounds === 1 ? "" : "s"}`;
    case "damage":
      return `${a.unsaved ?? 0} unsaved`;
    case "done": {
      const slain = (a.damage ?? []).filter((d) => d.destroyed).length;
      return slain ? `${slain} slain` : "No casualties";
    }
    default:
      return null;
  }
}

/**
 * The game's newest events as they arrive (live, or while a replay plays),
 * turned into effects and camera moves. Jumps in the replay show nothing.
 */
export function WatchEffects() {
  const game = useGame();
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const director = useStore((s) => s.director);
  // Held back while the dice tray rolls, so pop-ups and casualties land with the dice.
  const held = useHold((s) => s.held);
  const shownSeq = scrub ?? (held !== null ? held - 1 : (record.events.at(-1)?.seq ?? 0));
  const [initial] = useState(() => ({ seq: shownSeq, game, record }));
  const input = useRef(initial);
  useEffect(() => {
    input.current = { seq: shownSeq, game, record };
  }, [shownSeq, game, record]);
  const last = useRef(initial);
  const [effects, setEffects] = useState<Effect[]>([]);
  const focus = useRef<Focus | null>(null);
  const lastAction = useRef(0);
  const overview = useRef(true);
  // Effect keys must never repeat: a replay rewound and played again reaches the same seqs.
  const nextKey = useRef(0);

  // New events are picked up each frame (not in an effect, to keep renders cheap).
  useFrame(() => {
    const { seq: shownSeq, game, record } = input.current;
    const prev = last.current;
    if (prev === input.current) return;
    last.current = input.current;
    if (shownSeq <= prev.seq || shownSeq - prev.seq > 6) {
      // A jump: what was showing belongs to another moment.
      if (shownSeq !== prev.seq) setEffects((old) => (old.length ? [] : old));
      return;
    }
    const events = record.events.filter((e) => e.seq > prev.seq && e.seq <= shownSeq).map((e) => e.event);
    const now = performance.now();
    const fresh: Effect[] = [];
    for (const event of events)
      fresh.push(...effectsFor(event, prev.game, game, now, `${nextKey.current++}`));
    // Casualties: models destroyed since the last frame fade out where they stood.
    for (const m of Object.values(game.models))
      if (m.destroyed && prev.game.models[m.id] && !prev.game.models[m.id]!.destroyed)
        fresh.push({
          kind: "ghost",
          key: `ghost-${m.id}-${nextKey.current++}`,
          start: now,
          model: prev.game.models[m.id]!,
        });
    if (fresh.length) setEffects((old) => [...old.filter((e) => now - e.start < EFFECT_MS * 2), ...fresh]);
    const f = focusFor(events.at(-1), prev.game, game);
    if (f) {
      focus.current = f;
      lastAction.current = now;
      overview.current = false;
    }
  });

  // The director: ease the camera to look at the latest action, keeping its angle.
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    object: { position: Vector3 };
    update: () => void;
  } | null;
  // Once the action has been quiet a while, it eases back out to the whole table.
  const table = game.table;
  useFrame(() => {
    if (!director || !controls) return;
    if (!focus.current && !overview.current && performance.now() - lastAction.current > OVERVIEW_AFTER_MS) {
      overview.current = true;
      focus.current = { x: 0, y: 0, z: 0, span: null };
    }
    const f = focus.current;
    if (!f) return;
    const goal = new Vector3(f.x, 0, f.y);
    const delta = goal.sub(controls.target).multiplyScalar(0.06);
    // Distance: close enough to see the action (both shooter and target), or the whole table.
    const k = Math.max(table.width / 60, table.depth / 44);
    const full = Math.hypot(52, 44) * k;
    const want = f.span === null ? full : Math.min(full, Math.max(22, f.span * 1.6 + 14));
    const offset = controls.object.position.clone().sub(controls.target);
    const len = offset.length();
    const step = (want - len) * 0.06;
    if (delta.lengthSq() < 1e-4 && Math.abs(want - len) < 0.05) {
      focus.current = null;
      return;
    }
    controls.target.add(delta);
    if (len > 1e-6) offset.multiplyScalar((len + step) / len);
    controls.object.position.copy(controls.target).add(offset);
    controls.update();
  });

  return (
    <>
      {effects.map((e) =>
        e.kind === "tracer" ? (
          <FadingLine
            key={e.key}
            points={e.points}
            color="#fbbf24"
            start={e.start}
            duration={EFFECT_MS}
            opacity={0.9}
          />
        ) : e.kind === "burst" ? (
          <Html key={e.key} position={e.at} center zIndexRange={[9, 0]} className="burst">
            {e.text}
          </Html>
        ) : (
          <FadingGhost key={e.key} model={e.model} start={e.start} />
        ),
      )}
    </>
  );
}

function effectsFor(
  event: GameEvent,
  before: GameState,
  after: GameState,
  now: number,
  key: string,
): Effect[] {
  if (event.type === "attack/declare") {
    const s = event.attack.spec;
    const shooters = alive(after, s.attackerUnitId).filter(
      (m) => !s.weaponId || !m.weapons || m.weapons.includes(s.weaponId),
    );
    const targets = alive(after, s.targetUnitId);
    if (!targets.length) return [];
    const points: number[] = [];
    for (const m of shooters.slice(0, 20)) {
      // Each shooter fires at the nearest target model.
      const t = targets.reduce((a, b) =>
        Math.hypot(b.position.x - m.position.x, b.position.y - m.position.y) <
        Math.hypot(a.position.x - m.position.x, a.position.y - m.position.y)
          ? b
          : a,
      );
      points.push(
        m.position.x,
        (m.z ?? 0) + modelHeight(m) * 0.8,
        m.position.y,
        t.position.x,
        (t.z ?? 0) + modelHeight(t) * 0.5,
        t.position.y,
      );
    }
    return points.length ? [{ kind: "tracer", key: `tracer-${key}`, start: now, points }] : [];
  }
  if (event.type === "attack/roll") {
    const text = stageResult(event.attack);
    const c = centre(alive(before, event.attack.spec.targetUnitId));
    return text ? [{ kind: "burst", key: `burst-${key}`, start: now, at: [c.x, c.z + 2.4, c.y], text }] : [];
  }
  if (event.type === "dice/roll" && event.roll.unitId) {
    const c = centre(alive(after, event.roll.unitId));
    const total = event.roll.results.reduce((a, b) => a + b, 0);
    const label = event.roll.label ? `${event.roll.label} ` : "";
    return [
      { kind: "burst", key: `burst-${key}`, start: now, at: [c.x, c.z + 2.4, c.y], text: `${label}${total}` },
    ];
  }
  return [];
}

const OVERVIEW_AFTER_MS = 4000;

/** Where the director looks, and how wide a view it needs (null: the whole table). */
type Focus = { x: number; y: number; z: number; span: number | null };

/** Where the director should look after an event, if anywhere. */
function focusFor(event: GameEvent | undefined, before: GameState, after: GameState): Focus | null {
  if (!event) return null;
  const ofModels = (ids: string[]): Focus | null => {
    const ms = ids.flatMap((id) => after.models[id] ?? []);
    if (!ms.length) return null;
    const c = centre(ms);
    const span = Math.max(4, ...ms.map((m) => 2 * Math.hypot(m.position.x - c.x, m.position.y - c.y)));
    return { ...c, span };
  };
  const pair = (attacker: string, target: string, state: GameState): Focus => {
    const a = centre(alive(state, attacker));
    const b = centre(alive(state, target));
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0, span: Math.hypot(a.x - b.x, a.y - b.y) + 4 };
  };
  switch (event.type) {
    case "models/move":
      return ofModels(event.moves.map((m) => m.id));
    case "model/move":
      return ofModels([event.id]);
    case "unit/move":
      return ofModels(after.units[event.id]?.modelIds ?? []);
    // Shooter and target stay framed together while the dice roll.
    case "attack/declare":
      return pair(event.attack.spec.attackerUnitId, event.attack.spec.targetUnitId, after);
    case "attack/roll":
      return pair(event.attack.spec.attackerUnitId, event.attack.spec.targetUnitId, before);
    case "dice/roll":
      return event.roll.unitId ? ofModels(alive(after, event.roll.unitId).map((m) => m.id)) : null;
    default:
      return null;
  }
}

/** A destroyed model's stand-in, fading and sinking where it fell. */
function FadingGhost({ model, start }: { model: Model; start: number }) {
  const material = useRef<MeshBasicMaterial>(null);
  const group = useRef<{ position: Vector3 }>(null);
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.min(width, depth) / 2;
  const h = Math.max(0.3, modelHeight(model) - 0.2);
  const z = model.z ?? 0;
  useFrame(() => {
    const t = (performance.now() - start) / (EFFECT_MS * 1.5);
    if (material.current) {
      material.current.opacity = Math.max(0, 0.7 * (1 - t));
      material.current.visible = t < 1;
    }
    if (group.current) group.current.position.y = z - Math.min(1, t) * h * 0.5;
  });
  return (
    <group ref={group as never} position={[model.position.x, z, model.position.y]}>
      <mesh position-y={h / 2 + 0.2} raycast={() => null}>
        <cylinderGeometry args={[r * 0.6, r * 0.8, h, 12]} />
        <meshBasicMaterial ref={material} color="#ef4444" transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
}
