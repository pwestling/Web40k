import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Color, type Group } from "three";
import { baseSizeInches, modelHeight, type GameState, type Model, type Vec2 } from "../core";

/**
 * PX-3d: slain models tip over where they stood, lie still a moment, then
 * slide to their owner's casualty pile just off the table, where they lie
 * in rows with a count over them. The pile is read from the game state, so
 * an undo puts a model back on the table.
 */

export const FALL_MS = 350;
export const REST_MS = 600;
export const SLIDE_MS = 400;
export const TOPPLE_MS = FALL_MS + REST_MS + SLIDE_MS;
const PER_ROW = 10;
const MAX_SHOWN = 60;

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Which way a player's half of the table lies: +1 or -1 on the y axis. */
function sideOf(game: GameState, owner: string): number {
  const seat = game.players[owner]?.seat ?? 0;
  const zone = game.zones.find((z) => z.seat === seat);
  const zy = zone?.points.length ? zone.points.reduce((t, p) => t + p.y, 0) / zone.points.length : 0;
  return zy !== 0 ? Math.sign(zy) : seat === 0 ? 1 : -1;
}

/** A player's slain models, in the order they lie in the pile. */
function fallen(game: GameState, owner: string): Model[] {
  return Object.values(game.models).filter((m) => m.destroyed && m.owner === owner);
}

/** Where slot `i` of a player's pile is: rows off the table's right end, on their half. */
export function pileSlot(game: GameState, owner: string, i: number): Vec2 {
  const side = sideOf(game, owner);
  const row = Math.floor(Math.min(i, MAX_SHOWN - 1) / PER_ROW);
  const col = i % PER_ROW;
  return { x: game.table.width / 2 + 2.5 + row * 2, y: side * (2.5 + col * 1.6) };
}

/** A model's slot in its owner's pile. */
export function slotOf(game: GameState, model: Model): Vec2 {
  const i = fallen(game, model.owner).findIndex((m) => m.id === model.id);
  return pileSlot(game, model.owner, Math.max(0, i));
}

const faded = (c: string) => `#${new Color(c).lerp(new Color("#52525b"), 0.45).getHexString()}`;

/** A stand-in figure on its base, standing up along +y from its base centre. */
function Figure({ model, color }: { model: Model; color: string }) {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.min(width, depth) / 2;
  const h = Math.max(0.3, modelHeight(model) - 0.2);
  const rect = model.base.shape === "rect";
  return (
    <>
      <mesh position-y={0.1} raycast={() => null}>
        {rect ? <boxGeometry args={[width, 0.2, depth]} /> : <cylinderGeometry args={[r, r, 0.2, 20]} />}
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position-y={0.2 + h / 2} raycast={() => null}>
        {rect ? (
          <boxGeometry args={[width * 0.8, h, depth * 0.85]} />
        ) : (
          <capsuleGeometry args={[r * 0.45, Math.max(0.1, h - r * 0.9), 4, 10]} />
        )}
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
    </>
  );
}

/** Each player's pile: the slain lying in rows, "14 models · 210 pts" over it, click for the list. */
export function CasualtyPiles({ game, arriving }: { game: GameState; arriving: ReadonlySet<string> }) {
  const owners = Object.values(game.players).filter((p) => p.seat !== undefined);
  return (
    <>
      {owners.map((p) => (
        <Pile key={p.id} game={game} owner={p.id} color={p.color} arriving={arriving} />
      ))}
    </>
  );
}

