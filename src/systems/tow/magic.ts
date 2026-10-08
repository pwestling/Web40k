import { unitGap } from "../../core/manoeuvre";
import { opposed } from "../../core/teams";
import type { GameState, Spell, SpellKind, Unit } from "../../core/types";
import type { CodeAction, CodeProcedure, Command, Ctx, GameView } from "../../sdk";
import { alive, casualties, charNum, unitOf, woundAndSave } from "./combat";
import { wizardLevel } from "./specialRules";

/**
 * Rank-and-flank magic (roadmap #32): a wizard casts in the phase its spell's
 * kind belongs to, rolling 2D6 plus its level against the casting value. The
 * opponent may try to dispel with one of their wizards (2D6 plus level, equal
 * to or beating the casting roll). A double 1 always fails, to cast or to
 * dispel; a double 6 cast can't be dispelled but miscasts. Each wizard tries
 * each spell once a turn. Damage spells with hits and a Strength resolve
 * here; other effects (and spells without numbers) are played by hand, with
 * the spell marked on its target until it ends.
 *
 * Spells are player data (core Spell: name, casting value, range, kind), from
 * a spell list file or the roster, never rules text. The mechanics are from
 * general knowledge of the game and unverified; every result is advisory and
 * in the log.
 */

type Roll = { rolls: number[]; total: number };

/** Which phase each kind of spell is cast in. */
export const SPELL_PHASE: Record<SpellKind, string> = {
  enchantment: "strategy",
  hex: "strategy",
  conveyance: "movement",
  missile: "shooting",
  vortex: "shooting",
  assailment: "combat",
};

const KIND_NAME: Record<SpellKind, string> = {
  enchantment: "Enchantment",
  hex: "Hex",
  conveyance: "Conveyance",
  missile: "Magic missile",
  vortex: "Magical vortex",
  assailment: "Assailment",
};

/** In base contact, for assailments. */
const CONTACT = 0.5;

/** Miscast table, 2D6 (invented for Open Battle; unverified against any published table). */
const DETONATION = { upTo: 4, hits: "1d6", strength: 6 };
const BACKLASH_UP_TO = 9;

export const spellsOf = (u: Unit): Spell[] => u.sheet?.spells ?? [];

/** A spell lasting on the table: marked on its target until it ends. */
export interface SpellInPlay {
  spell: string;
  kind: SpellKind;
  caster: string;
  owner: string;
  target: string;
  /** The casting roll a dispel has to reach. */
  total: number;
  round: number;
  seat: number;
  remains: boolean;
}

const turnOf = (state: GameState) => ({ round: state.turn.round, seat: state.turn.activeSeat });

/** The spells this wizard has tried this turn. */
function triedNow(view: GameView, unitId: string): string[] {
  const t = view.own[`cast:${unitId}`] as { round: number; seat: number; spells: string[] } | undefined;
  const now = turnOf(view.state);
  return t && t.round === now.round && t.seat === now.seat ? t.spells : [];
}

/** Drained by a miscast: no more casting this turn. */
function drainedNow(view: GameView, unitId: string): boolean {
  const t = view.own[`drained:${unitId}`] as { round: number; seat: number } | undefined;
  const now = turnOf(view.state);
  return !!t && t.round === now.round && t.seat === now.seat;
}

/** Spells still marked on their targets (a player can take one off by hand). */
export const spellsInPlay = (view: GameView): SpellInPlay[] =>
  ((view.own.inPlay as SpellInPlay[]) ?? []).filter(
    (e) => view.state.units[e.target]?.status?.[`spell:${e.spell}`],
  );

/** Units a spell can be cast at from this wizard, nearest first. */
export function spellTargets(view: GameView, caster: Unit, spell: Spell): { u: Unit; d: number }[] {
  const state = view.state;
  if (!spell.range) return [{ u: caster, d: 0 }];
  const friendly = spell.kind === "enchantment" || spell.kind === "conveyance";
  const reach = spell.kind === "assailment" ? CONTACT : spell.range;
  return Object.values(state.units)
    .filter(
      (u) =>
        alive(state, u).length > 0 &&
        (friendly ? !opposed(state, u.owner, caster.owner) : opposed(state, u.owner, caster.owner)),
    )
    .map((u) => ({ u, d: u.id === caster.id ? 0 : unitGap(state, caster, u) }))
    .filter((x) => x.d <= reach + 1e-4)
    .filter((x) => spell.kind !== "missile" || view.visible(caster.id, x.u.id))
    .sort((a, b) => a.d - b.d);
}

/** The spells this wizard can still cast this phase. */
function castable(view: GameView, u: Unit): Spell[] {
  const tried = triedNow(view, u.id);
  return spellsOf(u).filter((s) => SPELL_PHASE[s.kind] === view.phase && !tried.includes(s.name));
}

