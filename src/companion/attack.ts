import { previewAttack, type GameState, type Model, type UnitId } from "../core";
import { baseSizeInches } from "../core/geometry";
import { aliveModels, carriers, weaponReach, type AttackSuggestion } from "../systems/wh40k/rules";
import { t } from "../i18n";

/**
 * Table companion (#37): the models are on a real table, so what the board
 * would measure, the players say. These answers stand in for range and sight.
 */
export interface TableAnswers {
  /** Models with the weapon that have the target in range. */
  inRange: number;
  /** Within half the weapon's range (Rapid Fire, Melta). */
  half: boolean;
  /** At least one target model can be seen. */
  visible: boolean;
  /** The target has the benefit of cover. */
  cover: boolean;
}

/** The models that carry the weapon, each once. */
export function weaponModels(state: GameState, unitId: UnitId, weaponId: string): Model[] {
  const unit = state.units[unitId];
  return unit ? [...new Set(carriers(state, unit, weaponId))] : [];
}

export function firstAnswers(state: GameState, unitId: UnitId, weaponId: string): TableAnswers {
  return { inRange: weaponModels(state, unitId, weaponId).length, half: false, visible: true, cover: false };
}

const radius = (m: Model) => {
  const { width, depth } = baseSizeInches(m.base);
  return Math.max(width, depth) / 2;
};

/**
 * The attack as the rules data works it out, on a stand-in table laid out to
 * match the players' answers: the target's models in a row, the attackers in
 * range (or within half range) facing them, the rest well out of reach, and
 * no terrain. Rules that measure (range, Rapid Fire, Melta) see what the
 * players said; cover comes from the answer, not the layout.
 */
export function tableAttack(
  state: GameState,
  attackerId: UnitId,
  weaponId: string,
  targetId: UnitId,
  answers: TableAnswers,
): AttackSuggestion | null {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  const weapon = attacker?.sheet?.weapons[weaponId];
  if (!attacker || !target || !weapon) return null;
  const reach = weaponReach(weapon) ?? 1;
  const gap = weapon.kind === "melee" ? 0.5 : answers.half ? reach / 2 - 0.5 : Math.max(0.5, reach - 0.5);
  const targets = aliveModels(state, target);
  const shooters = weaponModels(state, attackerId, weaponId);
  const inRange = Math.max(0, Math.min(answers.inRange, shooters.length));
  const models: GameState["models"] = {};
  // Everyone else stands far off, so nothing else is in range or in the way.
  let far = 0;
  for (const [id, m] of Object.entries(state.models))
    models[id] = { ...m, position: { x: 1000 + 10 * far++, y: 1000 }, z: 0 };
  targets.forEach((m, i) => (models[m.id] = { ...m, position: { x: i * 3, y: 0 }, z: 0, facing: 0 }));
  const front = Math.max(0, ...targets.map(radius));
  shooters.forEach((m, i) => {
    const near = i < inRange;
    const y = near ? -(front + radius(m) + gap) : -(front + radius(m) + reach + 50);
    models[m.id] = { ...m, position: { x: (i % Math.max(1, targets.length)) * 3, y }, z: 0, facing: 0 };
  });
  const stand: GameState = { ...state, models, terrain: [] };
  const ignoresCover = (previewAttack(stand, attackerId, weaponId, targetId)?.weaponRules ?? []).some(
    (r) => r.rule === "ignoresCover",
  );
  const cover = answers.cover && weapon.kind === "ranged" && !ignoresCover;
  const preview = previewAttack(stand, attackerId, weaponId, targetId, { cover, higherGround: false });
  if (!preview) return null;
  const notes: string[] = [];
  for (const names of Object.values(preview.fired)) for (const name of names) notes.push(name);
  if (preview.spec.fnp) notes.push(t("Feel no pain {value}+", { value: preview.spec.fnp }));
  if (preview.reminders.length)
    notes.push(t("Check by hand: {rules}", { rules: preview.reminders.join(", ") }));
  const visible = answers.visible ? targets.length : 0;
  return {
    spec: preview.spec,
    notes,
    carriers: shooters.length,
    inRange: preview.members.length,
    visible,
    inCover: cover ? visible : 0,
    targetModels: targets.length,
    sight: { targets: [], visible, inCover: cover ? visible : 0, hidden: 0, higherGround: false },
  };
}
