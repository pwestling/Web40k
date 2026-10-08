import {
  commitmentOf,
  resolveLogged,
  undoneSeqs,
  sidePlayers,
  type GameRecord,
  type GameState,
  type Intent,
  type PlayerId,
  type Rng,
  type Unit,
} from "../core";
import { opposed } from "../core/teams";
import { nextRoller } from "../core/rolls";
import { aliveModels, unitDistance, weaponReach } from "../systems/wh40k/rules";
import { actingUnits, actionTargets, unitActions } from "../core/content/play";
import { playerActions } from "../core/content/player";
import { currentSlot, systemOf } from "../core/content/turn";
import { gameView } from "../core/script";
import { pendingScores } from "../missions/scoring";
import { gameModule } from "../systems";
import { cardKey, nextCard, stackOf } from "../systems/conquest/command";
import type { CodeAction } from "../sdk";
import { undoGroup } from "../ui/gameLog";

/**
 * The soak bot: given the game as it stands, a random move that the rules
 * allow right now. Anything the game is waiting on (a question from a rule,
 * a reaction window, a roll in progress, a score to confirm) comes first;
 * otherwise the side whose turn it is takes a random action, moves a unit,
 * uses a stratagem or moves the game on. Every move is checked against the
 * host's own resolver before it is sent, so the bot never relies on the
 * host quietly dropping a bad intent.
 */

export interface BotMove {
  intent: Intent;
  /** The player it is sent as. */
  as: PlayerId;
  /** What kind of move, for the report. */
  kind: string;
  /** A move that goes with it, sent straight after (a tidy bot's move action, then the move itself). */
  then?: BotMove;
}

/** Secrets the bot's players committed: commitment → value and salt (a device's local store). */
export type Kept = Map<string, { value: unknown; salt: string }>;

export interface BotContext {
  rng: Rng;
  kept: Kept;
  /** Package code actions for a unit (rules packages loaded in the sandbox engine). */
  packageActions?: (
    unitId: string,
    player: string,
  ) => { id: string; available: true | string; targets: { unitId?: string }[] }[];
  /** Moves since the phase or activation last changed, so the bot moves the game on in time. */
  idle: number;
  /** Scores waiting to be confirmed, as of the last move that could change them. */
  scores?: string[];
  /**
   * Play like an opponent rather than a fuzzer (teaching mode): move units
   * only in movement phases or with a move action, and mostly towards the
   * nearest enemy.
   */
  tidy?: boolean;
  /** A tidy bot's units already moved this phase (keyed by round, side and phase). */
  moved?: { phase: string; units: Set<string> };
  /** Tidy mode: the unit actions taken this phase ("unit:action"), each taken once. */
  taken?: { phase: string; keys: Set<string> };
}

/** Tidy mode: note a move taken, so the bot doesn't repeat the same unit's action in one phase. */
export function noteTaken(ctx: BotContext, state: GameState, move: BotMove): void {
  if (!ctx.tidy || move.intent.type !== "action/take") return;
  const phase = phaseKey(state);
  if (ctx.taken?.phase !== phase) ctx.taken = { phase, keys: new Set() };
  ctx.taken.keys.add(`${move.intent.unitId}:${move.intent.action}`);
}

function phaseKey(state: GameState): string {
  return `${state.turn.round}:${state.turn.activeSeat}:${state.turn.phase}`;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T | undefined => xs[Math.floor(rng() * xs.length)];
const shuffle = <T>(rng: Rng, xs: readonly T[]): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const alive = (state: GameState, u: Unit) =>
  u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);

/** Whether the host would log this move now. Dice don't matter for that, so any rng will do. */
export function legal(record: GameRecord, state: GameState, move: BotMove): boolean {
  try {
    return !!resolveLogged(record, move.intent, move.as, () => 0.5, 0, state);
  } catch {
    return false;
  }
}

