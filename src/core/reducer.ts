import type { GameEvent } from "./actions";
import { revealMatches } from "./secrets";
import { shareSideResources, sidePlayers } from "./teams";
import { applyDamage } from "./attack";
import { applyAction, applyRunOutcomes, endReaction, setRun } from "./content/play";
import { applyPlayerAction, appliedKey, recordUse } from "./content/player";
import { advanceTurn, endActivation, initialResources, passTurn, systemOf } from "./content/turn";
import { transformPositions } from "./formation";
import { baseSizeInches } from "./geometry";
import { applyEventRef } from "./script";
import type { GameState, Model, Player, TerrainPiece, Unit, UnitSheet, Vec2 } from "./types";

/**
 * Apply one event's effect on the table. Pure: returns a new state and never
 * mutates the input. Sequencing, undo and history live in the event log
 * (log.ts), which is the source of truth; this only folds one event in.
 */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  // In a team game a side's counters (CP, VP) are one set (core/teams.ts).
  return shareSideResources(state, reduce(state, event));
}

function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player/join": {
      const known = state.players[event.player.id];
      // First come, first seated, filling the emptier side up to the team size; a rejoining player keeps their seat.
      const size = state.settings.teamSize ?? 1;
      const count = (seat: number) => Object.values(state.players).filter((p) => p.seat === seat).length;
      const free = count(0) < size || count(1) < size;
      const seat = known?.seat ?? event.player.seat ?? (free ? (count(1) < count(0) ? 1 : 0) : undefined);
      const player = { ...event.player, ...(seat === undefined ? {} : { seat }) };
      player.name = playerName(state, player);
      // A player joining a side shares its counters.
      const mate = seat === undefined ? undefined : sidePlayers(state, seat).find((p) => p.id !== player.id);
      const resources =
        state.resources[player.id] ?? (mate && state.resources[mate.id]) ?? initialResources(state);
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
        status: { ...body.status, attached: true },
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
    case "unit/form": {
      const unit = state.units[event.id];
      if (!unit) return state;
      const order = event.order?.filter((id) => unit.modelIds.includes(id));
      const modelIds = order && order.length === unit.modelIds.length ? order : unit.modelIds;
      const models = { ...state.models };
      for (const { id, to, facing } of event.models ?? []) {
        const m = models[id];
        if (m && m.unitId === unit.id) models[id] = { ...m, position: to, facing };
      }
      return {
        ...state,
        models,
        units: { ...state.units, [unit.id]: { ...unit, formation: event.formation, modelIds } },
      };
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
      return {
        ...state,
        ...event.layout,
        terrain: event.layout.terrain.map(upgradePiece),
        tableSource: event.source ?? null,
      };
    case "terrain/add":
    case "terrain/update":
      return {
        ...state,
        terrain: [...state.terrain.filter((t) => t.id !== event.piece.id), upgradePiece(event.piece)],
        tableSource: changedSource(state),
      };
    case "terrain/remove":
      return {
        ...state,
        terrain: state.terrain.filter((t) => t.id !== event.id),
        tableSource: changedSource(state),
      };
    case "clock/pause":
    case "clock/adjust":
    case "clock/call":
      // Read from the log by core/clock.ts; the table itself doesn't change.
      return state;
    case "ruler/set":
      return { ...state, ruler: event.ruler };
    case "player/rename": {
      const p = state.players[event.player];
      return p ? { ...state, players: { ...state.players, [p.id]: { ...p, name: event.name } } } : state;
    }
    case "player/color": {
      const p = state.players[event.player];
      return p ? { ...state, players: { ...state.players, [p.id]: { ...p, color: event.color } } } : state;
    }
    case "campaign/set": {
      if (!event.ref) {
        const { campaign: _c, ...rest } = state;
        return rest;
      }
      // The same book (a newer copy, or a new territory) keeps the armies already linked.
      const armies = state.campaign?.id === event.ref.id ? state.campaign.armies : {};
      return { ...state, campaign: { ...event.ref, armies } };
    }
    case "campaign/army":
      return state.campaign
        ? {
            ...state,
            campaign: {
              ...state.campaign,
              armies: {
                ...state.campaign.armies,
                [event.player]: {
                  armyId: event.armyId,
                  prefix: event.prefix,
                  ...(event.name ? { name: event.name } : {}),
                  ...(event.system ? { system: event.system } : {}),
                },
              },
            },
          }
        : state;
    case "player/dice": {
      const p = state.players[event.player];
      if (!p) return state;
      const { dice: _d, ...rest } = p;
      return {
        ...state,
        players: { ...state.players, [p.id]: event.dice ? { ...rest, dice: event.dice } : rest },
      };
    }
    case "player/ready": {
      const p = state.players[event.player];
      if (!p) return state;
      const { ready: _r, ...rest } = p;
      const player = event.ready ? { ...rest, ready: true } : rest;
      return { ...state, players: { ...state.players, [p.id]: player } };
    }
    case "player/resync":
      return state;
    case "player/rules": {
      const p = state.players[event.player];
      if (!p) return state;
      const { rulesMismatch: _m, ...rest } = p;
      const player = event.missing.length ? { ...rest, rulesMismatch: event.missing } : rest;
      return { ...state, players: { ...state.players, [p.id]: player } };
    }
    case "game/packages": {
      const { type: _t, ...packages } = event;
      const { packageProposal: _p, ...rest } = state;
      // New rules: whoever played without the old ones says again if they still do.
      const players = Object.fromEntries(
        Object.entries(state.players).map(([id, { rulesMismatch: _m, ...p }]) => [id, p]),
      );
      return { ...rest, players, packages };
    }
    case "packages/propose":
      return {
        ...state,
        packageProposal: { by: event.by, packages: event.packages, accepted: [event.by], declined: [] },
      };
    case "packages/withdraw": {
      const { packageProposal: _p, ...rest } = state;
      return rest;
    }
    case "packages/accept":
    case "packages/decline": {
      const p = state.packageProposal;
      if (!p) return state;
      const accepted = p.accepted.filter((id) => id !== event.player);
      const declined = p.declined.filter((id) => id !== event.player);
      if (event.type === "packages/accept") accepted.push(event.player);
      else declined.push(event.player);
      return { ...state, packageProposal: { ...p, accepted, declined } };
    }
    case "template/set": {
      const { [event.id]: _old, ...rest } = state.templates ?? {};
      return { ...state, templates: event.template ? { ...rest, [event.id]: event.template } : rest };
    }
    case "template/scatter": {
      const t = state.templates?.[event.id];
      if (!t) return state;
      const dx = event.to.x - t.at.x;
      const dy = event.to.y - t.at.y;
      const moved = {
        ...t,
        at: event.to,
        from: t.at,
        ...(t.to ? { to: { x: t.to.x + dx, y: t.to.y + dy } } : {}),
      };
      return { ...state, templates: { ...state.templates, [t.id]: moved } };
    }
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
      return advanceTurn(state, 1, event.seed);
    case "turn/prev":
      return advanceTurn(state, -1);
    case "turn/pass":
      return passTurn(state, event.seed);
    case "turn/endActivation":
      return endActivation(state);
    case "pool/set": {
      const next = {
        ...state,
        pools: {
          ...state.pools,
          [event.player]: { ...state.pools?.[event.player], [event.resource]: event.faces },
        },
      };
      return event.use ? recordUse(next, event.player, event.use) : next;
    }
    case "game/branch":
      return { ...state, branch: event.branch };
    case "game/system": {
      // Only before the battle starts: the table, settings and counters follow the system.
      if (state.turn.round !== 0) return state;
      const next = { ...state, system: event.system };
      const system = systemOf(next);
      const resources: GameState["resources"] = {};
      for (const id of Object.keys(state.players)) resources[id] = initialResources(next);
      return {
        ...next,
        table: system.defaultTable ?? state.table,
        settings: { ...state.settings, ...(system.settings as Partial<GameState["settings"]>) },
        resources,
      };
    }
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
    case "attack/allocate": {
      const attack = state.attack;
      if (!attack?.run) return state;
      const overrides = {
        ...attack.run.overrides,
        allocate: { ...attack.run.overrides?.allocate, order: event.order },
      };
      return { ...state, attack: { ...attack, run: { ...attack.run, overrides } } };
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
    case "action/take":
      return applyAction(state, event);
    case "player/action":
      return applyPlayerAction(state, event);
    case "ability/apply":
      return updateUnit(state, event.unitId, (u) => ({
        ...u,
        status: { ...u.status, [appliedKey(event.ability)]: true },
      }));
    case "mission/set":
      return { ...state, mission: event.mission, zones: event.zones, objectives: event.objectives };
    case "score/confirm": {
      if (state.scores?.some((s) => s.key === event.key)) return state;
      const { type: _t, ...entry } = event;
      const scores = [...(state.scores ?? []), entry];
      // The side's VP (shared by teammates, core/teams.ts): the first player at the seat holds it.
      const holder = sidePlayers(state, event.seat)[0];
      if (!holder || !event.vp) return { ...state, scores };
      const own = state.resources[holder.id] ?? {};
      return {
        ...state,
        scores,
        resources: { ...state.resources, [holder.id]: { ...own, VP: (own.VP ?? 0) + event.vp } },
      };
    }
    case "secret/commit": {
      const mine = { ...state.secrets?.[event.player] };
      for (const { key, commitment } of event.secrets) if (!mine[key]) mine[key] = { commitment };
      return { ...state, secrets: { ...state.secrets, [event.player]: mine } };
    }
    case "secret/reveal": {
      // Every peer checks the reveal; one that doesn't match its commitment changes nothing.
      const entry = state.secrets?.[event.player]?.[event.key];
      if (!revealMatches(entry, event.value, event.salt)) return state;
      const mine = {
        ...state.secrets![event.player],
        [event.key]: { ...entry!, revealed: { value: event.value } },
      };
      return { ...state, secrets: { ...state.secrets, [event.player]: mine } };
    }
    case "unit/reserve": {
      const next = updateUnit(state, event.id, (u) => {
        const { reserves: _r, arrived: _a, ...status } = u.status ?? {};
        // Taken back out of reserve before the battle, it simply stands deployed.
        if (!event.reserve && state.turn.round === 0) return { ...u, status };
        return { ...u, status: event.reserve ? { ...status, reserves: true } : { ...status, arrived: true } };
      });
      const models = { ...next.models };
      for (const { id, to } of event.moves) if (models[id]) models[id] = { ...models[id]!, position: to };
      // Arriving models are set up, not moved: drop the start point so it doesn't count as a move.
      if (!event.reserve)
        for (const id of next.units[event.id]?.modelIds ?? [])
          if (models[id]) {
            const { phaseStart: _p, ...m } = models[id]!;
            models[id] = m;
          }
      return { ...next, models };
    }
    case "unit/specialMove": {
      const unit = state.units[event.id];
      if (!unit) return state;
      const models = { ...state.models };
      for (const id of unit.modelIds)
        if (models[id])
          models[id] = { ...models[id]!, phaseStart: models[id]!.position, phaseStartZ: models[id]!.z ?? 0 };
      return updateUnit({ ...state, models }, event.id, (u) => ({
        ...u,
        status: { ...u.status, allowance: event.inches, [event.flag]: true },
      }));
    }
    case "reaction/end":
      return endReaction(state, event.run ?? null);
    case "procedure/set":
      return setRun(state, event.run);
    case "script/step": {
      const after = event.events.reduce(applyEvent, state);
      return { ...after, script: event.script };
    }
    case "log/note":
    case "campaign/award":
      return state;
    case "procedure/outcomes":
      return applyRunOutcomes(state, event.outcomes);
    case "module/set": {
      const mine = { ...state.modules?.[event.module], [event.key]: event.value };
      return { ...state, modules: { ...state.modules, [event.module]: mine } };
    }
    case "procedure/clear": {
      const cleared = { ...state, procedure: null };
      const ended = event.end ? endReaction(cleared, event.end.run ?? null) : cleared;
      return event.script ? applyEvent(ended, event.script) : ended;
    }
    case "undo":
      // Undo is resolved by the log's replay.
      return state;
  }
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
  // A player's committed secrets follow them to their new id (their device still holds the values).
  const { [from]: mine, ...secrets } = state.secrets ?? {};
  const { [from]: pool, ...pools } = state.pools ?? {};
  return {
    ...state,
    players: { ...players, [to]: { ...old, id: to } },
    resources: { ...resources, [to]: res ?? initialResources(state) },
    units,
    models,
    ...(state.secrets ? { secrets: mine ? { ...secrets, [to]: mine } : secrets } : {}),
    ...(state.pools ? { pools: pool ? { ...pools, [to]: pool } : pools } : {}),
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
  // Teammates number on: side 1 has Players 1 and 3, side 2 has Players 2 and 4.
  const before = Object.values(state.players).filter(
    (p) => p.id !== player.id && p.seat === player.seat,
  ).length;
  const fallback = player.seat === undefined ? "Spectator" : `Player ${player.seat + 1 + 2 * before}`;
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

applyEventRef.fn = applyEvent;

/** A named table, marked as changed once its terrain is edited. */
function changedSource(state: GameState): GameState["tableSource"] {
  return state.tableSource ? { ...state.tableSource, changed: true } : state.tableSource;
}
