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
import { automateArmy } from "../systems/wh40k/recognize";
import type { OwnArmy } from "../bot/startSolo";
import { dressFromShelf, useDeployed } from "../ui/shelfActions";

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
  /** Models that come with a place stand there as given (a TTS table, UX 477). */
  keepPlaces = false,
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
    for (const intent of spawnIntents(get(), owner, units, `${owner}-${tag}`, roster.name, keepPlaces))
      send(intent, owner);
    const color = armyColor(get(), owner, roster.color);
    if (color) send(color, owner);
    if (roster.army) send({ type: "player/army", army: roster.army }, owner);
  }
}

/**
 * The player's own army on the near side and the computer's on the far side
 * (#56): its sample army unless one is given. A shelf army comes with its
 * figures and dice; either can be saved back to the shelf from the side panel.
 */
export function deployOwn(mine: OwnArmy, get: () => GameState, send: Send, theirs?: ImportedRoster): void {
  const game = get();
  const tag = crypto.randomUUID().slice(0, 6);
  // A roster just read gets the rules the app can play ticked, as the import panel does (UX 370).
  const roster =
    mine.shelf || !mine.roster.army
      ? mine.roster
      : { ...mine.roster, army: automateArmy(mine.roster.army, systemOf(game)) };
  deploySamples(get, send, tag, [roster, theirs ?? systemModule(game.system ?? DEFAULT_SYSTEM).sample(1)]);
  const owner = sidePlayers(get(), 0)[0]?.id;
  if (!owner) return;
  const prefix = `${owner}-${tag}`;
  useDeployed.setState({ [owner]: { roster, prefix, shelfId: mine.shelf?.id } });
  if (mine.shelf) void dressFromShelf(mine.shelf, owner, prefix);
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
