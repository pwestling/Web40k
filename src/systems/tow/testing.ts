import {
  applyEvent,
  createInitialState,
  currentSlot,
  resolveIntent,
  type GameEvent,
  type GameState,
  type Intent,
  type PlayerId,
} from "../../core";
import "../index";
import { spawnIntents } from "../wh40k/deploy";
import { towSample } from "./sample";

/** Test helpers for the Old World code procedures: a tiny host and two blocks in contact. */

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny host: keeps every state by seq so code procedures can replay. */
export class Table {
  states = new Map<number, GameState>();
  events: GameEvent[] = [];
  constructor(public s: GameState) {
    this.states.set(s.seq, s);
  }
  play(intent: Intent, from: PlayerId, seed = 1): GameEvent {
    const event = resolveIntent(intent, from, rng(seed), this.s, (seq) => this.states.get(seq)!);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    this.s = applyEvent({ ...this.s, seq: this.s.seq + 1 }, event);
    this.states.set(this.s.seq, this.s);
    this.events.push(event);
    return event;
  }
  notes(): string[] {
    return this.events.flatMap((e) =>
      e.type === "script/step" ? e.events.flatMap((x) => (x.type === "log/note" ? [x.text] : [])) : [],
    );
  }
}

export const unitNamed = (s: GameState, name: string) => Object.values(s.units).find((u) => u.name === name)!;

/** Line a unit up in ranks of `files`, front rank on y, facing +y (0) or -y (PI). */
export function block(t: Table, unitId: string, y: number, files: number, facing: number) {
  const unit = t.s.units[unitId]!;
  const dir = facing === 0 ? -1 : 1;
  const moves = unit.modelIds.map((id, i) => ({
    id,
    to: { x: ((i % files) - (files - 1) / 2) * 0.8, y: y + dir * Math.floor(i / files) * 0.8 },
    facing,
  }));
  const moved = applyEvent(
    { ...t.s, units: { ...t.s.units, [unitId]: { ...unit, formation: { kind: "ranked", files } } } },
    { type: "models/move", moves },
  );
  // models/move keeps facings; turn the block too.
  const models = { ...moved.models };
  for (const id of unit.modelIds) models[id] = { ...models[id]!, facing };
  t.s = { ...moved, models };
  t.states.set(t.s.seq, t.s);
}

export function setup(): { t: Table; spears: string; warband: string } {
  const t = new Table(createInitialState());
  t.play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  t.play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  t.play({ type: "game/system", system: "tow-hand" }, "p1");
  t.play({ type: "layout/set", layout: { terrain: [], objectives: [], zones: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(t.s, p, towSample(seat).units, p, "army")) t.play(i, p);
  const spears = unitNamed(t.s, "Marchwarden Spears").id;
  const warband = unitNamed(t.s, "Reaver Warband").id;
  // Front ranks touching.
  block(t, spears, 0, 5, 0);
  block(t, warband, 0.8, 6, Math.PI);
  return { t, spears, warband };
}

export function toPhase(t: Table, id: string) {
  for (let i = 0; i < 20; i++) {
    if (t.s.turn.round > 0 && currentSlot(t.s)?.id === id && t.s.turn.activeSeat === 0) return;
    t.play({ type: "turn/next" }, "p1");
  }
  throw new Error(`no ${id} phase`);
}

export const standing = (s: GameState, unitId: string) =>
  s.units[unitId]!.modelIds.filter((id) => !s.models[id]!.destroyed).length;
