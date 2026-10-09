import { aliveModels } from "../core/units";
import { maxWounds } from "../core/attack";
import { closeDoor, facingOf, unitCentre, unitGap } from "../core/manoeuvre";
import { blockFrame, isBlock } from "../core/regiment";
import { transformPositions } from "../core/formation";
import { terrainOnMove } from "../core/content/moves";
import { inchesPerUnit } from "../core/content/runtime";
import type { ActionDef } from "../core/content/schema";
import {
  sidePlayers,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
  type AutoPart,
  type Rng,
  type Unit,
} from "../core";
import { opposed } from "../core/teams";
import { settleZ } from "../core/terrain";
import { actingUnits, actionTargets } from "../core/content/play";
import { fightOrder } from "../systems/wh40k/fight";
import { currentSlot, plainActivations, schedule, systemOf } from "../core/content/turn";
import { parseDice, type DiceExpr } from "../core/dice";
import { gameModule, systemModule } from "../systems";
import { freeMoves, legal, takenKey, type BotContext, type BotMove } from "../soak/bot";
import { rangeOf, type BotTuning } from "./evaluate";
import type { Policy, Seat } from "./policy";

/**
 * The moves a computer player can make (split from player.ts, #70): where a
 * unit can go, charges and landings, and the small checks the Thinker and
 * the random player share. Imports nothing from its siblings.
 */

/** The module's tuning for the bot, if it has any. */
export function tuningOf(system: string | undefined): BotTuning | undefined {
  return gameModule(system)?.bot;
}

/** Moves a policy may make in one activation, and in one phase with no unit acting, before it must move on. */
const ACTIVATION_CAP = 40;
const PHASE_CAP = 250;

/**
 * Whatever a policy thinks, a unit's go ends and the game moves on: past
 * the cap it ends the activation, passes, or goes to the next phase (UX 351).
 */
export function guarded(p: Policy, seat: number): Policy {
  let mark = "";
  let n = 0;
  return {
    name: p.name,
    move(record, state, me) {
      const mine = new Set(sidePlayers(state, seat).map((x) => x.id));
      const acting = actingUnits(state).filter((u) => mine.has(u.owner));
      const m = `${state.turn.round}:${state.turn.activeSeat}:${state.turn.phase}:${acting.map((u) => u.id).join()}`;
      n = m === mark ? n + 1 : 0;
      mark = m;
      if (n >= (acting.length ? ACTIVATION_CAP : PHASE_CAP) && !state.script?.waiting) {
        const on: BotMove[] = [
          ...acting.map((u) => ({
            intent: { type: "turn/endActivation" } as Intent,
            as: u.owner,
            kind: "endActivation",
          })),
          { intent: { type: "turn/pass" } as Intent, as: me.player, kind: "pass" },
          { intent: { type: "turn/next" } as Intent, as: me.player, kind: "next" },
        ];
        const go = on.find((x) => legal(record, state, x));
        if (go) return go;
      }
      return p.move(record, state, me);
    },
    saw: (state, move) => p.saw?.(state, move),
  };
}

/** Before the battle: ready up (the armies are already in their zones). */
export function setupMove(record: GameRecord, state: GameState, ctx: BotContext, me: Seat): BotMove | null {
  for (const m of freeMoves(state, { ...ctx, rng: () => 0.99 }))
    if (m.as === me.player && m.intent.type === "turn/next" && legal(record, state, m)) return m;
  return null;
}

export interface Candidate {
  move: BotMove;
  /** What it uses up this phase (a unit's move, a weapon fired). */
  key?: string;
  /** Tries: 1 for a move with no dice. */
  tries: number;
  /** Must be played if it can be (a fight the unit is in). */
  must?: boolean;
  /** Activates the unit (alternating activations): judged by the best thing it could then do. */
  activates?: boolean;
  /** A faction stratagem on one of ours (#49): judged by that unit's best action after it, less its cost. */
  boost?: { unit: string; cp: number };
  /** A Hazardous weapon (40k): judged with its expected harm to its own bearers, not one roll of it. */
  hazard?: { unit: string; weapon: string };
  /** A charge rolled and moved by hand (Conquest): judged as landing or falling short, by the odds. */
  charge?: { unit: string; target: string };
}

