import type { Rng } from "./actions";
import {
  advance,
  resolvedOutcomes,
  averageSum,
  getSystem,
  nextStep,
  parseDiceSum,
  previewRun,
  startRun,
  type DamagePlan,
  type Outcome,
  type FiredChange,
  type PoolPlan,
  type ProcedureRun,
  type RoleRef,
  type RuleRef,
  type RunEnv,
  type StartOptions,
  type StepRecord,
  type TestPlan,
} from "./content";
import { createInitialState, type GameState, type Model, type ModelId, type UnitId } from "./types";

/**
 * The attack sequence: hit → wound → save → damage, one weapon profile at a
 * time. It runs the game system's "attack" procedure (src/core/content), so
 * weapon keywords and core rules come from data. The numbers come from the
 * data, but players can edit every one of them before rolling, because rules
 * are advisory.
 *
 * The host rolls every die. Each stage is one event that carries its dice and
 * outcome, so every peer folds in exactly the same result and each stage can
 * be undone on its own.
 */
/** A rule that changed a step's roll, kept on the spec so the panel and the log can name it (UX 290). */
export interface AttackBecause {
  name: string;
  step: string;
  change: FiredChange;
}

export interface AttackSpec {
  /** What the rules changed, as the preview worked it out (not updated by the player's edits). */
  because?: AttackBecause[];
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
  /** Save roll modifier (e.g. +1 from an ability). */
  saveMod?: number;
  /** Damage per unsaved wound, e.g. "1", "D6+1". */
  damage: string;
  /** Feel no pain X+, or null. */
  fnp: number | null;
  /** Re-roll damage: "ones" each 1, "failed"/"any" a below-average roll. */
  rerollDamage?: Reroll;
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
  /** The damage first rolled, when a re-roll replaced it. */
  rerolledFrom?: number;
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
  /**
   * The procedure run behind this attack: every die, the rules that fired
   * and the table changes. The fields above are read from it for the panel.
   */
  run?: ProcedureRun;
  /**
   * Table changes from the weapon's rules that wait for the attack to
   * resolve (Hazardous), worked out by the host when it ends.
   */
  resolved?: Outcome[];
}

/** Applies the always-fails-on-1 rule and the ±1 cap used by most d6 games. */
export function passes(value: number, target: number, mod: number): boolean {
  if (value === 1) return false;
  return value + Math.max(-1, Math.min(1, mod)) >= target;
}

/** The game system and procedure that run attacks. */
export const ATTACK_SYSTEM = "forty-k-11";
export const ATTACK_PROCEDURE = "attack";

function roles(attackerId: UnitId, weaponId: string, targetId: UnitId): Record<string, RoleRef> {
  return {
    attacker: { unit: attackerId },
    weapon: { unit: attackerId, weapon: weaponId },
    target: { unit: targetId },
  };
}

/**
 * The players' numbers as run options. The spec is what the attack panel
 * shows and lets players edit, so the run uses exactly those numbers, and
 * only the per-die keyword rules the spec switches on.
 */
export function specToRun(spec: AttackSpec): StartOptions {
  const weapon: RuleRef[] = [];
  if (spec.sustained > 0) weapon.push({ rule: "sustainedHits", params: { x: spec.sustained } });
  if (spec.lethal) weapon.push({ rule: "lethalHits" });
  if (spec.devastating) weapon.push({ rule: "devastatingWounds" });
  return {
    explicit: true,
    rules: { weapon },
    overrides: {
      attacks: { count: spec.attacks },
      hit: {
        skip: spec.hit === null,
        target: spec.hit ?? 0,
        modifier: spec.hitMod,
        criticalOn: spec.critHit,
        reroll: spec.rerollHits,
      },
      wound: {
        target: spec.wound,
        modifier: spec.woundMod,
        criticalOn: spec.critWound,
        reroll: spec.rerollWounds,
      },
      save: { target: spec.save, modifier: spec.saveMod ?? 0, criticalOn: null, reroll: "none" },
      damage: { amount: spec.damage, ignoreDamage: spec.fnp, reroll: spec.rerollDamage ?? "none" },
    },
  };
}

