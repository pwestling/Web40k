import type { ArcDef, Effect, Expr, GameSystem, Procedure, RuleDef } from "../../core/content";

/**
 * Conquest: The Last Argument of Kings, played with the engine's help:
 * regiments of stands with front, flank and rear arcs; a command stack each
 * round (the module's `stack` state, see command.ts); alternating
 * activations of two actions; and roll-under Volley and Clash attacks with
 * Defense and Resolve, run as procedures.
 *
 * Written from the paraphrased core rules notes in research/conquest-rules.md
 * (2.0, 2026). No rules text, profiles or points: the sample armies are
 * invented. Special rules play themselves by name (`specialRules`, and
 * special.ts for those played in code); the rest are reminders. Supremacy is a
 * roll-off each round (no modifiers yet, and the higher goes first: the
 * rules have the lower roller choose; see docs/rules-coverage/conquest.md).
 */

const ref = (r: string): Expr => ({ ref: r });
const count = (unit: string): Expr => ({ count: `${unit}.models` });

/** Stands outside the front rank. */
const rearStands = (unit: string): Expr => ({
  op: "max",
  args: [0, { op: "-", args: [count(unit), ref(`${unit}.files`)] }],
});
const frontStands = (unit: string): Expr => ({ op: "min", args: [count(unit), ref(`${unit}.files`)] });

/**
 * The regiment tests on its best Resolve among its stands (an attached
 * character's counts); a Broken regiment on its lowest instead. Resolve rises
 * with the regiment's size: +1 for 4-6 stands, +2 for 7-9, +3 for 10 or more.
 */
const resolveTarget: Expr = {
  op: "+",
  args: [
    {
      if: { hasStatus: "target", status: "broken" },
      then: { least: "target.models", as: "stand", of: ref("stand.R") },
      else: { most: "target.models", as: "stand", of: ref("stand.R") },
    },
    {
      if: { cmp: ">=", a: count("target"), b: 10 },
      then: 3,
      else: {
        if: { cmp: ">=", a: count("target"), b: 7 },
        then: 2,
        else: { if: { cmp: ">=", a: count("target"), b: 4 }, then: 1, else: 0 },
      },
    },
  ],
};

/** The attacker stands in one of the target's flank arcs. */
const flanked: Expr = {
  any: [
    { query: { kind: "inArc", from: "target", to: "attacker", arc: "leftFlank" } },
    { query: { kind: "inArc", from: "target", to: "attacker", arc: "rightFlank" } },
  ],
};

/**
 * Hits on Volley or Clash or less; a natural 6 always misses and a natural 1
 * always hits. Defense on the higher of Defense (less Cleave) and Evasion: a
 * 1 is no automatic save, so D and E of 0 never save. Each failed defense is
 * a wound; each wound calls for a Resolve test, and each failed test is one
 * more wound. From a flank, passed Resolve tests are re-rolled; from the
 * rear, every test fails.
 */
function attack(
  id: string,
  name: string,
  pool: Expr,
  hitOn: string,
  cleave: Expr,
  afterHit: Procedure["steps"] = [],
): Procedure {
  return {
    id,
    name,
    params: ["attacker", "target"],
    steps: [
      { kind: "pool", id: "attacks", count: pool },
      {
        kind: "test",
        id: "hit",
        compare: "atMost",
        target: ref(hitOn),
        alwaysFail: [6],
        alwaysPass: [1],
        roller: "attacker",
      },
      ...afterHit,
      {
        kind: "test",
        id: "defense",
        compare: "atMost",
        target: {
          op: "max",
          args: [
            0,
            {
              op: "-",
              args: [
                // Shield adds to Defense (not Evasion) against attacks from the front.
                {
                  op: "+",
                  args: [
                    ref("target.D"),
                    {
                      if: { query: { kind: "inArc", from: "target", to: "attacker", arc: "front" } },
                      then: ref("target.Shield"),
                      else: 0,
                    },
                  ],
                },
                { op: "max", args: [0, { op: "-", args: [cleave, ref("target.Hardened")] }] },
              ],
            },
            ref("target.E"),
          ],
        },
        roller: "defender",
        passOn: "failures",
      },
      {
        kind: "test",
        id: "resolve",
        if: { not: flanked },
        compare: "atMost",
        target: resolveTarget,
        impossibleIf: { query: { kind: "inArc", from: "target", to: "attacker", arc: "rear" } },
        alwaysFail: [6],
        alwaysPass: [1],
        roller: "defender",
        passOn: "inputPlusFailures",
      },
      {
        // From a flank, passed tests are re-rolled: the same as needing two dice to pass.
        kind: "test",
        id: "resolve_flanked",
        if: flanked,
        compare: "atMost",
        target: resolveTarget,
        dicePerInput: 2,
        keep: "highest",
        alwaysFail: [6],
        alwaysPass: [1],
        roller: "defender",
        passOn: "inputPlusFailures",
      },
      // Broken and Shattered (morale.ts): runs once the attack is closed and its casualties are off.
      {
        kind: "do",
        id: "aftermath",
        do: [
          {
            do: "script",
            procedure: "aftermath",
            // Lethal Demise (special.ts) reads the wounds the attack cost.
            args: {
              unit: ref("target"),
              before: count("target"),
              attacker: ref("attacker"),
              hp: { call: "woundsLeft", args: [ref("target.id")] },
            },
          },
        ],
      },
      {
        kind: "allocate",
        id: "casualties",
        chooser: "defender",
        formation: "rearRankFirst",
        alternateEnds: true,
        // The command stand goes last of all, after any character (command.ts).
        last: { call: "commandStand", args: [ref("model")] },
      },
      { kind: "damage", id: "wounds", amount: 1, spillover: true },
    ],
  };
}

