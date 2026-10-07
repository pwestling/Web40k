import type { GameEvent } from "./actions";
import type { GameState } from "./types";

const MAX_LOG = 200;

/** Apply one event. Pure: returns a new state and never mutates the input. */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  const seq = state.seq + 1;
  switch (event.type) {
    case "player/join":
      return {
        ...state,
        seq,
        players: { ...state.players, [event.player.id]: event.player },
        log: appendLog(state, { kind: "info", seq, text: `${event.player.name} joined` }),
      };
    case "model/add":
      return { ...state, seq, models: { ...state.models, [event.model.id]: event.model } };
    case "model/move": {
      const model = state.models[event.id];
      if (!model) return { ...state, seq };
      const moved = { ...model, position: event.to, facing: event.facing ?? model.facing };
      return { ...state, seq, models: { ...state.models, [event.id]: moved } };
    }
    case "model/remove": {
      const { [event.id]: _removed, ...models } = state.models;
      return { ...state, seq, models };
    }
    case "dice/roll":
      return { ...state, seq, log: appendLog(state, { kind: "roll", seq, roll: event.roll }) };
  }
}

function appendLog(state: GameState, entry: GameState["log"][number]): GameState["log"] {
  const log = [...state.log, entry];
  return log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log;
}
