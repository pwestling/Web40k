import type { AbilityTiming, ActionDef, Effect, Expr, GameSystem, RuleDef } from "../schema";

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

/** The model making this pool's attacks is within half the weapon's range of the target. */
const bearerWithinHalfRange: Expr = {
  cmp: "<=",
  a: { query: { kind: "distance", from: "bearer", to: "target" } },
  b: { op: "+", args: [{ op: "/", args: [ref("weapon.range"), 2] }, 0.000001] },
};

/** Every model attacking with the weapon is within half range (damage applies to the whole pool). */
const allWithinHalfRange: Expr = {
  all: [
    { cmp: ">", a: { count: "step.attacks.members" }, b: 0 },
    {
      every: "step.attacks.members",
      as: "bearer",
      test: bearerWithinHalfRange,
    },
  ],
};

/** A weapon keyword with an optional value, e.g. "Sustained Hits 2" or "Sustained Hits D3". */
const keyword = (name: string, param?: string) =>
  param ? `^${name}\\s*(?<${param}>d?\\d+(\\+\\d+)?)?$` : `^${name}$`;

/** Rules whose effect a player resolves by hand; listed as reminders by name. */
const manualRule = (id: string, name: string, match: string): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["weapon"],
  effects: [{ when: { event: "action.declared" }, do: [{ do: "manual", reminder: id }] }],
});

const weaponRules: RuleDef[] = [
  {
    id: "sustainedHits",
    name: "Sustained Hits",
    params: [{ id: "x", type: "dice", default: 1 }],
    match: keyword("sustained hits", "x"),
    appliesTo: ["weapon"],
    effects: [{ when: onCritical("hit"), do: [{ do: "addSuccesses", count: { dice: ref("param.x") } }] }],
  },
  {
    id: "lethalHits",
    name: "Lethal Hits",
    match: keyword("lethal hits"),
    appliesTo: ["weapon"],
    effects: [{ when: onCritical("hit"), do: [{ do: "autoPass", step: "wound" }] }],
  },
  {
    id: "devastatingWounds",
    name: "Devastating Wounds",
    match: keyword("devastating wounds"),
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
    match: "^anti-(?<keyword>.+?)\\s+(?<threshold>\\d)\\+?$",
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
    // Per model: each one within half range makes extra attacks.
    id: "rapidFire",
    name: "Rapid Fire",
    params: [{ id: "x", type: "dice", default: 1 }],
    match: keyword("rapid fire", "x"),
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("attacks"),
        if: bearerWithinHalfRange,
        do: [
          { do: "modifyCharacteristic", target: "weapon", characteristic: "A", by: { dice: ref("param.x") } },
        ],
      },
    ],
  },
  {
    id: "melta",
    name: "Melta",
    params: [{ id: "x", type: "dice", default: 1 }],
    match: keyword("melta", "x"),
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("damage"),
        if: allWithinHalfRange,
        do: [
          { do: "modifyCharacteristic", target: "weapon", characteristic: "D", by: { dice: ref("param.x") } },
        ],
      },
    ],
  },
  {
    // +1 to hit if the unit has not moved this turn.
    id: "heavy",
    name: "Heavy",
    match: keyword("heavy"),
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("hit"),
        if: { not: { hasFlag: "attacker", flag: "moved" } },
        do: [{ do: "modifyRoll", by: 1 }],
      },
    ],
  },
  {
    id: "lance",
    name: "Lance",
    match: keyword("lance"),
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("wound"),
        if: { hasFlag: "attacker", flag: "charged" },
        do: [{ do: "modifyRoll", by: 1 }],
      },
    ],
  },
  {
    id: "twinLinked",
    name: "Twin-linked",
    match: keyword("twin-linked"),
    appliesTo: ["weapon"],
    effects: [{ when: beforeStep("wound"), do: [{ do: "reroll", which: "failed" }] }],
  },
  {
    id: "torrent",
    name: "Torrent",
    match: keyword("torrent"),
    appliesTo: ["weapon"],
    effects: [{ when: beforeStep("hit"), do: [{ do: "skipStep", step: "hit" }] }],
  },
  {
    // Per model: one extra attack for every five models in the target unit.
    id: "blast",
    name: "Blast",
    match: keyword("blast"),
    appliesTo: ["weapon"],
    effects: [
      {
        when: beforeStep("attacks"),
        do: [
          {
            do: "modifyCharacteristic",
            target: "weapon",
            characteristic: "A",
            by: { op: "floor", args: [{ op: "/", args: [{ count: "target.models" }, 5] }] },
          },
        ],
      },
    ],
  },
  {
    id: "ignoresCover",
    name: "Ignores Cover",
    match: keyword("ignores cover"),
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
    match: keyword("hazardous"),
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
    // Changes who allocates; not automated yet.
    id: "precision",
    name: "Precision",
    match: keyword("precision"),
    appliesTo: ["weapon"],
    effects: [{ when: beforeStep("allocate"), do: [{ do: "manual", reminder: "precision" }] }],
  },
  manualRule("indirectFire", "Indirect Fire", keyword("indirect fire")),
  manualRule("pistol", "Pistol", keyword("pistol")),
  manualRule("assault", "Assault", keyword("assault")),
  manualRule("extraAttacks", "Extra Attacks", keyword("extra attacks")),
];