function env(state: GameState, rng?: Rng): RunEnv {
  return { system: getSystem(ATTACK_SYSTEM), state, ...(rng ? { rng } : {}) };
}

/** The attack as the panel shows it, read from the run's step records. */
export function projectAttack(spec: AttackSpec, run: ProcedureRun): AttackState {
  const rec = (id: string) => run.records.find((r) => r.id === id);
  const dice = (r: StepRecord | undefined): Die[] | undefined =>
    r?.dice?.map((d) =>
      d.rerolledFrom !== undefined ? { value: d.value, rerolledFrom: d.rerolledFrom } : { value: d.value },
    );
  const pool = rec("attacks");
  const hit = rec("hit");
  const wound = rec("wound");
  const save = rec("save");
  const damage = rec("damage");
  const next = run.done ? "done" : (nextStep(getSystem(run.system), run)?.id ?? "done");
  const stage: AttackStage =
    (["hit", "wound", "save", "damage"] as const).find((s) => s === next) ??
    (next === "done" ? "done" : "save");
  const out: AttackState = {
    spec,
    stage,
    attackRolls: pool?.rolls ?? [],
    attackCount: pool?.out ?? 0,
    run,
  };
  if (hit) {
    const d = dice(hit);
    if (d?.length || !hit.bypassed) out.hitDice = d ?? [];
    out.hits = hit.out;
    out.critHits = hit.criticals ?? 0;
    out.autoWounds = hit.tagged?.["bypass:wound"] ?? 0;
  }
  if (wound) {
    out.woundDice = dice(wound) ?? [];
    out.wounds = wound.out;
    out.unsavable = wound.tagged?.["bypass:save"] ?? 0;
  }
  if (save) {
    out.saveDice = dice(save) ?? [];
    out.unsaved = save.out;
  }
  if (damage)
    out.damage = (damage.damage ?? []).map((e) => ({
      modelId: e.modelId,
      damage: e.damage,
      ...(e.rerolledFrom !== undefined ? { rerolledFrom: e.rerolledFrom } : {}),
      fnp: e.ignore,
      lost: e.lost,
      destroyed: e.destroyed,
    }));
  return out;
}

/** Host side: roll the number of attacks when the attack is declared. */
export function startAttack(
  spec: AttackSpec,
  rng: Rng,
  state: GameState = createInitialState(),
): AttackState {
  const run = startRun(
    env(state, rng),
    ATTACK_PROCEDURE,
    roles(spec.attackerUnitId, spec.weaponId, spec.targetUnitId),
    specToRun(spec),
  );
  return projectAttack(spec, run);
}

/** Host side: roll the dice for the attack's current stage. */
export function rollStage(state: GameState, attack: AttackState, rng: Rng): AttackState {
  if (attack.stage === "done") return attack;
  // Attacks saved before the runner existed carry no run: restart it from the rolled count.
  const run =
    attack.run ??
    startRun(
      env(state, rng),
      ATTACK_PROCEDURE,
      roles(attack.spec.attackerUnitId, attack.spec.weaponId, attack.spec.targetUnitId),
      {
        ...specToRun(attack.spec),
        overrides: { ...specToRun(attack.spec).overrides, attacks: { count: String(attack.attackCount) } },
      },
    );
  const next = projectAttack(attack.spec, advance(env(state, rng), run));
  if (next.stage !== "done" || !next.run) return next;
  // The panel's run has only its own numbers: the weapon's bound rules fire now it's over.
  const action = attack.spec.kind === "melee" ? "fight" : "shoot";
  const resolved = resolvedOutcomes(env(state, rng), { ...next.run, action });
  return resolved.length ? { ...next, resolved } : next;
}

