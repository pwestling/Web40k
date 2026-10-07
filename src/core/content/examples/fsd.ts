import type { Expr, GameSystem } from "../schema";

/**
 * Full Spectrum Dominance (free rulebook v1.7.1 by Pantalone & Valsecchi),
 * mechanics only, checked against the core rules chapters. No unit cards,
 * stats or rules text: players bring those.
 *
 * What it exercises: a pool of activation dice whose faces matter, AD slots
 * that only take certain faces, alternating activations with passing,
 * reactions that interrupt the opponent, a Command value that activates other
 * units for free, mixed die sizes with keep-highest saves opposed to the hit
 * roll, centre-to-centre measuring in DU, multi-base units that lose a base
 * per unsaved hit, and damage charts.
 *
 * Imported content uses these characteristics, as printed on a unit card:
 *  - model profile: Cmd, Def, Save ("d8(2)"), Move, and optionally Chart, a
 *    damage chart such as "1:red, 2-3:orange:ARM, 4:white:MOV, 5:white:S1, 6:white:PIN";
 *  - weapon profile: Range, Attack ("3d6"), AP, AD (slots such as "4-6" or
 *    "1-2 1-2"), Min (minimum range); keywords IC (ignore cover), Per Base.
 *
 * Simplifications, all advisory: ADs are paid when the action is taken rather
 * than pre-assigned to slots; reactions resolve before the action they
 * answer instead of at the same time; a damaged system (S1-S4) is shown on
 * the unit but its action is not switched off; areas of control, prepared
 * actions, reserves, behemoths and support cards are left to the players.
 */

const ref = (r: string): Expr => ({ ref: r });

const distance: Expr = { query: { kind: "distance", from: "attacker", to: "target", measure: "centre" } };
/** Close combat: within 1 DU. */
const close: Expr = { cmp: "<=", a: distance, b: 1 };
const notPinned: Expr = { not: { hasStatus: "self", status: "pinned" } };