/** "A ranged attack against the unit this rule or status belongs to." */
const rangedAgainstOwner: Expr = {
  all: [
    { is: "ruleOwner", value: "target" },
    { is: "weapon.weaponKind", value: "ranged" },
  ],
};

/** Flags a unit with a core ability the app handles (reserves, scout moves, attaching). */
const flagRule = (id: string, name: string, match: string, params?: RuleDef["params"]): RuleDef => ({
  id,
  name,
  match,
  ...(params ? { params } : {}),
  appliesTo: ["unit"],
  effects: [{ when: { event: "always" }, do: [{ do: "setFlag", target: "self", flag: id, value: true }] }],
});

const unitRules: RuleDef[] = [
  {
    id: "feelNoPain",
    name: "Feel No Pain",
    params: [{ id: "threshold", type: "number" }],
    // Found in an ability's name or text.
    match: "feel no pain\\s*(?<threshold>\\d)\\+",
    appliesTo: ["model", "unit"],
    effects: [{ when: { event: "always" }, do: [{ do: "ignoreDamage", atLeast: ref("param.threshold") }] }],
  },
  {
    // An ability that grants an invulnerable save, e.g. "Invulnerable Save 4+".
    id: "invulnerableSave",
    name: "Invulnerable save",
    params: [{ id: "x", type: "number" }],
    match: "invulnerable[\\s\\S]*?(?<x>\\d)\\+",
    appliesTo: ["model"],
    effects: [
      {
        when: { event: "always" },
        do: [
          {
            do: "setCharacteristic",
            target: "self",
            characteristic: "InSv",
            to: {
              if: { cmp: ">", a: ref("self.InSv"), b: 0 },
              then: { op: "min", args: [ref("self.InSv"), ref("param.x")] },
              else: ref("param.x"),
            },
          },
        ],
      },
    ],
  },
  {
    id: "deepStrike",
    name: "Deep Strike",
    match: "^deep strike",
    appliesTo: ["unit"],
    effects: [
      {
        when: { event: "always" },
        do: [{ do: "setFlag", target: "self", flag: "canDeepStrike", value: true }],
      },
    ],
  },
  {
    id: "stealth",
    name: "Stealth",
    match: "^stealth",
    appliesTo: ["unit"],
    effects: [{ when: beforeStep("hit"), if: rangedAgainstOwner, do: [{ do: "modifyRoll", by: -1 }] }],
  },
  // Lone Operative's range limit is the hit step's impossibleIf below.
  flagRule("loneOperative", "Lone Operative", "^lone operative"),
  flagRule("scouts", "Scouts", "^scouts\\s*(?<x>\\d+)", [{ id: "x", type: "number", default: 6 }]),
  flagRule("leader", "Leader", "^leader\\b"),
];

/** Lone Operative: out of reach of ranged attacks beyond 12" unless attached to a unit. */
const loneOperativeOutOfReach: Expr = {
  all: [
    { is: "weapon.weaponKind", value: "ranged" },
    { hasFlag: "target", flag: "loneOperative" },
    { not: { hasFlag: "target", flag: "attached" } },
    { cmp: ">", a: { query: { kind: "distance", from: "attacker", to: "target" } }, b: 12.000001 },
  ],
};

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

/**
 * Cover improves the save by 1 when the table plays cover that way, except
 * for a 3+ or better save against AP 0. `sight` is supplied by the system
 * module from true line of sight: every visible target model is in cover.
 */
const coverHelpsSave: Expr = {
  all: [
    { is: "settings.cover", value: "save" },
    { is: "weapon.weaponKind", value: "ranged" },
    ref("sight.cover"),
    { not: { hasFlag: "weapon", flag: "ignoresCover" } },
    {
      not: {
        all: [
          { cmp: "==", a: ref("weapon.AP"), b: 0 },
          { cmp: "<=", a: ref("model.Sv"), b: 3 },
        ],
      },
    },
  ],
};

