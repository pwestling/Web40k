import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Color, type Group, type Mesh, type MeshStandardMaterial } from "three";
import {
  applyEvent,
  baseSizeInches,
  modelHeight,
  undoneSeqs,
  type GameRecord,
  type GameState,
  type Model,
  type Vec2,
} from "../core";

/**
 * PX-3d: slain models tip over where they stood, lie still a moment and fade
 * out there, then fade in on their owner's casualty pile: rows just off the
 * owner's long table edge, under the player's name and a count. The pile is
 * read from the game state, so an undo puts a model back on the table.
 */

export const FALL_MS = 350;
export const REST_MS = 600;
export const FADE_MS = 300;
export const TOPPLE_MS = FALL_MS + REST_MS + FADE_MS;
const PER_ROW = 20;
const MAX_SHOWN = 60;
/** Along the edge between figures, and outwards between rows. */
const COL_STEP = 1.6;
const ROW_STEP = 2.6;

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

/**
 * Where slot `i` of a player's pile is: in rows just beyond their own long
 * table edge, from its right-hand end (reserves wait from the left), the
 * first row nearest the table.
 */
export function pileSlot(game: GameState, owner: string, i: number): Vec2 {
  const side = sideOf(game, owner);
  const k = Math.min(i, MAX_SHOWN - 1);
  const row = Math.floor(k / PER_ROW);
  const col = k % PER_ROW;
  return {
    x: side * (game.table.width / 2 - 1.5 - col * COL_STEP),
    y: side * (game.table.depth / 2 + 1 + row * ROW_STEP),
  };
}

/**
 * The battle round each model was slain in, read back from the log up to
 * `upto` (undone events skipped). Only worked out when a pile's list is opened.
 */
