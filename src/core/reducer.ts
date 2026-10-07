import type { GameEvent } from "./actions";
import { applyDamage } from "./attack";
import { transformPositions } from "./formation";
import { baseSizeInches } from "./geometry";
import type { GameState, Model, Player, TerrainPiece, Unit, UnitSheet, Vec2 } from "./types";

/** Unit flags that last one turn; cleared when their owner's turn begins. */
export const TURN_FLAGS = ["moved", "advanced", "fellBack", "shot", "charged", "fought", "advance", "charge"];

/**
 * Apply one event's effect on the table. Pure: returns a new state and never
 * mutates the input. Sequencing, undo and history live in the event log
 * (log.ts), which is the source of truth; this only folds one event in.
 */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player/join": {
      const known = state.players[event.player.id];
      const seats = new Set(Object.values(state.players).map((p) => p.seat));
      // First come, first seated; a rejoining player keeps their seat.
      const seat = known?.seat ?? event.player.seat ?? (seats.has(0) ? (seats.has(1) ? undefined : 1) : 0);
      const player = { ...event.player, ...(seat === undefined ? {} : { seat }) };
      player.name = playerName(state, player);
      const resources = state.resources[player.id] ?? { CP: 0, VP: 0 };
      return {
        ...state,
        players: { ...state.players, [player.id]: player },
        resources: { ...state.resources, [player.id]: resources },
      };
    }
    case "player/claim":
      return claimPlayer(state, event.player, event.by);
    case "model/add":
      return { ...state, models: { ...state.models, [event.model.id]: event.model } };
    case "model/move":
      return updateModel(state, event.id, (m) => ({
        ...m,
        position: event.to,
        facing: event.facing ?? m.facing,
      }));
    case "models/move": {
      const models = { ...state.models };
      for (const { id, to, z } of event.moves) {
        const m = models[id];
        if (m) models[id] = { ...m, position: to, ...(z === undefined ? {} : { z }) };
      }
      return { ...state, models };
    }
    case "model/remove": {
      const { [event.id]: removed, ...models } = state.models;
      const unit = removed?.unitId ? state.units[removed.unitId] : undefined;
      const units = unit
        ? { ...state.units, [unit.id]: { ...unit, modelIds: unit.modelIds.filter((id) => id !== event.id) } }
        : state.units;
      return { ...state, models, units };
    }
    case "model/wounds":
      return updateModel(state, event.id, (m) => ({
        ...m,
        woundsLost: Math.max(0, event.woundsLost),
        destroyed: event.destroyed,
      }));
    case "unit/add": {
      const models = { ...state.models };
      for (const model of event.models)
        models[model.id] = {
          ...model,
          unitId: event.unit.id,
          phaseStart: model.position,
          phaseStartZ: model.z ?? 0,
        };
      const unit = { ...event.unit, modelIds: event.models.map((m) => m.id) };
      return { ...state, units: { ...state.units, [unit.id]: unit }, models };
    }
    case "unit/attach": {
      const leader = state.units[event.id];
      const body = state.units[event.to];
      if (!leader || !body || leader === body) return state;
      const { [event.id]: _gone, ...units } = state.units;
      const models = { ...state.models };
      for (const id of leader.modelIds) if (models[id]) models[id] = { ...models[id]!, unitId: body.id };
      const sheet = body.sheet || leader.sheet ? mergeSheets(body.sheet, leader.sheet) : undefined;
      const merged: Unit = {
        ...body,
        name: `${body.name} + ${leader.name}`,
        // Leaders go last, so damage reaches them after the bodyguard.
        modelIds: [...body.modelIds, ...leader.modelIds],
        ...(sheet ? { sheet } : {}),
      };
      return { ...state, units: { ...units, [body.id]: merged }, models };
    }
    case "unit/remove": {
      const { [event.id]: unit, ...units } = state.units;
      if (!unit) return state;
      const models = { ...state.models };
      for (const id of unit.modelIds) delete models[id];
      return { ...state, units, models };
    }
    case "unit/status":
      return updateUnit(state, event.id, (u) => {
        const status = { ...u.status };
        if (event.value === null) delete status[event.key];
        else status[event.key] = event.value;
        return { ...u, status };
      });
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
    case "dice/roll": {
      // Advance and charge rolls are remembered on the unit for move checks;
      // a battle-shock test below the unit's Leadership shocks it.
      const { label, unitId, results } = event.roll;
      if (!unitId) return state;
      const total = results.reduce((a, b) => a + b, 0);
      if (label === "advance" || label === "charge")
        return updateUnit(state, unitId, (u) => ({ ...u, status: { ...u.status, [label]: total } }));
      if (label === "battleshock")
        return updateUnit(state, unitId, (u) => {
          const first = u.modelIds.map((id) => state.models[id]).find((m) => m && !m.destroyed);
          const ld = Number.parseInt(first?.profile?.chars.LD ?? "", 10);
          const status = { ...u.status, battleShocked: Number.isFinite(ld) && total < ld };
          return { ...u, status };
        });
      return state;
    }
    case "layout/set":
      return { ...state, ...event.layout, terrain: event.layout.terrain.map(upgradePiece) };
    case "terrain/add":
    case "terrain/update":
      return {
        ...state,
        terrain: [...state.terrain.filter((t) => t.id !== event.piece.id), upgradePiece(event.piece)],
      };
    case "terrain/remove":
      return { ...state, terrain: state.terrain.filter((t) => t.id !== event.id) };
    case "objective/move":
      return {
        ...state,
        objectives: state.objectives.map((o) => (o.id === event.id ? { ...o, position: event.to } : o)),
      };
    case "unit/height": {
      const unit = state.units[event.id];
      if (!unit) return state;
      const models = { ...state.models };
      for (const id of unit.modelIds) {
        const m = models[id];
        if (!m) continue;
        const { height: _old, ...rest } = m;
        models[id] = event.height ? { ...rest, height: event.height } : rest;
      }
      return { ...state, models };
    }
    case "unit/figure": {
      const unit = state.units[event.id];
      if (!unit) return state;
      const keys = new Set(event.keys);
      const models = { ...state.models };
      for (const id of unit.modelIds) {
        const m = models[id];
        if (!m || !keys.has(m.profile?.name ?? m.label)) continue;
        const { figure: _f, bands: _b, ...rest } = m;
        models[id] = event.figure ? { ...rest, figure: event.figure, bands: figureBands(m, event) } : rest;
      }
      return { ...state, models };
    }
    case "settings/set":
      return { ...state, settings: { ...state.settings, ...event.settings } };
    case "turn/next":
      return stepTurn(state, 1);
    case "turn/prev":
      return stepTurn(state, -1);
    case "turn/first":
      return { ...state, turn: { ...state.turn, firstSeat: event.seat, activeSeat: event.seat } };
    case "resource/adjust": {
      const own = state.resources[event.player] ?? {};
      const value = (own[event.resource] ?? 0) + event.delta;
      return {
        ...state,
        resources: { ...state.resources, [event.player]: { ...own, [event.resource]: value } },
      };
    }
    case "attack/declare":
      return { ...state, attack: event.attack };
    case "attack/roll": {
      const next = { ...state, attack: event.attack };
      return event.attack.damage && event.attack.stage === "done"
        ? applyDamage(next, event.attack.damage)
        : next;
    }
    case "attack/clear": {
      const attack = state.attack;
      if (!attack) return state;
      const flag = attack.spec.kind === "ranged" ? "shot" : "fought";
      const cleared = { ...state, attack: null };
      return attack.stage === "hit" && !attack.hitDice
        ? cleared
        : updateUnit(cleared, attack.spec.attackerUnitId, (u) => ({
            ...u,
            status: { ...u.status, [flag]: true },
          }));
    }
    case "undo":
      // Undo is resolved by the log's replay.
      return state;
  }
}