/** AP is stored negative, so Sv - AP worsens the save. Invulnerable saves ignore AP and cover. */
const armourSave: Expr = {
  op: "-",
  args: [ref("model.Sv"), ref("weapon.AP"), { if: coverHelpsSave, then: 1, else: 0 }],
};
const saveTarget: Expr = {
  op: "max",
  args: [
    2,
    {
      if: { cmp: ">", a: ref("model.InSv"), b: 0 },
      then: { op: "min", args: [armourSave, ref("model.InSv")] },
      else: armourSave,
    },
  ],
};

/** A model can attack if the target is within the weapon's range, or engagement range for melee. */
const inReach: Expr = {
  cmp: "<=",
  a: { query: { kind: "distance", from: "bearer", to: "target" } },
  b: {
    op: "+",
    args: [
      {
        if: { is: "weapon.weaponKind", value: "melee" },
        then: ref("const.engagementRange"),
        else: ref("weapon.range"),
      },
      0.000001,
    ],
  },
};

const engagementRange: Expr = {
  all: [
    { cmp: "<=", a: { query: { kind: "distance", from: "self", to: "other" } }, b: 2 },
    { cmp: "<=", a: { query: { kind: "distance", from: "self", to: "other", axis: "vertical" } }, b: 5 },
  ],
};

/**
 * When an imported ability matters, read from its text. Our own patterns,
 * not rules text; per phase the first match wins, so "your opponent's"
 * comes before "your".
 */
const abilityTimings: AbilityTiming[] = [
  {
    phase: "deployment",
    match: "deploy|declare battle formations|start of the (first battle round|battle)\\b",
  },
  { phase: "command", side: "inactive", match: "opponent.s command phase" },
  { phase: "command", side: "active", match: "your command phase" },
  { phase: "command", side: "either", match: "command phase" },
  { phase: "movement", side: "inactive", match: "opponent.s movement phase" },
  { phase: "movement", side: "active", match: "your movement phase|remains? stationary" },
  {
    phase: "movement",
    side: "either",
    match: "movement phase|(normal|advance|fall back) move|from (strategic )?reserves|reinforcements",
  },
  { phase: "shooting", side: "inactive", match: "opponent.s shooting phase" },
  { phase: "shooting", side: "active", match: "your shooting phase|selected to shoot|has shot" },
  { phase: "shooting", side: "either", match: "shooting phase" },
  { phase: "charge", side: "inactive", match: "opponent.s charge phase" },
  { phase: "charge", side: "active", match: "your charge phase|declares? a charge|charge move" },
  { phase: "charge", side: "either", match: "charge phase" },
  { phase: "fight", side: "inactive", match: "opponent.s fight phase|end of (your )?opponent.s turn" },
  { phase: "fight", side: "either", match: "fight phase|selected to fight|\\bfights\\b" },
  { attack: "attacker", weaponKind: "melee", match: "makes? a melee attack" },
  { attack: "attacker", weaponKind: "ranged", match: "makes? a ranged attack" },
  { attack: "attacker", match: "makes? an attack|attacks? made by this (model|unit)" },
  {
    attack: "defender",
    match:
      "attack (targets|is allocated to) (this|that) (unit|model)|made against (it|this unit)|benefit of cover|model is destroyed",
  },
];

/**
 * The 11th edition core stratagems, each once per phase. Costs and timings
 * from the 11th edition core rules (June 2026): Grenade is now Explosives,
 * Tank Shock is Crushing Impact, Go to Ground is gone (it's part of being
 * hidden now), Fire Overwatch is only at the end of the opponent's Movement
 * phase, and Heroic Intervention costs 1 CP (2 CP to go after any enemy unit
 * within 6"; name that one with Other stratagem). Ids stay as they were so
 * saved games and replays still read.
 */
