import type { GameEvent } from "./actions";
import { transformPositions } from "./formation";
import type { GameState } from "./types";

/**
 * Apply one event's effect on the table. Pure: returns a new state and never
 * mutates the input. Sequencing, undo and history live in the event log
 * (log.ts), which is the source of truth; this only folds one event in.
 */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player/join":
      return { ...state, players: { ...state.players, [event.player.id]: event.player } };
    case "model/add":
      return { ...state, models: { ...state.models, [event.model.id]: event.model } };
    case "model/move": {
      const model = state.models[event.id];
      if (!model) return state;
      const moved = { ...model, position: event.to, facing: event.facing ?? model.facing };
      return { ...state, models: { ...state.models, [event.id]: moved } };
    }
    case "model/remove": {
      const { [event.id]: removed, ...models } = state.models;
      const unit = removed?.unitId ? state.units[removed.unitId] : undefined;
      const units = unit
        ? { ...state.units, [unit.id]: { ...unit, modelIds: unit.modelIds.filter((id) => id !== event.id) } }
        : state.units;
      return { ...state, models, units };
    }
    case "unit/add": {
      const models = { ...state.models };
      for (const model of event.models) models[model.id] = { ...model, unitId: event.unit.id };
      const unit = { ...event.unit, modelIds: event.models.map((m) => m.id) };
      return { ...state, units: { ...state.units, [unit.id]: unit }, models };
    }
    case "unit/move": {
      const unit = state.units[event.id];
      if (!unit) return state;
      const members = unit.modelIds.flatMap((id) => state.models[id] ?? []);
      const moved = transformPositions(
        members.map((m) => m.position),
        event.pivot,
        event.turn,
        event.delta,
      );
      const models = { ...state.models };
      members.forEach(
        (m, i) => (models[m.id] = { ...m, position: moved[i]!, facing: m.facing + event.turn }),
      );
      return { ...state, models };
    }
    case "dice/roll":
    case "undo":
      // Rolls only live in the log; undo is resolved by the log's replay.
      return state;
  }
}
