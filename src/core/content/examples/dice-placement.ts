import type { Expr, GameSystem } from "../schema";

/**
 * Partial example: a dice-placement activation game in the style of Full
 * Spectrum Dominance. Players roll a pool of activation dice each round, then
 * alternate spending them on unit cards; the opponent can react. Mechanics
 * are guessed from the publisher's description and only show the shape fits.
 */

const ref = (r: string): Expr => ({ ref: r });

export const dicePlacementLike: GameSystem = {
  id: "dice-placement-like",
  name: "Free-form, dice-placement activation (FSD style, partial)",
  version: "0.1.0",
  units: "inch",
  dice: [
    { id: "d6", sides: 6 },
    { id: "d8", sides: 8 },
    { id: "d10", sides: 10 },
  ],
  defaultDie: "d6",
  characteristics: [
    { id: "speed", name: "Speed", of: "model", type: "distance" },
    { id: "armour", name: "Armour", of: "model", type: "number" },
    { id: "damageTrack", name: "Damage track", of: "model", type: "number" },
    { id: "range", name: "Range", of: "weapon", type: "distance" },
    { id: "dice", name: "Attack dice", of: "weapon", type: "number" },
    { id: "die", name: "Attack die size", of: "weapon", type: "number" },
  ],
  weaponKinds: ["direct", "indirect"],
  unitShape: { kind: "skirmish" },
  resources: [{ id: "activationDice", name: "Activation dice", on: "player", initial: 0, kind: "dicePool" }],
  rules: [],
  procedures: [
    {
      id: "attack",
      name: "Attack",
      params: ["attacker", "weapon", "target"],
      steps: [
        { kind: "pool", id: "attacks", count: ref("weapon.dice") },
        // Die size comes from the weapon; the engine picks the matching DieDef.
        { kind: "test", id: "hit", compare: "atLeast", target: ref("target.armour"), roller: "attacker" },
        { kind: "damage", id: "damage", amount: 1, spillover: false },
      ],
    },
  ],
  actions: [
    {
      id: "move",
      name: "Move",
      by: "unit",
      cost: [{ resource: "activationDice", amount: 1 }],
      move: { kind: "normal", distance: ref("self.speed") },
    },
    {
      id: "fire",
      name: "Fire",
      by: "unit",
      cost: [{ resource: "activationDice", amount: 1 }],
      procedure: "attack",
    },
    {
      id: "reactiveFire",
      name: "Reactive fire",
      by: "unit",
      side: "inactive",
      reactTo: { event: "move.end", where: { query: { kind: "visible", from: "self", to: "event.unit" } } },
      cost: [{ resource: "activationDice", amount: 1 }],
      procedure: "attack",
    },
  ],
  turn: {
    rounds: 6,
    initiative: "rollOff",
    round: [
      {
        kind: "step",
        id: "rollActivationDice",
        do: [
          { do: "gainResource", resource: "activationDice", amount: 6, player: "owner" },
          { do: "gainResource", resource: "activationDice", amount: 6, player: "opponent" },
        ],
      },
      {
        kind: "alternate",
        id: "activations",
        pool: { kind: "resource", resource: "activationDice" },
        activation: [{ kind: "phase", id: "activation", name: "Activation", actions: ["move", "fire"] }],
      },
    ],
  },
};