/** The same choice: one unit's action (with its weapon and target), or the same placed moves. */
export function sameMove(a: BotMove, b: BotMove): boolean {
  const x = a.intent;
  const y = b.intent;
  if (x.type !== y.type) return false;
  if (x.type === "action/take" && y.type === "action/take")
    return (
      x.unitId === y.unitId &&
      x.action === y.action &&
      (("weapon" in x && x.weapon) || "") === (("weapon" in y && y.weapon) || "") &&
      (("targetId" in x && x.targetId) || "") === (("targetId" in y && y.targetId) || "") &&
      !a.then === !b.then
    );
  return JSON.stringify(x) === JSON.stringify(y);
}

/** The unit a move is for, or the player action's id. */
export function unitOf(state: GameState, m: BotMove): string | undefined {
  const i = m.intent;
  if (i.type === "action/take") return i.unitId;
  if (i.type === "models/move") return i.moves[0] ? state.models[i.moves[0].id]?.unitId : undefined;
  if (i.type === "script/start") return typeof i.args?.unit === "string" ? i.args.unit : undefined;
  if (i.type === "player/action") return `player:${i.action}`;
  return undefined;
}

/** What a move played uses up this phase, as the bot keys its own (a unit's move, a weapon fired). */
export function usedKey(state: GameState, m: BotMove): string | undefined {
  const i = m.intent;
  if (i.type === "action/take") {
    const def = systemOf(state).actions.find((a) => a.id === i.action);
    return def?.procedure
      ? `${i.unitId}:${i.action}:${("weapon" in i && i.weapon) || ""}`
      : takenKey(state, i.unitId, i.action);
  }
  if (i.type === "models/move") {
    const unit = i.moves[0] ? state.models[i.moves[0].id]?.unitId : undefined;
    return unit ? `${unit}:move` : undefined;
  }
  if (i.type === "script/start" && typeof i.args?.unit === "string")
    return `${i.args.unit}:code:${i.procedure}`;
  if (i.type === "player/action") return `player:${i.action}`;
  return undefined;
}

/** A move of models, or of a regiment as a block (Conquest). */
const moving = (t: string | undefined) => t === "models/move" || t === "unit/move";
export const isMove = (m: BotMove) => moving(m.intent.type) || moving(m.then?.intent.type);

export const standing = (state: GameState, u: Unit) =>
  u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);

