import "../../systems";
import { applyEvent, resolveIntent, stateAt } from "../../core";
import type { GameRecord, GameState, Intent, Model, PlayerId, Unit } from "../../core";
import { maxWounds } from "../../core/attack";
import { aliveModels } from "../../core/units";
import { playMatch } from "../../bot/match";
import { botPolicy } from "../../bot/player";
import { destinations } from "../../bot/moves";
import type { Policy } from "../../bot/policy";
import { chargeMove, type BotMove } from "../../soak/bot";

export { chargeMove };

/**
 * Building the review benchmark's positions (#63): a real game played by
 * Steady up to the moment asked for, so the turn's bookkeeping (activation
 * dice, the command stack, what has moved) is the game's own, then the table
 * rearranged in code: units placed, hurt, copied or taken off.
 */

export interface Position {
  record: GameRecord;
  state: GameState;
  /** The side whose decision it is. */
  seat: number;
}

class Reached extends Error {}

/** A whole game's package source, for a game that isn't built in. */
type Package = Parameters<typeof playMatch>[0]["systemPkg"];

/** The game as Steady plays it from the sample armies, stopped at the first table `at` accepts. */
async function reach(
  system: string,
  at: (s: GameState) => boolean,
  opts: { seed?: number; first?: number; systemPkg?: Package } = {},
): Promise<{ record: GameRecord; state: GameState }> {
  const seed = opts.seed ?? 1;
  let got: { record: GameRecord; state: GameState } | null = null;
  const stop = (p: Policy): Policy => ({
    name: p.name,
    move(record, state, me) {
      if (!state.procedure && !state.attack && !state.script && !state.pending && at(state)) {
        got = { record, state };
        throw new Reached();
      }
      return p.move(record, state, me);
    },
    saw: (s, m) => p.saw?.(s, m),
  });
  const pkg = opts.systemPkg ? { systemPkg: opts.systemPkg } : {};
  await playMatch(
    { system, seed, ...pkg, ...(opts.first !== undefined ? { first: opts.first } : {}) },
    (start) => [
      stop(botPolicy("steady", start, 0, { seed })),
      stop(botPolicy("steady", start, 1, { seed: seed + 1 })),
    ],
  );
  if (!got) throw new Error(`${system}: never reached the position asked for`);
  return got;
}

/** A position from a table as it stands: no history before it. */
export function positionOf(record: GameRecord, state: GameState, seat: number): Position {
  return { record: { ...record, initial: state, events: [] }, state, seat };
}

/** Changes to a table, each returning a new one. */
class Table {
  constructor(public s: GameState) {}

  unit(name: string, owner?: PlayerId): Unit {
    const u = Object.values(this.s.units).find((x) => x.name === name && (!owner || x.owner === owner));
    if (!u) throw new Error(`no unit ${name}`);
    return u;
  }

  /** Every unit but these taken off the table (all their models destroyed); these whole and unhurt. */
  only(...ids: string[]): this {
    const models = { ...this.s.models };
    for (const u of Object.values(this.s.units))
      for (const id of u.modelIds)
        models[id] = ids.includes(u.id)
          ? { ...models[id]!, destroyed: false, woundsLost: 0 }
          : { ...models[id]!, destroyed: true };
    this.s = { ...this.s, models };
    return this;
  }

  /** Every unit's per-turn flags cleared (moved, advanced, shot...), but those matching `keep`. */
  fresh(keep?: RegExp): this {
    const units = { ...this.s.units };
    for (const u of Object.values(units)) {
      const status = Object.fromEntries(Object.entries(u.status ?? {}).filter(([k]) => keep?.test(k)));
      units[u.id] = { ...u, status };
    }
    this.s = { ...this.s, units };
    return this;
  }

  /** The unit's activation started, as the engine starts one (games of activations). */
  activate(id: string, budget = 2): this {
    const u = this.s.units[id]!;
    const status = { ...u.status, acting: true, activated: true, actionsTaken: 0, actionBudget: budget };
    this.s = { ...this.s, units: { ...this.s.units, [id]: { ...u, status } } };
    return this;
  }