/** Smite: the target's Defence counts as 0 against the attacker's melee attacks (Evasion still counts). */
const melee = (cleave: Expr): Expr => ({
  if: { hasRule: "attacker", rule: "smite" },
  then: 99,
  else: cleave,
});

/**
 * After a charge that made contact: Impact(X) attacks from each front-rank
 * stand, rolled like a clash (unverified: hits on Clash). Unstoppable Charge
 * doubles them; Brutal Impact (X) lowers Defence against them like Cleave.
 */
const impact = attack(
  "impact",
  "Impact",
  {
    op: "*",
    args: [
      ref("attacker.Impact"),
      frontStands("attacker"),
      { if: { hasRule: "attacker", rule: "unstoppableCharge" }, then: 2, else: 1 },
    ],
  },
  "attacker.C",
  melee({ op: "+", args: [ref("attacker.Cleave"), ref("attacker.BrutalImpact")] }),
);

/** Barrage shots from each front-rank stand with a clear shot (command.ts), one more each within half range. */
/**
 * Hits from a special rule (Lethal Demise, Aura of Death; special.ts): no hit
 * roll, then Defense and Resolve as usual. The count waits in the module's state.
 */
const hitsBase = attack("hits", "Hits", { call: "pendingHits", args: [ref("target.id")] }, "attacker.C", 0);
const hits: Procedure = {
  ...hitsBase,
  steps: hitsBase.steps
    .filter((s) => s.id !== "hit")
    .map((s) =>
      s.kind === "do"
        ? {
            ...s,
            do: s.do.map((a) => (a.do === "script" ? { ...a, args: { ...a.args, chained: true } } : a)),
          }
        : s,
    ),
};

const volley = attack(
  "volley",
  "Volley",
  {
    op: "*",
    args: [
      {
        op: "+",
        args: [
          ref("attacker.Barrage"),
          {
            if: {
              cmp: "<=",
              a: { query: { kind: "distance", from: "attacker", to: "target" } },
              b: { op: "/", args: [ref("attacker.Range"), 2] },
            },
            then: 1,
            else: 0,
          },
        ],
      },
      { call: "clearShots", args: [ref("attacker.id"), ref("target.id")] },
    ],
  },
  "attacker.V",
  // Armour Piercing (X): Defence X lower against the volley.
  ref("attacker.ArmourPiercing"),
  [
    {
      // Torrential Fire, not at long range: each hit makes one more shot, which can't make more.
      // Rolled as a test that each extra shot "fails" when it hits (V or less), so the
      // hits go on with one more for each.
      kind: "test",
      id: "torrential",
      if: {
        all: [
          { hasRule: "attacker", rule: "torrentialFire" },
          {
            cmp: "<=",
            a: { query: { kind: "distance", from: "attacker", to: "target" } },
            b: { op: "/", args: [ref("attacker.Range"), 2] },
          },
        ],
      },
      compare: "atLeast",
      target: { op: "+", args: [ref("attacker.V"), 1] },
      alwaysPass: [6],
      alwaysFail: [1],
      roller: "attacker",
      passOn: "inputPlusFailures",
    },
  ],
);

