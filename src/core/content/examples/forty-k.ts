import type { Effect, Expr, GameSystem, RuleDef } from "../schema";

/**
 * Example GameSystem: 40k 11th edition core mechanics, encoded as data.
 *
 * This is a draft to prove the schema, not a complete or verified rules
 * implementation. It holds mechanics only (numbers and procedures), no rules
 * text, unit stats or points. Values follow the research notes and still need
 * checking against the official core rules.
 */

const ref = (r: string): Expr => ({ ref: r });
const kw = (target: string, keyword: string): Expr => ({ hasKeyword: target, keyword });

/** "When a die in step X comes up critical." */
const onCritical = (step: string): Effect["when"] => ({
  event: "die.result",
  where: { all: [{ is: "event.step", value: step }, ref("event.critical")] },
});
const beforeStep = (step: string): Effect["when"] => ({
  event: "step.before",
  where: { is: "event.step", value: step },
});

const withinHalfRange: Expr = {
  cmp: "<=",
  a: { query: { kind: "distance", from: "attacker", to: "target" } },
  b: { op: "/", args: [ref("weapon.range"), 2] },
};

const weaponRules: RuleDef[] = [
  {
    id: "sustainedHits",
    name: "Sustained Hits",
    params: [{ id: "x", type: "dice" }],
    appliesTo: ["weapon"],
    effects: [{ when: onCritical("hit"), do: [{ do: "addSuccesses", count: { dice: ref("param.x") } }] }],
  },
  {
    id: "lethalHits",
    name: "Lethal Hits",
    appliesTo: ["weapon"],
    effects: [{ when: onCritical("hit"), do: [{ do: "autoPass", step: "wound" }] }],
  },
  {
    id: "devastatingWounds",
    name: "Devastating Wounds",
    appliesTo: ["weapon"],
    effects: [{ when: onCritical("wound"), do: [{ do: "skipStep", step: "save" }] }],
  },
  {
    id: "anti",
    name: "Anti",
    params: [
      { id: "keyword", type: "keyword" },
      { id: "threshold", type: "number" },
    ],
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("wound"),
        if: { hasKeyword: "target", keyword: { ref: "param.keyword" } },
        do: [{ do: "criticalOn", value: ref("param.threshold") }],
      },
    ],
  },
  {
    id: "rapidFire",
    name: "Rapid Fire",
    params: [{ id: "x", type: "dice" }],
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("attacks"),
        if: withinHalfRange,
        do: [
          { do: "modifyCharacteristic", target: "weapon", characteristic: "A", by: { dice: ref("param.x") } },
        ],
      },
    ],
  },
  {
    id: "melta",
    name: "Melta",
    params: [{ id: "x", type: "dice" }],
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("damage"),
        if: withinHalfRange,
        do: [
          { do: "modifyCharacteristic", target: "weapon", characteristic: "D", by: { dice: ref("param.x") } },
        ],
      },
    ],
  },
  {
    id: "heavy",
    name: "Heavy",
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("hit"),
        if: { cmp: "<=", a: ref("attacker.unit.inchesMoved"), b: 3 },
        do: [{ do: "modifyRoll", by: 1 }],
      },
    ],
  },
  {
    id: "twinLinked",
    name: "Twin-linked",
    appliesTo: ["weapon"],
    effects: [{ when: beforeStep("wound"), do: [{ do: "reroll", which: "failed" }] }],
  },
  {
    id: "torrent",
    name: "Torrent",
    appliesTo: ["weapon"],
    effects: [{ when: beforeStep("hit"), do: [{ do: "skipStep", step: "hit" }] }],
  },
  {
    id: "blast",
    name: "Blast",
    params: [{ id: "x", type: "number" }],
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("attacks"),
        do: [
          {
            do: "modifyCharacteristic",
            target: "weapon",
            characteristic: "A",
            by: {
              op: "*",
              args: [
                ref("param.x"),
                { op: "floor", args: [{ op: "/", args: [{ count: "target.models" }, 5] }] },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: "ignoresCover",
    name: "Ignores Cover",
    appliesTo: ["weapon"],
    effects: [
      {
        when: { event: "always" },
        do: [{ do: "setFlag", target: "weapon", flag: "ignoresCover", value: true }],
      },
    ],
  },
  {
    id: "hazardous",
    name: "Hazardous",
    appliesTo: ["weapon"],
    effects: [
      {
        when: { event: "action.resolved", where: { is: "event.action", value: "shoot" } },
        do: [
          {
            do: "roll",
            dice: "D6",
            outcomes: [
              {
                min: 1,
                max: 2,
                do: [
                  {
                    do: "inflictDamage",
                    target: "bearer",
                    kind: "mortal",
                    amount: {
                      if: { any: [kw("bearer", "CHARACTER"), kw("bearer", "MONSTER")] },
                      then: 3,
                      else: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    // Changes who allocates; not automated in this draft.
    id: "precision",
    name: "Precision",
    appliesTo: ["weapon"],
    effects: [{ when: beforeStep("allocate"), do: [{ do: "manual", reminder: "precision" }] }],
  },
];

const unitRules: RuleDef[] = [
  {
    id: "feelNoPain",
    name: "Feel No Pain",
    params: [{ id: "threshold", type: "number" }],
    appliesTo: ["model", "unit"],
    effects: [{ when: { event: "always" }, do: [{ do: "ignoreDamage", atLeast: ref("param.threshold") }] }],
  },
  {
    id: "deepStrike",
    name: "Deep Strike",
    appliesTo: ["unit"],
    effects: [
      {
        when: { event: "always" },
        do: [{ do: "setFlag", target: "self", flag: "canDeepStrike", value: true }],
      },
    ],
  },
];

/** Hit, wound, allocate, save, damage. */
const woundTarget: Expr = {
  cases: [
    { when: { cmp: ">=", a: ref("weapon.S"), b: { op: "*", args: [ref("target.T"), 2] } }, then: 2 },
    { when: { cmp: ">", a: ref("weapon.S"), b: ref("target.T") }, then: 3 },
    { when: { cmp: "==", a: ref("weapon.S"), b: ref("target.T") }, then: 4 },
    { when: { cmp: "<=", a: { op: "*", args: [ref("weapon.S"), 2] }, b: ref("target.T") }, then: 6 },
  ],
  else: 5,
};

/** AP is stored negative, so Sv - AP worsens the save. Invulnerable saves ignore AP. */
const saveTarget: Expr = {
  if: { cmp: ">", a: ref("model.InSv"), b: 0 },
  then: { op: "min", args: [{ op: "-", args: [ref("model.Sv"), ref("weapon.AP")] }, ref("model.InSv")] },
  else: { op: "-", args: [ref("model.Sv"), ref("weapon.AP")] },
};

const engagementRange: Expr = {
  all: [
    { cmp: "<=", a: { query: { kind: "distance", from: "self", to: "other" } }, b: 2 },
    { cmp: "<=", a: { query: { kind: "distance", from: "self", to: "other", axis: "vertical" } }, b: 5 },
  ],
};

export const fortyK: GameSystem = {
  id: "forty-k-11",
  name: "40k (11th edition mechanics, draft)",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "T", name: "Toughness", of: "model", type: "number" },
    { id: "Sv", name: "Save", of: "model", type: "target" },
    { id: "InSv", name: "Invulnerable save", of: "model", type: "target" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
    { id: "Ld", name: "Leadership", of: "model", type: "target" },
    { id: "OC", name: "Objective control", of: "model", type: "number" },
    { id: "range", name: "Range", of: "weapon", type: "distance" },
    { id: "A", name: "Attacks", of: "weapon", type: "dice" },
    { id: "skill", name: "BS/WS", of: "weapon", type: "target" },
    { id: "S", name: "Strength", of: "weapon", type: "number" },
    { id: "AP", name: "Armour penetration", of: "weapon", type: "number" },
    { id: "D", name: "Damage", of: "weapon", type: "dice" },
  ],
  weaponKinds: ["ranged", "melee"],
  unitShape: { kind: "skirmish" },
  statuses: [
    {
      id: "battleShocked",
      name: "Battle-shocked",
      on: "unit",
      effects: [
        {
          when: { event: "always" },
          do: [{ do: "setCharacteristic", target: "self", characteristic: "OC", to: 0 }],
        },
      ],
    },
    {
      // Simplified: within light or dense terrain. Hidden, elevation and
      // "behind dense terrain" are not modelled yet.
      id: "inCover",
      name: "In cover",
      on: "unit",
      derived: {
        any: [
          { query: { kind: "inArea", subject: "self", area: "terrain.light" } },
          { query: { kind: "inArea", subject: "self", area: "terrain.dense" } },
        ],
      },
    },
    {
      id: "engaged",
      name: "Engaged",
      on: "unit",
      derived: {
        some: "self.models",
        as: "self",
        test: { some: "enemy.models", as: "other", test: engagementRange },
      },
    },
  ],
  resources: [{ id: "cp", name: "Command points", on: "player", initial: 0 }],
  terrain: [
    { id: "exposed", name: "Exposed" },
    { id: "light", name: "Light" },
    { id: "dense", name: "Dense" },
    { id: "solid", name: "Solid", blocksMovement: true, blocksSight: true },
  ],
  rules: [...weaponRules, ...unitRules],
  procedures: [
    {
      id: "attack",
      name: "Attack sequence",
      params: ["attacker", "weapon", "target"],
      steps: [
        { kind: "pool", id: "attacks", count: { dice: ref("weapon.A") } },
        {
          kind: "test",
          id: "hit",
          compare: "atLeast",
          target: ref("weapon.skill"),
          alwaysFail: [1],
          alwaysPass: [6],
          criticalOn: 6,
          modifierCap: 1,
          roller: "attacker",
        },
        {
          kind: "test",
          id: "wound",
          compare: "atLeast",
          target: woundTarget,
          alwaysFail: [1],
          alwaysPass: [6],
          criticalOn: 6,
          modifierCap: 1,
          roller: "attacker",
        },
        {
          kind: "allocate",
          id: "allocate",
          chooser: "defender",
          groupBy: ["model.W", "model.Sv", "model.InSv"],
          order: { if: kw("model", "CHARACTER"), then: 1, else: 0 },
        },
        {
          kind: "test",
          id: "save",
          compare: "atLeast",
          target: saveTarget,
          impossibleIf: { cmp: ">", a: saveTarget, b: 6 },
          alwaysFail: [1],
          roller: "defender",
          passOn: "failures",
        },
        { kind: "damage", id: "damage", amount: { dice: ref("weapon.D") }, spillover: false },
      ],
    },
    {
      id: "battleShockTest",
      name: "Battle-shock test",
      params: ["unit"],
      steps: [
        { kind: "pool", id: "dice", count: 1 },
        {
          kind: "test",
          id: "test",
          compare: "atLeast",
          sumOf: 2,
          target: ref("unit.Ld"),
          roller: "owner",
          passOn: "failures",
        },
        {
          kind: "do",
          id: "shock",
          do: [{ do: "applyStatus", target: "unit", status: "battleShocked", duration: "battle" }],
        },
      ],
    },
  ],
  actions: [
    {
      id: "battleShockTest",
      name: "Battle-shock test",
      by: "unit",
      side: "active",
      if: {
        any: [
          { hasStatus: "self", status: "battleShocked" },
          { cmp: "<=", a: { count: "self.models" }, b: { op: "half", args: [ref("self.startingStrength")] } },
        ],
      },
      procedure: "battleShockTest",
    },
    { id: "remainStationary", name: "Remain stationary", by: "unit", side: "active", sets: ["stationary"] },
    {
      id: "normalMove",
      name: "Normal move",
      by: "unit",
      side: "active",
      if: { not: { hasStatus: "self", status: "engaged" } },
      move: { kind: "normal", distance: ref("self.M") },
    },
    {
      id: "advance",
      name: "Advance",
      by: "unit",
      side: "active",
      if: { not: { hasStatus: "self", status: "engaged" } },
      move: { kind: "advance", distance: { op: "+", args: [ref("self.M"), { dice: "D6" }] } },
      sets: ["advanced"],
    },
    {
      id: "fallBack",
      name: "Fall back",
      by: "unit",
      side: "active",
      if: { hasStatus: "self", status: "engaged" },
      move: { kind: "fallBack", distance: ref("self.M") },
      sets: ["fellBack"],
    },
    {
      id: "shoot",
      name: "Shoot",
      by: "unit",
      side: "active",
      if: { not: { any: [{ hasFlag: "self", flag: "fellBack" }] } },
      target: { filter: { query: { kind: "visible", from: "self", to: "it" } } },
      procedure: "attack",
    },
    {
      id: "charge",
      name: "Charge",
      by: "unit",
      side: "active",
      if: {
        all: [
          { not: { hasStatus: "self", status: "engaged" } },
          { not: { hasFlag: "self", flag: "advanced" } },
          { not: { hasFlag: "self", flag: "fellBack" } },
        ],
      },
      move: { kind: "charge", distance: { dice: "2D6" } },
      sets: ["charged"],
    },
    { id: "pileIn", name: "Pile in", by: "unit", side: "either", move: { kind: "pileIn", distance: 3 } },
    {
      id: "fight",
      name: "Fight",
      by: "unit",
      side: "either",
      if: {
        any: [
          { hasStatus: "self", status: "engaged" },
          { hasFlag: "self", flag: "charged" },
        ],
      },
      procedure: "attack",
    },
    {
      id: "consolidate",
      name: "Consolidate",
      by: "unit",
      side: "either",
      move: { kind: "consolidate", distance: 3 },
    },
  ],
  turn: {
    rounds: 5,
    initiative: "rollOff",
    round: [
      {
        kind: "playerTurns",
        segments: [
          {
            kind: "phase",
            id: "command",
            name: "Command",
            segments: [
              {
                kind: "step",
                id: "gainCp",
                do: [
                  { do: "gainResource", resource: "cp", amount: 1, player: "owner" },
                  { do: "gainResource", resource: "cp", amount: 1, player: "opponent" },
                ],
              },
            ],
            actions: ["battleShockTest"],
          },
          {
            kind: "phase",
            id: "movement",
            name: "Movement",
            actions: ["remainStationary", "normalMove", "advance", "fallBack"],
          },
          { kind: "phase", id: "shooting", name: "Shooting", actions: ["shoot"] },
          { kind: "phase", id: "charge", name: "Charge", actions: ["charge"] },
          { kind: "phase", id: "fight", name: "Fight", actions: ["pileIn", "fight", "consolidate"] },
        ],
      },
    ],
  },
  checks: [
    {
      id: "coherency",
      name: "Unit coherency",
      when: { event: "move.end" },
      require: {
        every: "self.models",
        as: "m",
        test: {
          all: [
            // Counts the model itself, so 2 means "one other model within 2".
            {
              cmp: ">=",
              a: {
                count: "self.models",
                as: "o",
                where: { cmp: "<=", a: { query: { kind: "distance", from: "m", to: "o" } }, b: 2 },
              },
              b: 2,
            },
            {
              every: "self.models",
              as: "o",
              test: { cmp: "<=", a: { query: { kind: "distance", from: "m", to: "o" } }, b: 9 },
            },
          ],
        },
      },
      message: "Unit is out of coherency",
    },
    {
      id: "moveDistance",
      name: "Move distance",
      when: { event: "move.end" },
      require: { cmp: "<=", a: ref("event.inchesMoved"), b: ref("event.allowed") },
      message: "Moved further than allowed",
    },
  ],
  coreEffects: [
    {
      // Cover: -1 to the attacker's BS (a worse target number).
      when: beforeStep("hit"),
      if: {
        all: [
          { hasStatus: "target", status: "inCover" },
          { not: { hasFlag: "weapon", flag: "ignoresCover" } },
        ],
      },
      do: [{ do: "modifyTarget", by: 1 }],
    },
  ],
};