/** Wizards on the other side from `player`, still standing and not fleeing. */
function enemyWizards(state: GameState, player: string): Unit[] {
  return Object.values(state.units).filter(
    (u) =>
      opposed(state, u.owner, player) && wizardLevel(u) > 0 && !u.status?.fleeing && alive(state, u).length,
  );
}

/** The wizard's own model (a character among the rank and file, or the lone model). */
function wizardModel(state: GameState, u: Unit) {
  const models = alive(state, u);
  const best = [...models].sort((a, b) => charNum(b, "Ld") - charNum(a, "Ld"))[0];
  return models.find((m) => /wizard|mage|seer|shaman|sorcer|priest/i.test(m.profile?.name ?? "")) ?? best;
}

/** "Bone Shaman (Reaver Warband)", or the unit's name when the wizard is the unit. */
function wizardName(state: GameState, u: Unit): string {
  const name = wizardModel(state, u)?.profile?.name;
  return name && name !== u.name ? `${name} (${u.name})` : u.name;
}

const dice = (hits: string) => {
  const m = /^(\d*)\s*d\s*(\d+)$/i.exec(hits.trim());
  return m ? `${m[1] || 1}d${m[2]}` : null;
};

/** The opponent's dispel window: one of their wizards rolls 2D6 + level to reach the casting roll. */
function* dispel(ctx: Ctx, caster: Unit, spell: Spell, total: number): Generator<Command, boolean, unknown> {
  const state = ctx.view.state;
  const wizards = enemyWizards(state, caster.owner);
  if (!wizards.length) return false;
  const who = wizards[0]!.owner;
  const theirs = wizards.filter((w) => w.owner === who);
  const pick = yield ctx.ask(who, `${caster.name} casts ${spell.name} (${total}). Try to dispel it?`, [
    ...theirs.map((w) => ({
      id: w.id,
      label: `Dispel with ${wizardName(state, w)} (2D6 + ${wizardLevel(w)})`,
    })),
    { id: "no", label: "Let it through" },
  ]);
  const w = theirs.find((x) => x.id === pick);
  if (!w) {
    yield ctx.note(`${spell.name} isn't dispelled`);
    return false;
  }
  const level = wizardLevel(w);
  const r = (yield ctx.roll("2d6", `dispel ${spell.name}`, w.id)) as Roll;
  const double1 = r.rolls.every((x) => x === 1);
  const score = r.total + level;
  if (!double1 && score >= total) {
    yield ctx.note(`${w.name} dispels ${spell.name} (${r.total} + ${level} = ${score}, against ${total})`);
    return true;
  }
  yield ctx.note(
    `${w.name} fails to dispel ${spell.name} (${double1 ? "a double 1" : `${r.total} + ${level} = ${score}, against ${total}`})`,
  );
  return false;
}

/** A miscast: 2D6 on the table above, against the wizard and its unit. */
function* miscast(ctx: Ctx, caster: Unit): Generator<Command, void, unknown> {
  const r = (yield ctx.roll("2d6", "miscast", caster.id)) as Roll;
  if (r.total <= DETONATION.upTo) {
    const h = (yield ctx.roll(DETONATION.hits, "miscast hits", caster.id)) as Roll;
    yield ctx.note(
      `Miscast (${r.total}): a detonation, ${h.total} Strength ${DETONATION.strength} hits on ${caster.name}`,
    );
    const n = yield* woundAndSave(ctx, caster, caster, h.total, DETONATION.strength);
    if (n) yield* casualties(ctx, unitOf(ctx.view, caster.id), n);
    return;
  }
  if (r.total <= BACKLASH_UP_TO) {
    const m = wizardModel(ctx.view.state, caster);
    if (m) {
      const w = Math.max(1, charNum(m, "W", 1));
      const lost = Math.min(w, (m.woundsLost ?? 0) + 1);
      yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost: lost, destroyed: lost >= w });
    }
    yield ctx.note(
      `Miscast (${r.total}): backlash, ${m?.profile?.name ?? caster.name} loses a wound (no saves)`,
    );
    return;
  }
  yield ctx.set(`drained:${caster.id}`, turnOf(ctx.view.state));
  yield ctx.note(`Miscast (${r.total}): ${caster.name}'s wizard is drained and can't cast again this turn`);
}