const once = { count: 1, per: "phase" as const };
const cp = (amount: number) => [{ resource: "CP", amount }];
const own: Expr = { same: ["it.owner", "player.id"] };
const ownWith = (keyword: string): Expr => ({ all: [own, kw("it", keyword)] });
const ownWithAny = (...keywords: string[]): Expr => ({
  all: [own, { any: keywords.map((k) => kw("it", k)) }],
});
const unengaged: Expr = { not: { hasStatus: "it", status: "engaged" } };
const stratagems: ActionDef[] = [
  {
    id: "commandReroll",
    name: "Command Re-roll",
    by: "player",
    side: "either",
    cost: cp(1),
    limit: once,
    hint: "Re-roll one roll",
  },
  {
    id: "insaneBravery",
    name: "Insane Bravery",
    by: "player",
    side: "active",
    phases: ["command"],
    cost: cp(1),
    limit: { count: 1, per: "battle" },
    target: { filter: { all: [own, { hasStatus: "it", status: "battleShocked" }] } },
    hint: "Pass a Battle-shock test",
  },
  {
    id: "grenade",
    name: "Explosives",
    by: "player",
    side: "active",
    phases: ["shooting"],
    cost: cp(1),
    limit: once,
    target: { filter: { all: [ownWithAny("EXPLOSIVES", "GRENADES"), unengaged] } },
    hint: 'Roll 6D6 at a visible unengaged unit within 8": each 4+ is a mortal wound',
  },
  {
    id: "tankShock",
    name: "Crushing Impact",
    by: "player",
    side: "active",
    phases: ["charge"],
    cost: cp(1),
    limit: once,
    target: { filter: ownWithAny("MONSTER", "VEHICLE") },
    hint: "After a charge move: roll D6 equal to Toughness; each 5+ wounds the enemy, each 1 your unit (6 at most)",
  },
  {
    id: "rapidIngress",
    name: "Rapid Ingress",
    by: "player",
    side: "inactive",
    phases: ["movement"],
    cost: cp(1),
    limit: once,
    target: { filter: { all: [own, { hasFlag: "it", flag: "reserves" }, { not: kw("it", "AIRCRAFT") }] } },
    notWhen: [{ if: { cmp: "<=", a: ref("turn.round"), b: 1 }, why: "Not in the first battle round" }],
    hint: "End of the opponent's Movement phase: arrive from reserves",
  },
  {
    id: "fireOverwatch",
    name: "Fire Overwatch",
    by: "player",
    side: "inactive",
    phases: ["movement"],
    cost: cp(1),
    limit: once,
    target: { filter: { all: [own, unengaged, { not: kw("it", "TITANIC") }] } },
    hint: "End of the opponent's Movement phase: shoot at a unit within 24\"; hits only on unmodified 6s",
  },
  {
    id: "smokescreen",
    name: "Smokescreen",
    by: "player",
    side: "inactive",
    phases: ["shooting"],
    cost: cp(1),
    limit: once,
    target: { filter: ownWith("SMOKE") },
    do: [{ do: "applyStatus", status: "smokescreen" }],
    hint: "Cover against ranged attacks this phase",
  },
  {
    id: "heroicIntervention",
    name: "Heroic Intervention",
    by: "player",
    side: "inactive",
    phases: ["charge"],
    cost: cp(1),
    limit: once,
    target: { filter: { all: [own, unengaged] } },
    hint: "End of the opponent's Charge phase: a unit within 12\" charges an enemy that just charged",
  },
  {
    id: "counterOffensive",
    name: "Counter-offensive",
    by: "player",
    side: "inactive",
    phases: ["fight"],
    cost: cp(2),
    limit: once,
    target: { filter: own },
    hint: "Fight next, after an enemy unit has fought",
  },
  {
    id: "epicChallenge",
    name: "Epic Challenge",
    by: "player",
    side: "either",
    phases: ["fight"],
    cost: cp(1),
    limit: once,
    target: { filter: ownWith("CHARACTER") },
    hint: "A character's melee attacks get Precision",
  },
  // Faction and detachment stratagems aren't in imported rosters: the player names one and its cost.
  { id: "otherStratagem", name: "Other stratagem", by: "player", side: "either", custom: true, cost: cp(0) },
];