  /** No objectives on the table: nothing to gain by going anywhere. */
  noObjectives(): this {
    this.s = { ...this.s, objectives: [] };
    return this;
  }

  /** No secrets kept (Conquest: no command stack this round, so any regiment may activate). */
  noSecrets(): this {
    this.s = { ...this.s, secrets: {} };
    return this;
  }

  /** A status flag set on the unit (FSD: pinned). */
  flag(id: string, key: string, value: number | boolean = true): this {
    const u = this.s.units[id]!;
    this.s = { ...this.s, units: { ...this.s.units, [id]: { ...u, status: { ...u.status, [key]: value } } } };
    return this;
  }

  noTerrain(): this {
    this.s = { ...this.s, terrain: [] };
    return this;
  }

  /** The unit moved as a block so its models' centre is at (x, y). */
  place(id: string, x: number, y: number): this {
    const u = this.s.units[id]!;
    const ms = u.modelIds.map((m) => this.s.models[m]!).filter((m) => !m.destroyed);
    const cx = ms.reduce((a, m) => a + m.position.x, 0) / ms.length;
    const cy = ms.reduce((a, m) => a + m.position.y, 0) / ms.length;
    const models = { ...this.s.models };
    for (const m of u.modelIds) {
      const was = models[m]!;
      const to = { x: was.position.x + x - cx, y: was.position.y + y - cy };
      // Where it stood at the phase's start moves too: it was placed, it hasn't moved.
      const { phaseVia: _v, ...rest } = was;
      models[m] = { ...rest, position: to, ...(was.phaseStart ? { phaseStart: to } : {}) };
    }
    this.s = { ...this.s, models };
    return this;
  }

  /** The unit cut down to its first `left` models, the last of them with `wounds` wounds left (default: unhurt). */
  hurt(id: string, left: number, wounds?: number): this {
    const u = this.s.units[id]!;
    const models = { ...this.s.models };
    const alive = u.modelIds.filter((m) => !models[m]!.destroyed);
    alive.forEach((m, i) => {
      const was = models[m]!;
      if (i >= left) models[m] = { ...was, destroyed: true };
      else if (i === left - 1 && wounds !== undefined)
        models[m] = { ...was, woundsLost: Math.max(0, maxWounds(was) - wounds) };
    });
    this.s = { ...this.s, models };
    return this;
  }

  /** A copy of a unit (new ids), placed at (x, y). */
  copy(id: string, newId: string, x: number, y: number, name?: string): this {
    const u = this.s.units[id]!;
    const models = { ...this.s.models };
    const ids = u.modelIds.map((m, i) => {
      const nid = `${newId}-m${i}`;
      models[nid] = { ...(models[m] as Model), id: nid, unitId: newId };
      return nid;
    });
    this.s = {
      ...this.s,
      models,
      units: { ...this.s.units, [newId]: { ...u, id: newId, name: name ?? u.name, modelIds: ids } },
    };
    return this.place(newId, x, y);
  }

  /** An intent played on the table as the host would (dice at their middle face); throws if refused. */
  apply(intent: Intent, by: PlayerId): this {
    const record: GameRecord = { format: "open-battle/record@1", initial: this.s, events: [] };
    const event = resolveIntent(
      intent,
      by,
      () => 0.5,
      this.s,
      (seq) => stateAt(record, seq),
    );
    if (!event) throw new Error(`refused: ${intent.type}`);
    this.s = { ...applyEvent(this.s, event), seq: this.s.seq + 1 };
    return this;
  }

  /** A terrain piece like the first one named so in the layout (or the first one), at (x, y). */
  terrain(from: GameState, x: number, y: number, name?: RegExp): this {
    const t = from.terrain.find((p) => !name || name.test(p.name)) ?? from.terrain[0];
    if (!t) throw new Error("no terrain in the layout");
    this.s = {
      ...this.s,
      terrain: [...this.s.terrain, { ...t, id: `bench-${this.s.terrain.length}`, position: { x, y } }],
    };
    return this;
  }
}

const centre = (ms: Model[]) => ({
  x: ms.reduce((a, m) => a + m.position.x, 0) / ms.length,
  y: ms.reduce((a, m) => a + m.position.y, 0) / ms.length,
});