/**
 * Attacks from each front-rank stand, plus support from each stand behind:
 * one each, or Support(X). Every front stand is taken to be in contact.
 */
const clash = attack(
  "clash",
  "Clash",
  {
    op: "+",
    args: [
      { op: "*", args: [ref("attacker.A"), frontStands("attacker")] },
      { op: "*", args: [rearStands("attacker"), { op: "max", args: [1, ref("attacker.Support")] }] },
    ],
  },
  "attacker.C",
  melee(ref("attacker.Cleave")),
);

const beforeHit = (procedure: string): Effect["when"] => ({
  event: "step.before",
  where: {
    all: [
      { is: "event.step", value: "hit" },
      { is: "event.procedure", value: procedure },
    ],
  },
});

const inspired: Expr = {
  all: [{ hasStatus: "attacker", status: "inspired" }, { not: { hasStatus: "attacker", status: "broken" } }],
};

const effects: Effect[] = [
  {
    // Inspired: +1 Clash, while that leaves Clash under 5. A Broken regiment can't be Inspired.
    id: "Inspired",
    when: beforeHit("clash"),
    if: { all: [inspired, { cmp: "<=", a: ref("attacker.C"), b: 3 }] },
    do: [{ do: "modifyTarget", by: 1 }],
  },
  {
    // At Clash 4 or more, Inspired re-rolls natural 6s to hit instead.
    id: "Inspired: re-roll natural 6s to hit (Clash already 4+)",
    when: beforeHit("clash"),
    if: { all: [inspired, { cmp: ">=", a: ref("attacker.C"), b: 4 }] },
    do: [{ do: "reroll", which: { values: [6] } }],
  },
  {
    // Obscuring terrain halves Barrage (secondary source): the shots are set by hand.
    id: "Obscured: halve Barrage (set the shots by hand)",
    when: {
      event: "step.before",
      where: {
        all: [
          { is: "event.step", value: "attacks" },
          { is: "event.procedure", value: "volley" },
        ],
      },
    },
    if: { query: { kind: "cover", from: "attacker", to: "target" } },
    do: [{ do: "manual", reminder: "obscured" }],
  },
  {
    // Take Aim: the volley re-rolls its misses.
    id: "Aimed shot",
    when: beforeHit("volley"),
    // An Arcing Fire volley at an enemy only a friend sees loses the aim's benefit.
    if: {
      all: [
        { hasFlag: "attacker", flag: "aimed" },
        {
          any: [
            { not: { hasRule: "attacker", rule: "arcingFire" } },
            { query: { kind: "visible", from: "attacker", to: "target" } },
          ],
        },
      ],
    },
    do: [{ do: "reroll", which: "failed" }],
  },
];

const owns = (role: "attacker" | "target"): Expr => ({ is: "ruleOwner", value: role });
const beforeStep = (step: string): Effect["when"] => ({
  event: "step.before",
  where: { is: "event.step", value: step },
});
/** A die of this step that rolled this natural value. */
const onDie = (step: string, natural: number, procedure?: string): Effect["when"] => ({
  event: "die.result",
  where: {
    all: [
      { is: "event.step", value: step },
      { cmp: "==", a: ref("event.natural"), b: natural },
      ...(procedure ? [{ is: "event.procedure", value: procedure }] : []),
    ],
  },
});
/** A rule the procedures, actions or module code look for by id (`hasRule`), with no effects of its own. */
const played = (id: string, name: string, match: string): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["unit"],
  effects: [],
  played: "code",
});
/** "Cleave (X)": sets the characteristic the attack procedures read to X. */
const setsFrom = (id: string, name: string, match: string, characteristic: string, x: number): RuleDef => ({
  id,
  name,
  params: [{ id: "x", type: "number", default: x }],
  match,
  appliesTo: ["unit"],
  effects: [
    {
      when: { event: "always" },
      do: [{ do: "setCharacteristic", target: "self", characteristic, to: ref("param.x") }],
    },
  ],
});
const reminder = (id: string, name: string, match: string): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["unit"],
  effects: [{ when: { event: "action.declared" }, do: [{ do: "manual", reminder: id }] }],
});

/** Fearless regiments ignore enemy Terrifying. */
const notFearless: Expr = { not: { hasRule: "target", rule: "fearless" } };