function Pile({
  game,
  owner,
  color,
  arriving,
}: {
  game: GameState;
  owner: string;
  color: string;
  arriving: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const dead = useMemo(() => fallen(game, owner), [game, owner]);
  const tint = useMemo(() => faded(color), [color]);
  const summary = useMemo(() => {
    let pts = 0;
    const units = new Map<string, number>();
    for (const m of dead) {
      const u = m.unitId ? game.units[m.unitId] : undefined;
      if (!u) continue;
      units.set(u.name, (units.get(u.name) ?? 0) + 1);
      pts += (u.sheet?.points ?? 0) / Math.max(1, u.modelIds.length);
    }
    return { pts: Math.round(pts), units: [...units] };
  }, [dead, game.units]);
  if (!dead.length) return null;
  const side = sideOf(game, owner);
  const label = pileSlot(game, owner, 0);
  return (
    <group>
      {dead
        .slice(0, MAX_SHOWN)
        .map((m, i) =>
          arriving.has(m.id) ? null : (
            <Lying key={m.id} model={m} at={pileSlot(game, owner, i)} color={tint} />
          ),
        )}
      <Html
        position={[label.x + 1, 1.2, side * 0.8]}
        center
        zIndexRange={[9, 0]}
        className="ruler casualty-pile"
      >
        <button className="link" onClick={() => setOpen(!open)} title="Units lost">
          {dead.length} model{dead.length === 1 ? "" : "s"}
          {summary.pts ? ` · ${summary.pts} pts` : ""}
          {dead.length > MAX_SHOWN ? ` (+${dead.length - MAX_SHOWN} not shown)` : ""}
        </button>
        {open && (
          <ul>
            {summary.units.map(([name, n]) => (
              <li key={name}>
                {name} × {n}
              </li>
            ))}
          </ul>
        )}
      </Html>
    </group>
  );
}

/** A model lying on its side in the pile, head away from the table (as a toppled model lands). */
function Lying({ model, at, color }: { model: Model; at: Vec2; color: string }) {
  const r = Math.min(baseSizeInches(model.base).width, baseSizeInches(model.base).depth) / 2;
  return (
    <group position={[at.x, r, at.y]} rotation-z={-Math.PI / 2}>
      <Figure model={model} color={color} />
    </group>
  );
}

/**
 * One slain model: it tips over about its base edge (away from `from`), with a
 * small bounce, lies still, then slides to its pile slot. With reduced
 * motion it just fades and appears in the pile.
 */
export function Topple({
  model,
  color,
  from,
  to,
  start,
}: {
  model: Model;
  color: string;
  /** Where the blow came from; it falls away from here. */
  from: Vec2 | null;
  /** Its slot in the pile. */
  to: Vec2;
  start: number;
}) {
  const outer = useRef<Group>(null);
  const pivot = useRef<Group>(null);
  const r = Math.min(baseSizeInches(model.base).width, baseSizeInches(model.base).depth) / 2;
  const z = model.z ?? 0;
  // Away from the blow, give or take 40°, steady for this model.
  const [dir] = useState(() => {
    const base = from
      ? Math.atan2(model.position.x - from.x, model.position.y - from.y)
      : Math.random() * Math.PI * 2;
    return base + (Math.random() - 0.5) * 1.4;
  });
  const edge = { x: model.position.x + Math.sin(dir) * r, y: model.position.y + Math.cos(dir) * r };
  const still = reduced();
  useFrame(() => {
    const g = outer.current;
    const p = pivot.current;
    if (!g || !p) return;
    const t = performance.now() - start;
    g.visible = !still && t < TOPPLE_MS;
    if (!g.visible) return;
    if (t < FALL_MS) {
      const k = t / FALL_MS;
      p.rotation.x = (Math.PI / 2) * k * k;
    } else if (t < FALL_MS + 150) {
      const k = (t - FALL_MS) / 150;
      p.rotation.x = Math.PI / 2 - 0.15 * Math.sin(k * Math.PI);
    } else p.rotation.x = Math.PI / 2;
    if (t > FALL_MS + REST_MS) {
      // Slide off to the pile, turning to lie as the pile lies.
      const k = Math.min(1, (t - FALL_MS - REST_MS) / SLIDE_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      g.position.set(edge.x + (to.x - edge.x) * e, z * (1 - e), edge.y + (to.y - edge.y) * e);
      g.rotation.y = dir + (Math.PI / 2 - dir) * e;
    }
  });
  return (
    <group ref={outer} position={[edge.x, z, edge.y]} rotation-y={dir}>
      <group ref={pivot}>
        <group position-z={-r}>
          <Figure model={model} color={color} />
        </group>
      </group>
    </group>
  );
}
