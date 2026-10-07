import type { ArcDef, Expr, GameSystem } from "../schema";

/**
 * Partial example systems that check the schema isn't 40k-shaped. Both are
 * rank-and-flank games: units are formations with a facing. Mechanics are
 * written from general knowledge of the games and are unverified; they only
 * need to be plausible enough to show the data model fits.
 */

const ref = (r: string): Expr => ({ ref: r });

const rankAndFlankArcs: ArcDef[] = [
  { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
  { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
  { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
  { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
];

/** Old World style: IGOUGO phases, roll-high, chart lookups, 7+ to hit. */
export const oldWorldLike: GameSystem = {
  id: "old-world-like",
  name: "Rank-and-flank, IGOUGO (Old World style, partial)",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Movement", of: "model", type: "distance" },
    { id: "WS", name: "Weapon skill", of: "model", type: "number" },
    { id: "BS", name: "Ballistic skill", of: "model", type: "number" },
    { id: "S", name: "Strength", of: "model", type: "number" },
    { id: "T", name: "Toughness", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
    { id: "I", name: "Initiative", of: "model", type: "number" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "Ld", name: "Leadership", of: "model", type: "number" },
    { id: "armour", name: "Armour", of: "model", type: "target" },
    { id: "ward", name: "Ward save", of: "model", type: "target" },
    { id: "range", name: "Range", of: "weapon", type: "distance" },
    { id: "AP", name: "Armour piercing", of: "weapon", type: "number" },
  ],
  weaponKinds: ["missile", "combat"],
  unitShape: { kind: "ranked", minFiles: 5, manoeuvres: ["wheel", "reform", "turn", "march"] },
  arcs: rankAndFlankArcs,
  tables: [
    // To hit with missile weapons, by BS: 1 -> 6+, 2 -> 5+ ... 5+ -> 2+.
    { id: "missileToHit", rows: [1, 2, 3, 4, 5], values: [[6], [5], [4], [3], [2]] },
  ],
  statuses: [
    { id: "fleeing", name: "Fleeing", on: "unit" },
    {
      id: "inCombat",
      name: "In combat",
      on: "unit",
      // Base contact with an enemy unit.
      derived: {
        some: "enemy.units",
        as: "other",
        test: { cmp: "<=", a: { query: { kind: "distance", from: "self", to: "other" } }, b: 0 },
      },
    },
  ],
  rules: [],
  procedures: [
    {
      id: "shoot",
      name: "Shooting",
      params: ["attacker", "weapon", "target"],
      steps: [
        { kind: "pool", id: "attacks", count: { count: "attacker.models" } },
        {
          kind: "test",
          id: "hit",
          compare: "atLeast",
          target: { table: "missileToHit", row: ref("attacker.BS") },
          alwaysFail: [1],
          roller: "attacker",
          // 7+ means a 6, then 4+; 8+ a 6 then 5+; and so on.
          overflow: { followUp: { op: "-", args: [ref("test.target"), 3] } },
        },
        {
          kind: "test",
          id: "wound",
          compare: "atLeast",
          target: {
            op: "max",
            args: [2, { op: "+", args: [4, { op: "-", args: [ref("target.T"), ref("attacker.S")] }] }],
          },
          impossibleIf: { cmp: ">", a: { op: "-", args: [ref("target.T"), ref("attacker.S")] }, b: 2 },
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
          impossibleIf: { cmp: "<=", a: ref("target.ward"), b: 0 },
          roller: "defender",
          passOn: "failures",
        },
        { kind: "allocate", id: "casualties", chooser: "defender", formation: "rearRankFirst" },
        { kind: "damage", id: "damage", amount: 1, spillover: true },
      ],
    },
    {
      id: "combatResult",
      name: "Combat result",
      params: ["winner", "loser"],
      steps: [
        {
          kind: "compare",
          id: "result",
          a: {
            op: "+",
            args: [ref("winner.woundsCaused"), ref("winner.rankBonus"), ref("winner.flankBonus")],
          },
          b: { op: "+", args: [ref("loser.woundsCaused"), ref("loser.rankBonus"), ref("loser.flankBonus")] },
          outcomes: [
            {
              when: { cmp: ">", a: ref("result.difference"), b: 0 },
              do: [{ do: "run", action: "breakTest" }],
            },
          ],
        },
      ],
    },
    {
      id: "breakTest",
      name: "Break test",
      params: ["unit", "result"],
      steps: [
        { kind: "pool", id: "dice", count: 1 },
        {
          kind: "test",
          id: "leadership",
          compare: "atMost",
          sumOf: 2,
          target: { op: "-", args: [ref("unit.Ld"), ref("result.difference")] },
          roller: "owner",
          passOn: "failures",
        },
        { kind: "do", id: "flee", do: [{ do: "applyStatus", target: "unit", status: "fleeing" }] },
      ],
    },
  ],
  actions: [
    {
      id: "declareCharge",
      name: "Declare charge",
      by: "unit",
      side: "active",
      // Charges go in through the arc the charger starts in.
      target: { filter: { query: { kind: "inArc", from: "it", to: "self", arc: "front" } } },
      move: { kind: "charge", distance: { op: "+", args: [ref("self.M"), { dice: "D6" }] } },
    },
    {
      id: "move",
      name: "Move",
      by: "unit",
      side: "active",
      move: { kind: "normal", distance: ref("self.M") },
    },
    {
      id: "march",
      name: "March",
      by: "unit",
      side: "active",
      move: { kind: "march", distance: { op: "*", args: [ref("self.M"), 2] } },
      sets: ["marched"],
    },
    { id: "shoot", name: "Shoot", by: "unit", side: "active", procedure: "shoot" },
    { id: "fight", name: "Fight", by: "unit", side: "either", procedure: "shoot" },
    { id: "breakTest", name: "Break test", by: "unit", side: "either", procedure: "breakTest" },
  ],
  turn: {
    rounds: 6,
    initiative: "rollOff",
    round: [
      {
        kind: "playerTurns",
        segments: [
          { kind: "phase", id: "strategy", name: "Strategy" },
          { kind: "phase", id: "movement", name: "Movement", actions: ["declareCharge", "move", "march"] },
          { kind: "phase", id: "shooting", name: "Shooting", actions: ["shoot"] },
          {
            kind: "phase",
            id: "combat",
            name: "Combat",
            segments: [
              {
                // Strikes go in initiative order, highest first.
                kind: "alternate",
                id: "strikes",
                pool: { kind: "units", filter: { hasStatus: "it", status: "inCombat" }, order: ref("it.I") },
                activation: [{ kind: "phase", id: "strike", name: "Strike", actions: ["fight"] }],
              },
            ],
          },
        ],
      },
    ],
  },
  checks: [
    {
      id: "wheelDistance",
      name: "Wheel distance",
      when: { event: "move.end" },
      require: { cmp: "<=", a: ref("event.inchesMoved"), b: ref("event.allowed") },
      message: "Moved further than allowed (wheels count the outside edge)",
    },
  ],
};

/** Conquest style: roll-under, command stack, alternating activations with two actions. */
export const conquestLike: GameSystem = {
  id: "conquest-like",
  name: "Rank-and-flank, alternating activation (Conquest style, partial)",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "March", of: "model", type: "distance" },
    { id: "V", name: "Volley", of: "model", type: "number" },
    { id: "C", name: "Clash", of: "model", type: "number" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
    { id: "R", name: "Resolve", of: "model", type: "number" },
    { id: "D", name: "Defense", of: "model", type: "number" },
    { id: "E", name: "Evasion", of: "model", type: "number" },
    { id: "cleave", name: "Cleave", of: "weapon", type: "number" },
  ],
  weaponKinds: ["volley", "clash"],
  unitShape: { kind: "ranked", maxFiles: 3, manoeuvres: ["wheel", "reform"] },
  arcs: rankAndFlankArcs,
  rules: [],
  procedures: [
    {
      id: "clash",
      name: "Clash",
      params: ["attacker", "target"],
      steps: [
        {
          kind: "pool",
          id: "attacks",
          count: { op: "*", args: [ref("attacker.A"), { count: "attacker.models" }] },
        },
        { kind: "test", id: "hit", compare: "atMost", target: ref("attacker.C"), roller: "attacker" },
        {
          kind: "test",
          id: "defense",
          compare: "atMost",
          target: { op: "-", args: [ref("target.D"), ref("weapon.cleave")] },
          roller: "defender",
          passOn: "failures",
        },
        {
          kind: "test",
          id: "resolve",
          compare: "atMost",
          target: ref("target.R"),
          roller: "defender",
          // Each failed resolve test is one more wound, on top of the wound that caused it.
          passOn: "inputPlusFailures",
        },
        { kind: "allocate", id: "casualties", chooser: "defender", formation: "rearRankFirst" },
        { kind: "damage", id: "damage", amount: 1, spillover: true },
      ],
    },
  ],
  actions: [
    { id: "march", name: "March", by: "unit", move: { kind: "march", distance: ref("self.M") } },
    { id: "reform", name: "Reform", by: "unit", move: { kind: "reform", distance: 0 } },
    {
      id: "charge",
      name: "Charge",
      by: "unit",
      move: { kind: "charge", distance: { op: "+", args: [ref("self.M"), { dice: "D6" }] } },
    },
    { id: "clash", name: "Clash", by: "unit", procedure: "clash" },
  ],
  turn: {
    rounds: 6,
    initiative: "rollOff",
    round: [
      { kind: "plan", id: "commandStack", produces: "stack", of: "cards" },
      {
        kind: "alternate",
        id: "activations",
        pool: { kind: "planned", plan: "commandStack" },
        actionsPerActivation: 2,
        activation: [
          {
            kind: "phase",
            id: "activation",
            name: "Activation",
            actions: ["march", "reform", "charge", "clash"],
          },
        ],
      },
    ],
  },
};
