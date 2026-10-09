import { aliveModels } from "../../core/units";
/**
 * 40k mechanics as code, for the first playable slice. These read the
 * characteristics a player imported (nothing here ships stats or rules
 * text) and suggest numbers for the attack sequence and table checks.
 * Every suggestion can be edited by the players: rules are advisory.
 *
 * The attack numbers come from the data-driven GameSystem in src/core/content
 * (see suggestAttack); the table checks here are still hand-written.
 */
import {
  baseSizeInches,
  baseToBaseDistance,
  inFootprint,
  modelDistance,
  modelSight,
  moveCrossesWall,
  phaseName,
  previewAttack,
  changeLabel,
  verticalGap,
  whollyWithin,
  type TerrainCategory,
  type AttackSpec,
  type GameState,
  type Model,
  type TerrainPiece,
  type Unit,
  type Vec2,
} from "../../core";
import { opposed, sidePlayers } from "../../core/teams";

/** 11th edition values, from the research notes. */
export const ENGAGEMENT_RANGE = 2;
const COHERENCY_NEAR = 2;
const COHERENCY_FAR = 9;
/** Vertical distance allowed for engagement and coherency. */
const VERTICAL_TOLERANCE = 5;
export const OBJECTIVE_RANGE = 3;
export const OBJECTIVE_MARKER_MM = 40;

export { aliveModels };

/** "3+" → 3, '6"' → 6, "-1" → -1, "N/A" → null. */
export function num(text: string | undefined): number | null {
  if (text === undefined) return null;
  const m = /-?\d+/.exec(text);
  return m ? Number(m[0]) : null;
}

/** Closest base-to-base distance from one model to any model of a unit. */
export function distanceToUnit(model: Model, targets: Model[]): number {
  let best = Infinity;
  const r = reach(model);
  for (const t of targets) {
    // No nearer than centre to centre less both bases' reach: skip the outline maths when that can't win.
    if (Math.hypot(t.position.x - model.position.x, t.position.y - model.position.y) - r - reach(t) >= best)
      continue;
    best = Math.min(best, modelDistance(model, t));
  }
  return best;
}

/** The furthest a base's edge is from its centre, in inches. */
function reach(m: Model): number {
  const s = baseSizeInches(m.base);
  return m.base.shape === "round" ? s.width / 2 : Math.hypot(s.width, s.depth) / 2;
}

export function unitDistance(a: Model[], b: Model[]): number {
  let best = Infinity;
  for (const m of a) best = Math.min(best, distanceToUnit(m, b));
  return best;
}

function hasKeyword(keywords: string[], name: string): boolean {
  const n = name.toLowerCase();
  return keywords.some((k) => k.trim().toLowerCase() === n);
}

/** Models of the attacking unit that carry `weaponId`, once per copy carried. */
export function carriers(state: GameState, unit: Unit, weaponId: string): Model[] {
  return aliveModels(state, unit).flatMap((m) =>
    (m.weapons ?? []).filter((w) => w === weaponId).map(() => m),
  );
}

/** The weapon of a kind that most of the unit's models carry (ties go to the first listed). */
export function mainWeapon(state: GameState, unit: Unit, kind: "ranged" | "melee"): string | undefined {
  let best: string | undefined;
  let most = 0;
  // A weapon not yet used this phase comes first, so the next shot picks up where the last left off.
  for (const fresh of [true, false]) {
    for (const w of Object.values(unit.sheet?.weapons ?? {})) {
      if (w.kind !== kind || (fresh && unit.status?.[`fired.${w.id}`])) continue;
      const n = carriers(state, unit, w.id).length;
      if (n > most) [best, most] = [w.id, n];
    }
    if (best) return best;
  }
  return best;
}