export const fortyK: GameSystem = {
  id: "forty-k-11",
  name: "Sci-fi battle (draft)",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance", aliases: ["Move"] },
    { id: "T", name: "Toughness", of: "model", type: "number", default: 4 },
    { id: "Sv", name: "Save", of: "model", type: "target", aliases: ["Save"], default: 7 },
    {
      id: "InSv",
      name: "Invulnerable save",
      of: "model",
      type: "target",
      aliases: ["INV", "Invuln"],
      default: 0,
    },
    { id: "W", name: "Wounds", of: "model", type: "number", default: 1 },
    { id: "Ld", name: "Leadership", of: "model", type: "target" },
    { id: "OC", name: "Objective control", of: "model", type: "number", default: 1 },
    { id: "range", name: "Range", of: "weapon", type: "distance", default: 0 },
    { id: "A", name: "Attacks", of: "weapon", type: "dice", default: 1 },
    { id: "skill", name: "BS/WS", of: "weapon", type: "target", aliases: ["BS", "WS"], default: 4 },
    { id: "S", name: "Strength", of: "weapon", type: "number", default: 4 },
    { id: "AP", name: "Armour penetration", of: "weapon", type: "number", default: 0 },
    { id: "D", name: "Damage", of: "weapon", type: "dice", default: 1 },
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
      // From the Go to Ground stratagem until the end of the phase. Cover is a reminder.
      id: "goneToGround",
      name: "Gone to ground",
      on: "unit",
      effects: [
        {
          when: { event: "always" },
          do: [
            {
              do: "setCharacteristic",
              target: "self",
              characteristic: "InSv",
              to: {
                if: { cmp: ">", a: ref("self.InSv"), b: 0 },
                then: { op: "min", args: [ref("self.InSv"), 6] },
                else: 6,
              },
            },
          ],
        },
        { when: { event: "action.declared" }, do: [{ do: "manual", reminder: "goneToGround" }] },
      ],
    },
    {
      // From the Smokescreen stratagem until the end of the phase: cover (11th edition), a reminder.
      id: "smokescreen",
      name: "Smokescreen",
      on: "unit",
      effects: [{ when: { event: "action.declared" }, do: [{ do: "manual", reminder: "smokescreen" }] }],
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
  resources: [
    { id: "CP", name: "Command points", short: "CP", on: "player", initial: 0 },
    { id: "VP", name: "Victory points", on: "player", initial: 0 },
  ],
  // Per-turn flags, cleared when their owner's turn begins.
  resets: [
    {
      at: "playerTurn",
      flags: ["moved", "advanced", "fellBack", "shot", "charged", "fought", "advance", "charge"],
    },
    // "auto.*": once-per-battle abilities in use (#38), and "strat.*": faction stratagems (#49), last until the end of the phase.
    { at: "phase", flags: ["goneToGround", "smokescreen", "scouting", "arrived", "auto.*", "strat.*"] },
  ],
  abilityTimings,
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
        {
          kind: "pool",
          id: "attacks",
          each: "weapon.bearers",
          as: "bearer",
          where: inReach,
          count: { dice: ref("weapon.A") },
        },
        {
          kind: "test",
          id: "hit",
          compare: "atLeast",
          target: ref("weapon.skill"),
          impossibleIf: loneOperativeOutOfReach,
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
          // A model that has already lost wounds takes the next one; then ordinary
          // models, then sergeants and special weapons, characters last.
          order: {
            cases: [
              { when: { cmp: ">", a: ref("model.woundsLost"), b: 0 }, then: -1 },
              { when: kw("model", "CHARACTER"), then: 2 },
              { when: { cmp: ">", a: ref("model.special"), b: 0 }, then: 1 },
            ],
            else: 0,
          },
        },
        {
          kind: "test",
          id: "save",
          compare: "atLeast",
          target: saveTarget,
          impossibleIf: { cmp: ">", a: saveTarget, b: 6 },
          alwaysFail: [1],
          // A save roll is modified by no more than 1 either way, like hit and wound rolls.
          modifierCap: 1,
          roller: "defender",
          passOn: "failures",
        },
        // Damage after modifiers is never below 1.
        { kind: "damage", id: "damage", amount: { dice: ref("weapon.D") }, spillover: false, minAmount: 1 },
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
    ...stratagems,
    {
      id: "battleShockTest",
      name: "Battle-shock test",
      by: "unit",
      side: "active",
      if: {
        any: [
          { hasStatus: "self", status: "battleShocked" },
          // Below half-strength (wh40k/module.ts): a lone model counts its wounds instead.
          { call: "belowHalf", args: [ref("self.id")] },
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
      // A charge needs an enemy unit within 12" to declare against (the 40k module's function).
      notWhen: [
        {
          if: { cmp: ">", a: { call: "enemyGap", args: [ref("self.id")] }, b: 12 },
          why: 'No enemy within 12"',
        },
      ],
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
                  { do: "gainResource", resource: "CP", amount: 1, player: "owner" },
                  { do: "gainResource", resource: "CP", amount: 1, player: "opponent" },
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
      // Cover: -1 to hit, when the table plays cover that way.
      id: "Cover",
      when: beforeStep("hit"),
      if: {
        all: [
          { is: "weapon.weaponKind", value: "ranged" },
          ref("sight.cover"),
          { not: { hasFlag: "weapon", flag: "ignoresCover" } },
          { not: { is: "settings.cover", value: "save" } },
        ],
      },
      do: [{ do: "modifyRoll", by: -1 }],
    },
    {
      // Every shooter stands well above every target.
      id: "Higher ground",
      when: beforeStep("hit"),
      if: { all: [{ is: "weapon.weaponKind", value: "ranged" }, ref("sight.higherGround")] },
      do: [{ do: "modifyRoll", by: 1 }],
    },
  ],
  constants: { engagementRange: 2 },
};