/** A secret kept on the bot's "device", committed with a salt from the bot's dice. */
export function keep(ctx: BotContext, value: unknown): string {
  const salt = Math.floor(ctx.rng() * 2 ** 48)
    .toString(16)
    .padStart(12, "0");
  const commitment = commitmentOf(value, salt);
  ctx.kept.set(commitment, { value, salt });
  return commitment;
}

export const lastRound = (state: GameState): number => {
  const r = systemOf(state).turn.rounds;
  return typeof r === "number" ? r : 5;
};

export const battleOver = (state: GameState) => state.turn.round > lastRound(state);

/**
 * What the game is waiting on, if anything: the moves that answer it, the
 * likeliest first. The bot plays the first legal one; if none is legal the
 * game is stuck.
 */
export function waitingOn(
  record: GameRecord,
  state: GameState,
  ctx: BotContext,
): { what: string; moves: BotMove[] } | null {
  const players = Object.values(state.players).filter((p) => p.seat !== undefined);
  const everyone = (intent: Intent, kind: string, first?: PlayerId): BotMove[] =>
    [...(first ? [first] : []), ...players.map((p) => p.id).filter((id) => id !== first)].map((as) => ({
      intent,
      as,
      kind,
    }));

  const q = state.script?.waiting;
  if (q) {
    if (q.reveal !== undefined) {
      const c = state.secrets?.[q.player]?.[q.reveal]?.commitment;
      const k = c ? ctx.kept.get(c) : undefined;
      return {
        what: `a reveal of ${q.reveal} by ${q.player}`,
        moves: k
          ? [{ intent: { type: "script/answer", answer: JSON.stringify(k) }, as: q.player, kind: "reveal" }]
          : [],
      };
    }
    const options = shuffle(ctx.rng, q.options);
    return {
      what: `"${q.question}" for ${q.player}`,
      moves: options.map((o) => ({
        intent: { type: "script/answer", answer: q.secret !== undefined ? keep(ctx, o.id) : o.id },
        as: q.player,
        kind: "answer",
      })),
    };
  }

  const proc = state.procedure;
  if (proc) {
    const run = proc.run;
    if (run.pending) {
      const answers = [
        ...shuffle(
          ctx.rng,
          run.pending.options.map((o) => o.id),
        ),
        "pass",
      ];
      // Pass more often than not, so windows don't swallow the game.
      if (ctx.rng() < 0.5) answers.unshift("pass");
      return {
        what: `the ${run.pending.step} window`,
        moves: answers.flatMap((answer) => everyone({ type: "procedure/respond", answer }, "respond")),
      };
    }
    return {
      what: `the ${proc.action} roll`,
      // The player whose dice these are first (a save is the defender's), so a learner rolls their own.
      moves: everyone(
        run.done ? { type: "procedure/clear" } : { type: "procedure/roll" },
        "roll",
        (!run.done && nextRoller(state, run)) || proc.by,
      ),
    };
  }

  const attack = state.attack;
  if (attack)
    return {
      what: "the attack",
      // Saves are the defender's roll, everything else the attacker's (as the attack panel sends them).
      moves: everyone(
        attack.stage === "done" ? { type: "attack/clear" } : { type: "attack/roll" },
        "attack",
        state.units[attack.stage === "save" ? attack.spec.targetUnitId : attack.spec.attackerUnitId]?.owner,
      ),
    };

  const pending = state.pending;
  if (pending) {
    const seat = sidePlayers(state, pending.seat);
    const react: BotMove[] = [];
    if (ctx.rng() < 0.4)
      for (const u of shuffle(ctx.rng, Object.values(state.units)))
        if (seat.some((p) => p.id === u.owner) && alive(state, u))
          for (const o of unitActions(state, u.id))
            if (o.ok && o.def.reactTo)
              react.push({
                intent: { type: "action/take", unitId: u.id, action: o.def.id },
                as: u.owner,
                kind: "react",
              });
    return {
      what: "a reaction",
      moves: [...react, ...seat.flatMap((p) => everyone({ type: "reaction/pass" }, "pass", p.id))],
    };
  }

  // Scores the mission suggests: the side scores it, or now and then passes.
  const mission = gameModule(state.system)?.app?.missions?.find((m) => m.id === state.mission?.id);
  // Working out the scores folds the whole log, so only after something that can change them.
  const last = record.events.at(-1)?.event.type;
  if (
    mission &&
    (ctx.scores === undefined || last === "turn/next" || last === "score/confirm" || last === "secret/reveal")
  )
    ctx.scores = pendingScores(record, state, mission).map((p) => p.key);
  const score = mission && ctx.scores?.length ? pendingScores(record, state, mission)[0] : undefined;
  if (score) {
    const skip = ctx.rng() < 0.2;
    const intent: Intent = {
      type: "score/confirm",
      key: score.key,
      seat: score.seat,
      round: score.round,
      vp: skip ? 0 : score.vp,
      why: score.why,
      ...(skip ? { skipped: true } : {}),
    };
    return {
      what: `the score ${score.key}`,
      moves: sidePlayers(state, score.seat).map((p) => ({ intent, as: p.id, kind: "score" })),
    };
  }
  return null;
}

