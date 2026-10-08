import {
  DEFAULT_SYSTEM,
  sidePlayers,
  sides,
  systemOf,
  type GameState,
  type Intent,
  type PlayerId,
} from "../core";
import { systemModule } from "../systems";
import { currentSlot } from "../core/content/turn";
import { armyColor, spawnIntents } from "../systems/wh40k/deploy";
import type { Lesson } from "./lesson";
import type { ImportedRoster } from "../systems/wh40k/roster";

type Send = (intent: Intent, as: PlayerId) => void;

/**
 * Both sample armies onto the table, each side's in its own deployment zone
 * (the front door's demos and the lessons). Ranked systems deploy their
 * blocks at the list's frontage (or five wide).
 */
export function deploySamples(
  get: () => GameState,
  send: Send,
  tag: string,
  /** Other armies than the sides' samples, by seat (a pick of factions). */
  armies?: [ImportedRoster, ImportedRoster],
): void {
  const game = get();
  const system = game.system ?? DEFAULT_SYSTEM;
  const ranked = systemOf(game).unitShape.kind === "ranked";
  for (const seat of sides(game)) {
    const owner = sidePlayers(game, seat)[0]!.id;
    const roster = armies?.[seat === 1 ? 1 : 0] ?? systemModule(system).sample(seat === 1 ? 1 : 0);
    const units = ranked
      ? roster.units.map((u) => ({
          ...u,
          files: u.files ?? Math.min(u.models.length, u.models.length >= 10 ? 5 : u.models.length),
        }))
      : roster.units;
    for (const intent of spawnIntents(get(), owner, units, `${owner}-${tag}`, roster.name))
      send(intent, owner);
    const color = armyColor(get(), owner, roster.color);
    if (color) send(color, owner);
    if (roster.army) send({ type: "player/army", army: roster.army }, owner);
  }
}

/** A seat's units in the order its sample list gave them. */
export function seatUnits(state: GameState, seat: number) {
  const players = new Set(sidePlayers(state, seat).map((p) => p.id));
  return Object.values(state.units).filter((u) => players.has(u.owner));
}

/**
 * A lesson's table: the sample armies, its units placed where the lesson
 * says, everything on the table, and the battle started with the learner
 * going first.
 */
export function setUpLesson(lesson: Lesson, get: () => GameState, send: Send, tag: string): void {
  deploySamples(get, send, tag);
  for (const p of lesson.place ?? []) {
    const state = get();
    const unit = seatUnits(state, p.seat)[p.unit];
    if (!unit) continue;
    const ms = unit.modelIds.map((id) => state.models[id]!).filter(Boolean);
    const cx = ms.reduce((a, m) => a + m.position.x, 0) / ms.length;
    const cy = ms.reduce((a, m) => a + m.position.y, 0) / ms.length;
    send(
      {
        type: "models/move",
        setup: true,
        moves: ms.map((m) => ({
          id: m.id,
          to: { x: m.position.x + p.at.x - cx, y: m.position.y + p.at.y - cy },
        })),
      },
      unit.owner,
    );
  }
  for (const u of Object.values(get().units))
    if (u.status?.reserves) send({ type: "unit/reserve", id: u.id, reserve: false, moves: [] }, u.owner);
  const you = lesson.you ?? 0;
  const first = sidePlayers(get(), you)[0]!.id;
  send({ type: "turn/next" }, first);
  // Straight on past a window for placing dice on cards (FSD's pre-assigning) to the first actions.
  if (currentSlot(get())?.placeDice) send({ type: "turn/next" }, first);
  if (get().turn.activeSeat !== you) send({ type: "turn/first", seat: you }, first);
}
