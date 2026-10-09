/**
 * The hand-written 40k attack from before the procedure runner (main at
 * ca8a718), kept only as the oracle for parity tests. Do not use at runtime.
 */
import { parseDice, rollDice } from "../../dice";
import type { AttackSpec, AttackState, DamageResult, Die, Reroll } from "../../attack";
import { maxWounds, passes, woundsRemaining } from "../../attack";
import type { GameState, Model, ModelId, Unit, WeaponProfile } from "../../types";
import {
  aliveModels,
  carriers,
  distanceToUnit,
  ENGAGEMENT_RANGE,
  HIDDEN_RANGE,
  HIGHER_GROUND,
  unitSight,
  type AttackSuggestion,
} from "../../../systems/wh40k/rules";

type Rng = () => number;

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
export function legacyStartAttack(spec: AttackSpec, rng: Rng): AttackState {
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
export function legacyRollStage(state: GameState, attack: AttackState, rng: Rng): AttackState {
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

/** "3+" → 3, '6"' → 6, "-1" → -1, "N/A" → null. */
function num(text: string | undefined): number | null {
  if (text === undefined) return null;
  const m = /-?\d+/.exec(text);
  return m ? Number(m[0]) : null;
}

/** A weapon keyword with its parameter, e.g. "Sustained Hits 2" → 2. */
function keywordValue(weapon: WeaponProfile, name: string): number | null {
  const re = new RegExp(`^${name}\\s*(D?\\d+)?`, "i");
  for (const k of weapon.keywords) {
    const m = re.exec(k.trim());
    if (m) return m[1] ? (num(m[1]) ?? 1) : 1;
  }
  return null;
}

function hasKeyword(keywords: string[], name: string): boolean {
  const n = name.toLowerCase();
  return keywords.some((k) => k.trim().toLowerCase() === n);
}

/** "Anti-Infantry 4+" against a target with that keyword → 4. */
function antiValue(weapon: WeaponProfile, targetKeywords: string[]): number | null {
  let best: number | null = null;
  for (const k of weapon.keywords) {
    const m = /^anti-(.+?)\s+(\d)\+?$/i.exec(k.trim());
    if (m && hasKeyword(targetKeywords, m[1]!)) best = Math.min(best ?? 7, Number(m[2]));
  }
  return best;
}

/** S vs T: double or more 2+, more 3+, equal 4+, less 5+, half or less 6+. */
function woundTarget(s: number, t: number): number {
  if (s >= 2 * t) return 2;
  if (s > t) return 3;
  if (s === t) return 4;
  if (s * 2 <= t) return 6;
  return 5;
}

/** Invulnerable save from the INV characteristic or an ability that names one. */
function invulnerable(model: Model, unit: Unit): number | null {
  const inv = num(model.profile?.chars.INV);
  if (inv) return inv;
  for (const a of unit.sheet?.abilities ?? []) {
    if (/invulnerable/i.test(a.name) || /invulnerable save/i.test(a.text)) {
      const m = /(\d)\+/.exec(`${a.name} ${a.text}`);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function feelNoPain(unit: Unit): number | null {
  for (const a of unit.sheet?.abilities ?? []) {
    const m = /feel no pain\s*(\d)\+/i.exec(`${a.name} ${a.text}`);
    if (m) return Number(m[1]);
  }
  return null;
}

export function legacySuggestAttack(
  state: GameState,
  attackerId: string,
  weaponId: string,
  targetId: string,
): AttackSuggestion | null {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  const weapon = attacker?.sheet?.weapons[weaponId];
  if (!attacker || !target || !weapon) return null;
  const notes: string[] = [];
  const targets = aliveModels(state, target);
  const first = targets[0];
  const range = weapon.kind === "melee" ? ENGAGEMENT_RANGE : (num(weapon.chars.RANGE) ?? 0);
  const all = carriers(state, attacker, weaponId);
  const shooters = all.filter((m) => distanceToUnit(m, targets) <= range + 1e-6);
  const halfRange = shooters.filter((m) => distanceToUnit(m, targets) <= range / 2 + 1e-6).length;
  const count = shooters.length;
  if (count < all.length) notes.push(`${count} of ${all.length} models in range (${range}")`);

  // Attacks: per-model A, plus rapid fire and blast.
  const a = (weapon.chars.A ?? "1").replace(/\s/g, "").toUpperCase();
  const dm = /^(\d*)D(\d+)([+-]\d+)?$/.exec(a);
  let dice = 0;
  let sides = 6;
  let flat: number;
  if (dm) {
    dice = (dm[1] ? Number(dm[1]) : 1) * count;
    sides = Number(dm[2]);
    flat = (dm[3] ? Number(dm[3]) : 0) * count;
  } else flat = (num(a) ?? 1) * count;
  const rapid = keywordValue(weapon, "Rapid Fire");
  if (rapid && halfRange > 0) {
    flat += rapid * halfRange;
    notes.push(`Rapid fire: +${rapid * halfRange} attacks within half range`);
  }
  if (keywordValue(weapon, "Blast") && count > 0) {
    const extra = Math.floor(targets.length / 5) * count;
    if (extra) notes.push(`Blast: +${extra} attacks`);
    flat += extra;
  }
  const attacks = dice ? `${dice}D${sides}${flat ? `+${flat}` : ""}` : String(flat);

  // Hit.
  const torrent = keywordValue(weapon, "Torrent") !== null;
  const skill = num(weapon.kind === "melee" ? weapon.chars.WS : weapon.chars.BS);
  let hitMod = 0;
  if (keywordValue(weapon, "Heavy") && !attacker.status?.moved) {
    hitMod += 1;
    notes.push("Heavy: +1 to hit (unit has not moved)");
  }
  const sustained = keywordValue(weapon, "Sustained Hits") ?? 0;
  const lethal = keywordValue(weapon, "Lethal Hits") !== null;
  if (torrent) notes.push("Torrent: hits automatically");

  // Wound.
  const s = num(weapon.chars.S) ?? 4;
  const t = num(first?.profile?.chars.T) ?? 4;
  let woundMod = 0;
  if (keywordValue(weapon, "Lance") && attacker.status?.charged) {
    woundMod += 1;
    notes.push("Lance: +1 to wound after charging");
  }
  const anti = antiValue(weapon, target.sheet?.keywords ?? []);
  if (anti) notes.push(`Anti: critical wounds on ${anti}+`);
  const twin = keywordValue(weapon, "Twin-linked") !== null;
  const devastating = keywordValue(weapon, "Devastating Wounds") !== null;

  // Save: armour modified by AP and cover, or the invulnerable save if better.
  const ap = num(weapon.chars.AP) ?? 0;
  const sv = num(first?.profile?.chars.SV) ?? 7;
  const sight = unitSight(state, shooters.length ? shooters : all, target);
  const ignoresCover = keywordValue(weapon, "Ignores Cover") !== null;
  const cover =
    weapon.kind === "ranged" && !ignoresCover && sight.visible > 0 && sight.inCover >= sight.visible;
  let save = sv - ap;
  let worseSkill = 0;
  if (cover && state.settings.cover === "save") {
    // Cover does not improve a 3+ or better save against AP 0.
    if (!(ap === 0 && sv <= 3)) {
      save -= 1;
      notes.push("Target in cover: +1 to save");
    }
  } else if (cover && !torrent) {
    // 11th edition: the attacker's Ballistic Skill is 1 worse.
    worseSkill = 1;
    notes.push("Target in cover: Ballistic Skill 1 worse");
  }
  if (weapon.kind === "ranged" && sight.higherGround) {
    hitMod += 1;
    notes.push(`Higher ground: +1 to hit (shooters ${HIGHER_GROUND}"+ above the target)`);
  }
  if (weapon.kind === "ranged" && sight.visible === 0) notes.push("No target model is visible");
  if (sight.hidden)
    notes.push(
      `${sight.hidden} target model(s) Hidden in dense terrain (only visible within ${HIDDEN_RANGE}")`,
    );
  const inv = first ? invulnerable(first, target) : null;
  if (inv && inv < save) {
    save = inv;
    notes.push(`Invulnerable save ${inv}+`);
  }

  // Damage.
  let damage = (weapon.chars.D ?? "1").replace(/\s/g, "");
  const melta = keywordValue(weapon, "Melta");
  if (melta && halfRange > 0 && halfRange === count) {
    damage = addBonus(damage, melta);
    notes.push(`Melta: +${melta} damage within half range`);
  }
  const fnp = feelNoPain(target);
  if (fnp) notes.push(`Feel no pain ${fnp}+`);
  if (weapon.keywords.some((k) => /precision|hazardous|indirect|pistol|assault|extra attacks/i.test(k)))
    notes.push(
      `Check by hand: ${weapon.keywords.filter((k) => /precision|hazardous|indirect|pistol|assault|extra attacks/i.test(k)).join(", ")}`,
    );

  const spec: AttackSpec = {
    attackerUnitId: attackerId,
    targetUnitId: targetId,
    weaponId,
    weaponName: weapon.name,
    kind: weapon.kind,
    attacks,
    hit: torrent ? null : (skill ?? 4) + worseSkill,
    hitMod,
    critHit: 6,
    rerollHits: "none",
    sustained,
    lethal,
    wound: woundTarget(s, t),
    woundMod,
    critWound: anti ?? 6,
    rerollWounds: twin ? "failed" : "none",
    devastating,
    save: save >= 7 ? null : Math.max(2, save),
    damage,
    fnp,
  };
  return {
    spec,
    notes,
    carriers: all.length,
    inRange: count,
    visible: sight.visible,
    inCover: sight.inCover,
    sight,
    targetModels: targets.length,
  };
}

function addBonus(dice: string, bonus: number): string {
  const m = /^(.*?)([+-]\d+)?$/.exec(dice);
  if (!m) return dice;
  if (!/d/i.test(m[1]!)) return String((num(dice) ?? 0) + bonus);
  const b = (m[2] ? Number(m[2]) : 0) + bonus;
  return `${m[1]}${b ? `+${b}` : ""}`;
}
