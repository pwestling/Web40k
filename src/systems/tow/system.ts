import type { GameSystem } from "../../core/content";

/**
 * Rank-and-flank IGOUGO play in the style of Warhammer: The Old World, set up
 * to be played by hand: regiments are blocks with front, flank and rear arcs,
 * the engine measures moves, wheels and arcs, and players roll the dice and
 * apply the results. No rules text, profiles or points: players bring those.
 *
 * Checked against the community rules index (tow.whfb.app): the 72" x 48"
 * table, the phase order, the 90 degree vision arc and the terrain types.
 * The manoeuvre costs and march distance below are from general knowledge of
 * the game and unverified; they only drive advisory warnings.
 */
export const oldWorld: GameSystem = {
  id: "tow-hand",
  name: "Rank and flank (The Old World, by hand)",
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
    { id: "range", name: "Range", of: "weapon", type: "distance", aliases: ["Range"] },
  ],
  weaponKinds: ["missile", "combat"],
  unitShape: { kind: "ranked", minFiles: 1, manoeuvres: ["wheel", "reform", "turn", "march"] },
  arcs: [
    { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
    { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
    { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
    { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
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
  procedures: [],
  actions: [],
  turn: {
    rounds: 6,
    initiative: "rollOff",
    round: [
      {
        kind: "playerTurns",
        segments: [
          { kind: "phase", id: "strategy", name: "Strategy" },
          { kind: "phase", id: "movement", name: "Movement" },
          { kind: "phase", id: "shooting", name: "Shooting" },
          { kind: "phase", id: "combat", name: "Combat" },
        ],
      },
    ],
  },
  constants: {
    /** Models a rank needs to count towards the rank bonus (close order). */
    rankWidth: 5,
    /** Most the rank bonus can be. */
    maxRankBonus: 3,
    /** A march is double Movement... */
    marchMultiple: 2,
    /** ...and isn't allowed this close to an enemy without a Leadership test. */
    marchBlock: 8,
    /** Share of Movement a 90 or 180 degree turn costs (unverified). */
    turnCost: 0.25,
    /** Share of Movement a reform costs (unverified). */
    reformCost: 0.5,
    /** Minimum frontage for a close-order rank to count. */
    minFiles: 1,
  },
};
