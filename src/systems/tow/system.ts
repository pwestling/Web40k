import type { Effect, Expr, GameSystem, Procedure } from "../../core/content";

const ref = (r: string): Expr => ({ ref: r });

/** The weapon's Strength, or the shooter's when the weapon has none. */
const strength: Expr = {
  if: { cmp: ">", a: ref("weapon.wS"), b: 0 },
  then: ref("weapon.wS"),
  else: ref("attacker.S"),
};

/**
 * Shooting: to hit from Ballistic Skill (7 - BS, at least 2+), where each
 * penalty raises the number needed and 7+ means a 6 followed by 4+ (8+ a 6
 * then 5+, 9+ a 6 then 6+, 10+ can't hit); to wound from Strength against
 * Toughness; then armour (worsened by AP), ward and regeneration saves.
 * Casualties come off the rear rank. From general knowledge of the game,
 * unverified against the rules index.
 */
const shooting: Procedure = {
  id: "shoot",
  name: "Shooting",
  params: ["attacker", "weapon", "target"],
  steps: [
    // The front rank shoots; extra ranks (volley fire, hills) are added by hand for now.
    {
      kind: "pool",
      id: "attacks",
      count: { op: "min", args: [{ count: "attacker.models" }, ref("attacker.files")] },
    },
    {
      kind: "test",
      id: "hit",
      compare: "atLeast",
      target: { op: "max", args: [2, { op: "-", args: [7, ref("attacker.BS")] }] },
      impossibleIf: { cmp: ">=", a: { op: "-", args: [7, ref("attacker.BS")] }, b: 10 },
      alwaysFail: [1],
      roller: "attacker",
      overflow: { followUp: { op: "-", args: [ref("test.target"), 3] } },
    },
    {
      kind: "test",
      id: "wound",
      compare: "atLeast",
      target: {
        op: "min",
        args: [
          6,
          { op: "max", args: [2, { op: "-", args: [{ op: "+", args: [4, ref("target.T")] }, strength] }] },
        ],
      },
      impossibleIf: { cmp: ">=", a: { op: "-", args: [ref("target.T"), strength] }, b: 4 },
      alwaysFail: [1],
      roller: "attacker",
    },
    {
      kind: "test",
      id: "armour",
      compare: "atLeast",
      target: { op: "-", args: [ref("target.armour"), ref("weapon.AP")] },
      impossibleIf: { cmp: ">", a: { op: "-", args: [ref("target.armour"), ref("weapon.AP")] }, b: 6 },
      alwaysFail: [1],
      roller: "defender",
      passOn: "failures",
    },
    {
      kind: "test",
      id: "ward",
      compare: "atLeast",
      target: ref("target.ward"),
      impossibleIf: { not: { cmp: ">", a: ref("target.ward"), b: 0 } },
      alwaysFail: [1],
      roller: "defender",
      passOn: "failures",
    },
    {
      kind: "test",
      id: "regeneration",
      compare: "atLeast",
      target: ref("target.regen"),
      impossibleIf: { not: { cmp: ">", a: ref("target.regen"), b: 0 } },
      alwaysFail: [1],
      roller: "defender",
      passOn: "failures",
    },
    // Heavy losses (a quarter of the unit) call for a Panic test: code (combat.ts heavyLosses), once the shooting is closed.
    {
      kind: "do",
      id: "panic",
      do: [
        {
          do: "script",
          procedure: "heavyLosses",
          args: { unit: ref("target"), before: { count: "target.models" } },
        },
      ],
    },
    { kind: "allocate", id: "casualties", chooser: "defender", formation: "rearRankFirst" },
    { kind: "damage", id: "damage", amount: 1, spillover: false },
  ],
};

const beforeHit: Effect["when"] = { event: "step.before", where: { is: "event.step", value: "hit" } };

/** To-hit penalties; each raises the score needed by one (unverified). */
const shootingModifiers: Effect[] = [
  {
    id: "Long range",
    when: beforeHit,
    if: {
      cmp: ">",
      a: { query: { kind: "distance", from: "attacker", to: "target" } },
      b: { op: "/", args: [ref("weapon.range"), 2] },
    },
    do: [{ do: "modifyTarget", by: 1 }],
  },
  {
    id: "Moved and shot",
    when: beforeHit,
    if: { hasFlag: "attacker", flag: "moved" },
    do: [{ do: "modifyTarget", by: 1 }],
  },
  {
    id: "Cover",
    when: beforeHit,
    if: { query: { kind: "cover", from: "attacker", to: "target" } },
    do: [{ do: "modifyTarget", by: 1 }],
  },
];

/**
 * Rank-and-flank IGOUGO play in the style of Warhammer: The Old World, set up
 * to be played by hand: regiments are blocks with front, flank and rear arcs,
 * the engine measures moves, wheels and arcs, and players roll the dice and
 * apply the results. No rules text, profiles or points: players bring those.
 *
 * Checked against the community rules index (tow.whfb.app): the 72" x 48"
 * table, the phase order, the 90 degree vision arc, the terrain types, and
 * (2026-10-07, by the Old World gaps thread) the manoeuvre costs, march
 * block and rank rules below. They only drive advisory warnings.
 */
