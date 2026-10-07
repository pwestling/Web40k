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
  type AttackSpec,
  type GameState,
  type Model,
  type TerrainPiece,
  type Unit,
  type Vec2,
  type WeaponProfile,
} from "../../core";
import { pointInTerrain } from "./layout";

/** 11th edition values, from the research notes. */
export const ENGAGEMENT_RANGE = 2;
export const COHERENCY_NEAR = 2;
export const COHERENCY_FAR = 9;
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
  for (const t of targets) best = Math.min(best, baseToBaseDistance(model, t));
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
  const visibility = lineOfSight(state, shooters.length ? shooters : all, targets);
  const ignoresCover = keywordValue(weapon, "Ignores Cover") !== null;
  const cover =
    weapon.kind === "ranged" &&
    !ignoresCover &&
    visibility.inCover > 0 &&
    visibility.inCover >= visibility.visible;
  let save = sv - ap - (cover ? 1 : 0);
  // Cover does not improve a 3+ or better save against AP 0.
  if (cover && ap === 0 && sv <= 3) save = sv;
  if (cover && save !== sv) notes.push("Target in cover: +1 to save");
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
    visible: visibility.visible,
    inCover: visibility.inCover,
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
// Line of sight and cover (simplified: ruin walls block, footprints give cover)
// ---------------------------------------------------------------------------

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function wallSegments(piece: TerrainPiece): [Vec2, Vec2][] {
  const c = Math.cos(piece.facing);
  const s = Math.sin(piece.facing);
  const tf = (p: Vec2): Vec2 => ({
    x: piece.position.x + p.x * c + p.y * s,
    y: piece.position.y - p.x * s + p.y * c,
  });
  return piece.walls.map((w) => [tf(w.from), tf(w.to)]);
}

/**
 * A target model is visible if a line from any shooter's centre to its
 * centre crosses no ruin wall. Base-centre lines are a simplification of
 * true line of sight; players can override.
 */
export function lineOfSight(
  state: GameState,
  shooters: Model[],
  targets: Model[],
): { visible: number; inCover: number } {
  const walls = state.terrain.flatMap(wallSegments);
  let visible = 0;
  let inCover = 0;
  for (const t of targets) {
    const seen = shooters.some((s) => !walls.some(([a, b]) => segmentsCross(s.position, t.position, a, b)));
    if (!seen) continue;
    visible++;
    if (state.terrain.some((p) => pointInTerrain(t.position, p))) inCover++;
  }
  return { visible, inCover };
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
      if (d <= COHERENCY_NEAR + 1e-6) near++;
      if (d > COHERENCY_FAR + 1e-6) bad.add(m.id);
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
    .filter((u) => unitDistance(mine, aliveModels(state, u)) <= ENGAGEMENT_RANGE + 1e-6)
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

/** Furthest any model of the unit has moved since the phase began. */
export function unitMoved(models: Model[], positions?: Record<string, Vec2>): number {
  let best = 0;
  for (const m of models) {
    const p = positions?.[m.id] ?? m.position;
    const from = m.phaseStart ?? m.position;
    best = Math.max(best, Math.hypot(p.x - from.x, p.y - from.y));
  }
  return best;
}

/** Allowed move this phase from M, plus the advance roll if the unit advanced. */
export function moveAllowance(state: GameState, unit: Unit): number | null {
  const m = aliveModels(state, unit)[0];
  const move = num(m?.profile?.chars.M);
  if (move === null) return null;
  const advance = typeof unit.status?.advance === "number" ? unit.status.advance : 0;
  return move + advance;
}
