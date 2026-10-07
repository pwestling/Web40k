import type { ArcDef, Effect, Expr, GameSystem, Procedure } from "../../core/content";

/**
 * Conquest: The Last Argument of Kings, played with the engine's help:
 * regiments of stands with front, flank and rear arcs; a command stack each
 * round (the module's `stack` state, see command.ts); alternating
 * activations of two actions; and roll-under Volley and Clash attacks with
 * Defense and Resolve, run as procedures.
 *
 * Written from the paraphrased core rules notes in research/conquest-rules.md
 * (2.0, 2026). No rules text, profiles or points: the sample armies are
 * invented. Not covered yet: reinforcements (every regiment starts on the
 * table), characters and special rules
 * beyond Cleave, Support and Barrage.
 */

const ref = (r: string): Expr => ({ ref: r });
const count = (unit: string): Expr => ({ count: `${unit}.models` });

/** Stands outside the front rank. */
const rearStands = (unit: string): Expr => ({
  op: "max",
  args: [0, { op: "-", args: [count(unit), ref(`${unit}.files`)] }],
});
const frontStands = (unit: string): Expr => ({ op: "min", args: [count(unit), ref(`${unit}.files`)] });

/** Resolve rises with the regiment's size: +1 for 4-6 stands, +2 for 7-9, +3 for 10 or more. */
const resolveTarget: Expr = {
  op: "+",
  args: [
    ref("target.R"),
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
          args: [0, { op: "-", args: [ref("target.D"), cleave] }, ref("target.E")],
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
      { kind: "allocate", id: "casualties", chooser: "defender", formation: "rearRankFirst" },
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

/** Barrage shots from each front-rank stand. */
const volley = attack(
  "volley",
  "Volley",
  { op: "*", args: [ref("attacker.Barrage"), frontStands("attacker")] },
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

const effects: Effect[] = [
  {
    // Inspired: +1 Clash.
    id: "Inspired",
    when: beforeHit("clash"),
    if: { hasStatus: "attacker", status: "inspired" },
    do: [{ do: "modifyTarget", by: 1 }],
  },
  {
    // Take Aim: the volley re-rolls its misses.
    id: "Aimed shot",
    when: beforeHit("volley"),
    if: { hasFlag: "attacker", flag: "aimed" },
    do: [{ do: "reroll", which: "failed" }],
  },
];

const arcs: ArcDef[] = [
  { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
  { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
  { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
  { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
];

const notBroken: Expr = { not: { hasStatus: "self", status: "broken" } };
/** A regiment that arrived from reserve this round marches first (reinforce.ts). */
const marchedIn: Expr = {
  any: [{ not: { hasFlag: "self", flag: "reinforced" } }, { hasFlag: "self", flag: "actionsTaken" }],
};
const and = (...e: (Expr | undefined)[]): Expr => {
  const all = e.filter((x): x is Expr => x !== undefined);
  return all.length === 1 ? all[0]! : { all };
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
  ],
  resets: [{ at: "round", flags: ["activated", "inspired", "charged", "aimed", "reinforced", "used.*"] }],
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
  rules: [],
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
      move: { kind: "march", distance: ref("self.M") },
    },
    {
      id: "charge",
      name: "Charge",
      verb: "charges",
      by: "unit",
      hint: "D6 + March at an enemy in the front arc; a charge that lands is Inspired",
      // Not in the round a regiment arrives from reserve.
      if: and(notBroken, { not: { hasFlag: "self", flag: "reinforced" } }),
      limit: { count: 1, per: "round" },
      sets: ["charged"],
      // A charge that falls short loses it: clear Inspired on the card.
      do: [{ do: "applyStatus", target: "self", status: "inspired" }],
    },
    {
      id: "impact",
      name: "Impact",
      verb: "makes Impact attacks",
      by: "unit",
      hint: "Impact attacks after the charge lands; part of the charge",
      free: true,
      if: {
        all: [
          { hasFlag: "self", flag: "charged" },
          { cmp: ">", a: ref("self.Impact"), b: 0 },
        ],
      },
      target: { filter: within(1) },
      limit: { count: 1, per: "round" },
      procedure: "impact",
    },
    {
      id: "volley",
      name: "Volley",
      verb: "volleys",
      by: "unit",
      hint: "Barrage shots from the front rank",
      if: and({ cmp: ">", a: ref("self.Barrage"), b: 0 }, marchedIn),
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
      hint: "Fight an enemy in contact",
      if: marchedIn,
      target: { filter: within(1) },
      limit: { count: 1, per: "round" },
      procedure: "clash",
    },
    {
      id: "takeAim",
      name: "Take Aim",
      verb: "takes aim",
      by: "unit",
      hint: "This round's volley re-rolls misses",
      if: and({ cmp: ">", a: ref("self.Barrage"), b: 0 }, marchedIn),
      limit: { count: 1, per: "round" },
      sets: ["aimed"],
    },
    {
      id: "inspire",
      name: "Inspire",
      verb: "is inspired",
      by: "unit",
      hint: "+1 Clash this round",
      if: and(notBroken, marchedIn),
      limit: { count: 1, per: "round" },
      do: [{ do: "applyStatus", target: "self", status: "inspired" }],
    },
    {
      id: "rally",
      name: "Rally",
      verb: "rallies",
      by: "unit",
      hint: "No longer Broken",
      if: and({ hasStatus: "self", status: "broken" }, marchedIn),
      limit: { count: 1, per: "round" },
      do: [{ do: "removeStatus", target: "self", status: "broken" }],
    },
    {
      id: "reform",
      name: "Reform",
      verb: "reforms",
      by: "unit",
      hint: "Rearrange the stands, then turn",
      if: marchedIn,
      limit: { count: 1, per: "round" },
      move: { kind: "reform", distance: ref("self.M") },
    },
    {
      id: "withdraw",
      name: "Withdraw",
      verb: "withdraws",
      by: "unit",
      hint: "Leave a fight (Light and Medium)",
      if: and({ not: { is: "self.Class", value: "Heavy" } }, marchedIn),
      limit: { count: 1, per: "round" },
      move: { kind: "withdraw", distance: ref("self.M") },
    },
  ],
  turn: {
    // Unverified: the notes give 10 rounds for a standard game.
    rounds: 10,
    initiative: "rollOff",
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