/** What the spell does once it's through. */
function* effect(ctx: Ctx, caster: Unit, target: Unit, spell: Spell, total: number) {
  const view = ctx.view;
  const damage = spell.kind === "missile" || spell.kind === "vortex" || spell.kind === "assailment";
  const hits = spell.hits ? dice(spell.hits) : null;
  if (damage && (hits || Number(spell.hits) > 0) && spell.strength) {
    const n = hits
      ? ((yield ctx.roll(hits, `${spell.name} hits`, caster.id)) as Roll).total
      : Number(spell.hits);
    yield ctx.note(`${spell.name}: ${n} Strength ${spell.strength} hits on ${target.name}`);
    const unsaved = yield* woundAndSave(ctx, caster, target, n, spell.strength, Math.abs(spell.ap ?? 0));
    if (unsaved) yield* casualties(ctx, unitOf(view, target.id), unsaved);
    return;
  }
  if (spell.kind === "conveyance") {
    yield ctx.note(`${spell.name}: move ${target.name} as the spell says (by hand)`);
    return;
  }
  if (spell.kind === "enchantment" || spell.kind === "hex") {
    const now = turnOf(view.state);
    const entry: SpellInPlay = {
      spell: spell.name,
      kind: spell.kind,
      caster: caster.id,
      owner: caster.owner,
      target: target.id,
      total,
      round: now.round,
      seat: now.seat,
      remains: !!spell.remains,
    };
    yield ctx.set("inPlay", [...spellsInPlay(view), entry]);
    yield ctx.emit({ type: "unit/status", id: target.id, key: `spell:${spell.name}`, value: true });
    yield ctx.note(
      `${target.name} is under ${spell.name} (its effect by hand) ${spell.remains ? "until it is dispelled" : `until the start of ${caster.name}'s side's next turn`}`,
    );
    return;
  }
  yield ctx.note(`${spell.name} on ${target.name}: play its effect by hand`);
}

/** Cast a spell: pick it, roll to cast, give the opponent a dispel, then its effect, and any miscast. */
export const castSpell: CodeProcedure = function* (ctx, args) {
  const caster = unitOf(ctx.view, args.unit);
  const target = unitOf(ctx.view, args.target);
  const options = castable(ctx.view, caster).filter((s) =>
    spellTargets(ctx.view, caster, s).some((x) => x.u.id === target.id),
  );
  if (!options.length) {
    yield ctx.note(`${caster.name} has no spell to cast at ${target.name} now`);
    return;
  }
  let spell = options[0]!;
  if (options.length > 1) {
    const pick = yield ctx.ask(
      caster.owner,
      `Which spell does ${caster.name} cast at ${target.name}?`,
      options.map((s, i) => ({ id: String(i), label: `${s.name} (${s.cv}+, ${KIND_NAME[s.kind]})` })),
    );
    spell = options[Number(pick)] ?? spell;
  }
  const level = wizardLevel(caster);
  yield ctx.set(`cast:${caster.id}`, {
    ...turnOf(ctx.view.state),
    spells: [...triedNow(ctx.view, caster.id), spell.name],
  });
  yield ctx.note(
    `${caster.name} casts ${spell.name} ${target.id === caster.id ? "on itself" : `at ${target.name}`}: 2D6 + ${level} against casting value ${spell.cv}`,
  );
  const r = (yield ctx.roll("2d6", `cast ${spell.name}`, caster.id)) as Roll;
  const total = r.total + level;
  const double1 = r.rolls.every((x) => x === 1);
  const irresistible = r.rolls.every((x) => x === 6);
  if (double1 || (!irresistible && total < spell.cv)) {
    yield ctx.note(
      `${spell.name} fails (${double1 ? "a double 1" : `${r.total} + ${level} = ${total}, short of ${spell.cv}`})`,
    );
    return;
  }
  if (irresistible) yield ctx.note(`A double 6: ${spell.name} is cast with irresistible force`);
  else {
    yield ctx.note(`${spell.name} is cast (${r.total} + ${level} = ${total})`);
    if (yield* dispel(ctx, caster, spell, total)) return;
  }
  yield* effect(ctx, caster, unitOf(ctx.view, target.id), spell, total);
  if (irresistible) yield* miscast(ctx, unitOf(ctx.view, caster.id));
};

/** End a spell in play: its mark comes off the target. */
export function* endSpell(ctx: Ctx, entry: SpellInPlay, why: string): Generator<Command, void, unknown> {
  const left = spellsInPlay(ctx.view).filter((e) => e !== entry && !same(e, entry));
  yield ctx.set("inPlay", left);
  if (!left.some((e) => e.target === entry.target && e.spell === entry.spell))
    yield ctx.emit({ type: "unit/status", id: entry.target, key: `spell:${entry.spell}`, value: null });
  const t = ctx.view.state.units[entry.target];
  yield ctx.note(`${entry.spell} on ${t?.name ?? "its target"} ends (${why})`);
}

