/**
 * 40k mechanics as code, for the first playable slice. These read the
 * characteristics a player imported (nothing here ships stats or rules
 * text) and suggest numbers for the attack sequence and table checks.
 * Every suggestion can be edited by the players: rules are advisory.
 *
 * The longer-term plan is for the data-driven GameSystem in
 * src/core/content to drive this; this module is the hand-written stand-in.
 */
import {
  baseToBaseDistance,
  inFootprint,
  modelDistance,
  modelSight,
  moveCrossesWall,
  PHASES,
  verticalGap,
  whollyWithin,
  type TerrainCategory,
  type AttackSpec,
  type GameState,
  type Model,
  type TerrainPiece,
  type Unit,
  type Vec2,
  type WeaponProfile,
} from "../../core";

/** 11th edition values, from the research notes. */
export const ENGAGEMENT_RANGE = 2;
export const COHERENCY_NEAR = 2;
export const COHERENCY_FAR = 9;
/** Vertical distance allowed for engagement and coherency. */
export const VERTICAL_TOLERANCE = 5;
export const OBJECTIVE_RANGE = 3;
export const OBJECTIVE_MARKER_MM = 40;

/** "3+" → 3, '6"' → 6, "-1" → -1, "N/A" → null. */
export function num(text: string | undefined): number | null {
  if (text === undefined) return null;
  const m = /-?\d+/.exec(text);
  return m ? Number(m[0]) : null;
}

export function aliveModels(state: GameState, unit: Unit | undefined): Model[] {
  if (!unit) return [];
  return unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [m] : [];
  });
}

/** Closest base-to-base distance from one model to any model of a unit. */
export function distanceToUnit(model: Model, targets: Model[]): number {
  let best = Infinity;
  for (const t of targets) best = Math.min(best, modelDistance(model, t));
  return best;
}

export function unitDistance(a: Model[], b: Model[]): number {
  let best = Infinity;
  for (const m of a) best = Math.min(best, distanceToUnit(m, b));
  return best;
}

/** A weapon keyword with its parameter, e.g. "Sustained Hits 2" → 2. */
export function keywordValue(weapon: WeaponProfile, name: string): number | null {
  const re = new RegExp(`^${name}\\s*(D?\\d+)?`, "i");
  for (const k of weapon.keywords) {
    const m = re.exec(k.trim());
    if (m) return m[1] ? (num(m[1]) ?? 1) : 1;
  }
  return null;
}

export function hasKeyword(keywords: string[], name: string): boolean {
  const n = name.toLowerCase();
  return keywords.some((k) => k.trim().toLowerCase() === n);
}

/** "Anti-Infantry 4+" against a target with that keyword → 4. */
export function antiValue(weapon: WeaponProfile, targetKeywords: string[]): number | null {
  let best: number | null = null;
  for (const k of weapon.keywords) {
    const m = /^anti-(.+?)\s+(\d)\+?$/i.exec(k.trim());
    if (m && hasKeyword(targetKeywords, m[1]!)) best = Math.min(best ?? 7, Number(m[2]));
  }
  return best;
}

/** S vs T: double or more 2+, more 3+, equal 4+, less 5+, half or less 6+. */
export function woundTarget(s: number, t: number): number {
  if (s >= 2 * t) return 2;
  if (s > t) return 3;
  if (s === t) return 4;
  if (s * 2 <= t) return 6;
  return 5;
}

