import type { Rng } from "./actions";
import { parseDice, rollDice } from "./dice";
import type { GameState, Model, ModelId, UnitId } from "./types";

/**
 * The attack sequence: hit → wound → save → damage, one weapon profile at a
 * time. The numbers come from the game system (see src/systems), but players
 * can edit every one of them before rolling, because rules are advisory.
 *
 * The host rolls every die. Each stage is one event that carries its dice and
 * outcome, so every peer folds in exactly the same result and each stage can
 * be undone on its own.
 */
export interface AttackSpec {
  attackerUnitId: UnitId;
  targetUnitId: UnitId;
  weaponId: string;
  weaponName: string;
  kind: "ranged" | "melee";
  /** Total attacks as a dice expression, e.g. "10" or "3D6+3". */
  attacks: string;
  /** Needed to hit (X+), or null to hit automatically (torrent). */
  hit: number | null;
  hitMod: number;
  /** Natural roll that counts as a critical hit. */
  critHit: number;
  rerollHits: Reroll;
  /** Extra hits for each critical hit. */
  sustained: number;
  /** Critical hits wound automatically. */
  lethal: boolean;
  wound: number;
  woundMod: number;
  critWound: number;
  rerollWounds: Reroll;
  /** Critical wounds skip the save. */
  devastating: boolean;
  /** Needed to save (X+) after AP, cover and invulnerable saves, or null for no save. */
  save: number | null;
  /** Damage per unsaved wound, e.g. "1", "D6+1". */
  damage: string;
  /** Feel no pain X+, or null. */
  fnp: number | null;
}

export type Reroll = "none" | "ones" | "failed";

export type AttackStage = "hit" | "wound" | "save" | "damage" | "done";

/** One die as rolled, and its re-roll if it had one. */
export interface Die {
  value: number;
  rerolledFrom?: number;
}

export interface DamageResult {
  modelId: ModelId;
  /** Damage rolled for this unsaved wound. */
  damage: number;
  /** Feel-no-pain dice, one per wound the model would lose. */
  fnp: number[];
  /** Wounds actually lost. */
  lost: number;
  destroyed: boolean;
}

export interface AttackState {
  spec: AttackSpec;
  stage: AttackStage;
  /** Rolled number of attacks (when it was a dice expression). */
  attackRolls: number[];
  attackCount: number;
  hitDice?: Die[];
  hits?: number;
  critHits?: number;
  /** Hits that wound automatically (lethal hits). */
  autoWounds?: number;
  woundDice?: Die[];
  wounds?: number;
  /** Wounds that skip the save (devastating wounds). */
  unsavable?: number;
  saveDice?: Die[];
  unsaved?: number;
  damage?: DamageResult[];
}

/** Applies the always-fails-on-1 rule and the ±1 cap used by most d6 games. */
export function passes(value: number, target: number, mod: number): boolean {
  if (value === 1) return false;
  return value + Math.max(-1, Math.min(1, mod)) >= target;
}

function rollD6(rng: Rng): number {
  return 1 + Math.floor(rng() * 6);
}

function rollPool(count: number, rng: Rng, reroll: Reroll, success: (v: number) => boolean): Die[] {
  return Array.from({ length: count }, () => {
    const value = rollD6(rng);
    const again = (reroll === "ones" && value === 1) || (reroll === "failed" && !success(value));
    return again ? { value: rollD6(rng), rerolledFrom: value } : { value };
  });
}

/** Host side: roll the number of attacks when the attack is declared. */
export function startAttack(spec: AttackSpec, rng: Rng): AttackState {
  const expr = parseDice(spec.attacks);
  const { rolls, total } = rollDice(expr, rng);
  const attackCount = Math.max(0, total);
  return {
    spec,
    stage: spec.hit === null ? "wound" : "hit",
    attackRolls: rolls,
    attackCount,
    ...autoHits(spec, attackCount),
  };
}

function autoHits(spec: AttackSpec, attackCount: number): Partial<AttackState> {
  // Torrent: every attack hits, and nothing is a critical hit.
  return spec.hit === null ? { hits: attackCount, critHits: 0, autoWounds: 0 } : {};
}

