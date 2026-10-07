import type { Expr, GameSystem } from "../schema";

/**
 * Partial example: Full Spectrum Dominance (free rulebook v1.7.1 by
 * Pantalone & Valsecchi). Mechanics only, checked against the core rules
 * chapters. Not complete: behemoths, terrain types and scenarios are left out.
 *
 * What it exercises: a pool of activation dice whose faces matter, card slots
 * that only take certain faces, alternating activations with passing,
 * reactions that interrupt the opponent, a Command value that activates other
 * units for free, mixed die sizes with keep-highest saves opposed to the hit
 * roll, centre-to-centre measuring in a configurable distance unit, and
 * multi-base units that lose a base per unsaved hit.
 */

const ref = (r: string): Expr => ({ ref: r });

const distance: Expr = { query: { kind: "distance", from: "attacker", to: "target", measure: "centre" } };

export const fsd: GameSystem = {
  id: "fsd-1.7",
  name: "Full Spectrum Dominance (partial)",
  version: "0.1.0",
  // A DU is set per game to suit the miniature scale.
  units: { name: "DU", inches: 4 },
  dice: [
    { id: "d6", sides: 6 },
    { id: "d8", sides: 8 },
    { id: "d10", sides: 10 },
    { id: "d12", sides: 12 },
  ],
  defaultDie: "d6",
  dieLadder: ["d6", "d8", "d10", "d12"],
  characteristics: [
    { id: "Cmd", name: "Command", of: "unit", type: "number" },
    { id: "Def", name: "Defense", of: "unit", type: "number" },
    { id: "saveDie", name: "Save die", of: "unit", type: "number" },
    { id: "saveDice", name: "Save dice", of: "unit", type: "number" },
    { id: "Move", name: "Move", of: "unit", type: "distance" },
    { id: "range", name: "Range", of: "weapon", type: "distance" },
    { id: "dice", name: "Attack dice", of: "weapon", type: "number" },
    { id: "die", name: "Attack die", of: "weapon", type: "number" },
    { id: "AP", name: "Armour piercing", of: "weapon", type: "number" },
  ],
  weaponKinds: ["weapon"],
  unitShape: { kind: "skirmish" },
  statuses: [
    { id: "pinned", name: "Pinned", on: "unit" },
    { id: "activated", name: "Activated", on: "unit" },
    { id: "inCover", name: "In cover", on: "unit" },
  ],
  resources: [
    // Rolled up to capacity each round from the spent pile; faces matter.
    { id: "readyDice", name: "Ready activation dice", on: "player", initial: 0, kind: "dicePool" },
  ],
  rules: [],
  procedures: [
    {
      id: "attack",
      name: "Attack",
      params: ["attacker", "weapon", "target"],
      steps: [
        { kind: "pool", id: "attacks", count: ref("weapon.dice") },
        {
          kind: "test",
          id: "hit",
          die: ref("weapon.die"),
          compare: "atLeast",
          target: {
            op: "+",
            args: [
              ref("target.Def"),
              // Cover: +2 for infantry, +1 for vehicles and mechs.
              {
                if: { hasStatus: "target", status: "inCover" },
                then: { if: { hasKeyword: "target", keyword: "INFANTRY" }, then: 2, else: 1 },
                else: 0,
              },
              // Beyond the weapon's range (up to double): +1.
              { if: { cmp: ">", a: distance, b: ref("weapon.range") }, then: 1, else: 0 },
            ],
          },
          impossibleIf: { cmp: ">", a: distance, b: { op: "*", args: [ref("weapon.range"), 2] } },
          roller: "attacker",
        },
        {
          // Roll the target's save dice, keep the highest, and beat the hit roll.
          // Each point of AP removes one save die.
          kind: "test",
          id: "save",
          die: ref("target.saveDie"),
          dicePerInput: {
            op: "max",
            args: [0, { op: "-", args: [ref("target.saveDice"), ref("weapon.AP")] }],
          },
          keep: "highest",
          compare: "atLeast",
          target: ref("input.value"),
          roller: "defender",
          passOn: "failures",
        },
        {
          // Units without a damage chart lose the closest base in line of sight per unsaved hit.
          kind: "allocate",
          id: "bases",
          chooser: "attacker",
          order: { query: { kind: "distance", from: "attacker", to: "model", measure: "centre" } },
        },
        { kind: "damage", id: "damage", amount: 1, spillover: false },
      ],
    },
  ],
  actions: [
    {
      id: "activate",
      name: "Activate",
      by: "unit",
      side: "active",
      if: { not: { hasStatus: "self", status: "activated" } },
      cost: [{ resource: "readyDice", amount: 1 }],
      // Commanded units must be within 2 DU and in line of sight.
      do: [
        {
          do: "activate",
          count: ref("self.Cmd"),
          filter: {
            all: [
              {
                cmp: "<=",
                a: { query: { kind: "distance", from: "self", to: "it", measure: "centre" } },
                b: 2,
              },
              { query: { kind: "visible", from: "self", to: "it" } },
            ],
          },
        },
        { do: "applyStatus", target: "self", status: "activated", duration: "round" },
      ],
    },
    { id: "move", name: "Move", by: "unit", move: { kind: "normal", distance: ref("self.Move") } },
    { id: "fire", name: "Fire", by: "unit", procedure: "attack" },
    {
      // Example special action whose slot takes one die showing 4 to 6.
      id: "heavyWeapon",
      name: "Heavy weapon",
      by: "unit",
      cost: [{ resource: "readyDice", amount: 1, slots: [{ min: 4, max: 6 }] }],
      procedure: "attack",
    },
    {
      id: "unpin",
      name: "Unpin",
      by: "unit",
      do: [{ do: "removeStatus", target: "self", status: "pinned" }],
    },
    {
      // An unactivated unit may react when targeted or when an enemy moves in sight: one action, then it's done.
      id: "react",
      name: "React",
      by: "unit",
      side: "inactive",
      reactTo: {
        event: "action.declared",
        where: {
          any: [
            { is: "event.action", value: "fire" },
            { is: "event.action", value: "move" },
          ],
        },
      },
      if: { not: { hasStatus: "self", status: "activated" } },
      cost: [{ resource: "readyDice", amount: 1 }],
      do: [
        { do: "run", action: "fire", optional: true },
        { do: "applyStatus", target: "self", status: "activated", duration: "round" },
      ],
    },
  ],
  turn: {
    rounds: 6,
    initiative: { expr: { op: "+", args: [{ dice: "D6" }, ref("player.highestCommand")] } },
    round: [
      { kind: "step", id: "reinforcements", do: [{ do: "manual", reminder: "reinforcements" }] },
      {
        kind: "step",
        id: "rollActivationDice",
        do: [
          { do: "gainResource", resource: "readyDice", amount: ref("player.adCapacity"), player: "owner" },
          { do: "gainResource", resource: "readyDice", amount: ref("player.adCapacity"), player: "opponent" },
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
            name: "Activation",
            actions: ["activate", "move", "fire", "heavyWeapon", "unpin"],
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