/**
 * Special rules, found in a regiment's ability names ("Flurry", "Hardened (1)").
 * Written from the paraphrased notes (secondary sources; see conquest.md).
 */
const specialRules: RuleDef[] = [
  {
    // Re-roll missed Clash hits.
    id: "flurry",
    name: "Flurry",
    match: "^flurry\\b",
    appliesTo: ["unit"],
    effects: [{ when: beforeHit("clash"), if: owns("attacker"), do: [{ do: "reroll", which: "failed" }] }],
  },
  {
    // +1 Defense against attacks from the front (the defense step reads Shield,
    // so it raises Defense only, never Evasion).
    id: "shield",
    name: "Shield",
    match: "^shield\\b",
    appliesTo: ["unit"],
    effects: [
      {
        when: { event: "always" },
        do: [{ do: "setCharacteristic", target: "self", characteristic: "Shield", to: 1 }],
      },
    ],
  },
  {
    // Cleave against it is X less (the defense step reads Hardened).
    id: "hardened",
    name: "Hardened",
    params: [{ id: "x", type: "number", default: 1 }],
    match: "^hardened\\s*\\(?\\s*(?<x>\\d+)?",
    appliesTo: ["unit"],
    effects: [
      {
        when: { event: "always" },
        do: [{ do: "setCharacteristic", target: "self", characteristic: "Hardened", to: ref("param.x") }],
      },
    ],
  },
  {
    // Regiments testing Resolve against it do so at −X.
    id: "terrifying",
    name: "Terrifying",
    params: [{ id: "x", type: "number", default: 1 }],
    match: "^terrifying\\s*\\(?\\s*(?<x>\\d+)?",
    appliesTo: ["unit"],
    effects: [
      {
        when: beforeStep("resolve"),
        if: { all: [owns("attacker"), notFearless] },
        do: [{ do: "modifyTarget", by: { op: "-", args: [0, ref("param.x")] } }],
      },
      {
        when: beforeStep("resolve_flanked"),
        if: { all: [owns("attacker"), notFearless] },
        do: [{ do: "modifyTarget", by: { op: "-", args: [0, ref("param.x")] } }],
      },
    ],
  },
  {
    // A defense roll of 6 costs two wounds.
    id: "deadlyBlades",
    name: "Deadly Blades",
    match: "^deadly blades\\b",
    appliesTo: ["unit"],
    effects: ["clash", "impact"].map((p) => ({
      when: onDie("defense", 6, p),
      if: owns("attacker"),
      do: [{ do: "addSuccesses", count: 1 }],
    })),
  },
  {
    // A Clash hit roll of 1 scores a second hit.
    id: "relentlessBlows",
    name: "Relentless Blows",
    match: "^relentless blows\\b",
    appliesTo: ["unit"],
    effects: [
      { when: onDie("hit", 1, "clash"), if: owns("attacker"), do: [{ do: "addSuccesses", count: 1 }] },
    ],
  },
  // Characteristics read by the attack procedures above, set from the rule's name.
  setsFrom("cleave", "Cleave", "^cleave\\s*\\(?\\s*(?<x>\\d+)?", "Cleave", 1),
  // A bare "Support" (older lists) means two support attacks per stand.
  setsFrom("support", "Support", "^support\\s*\\(?\\s*(?<x>\\d+)?", "Support", 2),
  setsFrom("impact", "Impact", "^impact\\s*\\(?\\s*(?<x>\\d+)?", "Impact", 1),
  setsFrom(
    "armourPiercing",
    "Armour Piercing",
    "^armou?r piercing\\s*\\(?\\s*(?<x>\\d+)?",
    "ArmourPiercing",
    1,
  ),
  setsFrom("brutalImpact", "Brutal Impact", "^brutal impact\\s*\\(?\\s*(?<x>\\d+)?", "BrutalImpact", 1),
  {
    // Barrage (X) with its range and any Armour Piercing in brackets: "Barrage 2 (24", Armour Piercing 1)".
    id: "barrage",
    name: "Barrage",
    params: [
      { id: "x", type: "number", default: 1 },
      { id: "range", type: "number", default: 0 },
      { id: "ap", type: "number", default: 0 },
    ],
    match:
      "^barrage\\s*\\(?\\s*(?<x>\\d+)?\\s*\\)?\\s*(?:\\(\\s*(?<range>\\d+)\\s*(?:\"|''|in)?\\s*(?:,\\s*armou?r piercing\\s*(?<ap>\\d+))?)?",
    appliesTo: ["unit"],
    effects: [
      {
        when: { event: "always" },
        do: [{ do: "setCharacteristic", target: "self", characteristic: "Barrage", to: ref("param.x") }],
      },
      {
        when: { event: "always" },
        if: { cmp: ">", a: ref("param.range"), b: 0 },
        do: [{ do: "setCharacteristic", target: "self", characteristic: "Range", to: ref("param.range") }],
      },
      {
        when: { event: "always" },
        if: { cmp: ">", a: ref("param.ap"), b: 0 },
        do: [
          { do: "setCharacteristic", target: "self", characteristic: "ArmourPiercing", to: ref("param.ap") },
        ],
      },
    ],
  },
  {
    // Like Deadly Blades, for its volleys.
    id: "deadlyShot",
    name: "Deadly Shot",
    match: "^deadly shot\\b",
    appliesTo: ["unit"],
    effects: [
      { when: onDie("defense", 6, "volley"), if: owns("attacker"), do: [{ do: "addSuccesses", count: 1 }] },
    ],
  },
  {
    // Re-roll missed hits against Monsters.
    id: "fiendHunter",
    name: "Fiend Hunter",
    match: "^fiend hunter\\b",
    appliesTo: ["unit"],
    effects: [
      {
        when: beforeStep("hit"),
        if: { all: [owns("attacker"), { is: "target.Type", value: "Monster" }] },
        do: [{ do: "reroll", which: "failed" }],
      },
    ],
  },
  // Read by the procedures, actions and code by rule id (hasRule): see each one's use.
  played("fearless", "Fearless", "^fearless\\b"), // ignores enemy Terrifying (above)
  played("smite", "Smite", "^smite\\b"), // Defence 0 against its melee attacks (`melee`)
  played("unstoppableCharge", "Unstoppable Charge", "^unstoppable charge\\b"), // twice the Impact attacks
  played("torrentialFire", "Torrential Fire", "^torrential fire\\b"), // the volley's "torrential" step
  played("fluidFormation", "Fluid Formation", "^fluid formation\\b"), // an extra Reform, sees all round
  played("arcingFire", "Arcing Fire", "^arcing fire\\b"), // aimed volleys at targets a friend sees
  played("vanguard", "Vanguard", "^vanguard\\b"), // a free March on arrival
  played("unstoppable", "Unstoppable", "^unstoppable(?!\\s+charge)\\b"), // re-rolls a short charge (charge.ts)
  played("lethalDemise", "Lethal Demise", "^lethal demise\\b"), // hits back for wounds taken (special.ts)
  played("auraOfDeath", "Aura of Death", "^aura of death\\b"), // hits at round start (special.ts)
  played("fly", "Fly", "^fly\\b"), // marches over impassable terrain (the terrain list below)
  // Played by hand: listed as reminders when they come up.
  reminder("oblivious", "Oblivious", "^oblivious\\b"),
  reminder("snapfire", "Snapfire", "^snapfire\\b"),
  reminder("blessed", "Blessed", "^blessed\\b"),
  reminder("fearsome", "Fearsome", "^fearsome\\b"),
  reminder("resistDecay", "Resist Decay", "^resist decay\\b"),
  reminder("devout", "Devout", "^devout\\b"),
  reminder("feral", "Feral", "^feral\\b"),
  reminder("flank", "Flank", "^flank\\b"),
  reminder("quicksilverStrike", "Quicksilver Strike", "^quicksilver strike\\b"),
  // Spellcasting characters: their spells are played by hand.
  reminder("wizard", "Wizard", "^wizard\\b"),
  reminder("priest", "Priest", "^priest\\b"),
];