export function roundsLost(record: GameRecord, upto: number): Map<string, number> {
  const undone = undoneSeqs(record, upto);
  const lost = new Map<string, number>();
  let state = record.initial;
  for (const { seq, event } of record.events) {
    if (seq > upto) break;
    if (undone.has(seq)) continue;
    const before = state.models;
    state = applyEvent(state, event);
    if (state.models === before) continue;
    for (const m of Object.values(state.models)) {
      if (m.destroyed && !before[m.id]?.destroyed) lost.set(m.id, state.turn.round);
      else if (!m.destroyed) lost.delete(m.id);
    }
  }
  return lost;
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
export function CasualtyPiles({
  game,
  record,
  upto,
  arriving,
}: {
  game: GameState;
  record: GameRecord;
  /** The last event shown. */
  upto: number;
  arriving: ReadonlySet<string>;
}) {
  const owners = Object.values(game.players).filter((p) => p.seat !== undefined);
  return (
    <>
      {owners.map((p) => (
        <Pile
          key={p.id}
          game={game}
          record={record}
          upto={upto}
          owner={p.id}
          name={p.name}
          color={p.color}
          arriving={arriving}
        />
      ))}
    </>
  );
}

function Pile({
  game,
  record,
  upto,
  owner,
  name,
  color,
  arriving,
}: {
  game: GameState;
  record: GameRecord;
  upto: number;
  owner: string;
  name: string;
  color: string;
  arriving: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const dead = useMemo(() => fallen(game, owner), [game, owner]);
  const tint = useMemo(() => faded(color), [color]);
  const summary = useMemo(() => {
    let pts = 0;
    for (const m of dead) {
      const u = m.unitId ? game.units[m.unitId] : undefined;
      if (u) pts += (u.sheet?.points ?? 0) / Math.max(1, u.modelIds.length);
    }
    return { pts: Math.round(pts) };
  }, [dead, game.units]);
  // Which units, how many, and in which rounds: read from the log only while the list is open.
  const units = useMemo(() => {
    if (!open) return [];
    const lost = roundsLost(record, upto);
    const by = new Map<string, { id: string; name: string; n: number; rounds: Set<number> }>();
    for (const m of dead) {
      const u = m.unitId ? game.units[m.unitId] : undefined;
      if (!u) continue;
      const row = by.get(u.id) ?? { id: u.id, name: u.name, n: 0, rounds: new Set<number>() };
      row.n++;
      const r = lost.get(m.id);
      if (r !== undefined) row.rounds.add(r);
      by.set(u.id, row);
    }
    return [...by.values()].map((row) => ({
      ...row,
      when: [...row.rounds].sort((a, b) => a - b),
    }));
  }, [open, record, upto, dead, game.units]);
  if (!dead.length) return null;
  const side = sideOf(game, owner);
  // Over the middle of the first row, at its outer side.
  const first = pileSlot(game, owner, 0);
  const last = pileSlot(game, owner, Math.min(dead.length, PER_ROW) - 1);
  const rows = Math.ceil(Math.min(dead.length, MAX_SHOWN) / PER_ROW);
  return (
    <group>
      {dead
        .slice(0, MAX_SHOWN)
        .map((m, i) =>
          arriving.has(m.id) ? null : (
            <Lying key={m.id} model={m} at={pileSlot(game, owner, i)} side={side} color={tint} />
          ),
        )}
      <Html
        position={[(first.x + last.x) / 2, 1.2, first.y + side * (rows * ROW_STEP)]}
        center
        zIndexRange={[9, 0]}
        className="ruler casualty-pile"
      >
        <button className="link" onClick={() => setOpen(!open)} title="Units lost">
          <strong style={{ color }}>{name}</strong> · {dead.length} model{dead.length === 1 ? "" : "s"}
          {summary.pts ? ` · ${summary.pts} pts` : ""}
          {dead.length > MAX_SHOWN ? ` (+${dead.length - MAX_SHOWN} not shown)` : ""}
        </button>
        {open && (
          <ul>
            {units.map((u) => (
              <li key={u.id}>
                {u.name} × {u.n}
                {u.when.length > 0 && (
                  <span className="muted">
                    {" "}
                    · round{u.when.length > 1 ? "s" : ""} {u.when.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Html>
    </group>
  );
}

/** A model lying on its side in the pile, head away from the table; it fades in as it arrives. */
function Lying({ model, at, side, color }: { model: Model; at: Vec2; side: number; color: string }) {
  const r = Math.min(baseSizeInches(model.base).width, baseSizeInches(model.base).depth) / 2;
  const ref = useRef<Group>(null);
  const [born] = useState(() => performance.now());
  const done = useRef(false);
  useFrame(() => {
    if (done.current || !ref.current) return;
    const k = reduced() ? 1 : Math.min(1, (performance.now() - born) / FADE_MS);
    fade(ref.current, k);
    if (k >= 1) done.current = true;
  });
  return (
    <group ref={ref} position={[at.x, r, at.y]} rotation-x={(side * Math.PI) / 2}>
      <Figure model={model} color={color} />
    </group>
  );
}

/** Sets every material under `g` to opacity `k`, transparent only while fading. */
function fade(g: Group, k: number) {
  g.traverse((o) => {
    const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!mat || Array.isArray(mat)) return;
    mat.transparent = k < 1;
    mat.opacity = k;
    mat.depthWrite = k >= 1;
  });
}

/**
 * One slain model: it tips over about its base edge (away from `from`), with a
 * small bounce, lies still, then fades out where it lies (and fades in on the
 * pile). With reduced motion it just appears in the pile.
 */
export function Topple({
  model,
  color,
  from,
  start,
}: {
  model: Model;
  color: string;
  /** Where the blow came from; it falls away from here. */
  from: Vec2 | null;
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
    // Gone from where it fell; it fades in on the pile instead of crossing the table.
    if (t > FALL_MS + REST_MS) fade(g, 1 - Math.min(1, (t - FALL_MS - REST_MS) / FADE_MS));
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