/**
 * Random moves for the side whose turn it is, in a rough order of
 * preference, worked out lazily: the caller takes the first the rules allow.
 */
export function* freeMoves(state: GameState, ctx: BotContext): Generator<BotMove> {
  const round = state.turn.round;
  const side = sidePlayers(state, state.turn.activeSeat);
  const mine = (p: PlayerId) =>
    round === 0 ? state.players[p]?.seat !== undefined : side.some((x) => x.id === p);
  const units = shuffle(
    ctx.rng,
    Object.values(state.units).filter((u) => mine(u.owner) && alive(state, u) && !u.status?.reserves),
  );
  const acting = actingUnits(state);
  const next = side.map((p) => ({ intent: { type: "turn/next" } as Intent, as: p.id, kind: "next" }));

  // Before the battle: a few moves around the deployment zone, then start.
  if (round === 0) {
    if (units[0] && ctx.rng() < 0.3) yield moveUnit(state, units[0], ctx, 4);
    yield* next;
    for (const p of Object.values(state.players))
      yield { intent: { type: "turn/next" }, as: p.id, kind: "next" };
    return;
  }

  // Conquest-style command stacks: lock in an order, then draw from it.
  yield* commandStack(
    state,
    ctx,
    side.map((p) => p.id),
  );

  // A tidy bot's movement phase: each unit (the acting one, mid-activation) heads for the enemy once.
  const slotId = currentSlot(state)?.id ?? "";
  if (ctx.tidy && /move/i.test(slotId)) {
    const phase = `${round}:${state.turn.activeSeat}:${state.turn.phase}`;
    if (ctx.moved?.phase !== phase) ctx.moved = { phase, units: new Set() };
    const u = (acting.length ? acting : units).find((x) => !ctx.moved!.units.has(x.id));
    // Units with a move action (40k's Normal move) move through it instead.
    if (u && !unitActions(state, u.id).some((o) => o.ok && o.move !== undefined)) {
      ctx.moved.units.add(u.id);
      yield moveUnit(state, u, ctx, 6);
    }
  }

  // The units' actions, unit by unit (acting units only, mid-activation).
  let anyAction = false;
  const actions = function* (): Generator<BotMove> {
    for (const u of acting.length ? acting : units)
      for (const m of unitMoves(state, u, ctx)) {
        anyAction = true;
        yield m;
      }
  };
  // A tidy opponent gets on with it; the fuzzer lingers to try more things in each phase.
  const patience = ctx.tidy ? 6 : 40;
  const onward = ctx.tidy ? Math.min(0.9, 0.15 + ctx.idle * 0.12) : Math.min(0.9, 0.05 + ctx.idle * 0.04);
  const end = acting.map((u) => ({
    intent: { type: "turn/endActivation" } as Intent,
    as: u.owner,
    kind: "endActivation",
  }));
  const r = ctx.rng();
  if (r < 0.6) yield* actions();
  else if (r < 0.75) yield* codeMoves(state, ctx, units);
  else if (r < 0.8)
    yield* stratagems(
      state,
      ctx,
      side.map((p) => p.id),
    );
  else if (r < 0.95 && units[0] && (!ctx.tidy || /move/i.test(currentSlot(state)?.id ?? "")))
    yield moveUnit(state, units[0], ctx, 6);
  // Move the game on: end an activation, or the phase, more surely the longer it sits.
  if (ctx.rng() < onward) yield* end;
  if (ctx.idle > patience && ctx.rng() < onward) yield* next;
  yield* actions();
  // Nothing else on offer: the game moves on.
  yield* end;
  if (!anyAction || ctx.idle > patience) {
    yield* next;
    for (const p of side) yield { intent: { type: "turn/pass" }, as: p.id, kind: "pass" };
  }
  yield* next;
}