/** Invulnerable save from the INV characteristic or an ability that names one. */
export function invulnerable(model: Model, unit: Unit): number | null {
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

export function feelNoPain(unit: Unit): number | null {
  for (const a of unit.sheet?.abilities ?? []) {
    const m = /feel no pain\s*(\d)\+/i.exec(`${a.name} ${a.text}`);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Models of the attacking unit that carry `weaponId`, once per copy carried. */
export function carriers(state: GameState, unit: Unit, weaponId: string): Model[] {
  return aliveModels(state, unit).flatMap((m) =>
    (m.weapons ?? []).filter((w) => w === weaponId).map(() => m),
  );
}

export interface AttackSuggestion {
  spec: AttackSpec;
  /** Explanations of each number, for the panel. */
  notes: string[];
  carriers: number;
  inRange: number;
  /** Target models the shooters can see, and how many are in cover. */
  visible: number;
  inCover: number;
  targetModels: number;
  sight: UnitSight;
}

/**
 * Work out a weapon's attack against a target unit from the imported
 * characteristics and the table: models in range, keywords, S vs T, AP,
 * cover and invulnerable saves.
 */
export function suggestAttack(
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
  if (cover && state.settings.cover === "save") {
    // Cover does not improve a 3+ or better save against AP 0.
    if (!(ap === 0 && sv <= 3)) {
      save -= 1;
      notes.push("Target in cover: +1 to save");
    }
  } else if (cover) {
    hitMod -= 1;
    notes.push("Target in cover: −1 to hit");
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
    hit: torrent ? null : (skill ?? 4),
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

// ---------------------------------------------------------------------------
// Terrain: categories, line of sight, cover, hidden, higher ground
// ---------------------------------------------------------------------------

/**
 * What each terrain category does. Based on the 11th edition summary in the
 * research notes (secondary sources), so treat the details as a best guess
 * and check against the official rules.
 */
export const CATEGORY_RULES: Record<
  TerrainCategory,
  {
    label: string;
    coverWithin: boolean;
    coverBehind: boolean;
    hides: boolean;
    impassable: boolean;
    help: string;
  }
> = {
  exposed: {
    label: "Exposed",
    coverWithin: false,
    coverBehind: false,
    hides: false,
    impassable: false,
    help: "No cover.",
  },
  light: {
    label: "Light",
    coverWithin: true,
    coverBehind: true,
    hides: false,
    impassable: false,
    help: "Cover for models wholly within it or partly hidden by it.",
  },
  dense: {
    label: "Dense",
    coverWithin: true,
    coverBehind: true,
    hides: true,
    impassable: false,
    help: `Cover as Light. Infantry wholly within are Hidden: only visible within ${15}" unless they shot.`,
  },
  solid: {
    label: "Solid",
    coverWithin: false,
    coverBehind: true,
    hides: false,
    impassable: true,
    help: "Cannot be moved through. Cover for models partly hidden by it.",
  },
};

export const HIDDEN_RANGE = 15;
export const HIGHER_GROUND = 3;

export interface TargetSight {
  modelId: string;
  visible: boolean;
  fully: boolean;
  cover: boolean;
  hidden: boolean;
  /** A shooter that can see it, for drawing the sight line. */
  seenBy?: string;
}

export interface UnitSight {
  targets: TargetSight[];
  visible: number;
  inCover: number;
  hidden: number;
  /** Every shooter stands at least 3" above every target. */
  higherGround: boolean;
}

/**
 * Line of sight from a set of shooters to a target unit, per target model,
 * using the terrain and model volumes. A target model is in cover if it is
 * wholly within light or dense terrain, or if terrain that gives cover hides
 * part of it from every shooter that can see it.
 */
export function unitSight(state: GameState, shooters: Model[], targetUnit: Unit): UnitSight {
  const targets = aliveModels(state, targetUnit);
  const ignore = new Set(
    shooters.map((m) => m.unitId && state.units[m.unitId]).flatMap((u) => (u ? u.modelIds : [])),
  );
  for (const id of targetUnit.modelIds) ignore.add(id);
  const infantry = hasKeyword(targetUnit.sheet?.keywords ?? [], "Infantry");
  const shotRecently = !!targetUnit.status?.shot;
  const result: TargetSight[] = targets.map((t) => {
    const within = state.terrain.filter((p) => whollyWithin(p, t));
    const coverWithin = within.some((p) => CATEGORY_RULES[p.category].coverWithin);
    const hiddenHere = infantry && !shotRecently && within.some((p) => CATEGORY_RULES[p.category].hides);
    let seenBy: string | undefined;
    let anyFully = false;
    let behindCover = true;
    let hidden = false;
    for (const s of shooters) {
      if (hiddenHere && modelDistance(s, t) > HIDDEN_RANGE) {
        hidden = true;
        continue;
      }
      const sight = modelSight(state, s, t, { ignore, modelsBlock: state.settings.modelsBlock });
      if (!sight.visible) continue;
      seenBy ??= s.id;
      if (sight.fully) anyFully = true;
      const covered = !sight.fully && sight.obscuredBy.some((p) => CATEGORY_RULES[p.category].coverBehind);
      if (!covered) behindCover = false;
    }
    const visible = seenBy !== undefined;
    return {
      modelId: t.id,
      visible,
      fully: anyFully,
      cover: visible && (coverWithin || behindCover),
      hidden: !visible && hidden,
      ...(seenBy ? { seenBy } : {}),
    };
  });
  const top = Math.max(0, ...targets.map((t) => t.z ?? 0));
  const higherGround = shooters.length > 0 && shooters.every((s) => (s.z ?? 0) >= top + HIGHER_GROUND);
  return {
    targets: result,
    visible: result.filter((r) => r.visible).length,
    inCover: result.filter((r) => r.cover).length,
    hidden: result.filter((r) => r.hidden).length,
    higherGround,
  };
}

/** Terrain a straight move from the phase start would pass through that the unit can't. */
export function blockedMoves(state: GameState, unit: Unit, positions?: Record<string, Vec2>): TerrainPiece[] {
  const kw = unit.sheet?.keywords ?? [];
  if (hasKeyword(kw, "Fly")) return [];
  const throughWalls = hasKeyword(kw, "Infantry") || hasKeyword(kw, "Beast") || hasKeyword(kw, "Swarm");
  const hit = new Set<TerrainPiece>();
  for (const m of aliveModels(state, unit)) {
    const from = m.phaseStart ?? m.position;
    const to = positions?.[m.id] ?? m.position;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.05) continue;
    for (const p of state.terrain) {
      const rule = CATEGORY_RULES[p.category];
      if (rule.impassable && (inFootprint(p, to) || moveCrossesWall([p], from, to, m.phaseStartZ ?? 0)))
        hit.add(p);
      else if (!throughWalls && moveCrossesWall([p], from, to, m.phaseStartZ ?? 0)) hit.add(p);
    }
  }
  return [...hit];
}

// ---------------------------------------------------------------------------
// Table checks: coherency, engagement, objectives
// ---------------------------------------------------------------------------

/** Models that break unit coherency: no other model within 2", or more than 9" from any model in the unit. */
export function incoherentModels(models: Model[]): Set<string> {
  const bad = new Set<string>();
  if (models.length < 2) return bad;
  const needed = 1;
  for (const m of models) {
    let near = 0;
    for (const o of models) {
      if (o === m) continue;
      const d = baseToBaseDistance(m, o);
      const up = verticalGap(m, o);
      if (d <= COHERENCY_NEAR + 1e-6 && up <= VERTICAL_TOLERANCE) near++;
      if (d > COHERENCY_FAR + 1e-6 || up > VERTICAL_TOLERANCE) bad.add(m.id);
    }
    if (near < needed) bad.add(m.id);
  }
  return bad;
}

/** Ids of enemy units within engagement range of this unit. */
export function engagedWith(state: GameState, unit: Unit): string[] {
  const mine = aliveModels(state, unit);
  return Object.values(state.units)
    .filter((u) => u.owner !== unit.owner)
    .filter((u) => {
      const theirs = aliveModels(state, u);
      return mine.some((m) =>
        theirs.some(
          (t) =>
            baseToBaseDistance(m, t) <= ENGAGEMENT_RANGE + 1e-6 && verticalGap(m, t) <= VERTICAL_TOLERANCE,
        ),
      );
    })
    .map((u) => u.id);
}

export function objectiveControl(
  state: GameState,
): { id: string; oc: Record<string, number>; controller: string | null }[] {
  const markerRadius = OBJECTIVE_MARKER_MM / 25.4 / 2;
  return state.objectives.map((o) => {
    const oc: Record<string, number> = {};
    for (const m of Object.values(state.models)) {
      if (m.destroyed || !m.unitId) continue;
      const unit = state.units[m.unitId];
      const r = m.base.shape === "round" ? m.base.diameterMm / 25.4 / 2 : 0;
      const d = Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) - r - markerRadius;
      if (d > OBJECTIVE_RANGE + 1e-6) continue;
      const value = unit?.status?.battleShocked ? 0 : (num(m.profile?.chars.OC) ?? 1);
      oc[m.owner] = (oc[m.owner] ?? 0) + value;
    }
    const sorted = Object.entries(oc).sort((a, b) => b[1] - a[1]);
    const controller = sorted[0] && sorted[0][1] > 0 && sorted[0][1] !== sorted[1]?.[1] ? sorted[0][0] : null;
    return { id: o.id, oc, controller };
  });
}

/**
 * Furthest any model of the unit has moved since the phase began, counting
 * climbing up or down between floors.
 */
export function unitMoved(
  models: Model[],
  positions?: Record<string, Vec2>,
  heights?: Record<string, number>,
): number {
  let best = 0;
  for (const m of models) {
    const p = positions?.[m.id] ?? m.position;
    const z = heights?.[m.id] ?? m.z ?? 0;
    const from = m.phaseStart ?? m.position;
    const climb = Math.abs(z - (m.phaseStartZ ?? 0));
    best = Math.max(best, Math.hypot(p.x - from.x, p.y - from.y) + climb);
  }
  return best;
}

/**
 * How far the unit may move in the current phase: M (plus the advance roll)
 * in Movement, the charge roll in Charge, 3" pile-in in Fight.
 */
export function moveAllowance(state: GameState, unit: Unit): number | null {
  const phase = PHASES[state.turn.phase];
  if (phase === "Charge") return typeof unit.status?.charge === "number" ? unit.status.charge : null;
  if (phase === "Fight") return 3;
  const m = aliveModels(state, unit)[0];
  const move = num(m?.profile?.chars.M);
  if (move === null) return null;
  const advance = typeof unit.status?.advance === "number" ? unit.status.advance : 0;
  return move + advance;
}
