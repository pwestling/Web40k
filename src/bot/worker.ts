import "../systems";
import { applyEvent, stateAt, type GameRecord, type GameState } from "../core";
import type { BotMove } from "../soak/bot";
import { botPolicy } from "./player";
import type { Policy } from "./policy";
import type { FromBot, ToBot } from "./think";

/**
 * The computer opponent's thinking for built-in games (#45), off the main
 * thread: a Sharp decision can take a second on a phone, which froze the
 * table. It keeps a replica of the game record, folded with the same
 * reducer, so a move call carries only who is asking.
 */
let record: GameRecord | null = null;
let state: GameState | null = null;
let policies = new Map<string, Policy>();

function apply(m: ToBot): FromBot | null {
  switch (m.t) {
    case "init":
      record = m.record;
      state = stateAt(record);
      policies = new Map();
      return null;
    case "events": {
      if (!record || !state) return null;
      record = { ...record, events: [...record.events, ...m.events] };
      // An undo takes earlier events back: fold from the start.
      if (m.events.some((l) => l.event.type === "undo")) state = stateAt(record);
      else for (const l of m.events) state = { ...applyEvent(state, l.event), seq: l.seq };
      return null;
    }
    case "saw":
      if (state) for (const p of policies.values()) p.saw?.(state, m.move);
      return null;
    case "move": {
      if (!record || !state) return { id: m.id, t: "ok", move: null };
      const key = `${m.level}:${m.seat}:${m.seed}`;
      let policy = policies.get(key);
      if (!policy) policies.set(key, (policy = botPolicy(m.level, state, m.seat, { seed: m.seed })));
      const move: BotMove | null = policy.move(record, state, { seat: m.seat, player: m.player });
      return { id: m.id, t: "ok", move };
    }
  }
}

self.onmessage = (e: MessageEvent<ToBot>) => {
  try {
    const reply = apply(e.data);
    if (reply) self.postMessage(reply);
  } catch (err) {
    if (e.data.t === "move")
      self.postMessage({
        id: e.data.id,
        t: "error",
        error: err instanceof Error ? err.message : String(err),
      });
  }
};
