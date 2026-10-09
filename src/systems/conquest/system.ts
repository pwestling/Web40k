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
 * invented. Special rules: Cleave, Support, Barrage, Impact, Flurry,
 * Shield, Hardened, Terrifying, Deadly Blades and Relentless Blows play
 * themselves; Unstoppable and Oblivious are reminders. Supremacy is a
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
function attack(id: string, name: string, pool: Expr, hitOn: string, cleave: Expr): Procedure {
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
          { do: "script", procedure: "aftermath", args: { unit: ref("target"), before: count("target") } },
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

/**
 * After a charge that made contact: Impact(X) attacks from each front-rank
 * stand, rolled like a clash (unverified: hits on Clash).
 */
const impact = attack(
  "impact",
  "Impact",
  { op: "*", args: [ref("attacker.Impact"), frontStands("attacker")] },
  "attacker.C",
  ref("attacker.Cleave"),
);

/** Barrage shots from each front-rank stand with a clear shot (command.ts), one more each within half range. */
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
  0,
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
  ref("attacker.Cleave"),
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
    if: { hasFlag: "attacker", flag: "aimed" },
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
const reminder = (id: string, name: string, match: string): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["unit"],
  effects: [{ when: { event: "action.declared" }, do: [{ do: "manual", reminder: id }] }],
});

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
        if: owns("attacker"),
        do: [{ do: "modifyTarget", by: { op: "-", args: [0, ref("param.x")] } }],
      },
      {
        when: beforeStep("resolve_flanked"),
        if: owns("attacker"),
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
    effects: [{ when: onDie("defense", 6), if: owns("attacker"), do: [{ do: "addSuccesses", count: 1 }] }],
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
  // Played by hand for now: listed as reminders when they come up.
  reminder("unstoppable", "Unstoppable", "^unstoppable\\b"),
  reminder("oblivious", "Oblivious", "^oblivious\\b"),
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
    // Set by the Hardened(X) special rule: Cleave against it is X less.
    { id: "Hardened", name: "Hardened", of: "model", type: "number", default: 0 },
    // Set by the Shield special rule: +1 Defense against attacks from the front.
    { id: "Shield", name: "Shield", of: "model", type: "number", default: 0 },
    { id: "Type", name: "Type", of: "model", type: "text" },
    { id: "Class", name: "Class", of: "model", type: "text" },
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
    { id: "impassable", name: "Impassable", blocksMovement: true, blocksSight: true },
    { id: "forest", name: "Forest", cover: true, blocksSight: true },
    { id: "hill", name: "Hill" },
    { id: "garrison", name: "Garrison", cover: true, blocksSight: true },
    { id: "defensible", name: "Defensible obstacle", cover: true },
  ],
  rules: specialRules,
  procedures: [volley, clash, impact],
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
      target: {
        filter: {
          all: [{ query: { kind: "visible", from: "self", to: "it" } }, within(ref("self.Range"))],
        },
      },
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