/** Phases per player turn. Systems will supply these; 40k's five for now. */
export const PHASES = ["Command", "Movement", "Shooting", "Charge", "Fight"];
export const SEATS = 2;

/**
 * Move the turn marker one phase forwards or back. Entering a phase records
 * where every model stands, so moves are measured from there. Starting a new
 * player turn clears that player's per-turn flags and, going forwards, gives
 * every player 1 CP (40k's Command phase).
 */
function stepTurn(state: GameState, dir: 1 | -1): GameState {
  let { round, activeSeat, phase } = state.turn;
  const { firstSeat } = state.turn;
  phase += dir;
  if (round === 0) {
    // Round 0 is deployment; going forwards starts the battle.
    if (dir === -1) return state;
    round = 1;
    phase = 0;
    activeSeat = firstSeat;
  } else if (round === 1 && activeSeat === firstSeat && phase < 0) {
    round = 0;
    phase = 0;
  } else if (phase >= PHASES.length) {
    phase = 0;
    activeSeat = (activeSeat + 1) % SEATS;
    if (activeSeat === firstSeat) round += 1;
  } else if (phase < 0) {
    phase = PHASES.length - 1;
    if (activeSeat === firstSeat) round -= 1;
    activeSeat = (activeSeat + SEATS - 1) % SEATS;
  }

  const models: Record<string, Model> = {};
  for (const [id, m] of Object.entries(state.models))
    models[id] = { ...m, phaseStart: m.position, phaseStartZ: m.z ?? 0 };
  let next: GameState = { ...state, models, attack: null, turn: { ...state.turn, round, activeSeat, phase } };

  if (dir === 1 && phase === 0) {
    const units: Record<string, Unit> = {};
    for (const [id, u] of Object.entries(next.units)) {
      const seat = next.players[u.owner]?.seat;
      if (seat !== activeSeat || !u.status) {
        units[id] = u;
        continue;
      }
      const status = { ...u.status };
      for (const flag of TURN_FLAGS) delete status[flag];
      units[id] = { ...u, status };
    }
    const resources: GameState["resources"] = {};
    for (const [pid, r] of Object.entries(next.resources)) resources[pid] = { ...r, CP: (r.CP ?? 0) + 1 };
    next = { ...next, units, resources };
  }
  return next;
}