export const oldWorld: GameSystem = {
  id: "tow-hand",
  name: "Rank and flank (by hand)",
  version: "0.1.0",
  units: "inch",
  defaultTable: { width: 72, depth: 48 },
  settings: { los: "true", modelsBlock: true, visionArc: 90 },
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Movement", of: "model", type: "distance", aliases: ["Move"] },
    { id: "WS", name: "Weapon skill", of: "model", type: "number" },
    { id: "BS", name: "Ballistic skill", of: "model", type: "number" },
    { id: "S", name: "Strength", of: "model", type: "number" },
    { id: "T", name: "Toughness", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
    { id: "I", name: "Initiative", of: "model", type: "number" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "Ld", name: "Leadership", of: "model", type: "number" },
    { id: "US", name: "Unit strength", of: "model", type: "number", default: 1 },
    { id: "Troop", name: "Troop type", of: "model", type: "text", aliases: ["Troop type", "Type"] },
    {
      id: "armour",
      name: "Armour save",
      short: "Sv",
      of: "model",
      type: "target",
      aliases: ["Sv", "Armour"],
      default: 7,
    },
    {
      id: "ward",
      name: "Ward save",
      short: "Ward",
      of: "model",
      type: "target",
      aliases: ["Ward"],
      default: 0,
    },
    {
      id: "regen",
      name: "Regeneration save",
      short: "Regen",
      of: "model",
      type: "target",
      aliases: ["Regeneration"],
      default: 0,
    },
    { id: "range", name: "Range", short: "Rng", of: "weapon", type: "distance", aliases: ["Range"] },
    {
      id: "wS",
      name: "Weapon strength",
      short: "S",
      of: "weapon",
      type: "number",
      aliases: ["S", "Strength"],
      default: 0,
    },
    { id: "AP", name: "Armour piercing", of: "weapon", type: "number", aliases: ["AP"], default: 0 },
  ],
  weaponKinds: ["missile", "combat"],
  unitShape: { kind: "ranked", minFiles: 1, manoeuvres: ["wheel", "reform", "turn", "march"] },
  arcs: [
    { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
    { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
    { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
    { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
  ],
  // A charge, a march and its test last the unit's own turn.
  resets: [{ at: "playerTurn", flags: ["charged", "marching", "marchTest"] }],
  // Psychology marks on a regiment (combat.ts, psychology.ts); spells show as their own names.
  statuses: [
    { id: "fleeing", name: "Fleeing", on: "unit" },
    {
      id: "stupid",
      name: "Stupid this turn",
      on: "unit",
      hint: "Stupid this turn: it can't declare a charge and moves straight ahead.",
    },
    { id: "frenzyLost", name: "Frenzy lost", on: "unit" },
  ],
  resources: [{ id: "VP", name: "Victory points", on: "player", initial: 0 }],
  terrain: [
    { id: "open", name: "Open ground" },
    { id: "difficult", name: "Difficult terrain" },
    { id: "dangerous", name: "Dangerous terrain" },
    { id: "impassable", name: "Impassable", blocksMovement: true, blocksSight: true },
    { id: "lowObstacle", name: "Low linear obstacle", cover: true },
    { id: "highObstacle", name: "High linear obstacle", cover: true, blocksSight: true },
    { id: "woods", name: "Woods", cover: true },
    { id: "hill", name: "Hill" },
    { id: "building", name: "Building", cover: true, blocksSight: true },
  ],
  rules: [],
  procedures: [shooting],
  actions: [{ id: "shoot", name: "Shoot", by: "unit", side: "active", procedure: "shoot" }],
  coreEffects: shootingModifiers,
  turn: {
    rounds: 6,
    initiative: "rollOff",
    round: [
      {
        kind: "playerTurns",
        segments: [
          { kind: "phase", id: "strategy", name: "Strategy" },
          { kind: "phase", id: "movement", name: "Movement" },
          { kind: "phase", id: "shooting", name: "Shooting", actions: ["shoot"] },
          { kind: "phase", id: "combat", name: "Combat" },
        ],
      },
    ],
  },
  constants: {
    /** Models a rank needs to count towards the rank bonus; by troop type (see troops.ts), this is the default. */
    rankWidth: 5,
    /** Most the rank bonus can be (infantry); by troop type in troops.ts. */
    maxRankBonus: 2,
    /** A march is double Movement... */
    marchMultiple: 2,
    /** ...and needs a Leadership test this close to an enemy that isn't fleeing. */
    marchBlock: 8,
    /** Share of Movement each 90 degrees of turn costs (180 degrees: twice this). */
    turnCost: 0.25,
    /** Share of Movement a reform costs: all of it; the unit moves no further. */
    reformCost: 1,
    /** Share of Movement redressing the ranks costs, changing the frontage by up to `redressMax` models. */
    redressCost: 0.5,
    redressMax: 5,
    /** Moving backwards or sideways is at half rate: each inch costs two. */
    slowMoveCost: 2,
    /** One manoeuvre (turn, back, sideways, redress or reform) per move; wheels don't count. */
    manoeuvresPerMove: 1,
  },
};