/** An action at a target (a shot, a fight), as the review reads one. */
export function act(s: GameState, unit: string, action: string, targetId?: string, weapon?: string): BotMove {
  const u = s.units[unit]!;
  return {
    intent: {
      type: "action/take",
      unitId: unit,
      action,
      ...(weapon ? { weapon } : {}),
      ...(targetId ? { targetId } : {}),
    } as Intent,
    as: u.owner,
    kind: "bench",
  };
}

/** The unit's models moved by (dx, dy), as a move intent. */
export function shift(s: GameState, unit: string, dx: number, dy: number): BotMove {
  const u = s.units[unit]!;
  return {
    intent: {
      type: "models/move",
      moves: aliveModels(s, u).map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } })),
    } as Intent,
    as: u.owner,
    kind: "bench",
  };
}

/** The unit moved `inches` towards (x, y) (stopping there). */
export function toward(s: GameState, unit: string, x: number, y: number, inches: number): BotMove {
  const c = centre(aliveModels(s, s.units[unit]!));
  const d = Math.hypot(x - c.x, y - c.y) || 1;
  const k = Math.min(inches, d) / d;
  return shift(s, unit, (x - c.x) * k, (y - c.y) * k);
}

/**
 * One of the moves the computer would consider for the unit (bot destinations,
 * any game's move shape): the one ending nearest (x, y), or farthest with `away`.
 */
export function goal(
  s: GameState,
  unit: string,
  inches: number,
  x: number,
  y: number,
  away = false,
): BotMove {
  const u = s.units[unit]!;
  const c = centre(aliveModels(s, u));
  const end = (m: BotMove) => {
    const i = m.intent as Intent & {
      moves?: { id: string; to: { x: number; y: number } }[];
      delta?: { x: number; y: number };
    };
    if (i.type === "models/move" && i.moves) return centre(i.moves.map((v) => ({ position: v.to }) as Model));
    return { x: c.x + (i.delta?.x ?? 0), y: c.y + (i.delta?.y ?? 0) };
  };
  const ms = destinations(s, u, inches);
  if (!ms.length) throw new Error(`${unit} has nowhere to go`);
  const d = (m: BotMove) => Math.hypot(end(m).x - x, end(m).y - y) * (away ? -1 : 1);
  return ms.reduce((a, b) => (d(b) < d(a) ? b : a));
}

/** An action that moves the unit (a Normal move), then the move. */
export function moveWith(s: GameState, unit: string, action: string | null, move: BotMove): BotMove {
  if (!action) return move;
  return { ...act(s, unit, action), then: move };
}

/** A charge at `target`, with the move into contact. */
export function charge(s: GameState, unit: string, action: string, target: string, inches = 12): BotMove {
  const u = s.units[unit]!;
  const ctx = { rng: () => 0.5, kept: new Map(), idle: 0 };
  return { ...act(s, unit, action, target), then: chargeMove(s, u, ctx, inches, target) };
}

const reached = new Map<string, Promise<{ record: GameRecord; state: GameState }>>();

/**
 * A game reached once (and kept) by `key`, then laid out afresh by `lay`:
 * terrain cleared, each unit's turn flags cleared but those `keep` matches.
 * `systemPkg` benches a whole game from a package (#69): it is loaded for the
 * game reached and stays registered, code and hooks, for the judging after.
 */
export async function scene(
  system: string,
  key: string,
  at: (s: GameState) => boolean,
  lay: (t: Table, id: (name: string) => string) => void,
  opts: { first?: number; keep?: RegExp; terrain?: boolean; systemPkg?: Package } = {},
) {
  const k = `${system}:${key}`;
  let got = reached.get(k);
  const pkg = opts.systemPkg ? { systemPkg: opts.systemPkg } : {};
  if (!got) reached.set(k, (got = reach(system, at, { first: opts.first ?? 0, ...pkg })));
  const { record, state } = await got;
  const t = new Table(state).fresh(opts.keep);
  if (!opts.terrain) t.noTerrain();
  const id = (name: string) => t.unit(name).id;
  lay(t, id);
  return { t, record, src: state, id };
}