function updateModel(state: GameState, id: string, f: (m: Model) => Model): GameState {
  const m = state.models[id];
  return m ? { ...state, models: { ...state.models, [id]: f(m) } } : state;
}

function updateUnit(state: GameState, id: string, f: (u: Unit) => Unit): GameState {
  const u = state.units[id];
  return u ? { ...state, units: { ...state.units, [id]: f(u) } } : state;
}

/** Hand a player's seat, units and counters to a new peer id. */
function claimPlayer(state: GameState, from: string, to: string): GameState {
  const old = state.players[from];
  if (!old) return state;
  const { [from]: _gone, [to]: _new, ...players } = state.players;
  const { [from]: res, ...resources } = state.resources;
  const units: Record<string, Unit> = {};
  for (const [id, u] of Object.entries(state.units)) units[id] = u.owner === from ? { ...u, owner: to } : u;
  const models: Record<string, Model> = {};
  for (const [id, m] of Object.entries(state.models)) models[id] = m.owner === from ? { ...m, owner: to } : m;
  return {
    ...state,
    players: { ...players, [to]: { ...old, id: to } },
    resources: { ...resources, [to]: res ?? { CP: 0, VP: 0 } },
    units,
    models,
  };
}

function mergeSheets(a: UnitSheet | undefined, b: UnitSheet | undefined): UnitSheet {
  const names = new Set((a?.abilities ?? []).map((x) => x.name));
  return {
    weapons: { ...b?.weapons, ...a?.weapons },
    abilities: [...(a?.abilities ?? []), ...(b?.abilities ?? []).filter((x) => !names.has(x.name))],
    keywords: [...new Set([...(a?.keywords ?? []), ...(b?.keywords ?? [])])],
    ...(a?.points || b?.points ? { points: (a?.points ?? 0) + (b?.points ?? 0) } : {}),
  };
}

/** Read terrain saved before pieces were made of solids (an L of walls on a footprint). */
function upgradePiece(piece: TerrainPiece): TerrainPiece {
  if (Array.isArray(piece.solids)) return piece;
  const old = piece as unknown as { walls?: { from: Vec2; to: Vec2; height: number }[] };
  const solids = (old.walls ?? []).map((w) => ({
    kind: "wall" as const,
    x: (w.from.x + w.to.x) / 2,
    y: (w.from.y + w.to.y) / 2,
    z: 0,
    w: Math.max(0.3, Math.abs(w.to.x - w.from.x)),
    d: Math.max(0.3, Math.abs(w.to.y - w.from.y)),
    h: w.height,
  }));
  return { ...piece, name: piece.name ?? "Ruin", category: piece.category ?? "light", solids };
}

/**
 * A blank or generic name becomes "Player 1"/"Player 2" by seat, and a name
 * another player already has gets a number, so the two sides never look alike.
 */
function playerName(state: GameState, player: Player): string {
  const fallback = player.seat === undefined ? "Spectator" : `Player ${player.seat + 1}`;
  const wanted = player.name.trim();
  const base = !wanted || wanted === "Player" ? fallback : wanted;
  const taken = new Set(
    Object.values(state.players)
      .filter((p) => p.id !== player.id)
      .map((p) => p.name),
  );
  if (!taken.has(base)) return base;
  if (!taken.has(fallback) && base !== fallback) return fallback;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}

/** Thickness of a miniature's base, which the figure stands on. */
export const BASE_THICKNESS = 0.2;

/**
 * Sight bands for a model wearing a figure: its base, then the figure's
 * bands scaled and lifted onto the base. At most four in all.
 */
function figureBands(m: Model, event: Extract<GameEvent, { type: "unit/figure" }>): Model["bands"] {
  if (!event.bands?.length || !event.figure) return undefined;
  const { width, depth } = baseSizeInches(m.base);
  const s = event.figure.scale;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return [
    { r: round(Math.min(width, depth) / 2), z0: 0, z1: BASE_THICKNESS },
    ...event.bands.map((b) => ({
      r: round(b.r * s),
      z0: round(BASE_THICKNESS + b.z0 * s),
      z1: round(BASE_THICKNESS + b.z1 * s),
    })),
  ].slice(0, 4);
}
