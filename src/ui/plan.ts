import { create } from "zustand";
import type { GameRecord, GameState, PlayerId, UnitId } from "../core";
import { currentSlot } from "../core/content/turn";
import { aliveModels } from "../systems/wh40k/rules";
import { sendPlanning } from "../talk/talk";
import { useStore } from "../store";
import { fireNext, useVolley, volleyWeapons } from "./volley";

/**
 * Your next turn, planned while the other player takes theirs (#81 "Waiting
 * with purpose"). In plan mode a drag of your own models leaves ghosts where
 * they'd go instead of moving them, and clicking an enemy with one of your
 * units picked marks it as that unit's target. Nothing here is in the log or
 * sent to anyone: the other screen hears only that you're planning
 * (talk/plan). On your turn, "Move as planned" and "Shoot as planned" do it.
 */
interface PlanState {
  /** Drags leave ghosts, enemy clicks pick targets. */
  on: boolean;
  /** The game the plan is for (its first event's time): a new game starts a clean plan. */
  game: string;
  /** Where each unit's models would go, by unit. */
  moves: Record<UnitId, Record<string, { x: number; y: number }>>;
  /** Each unit's planned target. */
  shots: Record<UnitId, UnitId>;
  /** Units still to shoot, in order, while "Shoot as planned" runs. */
  shooting: UnitId[];
}

export const usePlan = create<PlanState>(() => ({ on: false, game: "", moves: {}, shots: {}, shooting: [] }));

const gameKey = (record: GameRecord) => String(record.events[0]?.at ?? "");

/** This game's plan (an older game's is dropped). */
export function planFor(record: GameRecord): PlanState {
  const plan = usePlan.getState();
  if (plan.game === gameKey(record)) return plan;
  const fresh = { on: false, game: gameKey(record), moves: {}, shots: {}, shooting: [] };
  usePlan.setState(fresh);
  return fresh;
}

/** Turn plan mode on or off, telling the table only that this player is planning. */
export function setPlanning(on: boolean): void {
  planFor(useStore.getState().record);
  if (usePlan.getState().on === on) return;
  usePlan.setState({ on });
  sendPlanning(on);
}

/** Plan a unit's move: where its models would end up. */
export function planMove(unitId: UnitId, to: Record<string, { x: number; y: number }>): void {
  planFor(useStore.getState().record);
  usePlan.setState((s) => ({ moves: { ...s.moves, [unitId]: to } }));
}

/** Plan a unit's target, or clear it (null). */
export function planShot(unitId: UnitId, targetId: UnitId | null): void {
  planFor(useStore.getState().record);
  usePlan.setState((s) => {
    const { [unitId]: _gone, ...rest } = s.shots;
    return { shots: targetId ? { ...rest, [unitId]: targetId } : rest };
  });
}

/** Forget a unit's plan. */
export function forgetPlan(unitId: UnitId): void {
  usePlan.setState((s) => {
    const { [unitId]: _m, ...moves } = s.moves;
    const { [unitId]: _s, ...shots } = s.shots;
    return { moves, shots };
  });
}

/** Whether the game is in a phase with this id (40k's slots: "movement", "shooting"). */
export function inPhase(game: GameState, id: string): boolean {
  try {
    return game.turn.round > 0 && currentSlot(game)?.id === id;
  } catch {
    return false;
  }
}

/** The planned moves that can still be made: your units, alive, on the table. */
export function movesReady(game: GameState, mine: (id: PlayerId) => boolean): UnitId[] {
  return Object.keys(usePlan.getState().moves).filter((id) => {
    const u = game.units[id];
    return !!u && mine(u.owner) && !u.status?.reserves && aliveModels(game, u).length > 0;
  });
}

/** The planned shots that can still be taken: your unit and its target both standing. */
export function shotsReady(game: GameState, mine: (id: PlayerId) => boolean): UnitId[] {
  return Object.entries(usePlan.getState().shots)
    .filter(([id, target]) => {
      const u = game.units[id];
      const v = game.units[target];
      return (
        !!u && !!v && mine(u.owner) && aliveModels(game, u).length > 0 && aliveModels(game, v).length > 0
      );
    })
    .map(([id]) => id);
}

/** Move every planned unit to its ghosts: one logged move each. */
export function moveAsPlanned(units: UnitId[]): void {
  const { game, dispatch } = useStore.getState();
  const { moves } = usePlan.getState();
  for (const id of units) {
    const unit = game.units[id];
    const to = moves[id];
    if (!unit || !to) continue;
    const list = Object.entries(to)
      .filter(([m]) => game.models[m] && !game.models[m]!.destroyed)
      .map(([m, at]) => ({ id: m, to: at }));
    if (list.length) dispatch({ type: "models/move", moves: list }, unit.owner);
    usePlan.setState((s) => {
      const { [id]: _gone, ...rest } = s.moves;
      return { moves: rest };
    });
  }
}

/** Shoot with each planned unit at its target, one after another: each one's whole volley. */
export function shootAsPlanned(units: UnitId[]): void {
  usePlan.setState({ shooting: units });
  shootNext();
}

function shootNext(): void {
  const { game, select } = useStore.getState();
  const plan = usePlan.getState();
  const [next, ...rest] = plan.shooting;
  if (!next) return;
  usePlan.setState((s) => {
    const { [next]: _gone, ...shots } = s.shots;
    return { shooting: rest, shots };
  });
  const target = plan.shots[next];
  const weapons = target ? volleyWeapons(game, next, target).filter((w) => !w.why) : [];
  if (!target || !weapons.length) return shootNext();
  select(next);
  useVolley.setState({
    queue: { attackerId: next, targetId: target, weapons: weapons.map((w) => w.id), total: weapons.length },
  });
  fireNext();
}

// When one planned unit's volley is done, the next planned unit fires.
useVolley.subscribe((v, prev) => {
  if (prev.queue && !v.queue && usePlan.getState().shooting.length)
    window.setTimeout(() => {
      const g = useStore.getState().game;
      if (!g.attack && !useVolley.getState().queue) shootNext();
    }, 0);
});

// Your turn: plan mode ends (and the table hears so); a turn of yours that ends drops what wasn't used.
useStore.subscribe((s, prev) => {
  const self = s.session?.selfId;
  if (!self || s.mode === "hotseat") return;
  const seat = s.game.players[self]?.seat;
  const mine = seat !== undefined && s.game.turn.activeSeat === seat;
  const was = seat !== undefined && prev.game.turn.activeSeat === seat;
  if (mine && !was && usePlan.getState().on) setPlanning(false);
  if (!mine && was) usePlan.setState({ moves: {}, shots: {}, shooting: [] });
});