const arcs: ArcDef[] = [
  { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
  { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
  { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
  { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
];

const notBroken: Expr = { not: { hasStatus: "self", status: "broken" } };
/** A regiment that arrived from reserve this round marches first (reinforce.ts). */
const marchFirst = {
  if: { all: [{ hasFlag: "self", flag: "reinforced" }, { not: { hasFlag: "self", flag: "actionsTaken" } }] },
  why: "Arrived this round: march first",
} satisfies { if: Expr; why: string };
/** Engaged: an enemy within reach (command.ts). */
const engaged: Expr = { call: "engaged", args: [ref("self.id")] };
const notEngaged = { if: engaged, why: "Engaged: combat actions only" } satisfies { if: Expr; why: string };
const mustBeEngaged = { if: { not: engaged }, why: "Not engaged" } satisfies { if: Expr; why: string };
/**
 * Volley targets in sight: Fluid Formation sees all round; Arcing Fire, having
 * taken aim, may shoot at an enemy a friendly regiment sees (special.ts).
 */
const volleySight: Expr = {
  any: [
    { query: { kind: "visible", from: "self", to: "it" } },
    {
      all: [
        { hasRule: "self", rule: "fluidFormation" },
        { query: { kind: "visible", from: "self", to: "it", allAround: true } },
      ],
    },
    {
      all: [
        { hasRule: "self", rule: "arcingFire" },
        { hasFlag: "self", flag: "aimed" },
        { call: "friendSees", args: [ref("self.id"), ref("it.id")] },
      ],
    },
  ],
};
const within = (inches: Expr): Expr => ({
  cmp: "<=",
  a: { query: { kind: "distance", from: "self", to: "it" } },
  b: inches,
});

export const conquest: GameSystem = {
  id: "conquest-hand",
  name: "Conquest (by hand)",
  version: "0.1.0",
  units: "inch",
  defaultTable: { width: 72, depth: 48 },
  settings: { los: "true", modelsBlock: true, visionArc: 90 },
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "March", of: "model", type: "distance", aliases: ["March"] },
    { id: "V", name: "Volley", of: "model", type: "number", aliases: ["Volley"] },
    { id: "C", name: "Clash", of: "model", type: "number", aliases: ["Clash"] },
    { id: "A", name: "Attacks", of: "model", type: "number", aliases: ["Attacks"] },
    { id: "W", name: "Wounds", of: "model", type: "number", aliases: ["Wounds"] },
    { id: "R", name: "Resolve", of: "model", type: "number", aliases: ["Resolve"] },
    { id: "D", name: "Defense", of: "model", type: "number", aliases: ["Defense", "Defence"] },
    { id: "E", name: "Evasion", of: "model", type: "number", aliases: ["Evasion"], default: 0 },
    { id: "Barrage", name: "Barrage", of: "model", type: "number", default: 0 },
    { id: "Range", name: "Range", short: "Rng", of: "model", type: "distance", default: 0 },
    { id: "Cleave", name: "Cleave", of: "model", type: "number", default: 0 },
    { id: "Support", name: "Support", of: "model", type: "number", default: 0 },
    { id: "Impact", name: "Impact", of: "model", type: "number", default: 0 },
    // Set by Armour Piercing (X) and Brutal Impact (X): Defence X lower against volleys, Impact attacks.
    { id: "ArmourPiercing", name: "Armour Piercing", short: "AP", of: "model", type: "number", default: 0 },
    { id: "BrutalImpact", name: "Brutal Impact", of: "model", type: "number", default: 0 },
    // Set by the Hardened(X) special rule: Cleave against it is X less.
    { id: "Hardened", name: "Hardened", of: "model", type: "number", default: 0 },
    // Set by the Shield special rule: +1 Defense against attacks from the front.
    { id: "Shield", name: "Shield", of: "model", type: "number", default: 0 },
    { id: "Type", name: "Type", of: "model", type: "text" },
    { id: "Class", name: "Class", of: "model", type: "text" },
    // A stand's Size, from its type (stands.ts:`standOf`).
    { id: "Size", name: "Size", of: "model", type: "number" },
  ],
  weaponKinds: [],
  unitShape: { kind: "ranked", minFiles: 1, manoeuvres: ["wheel", "reform", "turn", "march"] },
  arcs,
  statuses: [
    { id: "activated", name: "Activated", on: "unit" },
    { id: "inspired", name: "Inspired", on: "unit" },
    { id: "broken", name: "Broken", on: "unit" },
    // Set on a regiment that came in from reserve this round (reinforce.ts).
    { id: "reinforced", name: "Arrived this round", on: "unit" },
  ],
  resets: [
    { at: "round", flags: ["activated", "inspired", "charged", "marched", "aimed", "reinforced", "used.*"] },
  ],
  resources: [{ id: "VP", name: "Victory points", on: "player", initial: 0 }],
  terrain: [
    { id: "open", name: "Open ground" },
    { id: "obscuring", name: "Obscuring", blocksSight: true },
    {
      id: "impassable",
      name: "Impassable",
      blocksMovement: true,
      blocksSight: true,
      movement: [{ keywords: ["Fly"], blocks: false }],
    },
    { id: "forest", name: "Forest", cover: true, blocksSight: true },
    { id: "hill", name: "Hill" },
    { id: "garrison", name: "Garrison", cover: true, blocksSight: true },
    { id: "defensible", name: "Defensible obstacle", cover: true },
  ],
  rules: specialRules,
  procedures: [volley, clash, impact, hits],
  coreEffects: effects,
  actions: [
    {
      // Draw the regiment's command card: it takes two actions. The command
      // stack sets the order (command.ts); with no stack, any regiment may go.
      id: "activate",
      name: "Activate",
      by: "unit",
      side: "active",
      hint: "Draw its command card: two actions",
      activates: 2,
      if: {
        all: [
          { not: { hasStatus: "self", status: "activated" } },
          { not: { hasFlag: "self", flag: "reserves" } },
          { call: "nextCard", args: [ref("self.id")] },
        ],
      },
    },
    {
      id: "march",
      name: "March",
      verb: "marches",
      by: "unit",
      hint: "Up to March forwards; may be taken twice",
      notWhen: [notEngaged],
      move: { kind: "march", distance: ref("self.M") },
      // For the march checks (march.ts): half rate sideways or back, not ending near an enemy.
      sets: ["marched"],
    },
    {
      id: "charge",
      name: "Charge",
      verb: "charges",
      by: "unit",
      hint: "D6 + March at an enemy in the front arc and in sight; Inspired if it lands. Short: activation over",
      // Not in the round a regiment arrives from reserve.
      if: notBroken,
      notWhen: [
        notEngaged,
        { if: { hasFlag: "self", flag: "reinforced" }, why: "Arrived this round: can't charge" },
        {
          if: { not: { call: "chargeable", args: [ref("self.id")] } },
          why: "No enemy in the front arc and in sight",
        },
      ],
      // Only enemies in the front arc that it can see (charge.ts); the outcome hook there reacts to the roll and move.
      target: { filter: { call: "chargeable", args: [ref("self.id"), ref("it.id")] } },
      limit: { count: 1, per: "round" },
      sets: ["charged"],
      // Inspired as it charges (for charges moved by hand); a short charge loses it again (charge.ts).
      do: [{ do: "applyStatus", target: "self", status: "inspired" }],
    },
    {
      id: "impact",
      name: "Impact",
      verb: "makes Impact attacks",
      by: "unit",
      hint: "Impact attacks after the charge lands; part of the charge",
      free: true,
      notWhen: [
        { if: { cmp: "<=", a: ref("self.Impact"), b: 0 }, why: "No Impact attacks" },
        { if: { not: { hasFlag: "self", flag: "charged" } }, why: "Only straight after a charge" },
      ],
      target: { filter: within(1) },
      limit: { count: 1, per: "round" },
      procedure: "impact",
    },
    {
      id: "volley",
      name: "Volley",
      verb: "volleys",
      by: "unit",
      notWhen: [marchFirst, notEngaged],
      hint: "Barrage shots from the front rank",
      if: { cmp: ">", a: ref("self.Barrage"), b: 0 },
      target: { filter: { all: [volleySight, within(ref("self.Range"))] } },
      limit: { count: 1, per: "round" },
      procedure: "volley",
    },
    {
      id: "clash",
      name: "Clash",
      verb: "clashes",
      by: "unit",
      notWhen: [marchFirst],
      hint: "Fight an enemy in contact",
      target: { filter: within(1) },
      limit: { count: 1, per: "round" },
      procedure: "clash",
    },
    {
      id: "takeAim",
      name: "Take Aim",
      verb: "takes aim",
      by: "unit",
      notWhen: [marchFirst, notEngaged],
      hint: "This round's volley re-rolls misses",
      if: { cmp: ">", a: ref("self.Barrage"), b: 0 },
      limit: { count: 1, per: "round" },
      sets: ["aimed"],
    },
    {
      id: "inspire",
      name: "Inspire",
      verb: "is inspired",
      by: "unit",
      notWhen: [marchFirst, mustBeEngaged],
      hint: "+1 Clash this round",
      if: notBroken,
      limit: { count: 1, per: "round" },
      do: [{ do: "applyStatus", target: "self", status: "inspired" }],
    },
    {
      id: "rally",
      name: "Rally",
      verb: "rallies",
      by: "unit",
      notWhen: [marchFirst, notEngaged],
      hint: "No longer Broken",
      if: { hasStatus: "self", status: "broken" },
      limit: { count: 1, per: "round" },
      do: [{ do: "removeStatus", target: "self", status: "broken" }],
    },
    {
      id: "reform",
      name: "Reform",
      verb: "reforms",
      by: "unit",
      notWhen: [marchFirst, notEngaged],
      hint: "Rearrange the stands, then turn",
      limit: { count: 1, per: "round" },
      move: { kind: "reform", distance: ref("self.M") },
    },
    {
      // Fluid Formation: one more Reform, as the activation's first or last action.
      id: "fluidReform",
      name: "Fluid Formation",
      verb: "reforms (Fluid Formation)",
      by: "unit",
      free: true,
      hint: "An extra Reform, first or last",
      if: { hasRule: "self", rule: "fluidFormation" },
      notWhen: [
        marchFirst,
        notEngaged,
        { if: { call: "midActivation", args: [ref("self.id")] }, why: "Only first or last" },
      ],
      limit: { count: 1, per: "round" },
      move: { kind: "reform", distance: ref("self.M") },
    },
    {
      // Vanguard: arrived this round and marched, with no enemy within 8": one more March, free.
      id: "vanguardMarch",
      name: "Vanguard",
      verb: "marches again (Vanguard)",
      by: "unit",
      free: true,
      hint: "A free March after arriving",
      if: {
        all: [
          { hasRule: "self", rule: "vanguard" },
          { hasFlag: "self", flag: "reinforced" },
          { hasFlag: "self", flag: "marched" },
        ],
      },
      notWhen: [
        notEngaged,
        { if: { call: "enemyWithin", args: [ref("self.id"), 8] }, why: 'An enemy within 8"' },
      ],
      limit: { count: 1, per: "round" },
      move: { kind: "march", distance: ref("self.M") },
      sets: ["marched"],
    },
    {
      // Engaged: played by hand, the button marks the action taken.
      id: "combatRally",
      name: "Combat Rally",
      verb: "makes a Combat Rally",
      by: "unit",
      notWhen: [marchFirst, mustBeEngaged],
      hint: "Rally while engaged: resolve it by hand",
      limit: { count: 1, per: "round" },
    },
    {
      // Engaged: a Resolve test, then the stands are rearranged by hand.
      id: "combatReform",
      name: "Combat Reform",
      verb: "makes a Combat Reform",
      by: "unit",
      notWhen: [marchFirst, mustBeEngaged],
      hint: "Reform while engaged: a Resolve test first, by hand",
      limit: { count: 1, per: "round" },
    },
    {
      id: "withdraw",
      name: "Withdraw",
      verb: "withdraws",
      by: "unit",
      notWhen: [marchFirst, mustBeEngaged],
      hint: "Leave a fight (Light and Medium)",
      if: { not: { is: "self.Class", value: "Heavy" } },
      limit: { count: 1, per: "round" },
      move: { kind: "withdraw", distance: ref("self.M") },
    },
  ],
  turn: {
    // 10 rounds: two secondary sources agree ("almost always 10"); the rulebook itself isn't in research.
    rounds: 10,
    // Supremacy: rolled once the command stacks are set, -1 to the side with fewer cards (a card
    // a regiment on the table), and the lower roll picks the First Player (research/conquest-rules.md).
    initiative: "rollOffEachRound",
    rollOffName: "Supremacy",
    rollOff: { after: "command", fewerUnits: 1, chooses: "lower" },
    round: [
      // Each player orders their command stack (command.ts).
      { kind: "phase", id: "command", name: "Command" },
      {
        kind: "alternate",
        id: "actions",
        pool: { kind: "units" },
        actionsPerActivation: 2,
        activation: [
          {
            kind: "phase",
            id: "action",
            name: "Action",
            actions: [
              "activate",
              "march",
              "charge",
              "impact",
              "volley",
              "clash",
              "takeAim",
              "inspire",
              "rally",
              "reform",
              "combatRally",
              "combatReform",
              "withdraw",
              "fluidReform",
              "vanguardMarch",
            ],
          },
        ],
      },
      { kind: "phase", id: "victory", name: "Victory" },
    ],
  },
  constants: {
    /** Stands to count a rank (advisory regiment checks). */
    rankWidth: 2,
    maxRankBonus: 0,
  },
};