/** A unit's actions now: procedure actions with a weapon and target each, others as they are. */
function* unitMoves(state: GameState, u: Unit, ctx: BotContext): Generator<BotMove> {
  const taken = ctx.taken?.phase === phaseKey(state) ? ctx.taken.keys : undefined;
  for (const o of shuffle(ctx.rng, unitActions(state, u.id))) {
    if (o.def.reactTo) continue;
    // A tidy bot plays like a person would: each action once a phase, and no pointless ones.
    if (ctx.tidy && (taken?.has(`${u.id}:${o.def.id}`) || pointless(state, u, o.def.id))) continue;
    if (o.def.procedure) {
      const weapons = Object.keys(u.sheet?.weapons ?? {});
      const targets = actionTargets(state, u.id, o.def.id).filter((t) => t.ok);
      for (const weapon of shuffle(ctx.rng, weapons.length ? weapons : [undefined]).slice(0, 3))
        for (const t of shuffle(ctx.rng, targets).slice(0, 2)) {
          // A tidy bot doesn't make attacks that can't reach (no dice to roll).
          if (ctx.tidy && weapon && (!reaches(state, u, weapon, t.unitId) || wrongKind(u, weapon, o.def.id)))
            continue;
          const req = { ...(weapon ? { weapon } : {}), targetId: t.unitId };
          if (unitActions(state, u.id, req).find((x) => x.def.id === o.def.id)?.ok)
            yield {
              intent: { type: "action/take", unitId: u.id, action: o.def.id, ...req },
              as: u.owner,
              kind: `action:${o.def.id}`,
            };
        }
      continue;
    }
    if (!o.ok) continue;
    const withUnits = o.commands ? shuffle(ctx.rng, o.commands.candidates).slice(0, o.commands.count) : [];
    const take: BotMove = {
      intent: {
        type: "action/take",
        unitId: u.id,
        action: o.def.id,
        ...(withUnits.length ? { with: withUnits } : {}),
      },
      as: u.owner,
      kind: `action:${o.def.id}`,
    };
    // A tidy bot moves the unit as part of its move action; the fuzzer may or may not get round to it.
    if (ctx.tidy && o.move !== undefined) {
      yield { ...take, then: moveUnit(state, u, ctx, Math.max(1, o.move)) };
      continue;
    }
    yield take;
    if (o.move !== undefined) yield moveUnit(state, u, ctx, Math.max(1, o.move));
  }
}

