import type { GameView, PureFn } from "../../sdk";
import type { GameState } from "../types";
import type { ExprValue } from "./expr";
import type { Id } from "./schema";

/**
 * Module functions data can call: `{ call: "id", args: [...] }` in any
 * expression. They are pure (the game modules spec), so every peer gets the
 * same answer from the same state, and previews can call them too.
 */
const functions = new Map<Id, Record<Id, PureFn>>();

export function registerFunctions(system: Id, fns: Record<Id, PureFn>): void {
  functions.set(system, { ...functions.get(system), ...fns });
}

/** Set by core/script.ts, which builds a module's view of the game (imported here it would cycle). */
export const viewRef: { fn: (state: GameState, module: Id) => GameView } = {
  fn: () => {
    throw new Error("No game view");
  },
};

/** The `call` hook for an EvalContext on this state and system. */
export function callFor(state: GameState, system: Id): (id: Id, args: unknown[]) => ExprValue {
  return (id, args) => {
    const fn = functions.get(system)?.[id];
    if (!fn) throw new Error(`No function "${id}" in ${system}`);
    const out = fn(viewRef.fn(state, system), ...args);
    if (typeof out === "number" || typeof out === "boolean") return out;
    throw new Error(`Function "${id}" returned ${typeof out}, not a number or true/false`);
  };
}