/** A weapon's reach in inches: its range, or engagement range for melee. Null if unreadable. */
export function weaponReach(weapon: {
  kind: "ranged" | "melee";
  chars: Record<string, string>;
}): number | null {
  if (weapon.kind === "melee") return 1;
  const n = parseFloat(weapon.chars.RANGE ?? "");
  return Number.isFinite(n) ? n : null;
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

/** What a step is called in notes. */
const STEP_NOUN: Record<string, string> = {
  attacks: "attacks",
  hit: "hit roll",
  wound: "wound roll",
  save: "save",
  damage: "damage",
};

/**
 * Work out a weapon's attack against a target unit. The numbers come from
 * the 40k GameSystem data run through the procedure runner (models in range,
 * weapon keywords, S vs T, AP, invulnerable saves, feel no pain); this
 * module supplies what it sees on the table: line of sight, cover, hidden
 * models and higher ground.
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
  const all = carriers(state, attacker, weaponId);
  const reach = previewAttack(state, attackerId, weaponId, targetId);
  if (!reach) return null;
  const inRange = new Set(reach.members);
  const shooters = all.filter((m) => inRange.has(m.id));
  const count = reach.members.length;
  const sight = unitSight(state, shooters.length ? shooters : all, target);
  const preview = previewAttack(state, attackerId, weaponId, targetId, {
    cover: sight.visible > 0 && sight.inCover >= sight.visible,
    higherGround: sight.higherGround,
  })!;
  const { spec } = preview;

  const notes: string[] = [];
  const range = weapon.kind === "melee" ? ENGAGEMENT_RANGE : (num(weapon.chars.RANGE) ?? 0);
  if (count < all.length) notes.push(`${count} of ${all.length} models in range (${range}")`);
  for (const [step, names] of Object.entries(preview.fired))
    for (const name of names)
      if (name === "Cover") notes.push("Target in cover: Ballistic Skill 1 worse");
      else if (name === "Higher ground")
        notes.push(`Higher ground: +1 to hit (shooters ${HIGHER_GROUND}"+ above the target)`);
      else {
        // What it did, not just where (UX 290): "Smouldering Ward: −1 to hit".
        const change = preview.changes[step]?.[name];
        const label = change ? changeLabel(step, change) : "";
        notes.push(`${name}: ${label || (STEP_NOUN[step] ?? step)}`);
      }
  const ignoresCover = preview.weaponRules.some((r) => r.rule === "ignoresCover");
  const cover =
    weapon.kind === "ranged" && !ignoresCover && sight.visible > 0 && sight.inCover >= sight.visible;
  if (cover && state.settings.cover === "save")
    notes.push("Target in cover: +1 to save (not 3+ against AP 0)");
  if (weapon.kind === "ranged" && sight.visible === 0) notes.push("No target model is visible");
  if (sight.hidden)
    notes.push(
      `${sight.hidden} target model(s) Hidden in dense terrain (only visible within ${HIDDEN_RANGE}")`,
    );
  if (spec.fnp) notes.push(`Feel no pain ${spec.fnp}+`);
  if (preview.reminders.length) notes.push(`Check by hand: ${preview.reminders.join(", ")}`);

  return {
    spec,
    notes,
    carriers: all.length,
    inRange: count,
    visible: sight.visible,
    inCover: sight.inCover,
    sight,
    targetModels: aliveModels(state, target).length,
  };
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
  "exposed" | "light" | "dense" | "solid",
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
    const coverWithin = within.some((p) => categoryRule(p.category).coverWithin);
    const hiddenHere = infantry && !shotRecently && within.some((p) => categoryRule(p.category).hides);
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
      const covered = !sight.fully && sight.obscuredBy.some((p) => categoryRule(p.category).coverBehind);
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

/** The rules of a terrain category; categories from other games count as exposed. */
function categoryRule(category: TerrainCategory) {
  return CATEGORY_RULES[category as keyof typeof CATEGORY_RULES] ?? CATEGORY_RULES.exposed;
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
      const rule = categoryRule(p.category);
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
    .filter((u) => opposed(state, u.owner, unit.owner))
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
  // Teammates' OC adds up: a side's total goes to its first player.
  const lead = (id: string) => {
    const seat = state.players[id]?.seat;
    return (seat === undefined ? undefined : sidePlayers(state, seat)[0]?.id) ?? id;
  };
  return state.objectives.map((o) => {
    const oc: Record<string, number> = {};
    for (const m of Object.values(state.models)) {
      if (m.destroyed || !m.unitId) continue;
      const unit = state.units[m.unitId];
      const r = m.base.shape === "round" ? m.base.diameterMm / 25.4 / 2 : 0;
      const d = Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) - r - markerRadius;
      if (d > OBJECTIVE_RANGE + 1e-6) continue;
      const value = unit?.status?.battleShocked ? 0 : (num(m.profile?.chars.OC) ?? 1);
      oc[lead(m.owner)] = (oc[lead(m.owner)] ?? 0) + value;
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
  // Set by a game system's move actions (see core/content/play.ts).
  if (typeof unit.status?.allowance === "number") return unit.status.allowance;
  const phase = phaseName(state);
  if (phase === "Charge") return typeof unit.status?.charge === "number" ? unit.status.charge : null;
  if (phase === "Fight") return 3;
  const m = aliveModels(state, unit)[0];
  const move = num(m?.profile?.chars.M);
  if (move === null) return null;
  const advance = typeof unit.status?.advance === "number" ? unit.status.advance : 0;
  return move + advance;
}

export { clampFraction } from "./measure";