/** The game module's own code actions (sdk CodeAction), and any a rules package adds. */
function* codeMoves(state: GameState, ctx: BotContext, units: Unit[]): Generator<BotMove> {
  if (state.script) return;
  const mod = gameModule(state.system);
  const phase = currentSlot(state)?.id;
  const view = mod ? gameView(state, mod.system.id) : null;
  for (const u of units.slice(0, 4)) {
    const actor = { player: u.owner, unitId: u.id };
    const rows = [
      ...(view
        ? (mod!.actions ?? [])
            .filter((a: CodeAction) => a.by === "unit" && (!a.phases || (phase && a.phases.includes(phase))))
            .filter((a) => !a.applies || a.applies(view, actor))
            .map((a) => {
              const available = a.available(view, actor);
              const targets = available === true && a.targets ? a.targets(view, actor) : [];
              return { id: a.id, available, targets, targeted: !!a.targets };
            })
        : []),
      ...(ctx.packageActions?.(u.id, u.owner) ?? []).map((r) => ({ ...r, targeted: r.targets.length > 0 })),
    ];
    for (const r of shuffle(ctx.rng, rows)) {
      if (r.available !== true) continue;
      const target = pick(ctx.rng, r.targets)?.unitId;
      if (r.targeted && !target) continue;
      yield {
        intent: {
          type: "script/start",
          procedure: r.id,
          args: { unit: u.id, ...(target ? { target } : {}) },
        },
        as: u.owner,
        kind: `code:${r.id}`,
      };
    }
  }
}

/** Stratagems the side can use now. */
function* stratagems(state: GameState, ctx: BotContext, players: PlayerId[]): Generator<BotMove> {
  for (const p of players)
    for (const o of shuffle(ctx.rng, playerActions(state, p))) {
      if (!o.ok || o.def.custom) continue;
      const target = o.targets ? pick(ctx.rng, o.targets) : undefined;
      if (o.targets && !target) continue;
      yield {
        intent: { type: "player/action", action: o.def.id, ...(target ? { targetId: target } : {}) },
        as: p,
        kind: `stratagem:${o.def.id}`,
      };
    }
}

/** Move a unit as a block by up to `inches` in a random direction, staying on the table. */
function moveUnit(state: GameState, u: Unit, ctx: BotContext, inches: number): BotMove {
  const ms = u.modelIds.map((id) => state.models[id]!).filter((m) => m && !m.destroyed);
  const cx = ms.reduce((a, m) => a + m.position.x, 0) / ms.length;
  const cy = ms.reduce((a, m) => a + m.position.y, 0) / ms.length;
  // A tidy bot heads for the nearest enemy, give or take; the fuzzer goes anywhere.
  const foe = ctx.tidy ? nearestEnemy(state, u, cx, cy) : null;
  const angle = foe ? Math.atan2(foe.x - cx, foe.y - cy) + (ctx.rng() - 0.5) * 0.6 : ctx.rng() * Math.PI * 2;
  const d = foe
    ? Math.max(0, Math.min(Math.hypot(foe.x - cx, foe.y - cy) - 3, inches * (0.6 + 0.4 * ctx.rng())))
    : ctx.rng() * inches;
  const hx = state.table.width / 2 - 2;
  const hy = state.table.depth / 2 - 2;
  const clamp = (v: number, h: number) => Math.max(-h, Math.min(h, v));
  const dx = clamp(cx + Math.sin(angle) * d, hx) - cx;
  const dy = clamp(cy + Math.cos(angle) * d, hy) - cy;
  return {
    intent: {
      type: "models/move",
      moves: ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } })),
    } as Intent,
    as: u.owner,
    kind: "move",
  };
}

/** Whether a weapon reaches the target unit, where its range can be read (true when it can't). */
function reaches(state: GameState, u: Unit, weapon: string, targetId: string): boolean {
  const w = u.sheet?.weapons?.[weapon];
  const target = state.units[targetId];
  if (!w || !target) return true;
  const reach = weaponReach(w);
  if (reach === null) return true;
  return unitDistance(aliveModels(state, u), aliveModels(state, target)) <= reach + 0.05;
}