const same = (a: SpellInPlay, b: SpellInPlay) =>
  a.spell === b.spell &&
  a.caster === b.caster &&
  a.target === b.target &&
  a.round === b.round &&
  a.seat === b.seat;

/** Spells the enemy keeps in play that this wizard could dispel. */
function dispellable(view: GameView, u: Unit): SpellInPlay[] {
  return spellsInPlay(view).filter((e) => e.remains && opposed(view.state, e.owner, u.owner));
}

/** Dispel a spell the enemy keeps in play: 2D6 + level reaching its casting roll. */
export const dispelInPlay: CodeProcedure = function* (ctx, args) {
  const w = unitOf(ctx.view, args.unit);
  const entry = dispellable(ctx.view, w).find((e) => e.target === args.target);
  if (!entry) return;
  const level = wizardLevel(w);
  yield ctx.set(`cast:${w.id}`, {
    ...turnOf(ctx.view.state),
    spells: [...triedNow(ctx.view, w.id), `dispel:${entry.spell}`],
  });
  const r = (yield ctx.roll("2d6", `dispel ${entry.spell}`, w.id)) as Roll;
  const score = r.total + level;
  if (!r.rolls.every((x) => x === 1) && score >= entry.total)
    yield* endSpell(ctx, entry, `${w.name} dispels it, ${score}`);
  else yield ctx.note(`${w.name} fails to dispel ${entry.spell} (${score} against ${entry.total})`);
};

/** At the start of a side's turn its own lasting spells run out, except those that remain in play. */
export function* expireSpells(ctx: Ctx, player: string): Generator<Command, void, unknown> {
  for (const e of spellsInPlay(ctx.view))
    if (!e.remains && e.owner === player) yield* endSpell(ctx, e, "its caster's side begins a new turn");
}

const isWizard = (view: GameView, actor: { unitId?: string }) => {
  const u = view.state.units[actor.unitId ?? ""];
  return !!u && wizardLevel(u) > 0;
};

export const magicActions: CodeAction[] = [
  {
    id: "castSpell",
    name: "Cast a spell",
    by: "unit",
    phases: ["strategy", "movement", "shooting", "combat"],
    applies: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      return !!u && spellsOf(u).length > 0;
    },
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return "No unit";
      if (view.activePlayer && opposed(view.state, view.activePlayer, u.owner))
        return "Only in your own turn";
      if (u.status?.fleeing) return "Fleeing wizards can't cast";
      if (drainedNow(view, u.id)) return "Drained by a miscast this turn";
      const now = spellsOf(u).filter((s) => SPELL_PHASE[s.kind] === view.phase);
      if (!now.length) return "No spells of this phase's kind";
      const left = castable(view, u);
      if (!left.length) return "Tried each of this phase's spells this turn";
      return left.some((s) => spellTargets(view, u, s).length) ? true : "No target in range";
    },
    targets: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return [];
      // "Ward of Thorns on itself", "Spark Lance at Reaver Warband (9.2")" (UX 248).
      const seen = new Map<string, { unitId: string; spells: string[]; where: string; d: number }>();
      for (const s of castable(view, u))
        for (const x of spellTargets(view, u, s)) {
          const t = seen.get(x.u.id) ?? {
            unitId: x.u.id,
            spells: [],
            where: x.u.id === u.id ? "on itself" : `at ${x.u.name} (${x.d.toFixed(1)}")`,
            d: x.d,
          };
          t.spells.push(s.name);
          seen.set(x.u.id, t);
        }
      return [...seen.values()]
        .sort((a, b) => a.d - b.d)
        .map(({ unitId, spells, where }) => ({ unitId, label: `${spells.join(" or ")} ${where}` }));
    },
    run: castSpell,
  },
  {
    id: "dispelInPlay",
    name: "Dispel a spell in play",
    by: "unit",
    phases: ["strategy"],
    applies: isWizard,
    available: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return "No unit";
      if (view.activePlayer && opposed(view.state, view.activePlayer, u.owner))
        return "Only in your own turn";
      if (drainedNow(view, u.id)) return "Drained by a miscast this turn";
      const left = dispellable(view, u).filter((e) => !triedNow(view, u.id).includes(`dispel:${e.spell}`));
      return left.length ? true : "No enemy spell remains in play";
    },
    targets: (view, actor) => {
      const u = view.state.units[actor.unitId ?? ""];
      if (!u) return [];
      return dispellable(view, u)
        .filter((e) => !triedNow(view, u.id).includes(`dispel:${e.spell}`))
        .map((e) => ({
          unitId: e.target,
          label: `${e.spell} on ${view.state.units[e.target]?.name ?? "?"} (${e.total} to beat)`,
        }));
    },
    run: dispelInPlay,
  },
];