export function dedupe(moves: BotMove[]): BotMove[] {
  const seen = new Set<string>();
  return moves.filter((m) => {
    const k = JSON.stringify(m.intent);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const centreOf = (state: GameState, u: Unit) => {
  const ms = aliveModels(state, u);
  return {
    x: ms.reduce((a, m) => a + m.position.x, 0) / Math.max(1, ms.length),
    y: ms.reduce((a, m) => a + m.position.y, 0) / Math.max(1, ms.length),
  };
};

export function enemiesWithin(state: GameState, u: Unit, inches: number): Unit[] {
  const c = centreOf(state, u);
  return Object.values(state.units)
    .filter((e) => opposed(state, e.owner, u.owner) && aliveModels(state, e).length && !e.status?.reserves)
    .map((e) => ({ e, d: Math.hypot(centreOf(state, e).x - c.x, centreOf(state, e).y - c.y) }))
    .filter((x) => x.d <= inches + 6)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.e);
}

const num = (s: string | undefined) => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : undefined;
};

/** How far a unit moves by hand: the module's say, else its Move characteristic, else 6". */
export function moveInches(state: GameState, u: Unit, tuning?: BotTuning): number {
  if (tuning?.moveInches) return tuning.moveInches(state, u);
  const c = aliveModels(state, u)[0]?.profile?.chars;
  // Random Movement ("2D6+1", The Old World): its average, not the 2 it starts with.
  const random = randomMove(state, u);
  if (random) return (random.count * (random.sides + 1)) / 2 + random.bonus;
  // In the system's unit (FSD's Move is in DU of 3").
  const move = num(c?.M) ?? num(c?.Move);
  return move === undefined ? 6 : move * inchesPerUnit(systemOf(state));
}

/** The furthest a unit can hurt from (its longest shot, else 1"), plus a move. */
export function reachOf(state: GameState, u: Unit, tuning?: BotTuning): number {
  return Math.max(1, rangeOf(state, u)) + moveInches(state, u, tuning);
}

/**
 * Where a unit might move this turn: towards each objective (stopping on
 * it), towards the nearest enemy (stopping short), and back from it. The
 * unit moves as a block, staying on the table, and around terrain it can't
 * cross (or short of it), less what terrain on the way costs it. A regiment
 * in a game that wants it (BotTuning.faceMoves) turns to face where it goes,
 * or ends facing the nearest enemy.
 */
export function destinations(state: GameState, u: Unit, inches: number): BotMove[] {
  const ms = aliveModels(state, u);
  if (!ms.length) return [];
  const c = centreOf(state, u);
  const goals: { x: number; y: number; stop: number }[] = state.objectives.map((o) => ({
    ...o.position,
    stop: 0.5,
  }));
  const foes = Object.values(state.units)
    .filter((e) => opposed(state, e.owner, u.owner) && aliveModels(state, e).length && !e.status?.reserves)
    .map((e) => centreOf(state, e))
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  if (foes[0]) {
    goals.push({ ...foes[0], stop: 3 });
    // Back off, the same distance the other way.
    goals.push({ x: 2 * c.x - foes[0].x, y: 2 * c.y - foes[0].y, stop: 0 });
  }
  if (foes[1]) goals.push({ ...foes[1], stop: 3 });
  const hx = state.table.width / 2 - 1.5;
  const hy = state.table.depth / 2 - 1.5;
  const frame = tuningOf(state.system)?.faceMoves ? blockFrame(state, u) : null;
  const pivot = frame ? unitCentre(state, u) : c;
  const ground = terrainCheck(state, u);
  const climbs = !!tuningOf(state.system)?.climbs;
  const out: BotMove[] = [];
  for (const g of goals) {
    const dist = Math.hypot(g.x - c.x, g.y - c.y);
    const d = Math.max(0, Math.min(inches, dist - g.stop));
    if (d < 0.5) continue;
    const turnTo = (dir: { x: number; y: number }) => (frame ? facingOf(dir) - frame.facing : 0);
    // The move along a heading, kept on the table, as where each model ends up.
    const along = (angle: number, len: number) => {
      const dir = rotateBy({ x: (g.x - c.x) / dist, y: (g.y - c.y) / dist }, angle);
      let dx = dir.x * len;
      let dy = dir.y * len;
      const turn = turnTo(dir);
      const at = transformPositions(
        ms.map((m) => m.position),
        pivot,
        turn,
        { x: 0, y: 0 },
      );
      for (const p of at) {
        dx = Math.max(-hx - p.x, Math.min(hx - p.x, dx));
        dy = Math.max(-hy - p.y, Math.min(hy - p.y, dy));
      }
      return { dx, dy, turn, to: at.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    };
    // Straight there; else around what blocks the way, or short of it.
    let step: ReturnType<typeof along> | null = null;
    let near = Infinity;
    for (const [angle, f] of [
      [0, 1],
      [0.6, 1],
      [-0.6, 1],
      [1.2, 1],
      [-1.2, 1],
      [0, 0.66],
      [0, 0.33],
    ] as const) {
      let s = along(angle, d * f);
      let fit = ground(s.to);
      if (fit === null) continue;
      // Terrain on the way costs movement: what's left of the move, if this went further.
      if (fit > 0 && d * f > inches - fit) {
        s = along(angle, Math.max(Math.min(1, inches), inches - fit));
        fit = ground(s.to);
        if (fit === null) continue;
      }
      const left = Math.hypot(g.x - c.x - s.dx, g.y - c.y - s.dy);
      if (left < near - 0.25) [step, near] = [s, left];
      if (angle === 0 && f === 1) break;
    }
    if (!step) continue;
    if (!frame) {
      out.push({
        intent: {
          type: "models/move",
          // A model up on a floor steps down where the floor ends, as a drag does (core/terrain.ts settleZ).
          moves: ms.map((m, i) =>
            (m.z ?? 0) > 0 || climbs
              ? { id: m.id, to: step.to[i]!, z: settleZ(state.terrain, step.to[i]!, m.z ?? 0) }
              : { id: m.id, to: step.to[i]! },
          ),
        } as Intent,
        as: u.owner,
        kind: "move",
      });
      continue;
    }
    const block = (turn: number): BotMove => ({
      intent: {
        type: "unit/move",
        id: u.id,
        pivot,
        turn,
        delta: { x: step.dx, y: step.dy },
        how: "forward",
        distance: Math.hypot(step.dx, step.dy),
      } as Intent,
      as: u.owner,
      kind: "move",
    });
    out.push(block(step.turn));
    // Ending facing the nearest enemy, so it's in the front arc for a charge.
    const at = { x: pivot.x + step.dx, y: pivot.y + step.dy };
    if (foes[0] && Math.hypot(foes[0].x - at.x, foes[0].y - at.y) > 0.5)
      out.push(block(turnTo({ x: foes[0].x - at.x, y: foes[0].y - at.y })));
  }
  return out;
}

/** A direction turned by `angle` radians. */
function rotateBy(v: { x: number; y: number }, angle: number) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * How terrain treats a move of this unit to where its models would end up
 * (TerrainCategoryDef.movement, the core "terrain" path check): null when it
 * runs into terrain the unit can't cross, else the inches the worst piece on
 * the way costs it (0 for none).
 */
function terrainCheck(state: GameState, u: Unit): (to: { x: number; y: number }[]) => number | null {
  const system = systemOf(state);
  const matters = (system.terrain ?? []).some((t) => t.blocksMovement || t.slows || t.movement?.length);
  if (!matters || !state.terrain.length) return () => 0;
  const ms = aliveModels(state, u);
  const per = inchesPerUnit(system);
  return (to) => {
    const models = { ...state.models };
    ms.forEach((m, i) => (models[m.id] = { ...m, phaseStart: m.position, position: to[i]! }));
    const { blocked, slowed } = terrainOnMove({ ...state, models }, system, u);
    return blocked.length ? null : (slowed?.by ?? 0) * per;
  };
}

/** Whether an action's targets hang on the weapon used (its filter or reasons read "weapon"). */
const byWeapon = new WeakMap<object, boolean>();
export function weaponTargets(def: ActionDef): boolean {
  let v = byWeapon.get(def);
  if (v === undefined) {
    v = /"weapon[."]/.test(JSON.stringify(def.target ?? {}));
    byWeapon.set(def, v);
  }
  return v;
}

/** A weapon keyword (any case), e.g. "Hazardous". */
export function hasKeyword(u: Unit, weapon: string, keyword: string): boolean {
  const k = keyword.toLowerCase();
  return (u.sheet?.weapons[weapon]?.keywords ?? []).some((w) => w.trim().toLowerCase() === k);
}

/**
 * Where a multiple attack (ActionDef.repeat) could go: every way of sharing
 * `n` attacks among the three nearest targets (all at one, split two ways,
 * one each), first target first. One attack: each target alone.
 */
export function aims(targets: string[], n: number): string[][] {
  if (n <= 1) return targets.map((t) => [t]);
  const near = targets.slice(0, 3);
  const out: string[][] = [];
  const grow = (from: number, picked: string[]) => {
    if (picked.length === n) return void out.push(picked);
    for (let i = from; i < near.length; i++) grow(i, [...picked, near[i]!]);
  };
  grow(0, []);
  return out;
}

/**
 * A charge the player rolls and moves by hand (a regiment game whose module
 * names its charge roll, Conquest): the roll to make for it, labelled so
 * the unit remembers it and the game's charge hook answers it. Null otherwise.
 */
export function handCharge(state: GameState, u: Unit): Intent | null {
  const dice = systemModule(state.system ?? "").chargeRoll;
  if (!dice || !isBlock(u)) return null;
  return { type: "dice/roll", count: dice.count, sides: dice.sides, label: "charge", unitId: u.id };
}

/**
 * How far a code action's charge goes in a try: the unit's move plus the
 * game's charge roll (TOW: the higher of 2D6), rolled, or a Random Movement's
 * dice rolled in their place; 24" where the game names no roll. A charge that
 * falls short stops there.
 */
export function chargeReach(state: GameState, u: Unit, rng: Rng): number {
  const dice = systemModule(state.system ?? "").chargeRoll;
  if (!dice) return 24;
  // Random Movement is rolled for the charge instead of the charge dice plus Movement.
  const random = randomMove(state, u);
  if (random)
    return Array.from({ length: random.count }, () => 1 + Math.floor(rng() * random.sides)).reduce(
      (a, b) => a + b,
      random.bonus,
    );
  const faces = Array.from({ length: dice.count }, () => 1 + Math.floor(rng() * dice.sides));
  const roll = dice.keep === "highest" ? Math.max(...faces) : faces.reduce((a, b) => a + b, 0);
  return moveInches(state, u, tuningOf(state.system)) + roll;
}

/** A unit's Movement written as dice ("2D6+1": rolled for each move and charge), else null. */
function randomMove(state: GameState, u: Unit): DiceExpr | null {
  const m = (aliveModels(state, u)[0]?.profile?.chars.M ?? "").trim();
  if (!/^\d*\s*d\s*\d/i.test(m)) return null;
  try {
    const d = parseDice(m.replace(/\s+/g, ""));
    return d.sides ? d : null;
  } catch {
    return null;
  }
}

/** A unit's March (its M), in inches. */
export function marchOf(state: GameState, u: Unit): number {
  return num(aliveModels(state, u)[0]?.profile?.chars.M) ?? 0;
}

/**
 * The charge move a regiment has rolled for and not made yet: lined up
 * against the nearest enemy it may charge that the roll plus its March
 * reaches, as "close the door" would; null if none does (a short charge,
 * which the game's charge hook ends the activation for).
 */
export function landing(state: GameState, u: Unit, declaredOnly = false): BotMove | null {
  const roll = u.status?.charge;
  if (!u.status?.charged || typeof roll !== "number") return null;
  const short = state.modules?.[state.system ?? ""]?.[`short:${u.id}`];
  if (short === state.turn.round) return null;
  const reach = roll + marchOf(state, u);
  // Reviewing (#63), the enemy the charge was declared against, where the roll names it (chargeAt flags).
  const declared = Object.keys(declaredOnly ? (u.status ?? {}) : {})
    .filter((k) => k.startsWith("chargeAt."))
    .map((k) => k.slice("chargeAt.".length));
  let best: { move: BotMove; d: number } | null = null;
  for (const t of targetsOf(state, u.id, "charge")) {
    const e = state.units[t.unitId];
    if (!t.ok || !e || (declared.length && !declared.includes(e.id))) continue;
    // Reached as the game's charge hook measures it: the gap between the units.
    const gap = unitGap(state, u, e);
    const door = closeDoor(state, u, e);
    if (!door || door.distance < 0.05 || gap > reach + 0.05) continue;
    if (best && best.d <= gap) continue;
    best = {
      move: { intent: { ...door.move, how: "charge" } as Intent, as: u.owner, kind: "charge" },
      d: gap,
    };
  }
  return best?.move ?? null;
}

/** The table with a unit's models as they were before (its wounds and losses undone). */
export function unhurt(s: GameState, before: GameState, unitId: string): GameState {
  const ids = before.units[unitId]?.modelIds ?? [];
  const models = { ...s.models };
  for (const id of ids) {
    const was = before.models[id];
    const now = models[id];
    if (was && now) models[id] = { ...now, woundsLost: was.woundsLost, destroyed: was.destroyed };
  }
  return { ...s, models };
}

/** The table with a model taking `n` wounds. */
export function wounded(s: GameState, modelId: string, n: number): GameState {
  const m = s.models[modelId];
  if (!m) return s;
  const lost = Math.min(maxWounds(m), (m.woundsLost ?? 0) + n);
  return {
    ...s,
    models: {
      ...s.models,
      [modelId]: { ...m, woundsLost: lost, destroyed: lost >= maxWounds(m) || m.destroyed },
    },
  };
}

/** A stratagem rule that works on attacks against its unit. */
export function shields(parts: AutoPart[]): boolean {
  return parts.some(
    (p) => p.kind === "invuln" || p.kind === "fnp" || (p.kind === "attack" && p.side === "targeted"),
  );
}

/**
 * The candidates the 40k fight order allows now: fights by our units whose
 * pick it is (Fights First first), and more fights by a unit already
 * fighting (its other weapons); everything that isn't a fight stays. "wait"
 * when it's the other player's pick and we have nothing else to fight with.
 */
export function inOrder(
  state: GameState,
  order: NonNullable<ReturnType<typeof fightOrder>>,
  candidates: Candidate[],
  mine: Set<PlayerId>,
): Candidate[] | "wait" {
  const fight = (c: Candidate) =>
    c.move.intent.type === "action/take" && /fight|melee/i.test(c.move.intent.action)
      ? c.move.intent.unitId
      : null;
  const ours = !!order.picker && mine.has(order.picker);
  const allowed = (id: string) => (ours && order.eligible.includes(id)) || !!state.units[id]?.status?.fought;
  const fights = candidates.filter((c) => fight(c) !== null);
  // Finish the unit fighting now before picking another.
  const going = fights.filter((c) => state.units[fight(c)!]?.status?.fought);
  const ok = going.length ? going : fights.filter((c) => allowed(fight(c)!));
  if (!ok.length && order.picker && !mine.has(order.picker)) return "wait";
  return [...candidates.filter((c) => fight(c) === null), ...ok];
}

/** A game of plain activations (units take turns moving and acting, with no activation actions). */
export function plainGame(start: GameState): boolean {
  const system = systemOf(start);
  return (
    schedule(system).some((s) => s.kind === "alternate") &&
    !system.actions.some((a) => a.activates !== undefined)
  );
}

/** Taking turns at activations whose units then take actions (Conquest, FSD), not plain activations. */
export function actionActivations(state: GameState): boolean {
  return currentSlot(state)?.kind === "alternate" && !plainActivations(state);
}

/**
 * A unit's targets for an action (core actionTargets), kept while the
 * models and units stay the same: the bot asks for them over and over on
 * each table it tries out.
 */
export function targetsOf(
  state: GameState,
  unitId: string,
  action: string,
  weapon?: string,
): ReturnType<typeof actionTargets> {
  let memo = targetMemo.get(state.models);
  if (!memo || memo.units !== state.units || memo.terrain !== state.terrain)
    targetMemo.set(state.models, (memo = { units: state.units, terrain: state.terrain, targets: new Map() }));
  const key = `${state.turn.round}:${state.turn.phase}:${state.turn.activeSeat}:${unitId}:${action}:${weapon ?? ""}`;
  let got = memo.targets.get(key);
  if (!got) memo.targets.set(key, (got = actionTargets(state, unitId, action, weapon)));
  return got;
}
const targetMemo = new WeakMap<
  object,
  { units: unknown; terrain: unknown; targets: Map<string, ReturnType<typeof actionTargets>> }
>();