/** A melee weapon in a shooting action, or a ranged one in a fight. */
function wrongKind(u: Unit, weapon: string, action: string): boolean {
  const kind = u.sheet?.weapons?.[weapon]?.kind;
  return (
    (kind === "melee" && /shoot|fire/i.test(action)) ||
    (kind === "ranged" && /fight|melee|strike/i.test(action))
  );
}

/** Falling back with no enemy near, the kind of move that teaches a learner the wrong thing. */
function pointless(state: GameState, u: Unit, action: string): boolean {
  if (!/withdraw|fall.?back|retreat|disengage/i.test(action)) return false;
  const mine = aliveModels(state, u);
  return !Object.values(state.units).some(
    (e) =>
      opposed(state, e.owner, u.owner) && alive(state, e) && unitDistance(mine, aliveModels(state, e)) <= 6,
  );
}

function nearestEnemy(state: GameState, u: Unit, cx: number, cy: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let dist = Infinity;
  for (const e of Object.values(state.units)) {
    if (!opposed(state, e.owner, u.owner) || !alive(state, e)) continue;
    const ms = e.modelIds.map((id) => state.models[id]!).filter((m) => m && !m.destroyed);
    const x = ms.reduce((a, m) => a + m.position.x, 0) / ms.length;
    const y = ms.reduce((a, m) => a + m.position.y, 0) / ms.length;
    const d = Math.hypot(x - cx, y - cy);
    if (d < dist) [best, dist] = [{ x, y }, d];
  }
  return best;
}

/** Moves a side makes outside its own turn: locking in its command stack for the round. */
export function offTurnMoves(state: GameState, ctx: BotContext, players: PlayerId[]): BotMove[] {
  return commandStack(state, ctx, players).filter((m) => m.kind === "stack");
}

/** Conquest's command stack (systems/conquest/command.ts): commit one this round, then draw the top card. */
function commandStack(state: GameState, ctx: BotContext, players: PlayerId[]): BotMove[] {
  if (state.system !== "conquest-hand") return [];
  const out: BotMove[] = [];
  for (const p of players) {
    const stack = stackOf(state, p);
    if (!stack) {
      const ids = shuffle(
        ctx.rng,
        Object.values(state.units)
          .filter((u) => u.owner === p && alive(state, u))
          .map((u) => u.id),
      );
      if (!ids.length || (!ctx.tidy && ctx.rng() < 0.3)) continue;
      out.push({
        intent: {
          type: "secret/commit",
          player: p,
          secrets: ids.map((id, i) => ({ key: cardKey(state.turn.round, i), commitment: keep(ctx, id) })),
          label: "their command stack",
        },
        as: p,
        kind: "stack",
      });
      continue;
    }
    // Draw only when the last card drawn has had its turn and nobody is mid-activation.
    const top = nextCard(state, stack);
    const k = top && top.unitId === undefined ? ctx.kept.get(top.commitment) : undefined;
    if (top && k && !actingUnits(state).length)
      out.push({
        intent: {
          type: "secret/reveal",
          player: p,
          key: top.key,
          value: k.value,
          salt: k.salt,
          label: "their command card",
        },
        as: p,
        kind: "draw",
      });
  }
  return out;
}

/** The Undo button: a player takes back their own last move (a whole attack at once), as the panel offers it. */
export function undoMove(record: GameRecord, state: GameState, player: PlayerId): BotMove | null {
  const undone = undoneSeqs(record);
  const last = [...record.events]
    .reverse()
    .find(
      (e) =>
        e.by === player &&
        e.event.type !== "undo" &&
        e.event.type !== "player/join" &&
        e.event.type !== "layout/set" &&
        !undone.has(e.seq),
    );
  if (!last) return null;
  const group = undoGroup(record, last.seq, undone, state);
  return {
    intent: { type: "undo", seq: group.seq, ...(group.also.length ? { also: group.also } : {}) },
    as: player,
    kind: "undo",
  };
}