/** What the data says an attack should be, before any player edits. */
export interface AttackPreview {
  spec: AttackSpec;
  /** Ids of the attacking models in range. */
  members: string[];
  /** Rule names that changed each step, e.g. { hit: ["Heavy"] }. */
  fired: Record<string, string[]>;
  /** What each of them changed, by step then rule name. */
  changes: Record<string, Record<string, FiredChange>>;
  /** Rules the weapon or target has that a player resolves by hand. */
  reminders: string[];
  /** The weapon's rules as bound from its keywords. */
  weaponRules: RuleRef[];
}

/** Facts about sight between attacker and target, worked out by the system module. */
export interface SightFacts {
  /** Every visible target model is in cover. */
  cover: boolean;
  /** Every shooter stands well above every target. */
  higherGround: boolean;
}

/**
 * Work out an attack's numbers from the game system's data: models in
 * range, weapon keywords, S vs T, AP, cover, invulnerable saves, feel no pain.
 */
export function previewAttack(
  state: GameState,
  attackerId: UnitId,
  weaponId: string,
  targetId: UnitId,
  sight: SightFacts = { cover: false, higherGround: false },
): AttackPreview | null {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  const weapon = attacker?.sheet?.weapons[weaponId];
  if (!attacker || !target || !weapon) return null;
  const e = { ...env(state), facts: { sight } };
  const p = previewRun(e, ATTACK_PROCEDURE, roles(attackerId, weaponId, targetId));
  const pool = p.plans.attacks as PoolPlan;
  const hit = p.plans.hit as TestPlan;
  const wound = p.plans.wound as TestPlan;
  const save = p.plans.save as TestPlan;
  const damage = p.plans.damage as DamagePlan;
  const weaponRules = p.rules.weapon ?? [];
  const has = (id: string) => weaponRules.find((r) => r.rule === id);
  const sustained = has("sustainedHits")?.params?.x;
  const reroll = (r: TestPlan["reroll"]): Reroll => (r === "any" ? "failed" : r);
  const spec: AttackSpec = {
    attackerUnitId: attackerId,
    targetUnitId: targetId,
    weaponId,
    weaponName: weapon.name,
    kind: weapon.kind,
    attacks: pool.count,
    hit: hit.skip ? null : (hit.target ?? 7),
    hitMod: hit.modifier,
    critHit: hit.criticalOn ?? 6,
    rerollHits: reroll(hit.reroll),
    sustained:
      sustained === undefined || sustained === null
        ? 0
        : typeof sustained === "number"
          ? sustained
          : averageSum(parseDiceSum(sustained)),
    lethal: !!has("lethalHits"),
    wound: wound.target ?? 7,
    woundMod: wound.modifier,
    critWound: wound.criticalOn ?? 6,
    rerollWounds: reroll(wound.reroll),
    devastating: !!has("devastatingWounds"),
    save: save.target === null || save.target > 6 ? null : save.target,
    ...(save.modifier ? { saveMod: save.modifier } : {}),
    damage: damage.amount,
    ...(damage.reroll && damage.reroll !== "none" ? { rerollDamage: reroll(damage.reroll) } : {}),
    fnp: damage.ignoreDamage,
  };
  const because = Object.entries(p.changes).flatMap(([step, byName]) =>
    Object.entries(byName).map(([name, change]) => ({ name, step, change })),
  );
  if (because.length) spec.because = because;
  return {
    spec,
    members: pool.members ?? [],
    fired: p.fired,
    changes: p.changes,
    reminders: p.reminders,
    weaponRules,
  };
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);

/** "−1 to hit", "re-roll 1s to wound", in English for the attack notes. */
export function changeLabel(step: string, c: FiredChange): string {
  const parts: string[] = [];
  if (c.mod) parts.push(`${signed(c.mod)} to ${step}`);
  if (c.target) parts.push(`${step} target ${signed(c.target)}`);
  if (c.reroll === "ones") parts.push(`re-roll 1s to ${step}`);
  else if (c.reroll === "failed") parts.push(`re-roll failed ${step} rolls`);
  else if (c.reroll === "any") parts.push(`re-roll ${step} rolls`);
  if (c.crit) parts.push(`critical ${step}s on ${c.crit}+`);
  return parts.join(", ");
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