export const fsd: GameSystem = {
  id: "fsd-1.7",
  name: "Full Spectrum Dominance",
  version: "0.2.0",
  // 1 DU is 3" on the standard 2' x 3' table (8 x 12 DU).
  units: { name: "DU", inches: 3 },
  defaultTable: { width: 36, depth: 24 },
  settings: { los: "footprint", modelsBlock: true, visionArc: 0 },
  dice: [
    { id: "d6", sides: 6 },
    { id: "d8", sides: 8 },
    { id: "d10", sides: 10 },
    { id: "d12", sides: 12 },
  ],
  defaultDie: "d6",
  dieLadder: ["d6", "d8", "d10", "d12"],
  characteristics: [
    { id: "Cmd", name: "Command", of: "model", type: "number", aliases: ["Command"], default: 0 },
    { id: "Def", name: "Defense", of: "model", type: "number", aliases: ["Defense", "Defence"] },
    {
      id: "saveDie",
      name: "Save die",
      short: "Sv die",
      of: "model",
      type: "number",
      aliases: ["Save"],
      pattern: "d(\\d+)",
    },
    {
      id: "saveDice",
      name: "Save dice",
      short: "Sv dice",
      of: "model",
      type: "number",
      aliases: ["Save"],
      pattern: "\\((\\d+)\\)",
      default: 1,
    },
    { id: "Move", name: "Move", of: "model", type: "distance", aliases: ["Mov", "Movement"] },
    { id: "Chart", name: "Damage chart", of: "model", type: "text", aliases: ["Damage", "Damage chart"] },
    { id: "range", name: "Range", short: "Rng", of: "weapon", type: "distance", aliases: ["Range", "Rng"] },
    {
      id: "minRange",
      name: "Minimum range",
      short: "Min",
      of: "weapon",
      type: "distance",
      aliases: ["Min"],
      default: 0,
    },
    {
      id: "dice",
      name: "Attack dice",
      short: "Dice",
      of: "weapon",
      type: "number",
      aliases: ["Attack"],
      pattern: "^(\\d+)d",
      default: 1,
    },
    {
      id: "die",
      name: "Attack die",
      short: "Die",
      of: "weapon",
      type: "number",
      aliases: ["Attack"],
      pattern: "d(\\d+)",
      default: 6,
    },
    { id: "AP", name: "Armour piercing", of: "weapon", type: "number", default: 0 },
    { id: "slots", name: "AD slots", short: "AD", of: "weapon", type: "text", aliases: ["AD", "Slots"] },
  ],
  weaponKinds: ["ranged", "melee"],
  unitShape: { kind: "skirmish" },
  // A vehicle's front is the 180° ahead of it; everything else is rear.
  arcs: [
    { id: "front", name: "Front", from: -90, to: 90, origin: "centre" },
    { id: "rear", name: "Rear", from: 90, to: 270, origin: "centre" },
  ],
  terrain: [
    { id: "open", name: "Open", visibility: "open" },
    { id: "broken", name: "Broken ground", visibility: "open", cover: true, coverFor: ["INFANTRY"] },
    {
      id: "traversable",
      name: "Traversable (walls, fences)",
      visibility: "obscuring",
      cover: true,
      coverFor: ["INFANTRY"],
    },
    { id: "obscuring", name: "Obscuring (woods, scrub)", visibility: "obscuring", cover: true },
    {
      id: "blocking",
      name: "Blocking (buildings, rocks)",
      visibility: "blocking",
      blocksMovement: true,
      cover: true,
    },
  ],
  statuses: [
    { id: "pinned", name: "Pinned", on: "unit" },
    { id: "activated", name: "Activated", on: "unit" },
    {
      id: "damageMOV",
      name: "Movement damaged",
      on: "unit",
      effects: [
        { when: { event: "always" }, do: [{ do: "setCharacteristic", characteristic: "Move", to: 1 }] },
      ],
    },
    {
      id: "damageARM",
      name: "Armour damaged",
      on: "unit",
      // Save dice one category lower, to d6 at worst.
      effects: [
        {
          when: { event: "always" },
          do: [
            {
              do: "setCharacteristic",
              characteristic: "saveDie",
              to: { op: "max", args: [6, { op: "-", args: [ref("self.saveDie"), 2] }] },
            },
          ],
        },
      ],
    },
    { id: "damageS1", name: "System 1 damaged", on: "unit" },
    { id: "damageS2", name: "System 2 damaged", on: "unit" },
    { id: "damageS3", name: "System 3 damaged", on: "unit" },
    { id: "damageS4", name: "System 4 damaged", on: "unit" },
  ],
  resources: [
    // Rolled each round; the faces matter for AD slots.
    {
      id: "readyDice",
      name: "Activation dice",
      on: "player",
      initial: 0,
      kind: "dicePool",
      sides: 6,
      reset: "round",
      rerollOnce: true,
    },
    { id: "VP", name: "VP", on: "player", initial: 0 },
  ],
  constants: { adCapacity: 8, closeCombat: 1, commandRange: 2 },
  resets: [{ at: "round", flags: ["activated", "moved", "interacting", "commanded", "used.*"] }],
  rules: [],
  procedures: [
    {
      id: "attack",
      name: "Attack",
      params: ["attacker", "weapon", "target"],
      steps: [
        {
          // Per Base weapons attack once from each base.
          kind: "pool",
          id: "attacks",
          count: {
            if: { hasKeyword: "weapon", keyword: "PER BASE" },
            then: { op: "*", args: [ref("weapon.dice"), { count: "attacker.models" }] },
            else: ref("weapon.dice"),
          },
        },
        {
          kind: "test",
          id: "hit",
          die: ref("weapon.die"),
          compare: "atLeast",
          target: {
            op: "+",
            args: [
              ref("target.Def"),
              // Cover: +2 for infantry, +1 for vehicles and mechs; not in close combat or with IC.
              {
                if: {
                  all: [
                    { not: close },
                    { not: { hasKeyword: "weapon", keyword: "IC" } },
                    { query: { kind: "cover", from: "attacker", to: "target" } },
                  ],
                },
                then: { if: { hasKeyword: "target", keyword: "INFANTRY" }, then: 2, else: 1 },
                else: 0,
              },
              // Beyond the weapon's range (up to double): +1.
              { if: { cmp: ">", a: distance, b: ref("weapon.range") }, then: 1, else: 0 },
            ],
          },
          impossibleIf: {
            any: [
              { cmp: ">", a: distance, b: { op: "*", args: [ref("weapon.range"), 2] } },
              { cmp: "<", a: distance, b: ref("weapon.minRange") },
            ],
          },
          roller: "attacker",
        },
        {
          // Infantry is pinned by any hit, saved or not.
          kind: "do",
          id: "pinInfantry",
          if: { hasKeyword: "target", keyword: "INFANTRY" },
          do: [{ do: "applyStatus", target: "target", status: "pinned" }],
        },
        {
          // Roll the save dice, keep the highest, and match the hit roll. AP
          // removes dice (close combat gives AP1), leaving at least one; the
          // rear of a vehicle saves with a die one size smaller.
          kind: "test",
          id: "save",
          die: {
            if: {
              all: [
                { hasKeyword: "target", keyword: "VEHICLE" },
                { query: { kind: "inArc", from: "target", to: "attacker", arc: "rear" } },
              ],
            },
            then: { op: "max", args: [6, { op: "-", args: [ref("target.saveDie"), 2] }] },
            else: ref("target.saveDie"),
          },
          dicePerInput: {
            op: "max",
            args: [
              1,
              {
                op: "-",
                args: [
                  ref("target.saveDice"),
                  { if: close, then: { op: "max", args: [1, ref("weapon.AP")] }, else: ref("weapon.AP") },
                ],
              },
            ],
          },
          keep: "highest",
          compare: "atLeast",
          target: ref("input.value"),
          impossibleIf: { not: { has: "target.saveDie" } },
          roller: "defender",
          passOn: "failures",
        },
        {
          // Units with a damage chart roll on it for each damage, and are pinned.
          kind: "do",
          id: "chart",
          if: { has: "target.Chart" },
          do: [{ do: "damageTrack", target: "target", chart: "target.Chart", status: "pinned" }],
        },
        {
          // Units without one lose the closest base per unsaved hit, and are pinned.
          kind: "do",
          id: "pinDamaged",
          if: { not: { has: "target.Chart" } },
          do: [{ do: "applyStatus", target: "target", status: "pinned" }],
        },
        {
          kind: "allocate",
          id: "bases",
          chooser: "attacker",
          order: { query: { kind: "distance", from: "attacker", to: "model", measure: "centre" } },
        },
        { kind: "damage", id: "damage", if: { not: { has: "target.Chart" } }, amount: 1, spillover: false },
      ],
    },
  ],
  actions: [
    {
      // Spend a die: the unit (and any it commands) may take two actions.
      id: "activate",
      name: "Activate",
      by: "unit",
      side: "active",
      activates: 2,
      if: { not: { hasStatus: "self", status: "activated" } },
      cost: [{ resource: "readyDice", amount: 1 }],
      // Commanded units: within 2 DU and in line of sight. Pinned units can't command.
      do: [
        {
          do: "activate",
          count: { if: { hasStatus: "self", status: "pinned" }, then: 0, else: ref("self.Cmd") },
          filter: {
            all: [
              { not: { hasStatus: "it", status: "activated" } },
              {
                cmp: "<=",
                a: { query: { kind: "distance", from: "self", to: "it", measure: "centre" } },
                b: ref("const.commandRange"),
              },
              { query: { kind: "visible", from: "self", to: "it" } },
            ],
          },
        },
      ],
    },
    {
      // An unactivated unit may spend a die to react when it is shot at, or
      // when an enemy moves in its sight: one action, then it is done.
      id: "react",
      name: "React",
      by: "unit",
      side: "inactive",
      activates: 1,
      reactTo: {
        event: "action.declared",
        where: {
          any: [
            { is: "event.action", value: "fire" },
            { is: "event.action", value: "move" },
          ],
        },
      },
      if: {
        all: [
          { not: { hasStatus: "self", status: "activated" } },
          notPinned,
          {
            any: [
              { all: [{ is: "event.action", value: "fire" }, { same: ["event.target", "self"] }] },
              {
                all: [
                  { is: "event.action", value: "move" },
                  { query: { kind: "visible", from: "self", to: "event.unit" } },
                ],
              },
            ],
          },
        ],
      },
      cost: [{ resource: "readyDice", amount: 1 }],
    },
    {
      id: "unpin",
      name: "Unpin",
      by: "unit",
      if: { hasStatus: "self", status: "pinned" },
      do: [{ do: "removeStatus", target: "self", status: "pinned" }],
    },
    {
      // Moves after the first are 1 DU shorter, but at least 1 DU.
      id: "move",
      name: "Move",
      by: "unit",
      if: notPinned,
      move: {
        kind: "normal",
        distance: {
          op: "max",
          args: [
            1,
            {
              op: "-",
              args: [ref("self.Move"), { if: { hasFlag: "self", flag: "moved" }, then: 1, else: 0 }],
            },
          ],
        },
      },
      sets: ["moved"],
    },
    {
      // Each weapon is a special action: once per round, paying its AD slots.
      id: "fire",
      name: "Fire",
      by: "unit",
      if: notPinned,
      target: { filter: { query: { kind: "visible", from: "self", to: "it" } } },
      limit: { count: 1, per: "round", perUnit: true },
      cost: [{ resource: "readyDice", amount: 0, slotsFrom: "weapon.slots" }],
      procedure: "attack",
    },
    { id: "interact", name: "Interact", by: "unit", if: notPinned, sets: ["interacting"] },
  ],
  turn: {
    rounds: 6,
    round: [
      {
        kind: "step",
        id: "rollActivationDice",
        do: [
          { do: "gainResource", resource: "readyDice", amount: ref("const.adCapacity"), player: "owner" },
          { do: "gainResource", resource: "readyDice", amount: ref("const.adCapacity"), player: "opponent" },
        ],
      },
      {
        kind: "alternate",
        id: "activations",
        pool: { kind: "resource", resource: "readyDice" },
        actionsPerActivation: 2,
        activation: [
          {
            kind: "phase",
            id: "activation",
            name: "Activations",
            actions: ["activate", "react", "unpin", "move", "fire", "interact"],
          },
        ],
      },
      { kind: "phase", id: "scoring", name: "Scoring" },
    ],
  },
  checks: [
    {
      id: "baseCoherency",
      name: "Bases within 1 DU",
      when: { event: "move.end" },
      require: {
        every: "self.models",
        as: "m",
        test: {
          cmp: ">=",
          a: {
            count: "self.models",
            as: "o",
            where: {
              cmp: "<=",
              a: { query: { kind: "distance", from: "m", to: "o", measure: "centre" } },
              b: 1,
            },
          },
          b: { op: "min", args: [2, { count: "self.models" }] },
        },
      },
      message: "A base is more than 1 DU from the rest of its unit",
    },
  ],
};