/** Host side: roll the dice for the attack's current stage. */
export function rollStage(state: GameState, attack: AttackState, rng: Rng): AttackState {
  const { spec } = attack;
  switch (attack.stage) {
    case "hit": {
      const target = spec.hit ?? 0;
      const ok = (v: number) => v >= spec.critHit || passes(v, target, spec.hitMod);
      const dice = rollPool(attack.attackCount, rng, spec.rerollHits, ok);
      const crits = dice.filter((d) => d.value >= spec.critHit).length;
      const normal = dice.filter((d) => d.value < spec.critHit && ok(d.value)).length;
      const autoWounds = spec.lethal ? crits : 0;
      const hits = normal + crits + crits * spec.sustained;
      return { ...attack, stage: "wound", hitDice: dice, hits, critHits: crits, autoWounds };
    }
    case "wound": {
      const pool = (attack.hits ?? 0) - (attack.autoWounds ?? 0);
      const ok = (v: number) => v >= spec.critWound || passes(v, spec.wound, spec.woundMod);
      const dice = rollPool(pool, rng, spec.rerollWounds, ok);
      const crits = dice.filter((d) => d.value >= spec.critWound).length;
      const success = dice.filter((d) => ok(d.value)).length + (attack.autoWounds ?? 0);
      const unsavable = spec.devastating ? crits : 0;
      return { ...attack, stage: "save", woundDice: dice, wounds: success, unsavable };
    }
    case "save": {
      const pool = (attack.wounds ?? 0) - (attack.unsavable ?? 0);
      const dice = rollPool(pool, rng, "none", () => true);
      const saved = spec.save === null ? 0 : dice.filter((d) => passes(d.value, spec.save!, 0)).length;
      const unsaved = pool - saved + (attack.unsavable ?? 0);
      return { ...attack, stage: "damage", saveDice: dice, unsaved };
    }
    case "damage":
      return { ...attack, stage: "done", damage: allocateDamage(state, attack, rng) };
    case "done":
      return attack;
  }
}

/**
 * Allocate each unsaved wound to the target: a model that is already wounded
 * first, then the others in unit order. Excess damage on one wound is lost.
 * Feel-no-pain is rolled for each wound the model would actually lose.
 */
function allocateDamage(state: GameState, attack: AttackState, rng: Rng): DamageResult[] {
  const unit = state.units[attack.spec.targetUnitId];
  if (!unit) return [];
  const expr = parseDice(attack.spec.damage);
  const left = new Map<ModelId, number>();
  const alive = unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [m] : [];
  });
  for (const m of alive) left.set(m.id, woundsRemaining(m));

  const results: DamageResult[] = [];
  for (let i = 0; i < (attack.unsaved ?? 0); i++) {
    const victim =
      alive.find((m) => left.get(m.id)! > 0 && left.get(m.id)! < maxWounds(m)) ??
      alive.find((m) => left.get(m.id)! > 0);
    if (!victim) break;
    const damage = Math.max(0, rollDice(expr, rng).total);
    const remaining = left.get(victim.id)!;
    const wouldLose = Math.min(damage, remaining);
    const fnp = attack.spec.fnp === null ? [] : Array.from({ length: wouldLose }, () => rollD6(rng));
    const ignored = fnp.filter((v) => v >= attack.spec.fnp!).length;
    const lost = wouldLose - ignored;
    left.set(victim.id, remaining - lost);
    results.push({ modelId: victim.id, damage, fnp, lost, destroyed: remaining - lost <= 0 });
  }
  return results;
}

export function maxWounds(model: Model): number {
  const w = Number.parseInt(model.profile?.chars.W ?? "1", 10);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

export function woundsRemaining(model: Model): number {
  return Math.max(0, maxWounds(model) - (model.woundsLost ?? 0));
}

/** Fold a damage stage into the table: wounds lost and models destroyed. */
export function applyDamage(state: GameState, results: DamageResult[]): GameState {
  const models = { ...state.models };
  for (const r of results) {
    const m = models[r.modelId];
    if (!m) continue;
    const woundsLost = (m.woundsLost ?? 0) + r.lost;
    models[r.modelId] = { ...m, woundsLost, destroyed: woundsLost >= maxWounds(m) || m.destroyed };
  }
  return { ...state, models };
}
