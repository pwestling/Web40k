import type { AbilityTiming, Effect, Expr, GameSystem, RuleDef } from "../schema";

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
 * Also covered: ADs placed on cards' slots ahead of time (in pre-assigning,
 * at the start of a player's alternating turn, and at cleanup) and kept over
 * the round, the AD Pool (12 at 60 points, following the game size) counting
 * dice still on cards; reactions that
 * resolve at the same time as the action they answer; damaged systems S1-S4
 * switching off the action on that card line (a weapon's Line, or its place
 * on the card) and dropping the dice on it; prepared actions (weapons with
 * the Prepared keyword) and Interact; reserves deployed as an activation;
 * support cards (named by the player, paid in ADs); and areas of control as
 * table warnings (src/systems/fsd/checks.ts).
 *
 * Behemoths: Systems that shield the Core from a side (their own Defense,
 * Save and damage chart, only a destroying result going through to the
 * Core), Attachments lost to a WPN box, Parts activating with the Core, no
 * rear penalty, and pinned only by Core damage.
 *
 * A behemoth may react (one of its Systems) before or after its Core
 * activates; the player picks a System that hasn't acted.
 *
 * Weapon keywords automated: AP, IC, Per Base (bases in range and sight),
 * Min, Short Range, Contact, Indirect Fire (+1 out of sight), Heavy (not
 * after moving); multiple attacks (x2, x3) and arcs of fire. Terrain slows or
 * blocks moves by unit type (a table warning along each base's path). Other weapon and unit special rules are reminders, by name
 * (weaponRules, abilityTimings). Coverage: docs/rules-coverage/fsd.md.
 *
 * Left to the players: what a prepared action or support card does while it
 * applies, triggered abilities, which behemoth System reacts, and a
 * behemoth's 45° turning limit.
 */

const ref = (r: string): Expr => ({ ref: r });

const distance: Expr = { query: { kind: "distance", from: "attacker", to: "target", measure: "centre" } };
const weaponHas = (keyword: string): Expr => ({ hasKeyword: "weapon", keyword });
/** Bases touching: edge to edge within a hair (positions are placed by hand). */
const baseContact: Expr = {
  cmp: "<=",
  a: { query: { kind: "distance", from: "attacker", to: "target" } },
  b: 0.05,
};
/** Close combat: within 1 DU, or a Contact weapon (attacking in contact is close combat). */
const close: Expr = { any: [{ cmp: "<=", a: distance, b: 1 }, weaponHas("CONTACT")] };
/** Where one base of the attacker can shoot from: in reach of the weapon and seeing the target. */
const baseCanShoot: Expr = {
  all: [
    {
      cmp: "<=",
      a: { query: { kind: "distance", from: "base", to: "target", measure: "centre" } },
      b: { op: "*", args: [ref("weapon.range"), 2] },
    },
    {
      cmp: ">=",
      a: { query: { kind: "distance", from: "base", to: "target", measure: "centre" } },
      b: ref("weapon.minRange"),
    },
    { query: { kind: "visible", from: "base", to: "target" } },
  ],
};
/** The weapon sits on system line n and that system is damaged. */
const systemDamaged = (n: number): Expr => ({
  all: [
    { hasStatus: "self", status: `damageS${n}` },
    {
      cmp: "==",
      a: {
        if: { cmp: ">", a: ref("weapon.line"), b: 0 },
        then: ref("weapon.line"),
        else: ref("weapon.order"),
      },
      b: n,
    },
  ],
});
const damagedSystems = [1, 2, 3, 4].map((n) => ({ if: systemDamaged(n), why: `System ${n} is damaged` }));
/** A behemoth Attachment's weapon (WPN) once a WPN box is hit. */
const attachmentLost = {
  if: {
    all: [
      { hasStatus: "self", status: "damageWPN" },
      { hasKeyword: "weapon", keyword: "WPN" },
    ],
  },
  why: "The attachment is destroyed",
};
/** Heavy weapons can't be used in a round the unit moved. */
const heavyAfterMoving = {
  if: {
    all: [
      { hasKeyword: "weapon", keyword: "HEAVY" },
      { hasFlag: "self", flag: "moved" },
    ],
  },
  why: "Heavy: not in a round the unit moved",
};
/** A special action marked prepared on the card (a square slot on its right). */
const prepared: Expr = { hasKeyword: "weapon", keyword: "Prepared" };
/** Taking another action ends interacting with an objective. */
const dropInteract = { do: "setFlag", target: "self", flag: "interacting", value: false } as const;
/** Getting pinned ends interacting too (in an attack's outcomes). */
const dropInteractTarget = { do: "removeStatus", target: "target", status: "interacting" } as const;
const notPinned: Expr = { not: { hasStatus: "self", status: "pinned" } };

/**
 * Behemoths (multi-card units): the Core is the unit's one base, and up to
 * four System cards are characteristics on it: Sys1Name, Sys1Arc (the side
 * it shields: front, left, right or rear), Sys1Def, Sys1Save ("d10(2)") and
 * Sys1Chart. An attack from a shielded side hits that System: its Defense,
 * Save and damage chart, with only a result that would destroy going through
 * to the Core's chart. Parts counts the Systems and Attachments that
 * activate with the Core (two actions each); an Attachment's weapons carry
 * the WPN keyword and are lost when a WPN box is hit.
 */
const SYSTEMS = [1, 2, 3, 4] as const;
const SIDES = ["front", "right", "rear", "left"] as const;
const isBehemoth = (role: string): Expr => ({ hasKeyword: role, keyword: "BEHEMOTH" });
/** System n shields the target from where the attacker stands. */
const shields = (n: number): Expr => ({
  all: [
    isBehemoth("target"),
    {
      any: SIDES.map((side) => ({
        all: [
          { is: `target.Sys${n}Arc`, value: side },
          { query: { kind: "inArc", from: "target", to: "attacker", arc: `${side}Side` } },
        ],
      })),
    },
  ],
});
/** The shielding System's value of a characteristic, else `own` (the target's own by default). */
const shieldedOr = (char: string, own: Expr): Expr =>
  SYSTEMS.reduceRight<Expr>(
    (rest, n) => ({ if: shields(n), then: ref(`target.Sys${n}${char}`), else: rest }),
    own,
  );
const shielded = (char: string): Expr => shieldedOr(char, ref(`target.${char}`));
const unshielded: Expr = { not: { any: SYSTEMS.map(shields) } };
const behemothChars = SYSTEMS.flatMap((n) => [
  { id: `Sys${n}Name`, name: `System ${n}`, of: "model" as const, type: "text" as const },
  { id: `Sys${n}Arc`, name: `System ${n} shields`, of: "model" as const, type: "text" as const },
  { id: `Sys${n}Def`, name: `System ${n} Defense`, of: "model" as const, type: "number" as const },
  {
    id: `Sys${n}saveDie`,
    name: `System ${n} save die`,
    of: "model" as const,
    type: "number" as const,
    aliases: [`Sys${n}Save`],
    pattern: "d(\\d+)",
  },
  {
    id: `Sys${n}saveDice`,
    name: `System ${n} save dice`,
    of: "model" as const,
    type: "number" as const,
    aliases: [`Sys${n}Save`],
    pattern: "\\((\\d+)\\)",
    default: 1,
  },
  { id: `Sys${n}Chart`, name: `System ${n} damage chart`, of: "model" as const, type: "text" as const },
]);

/**
 * Weapon special rules the players resolve by hand, shown as reminders in the
 * attack (matched by keyword name only; no rules text here).
 */
const weaponReminder = (id: string, name: string, match: string): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["weapon"],
  effects: [{ when: { event: "action.declared" }, do: [{ do: "manual", reminder: id }] }],
});
const weaponRules: RuleDef[] = [
  weaponReminder("area", "Area", "^area\\b"),
  weaponReminder("lethal", "Lethal", "^lethal$"),
  weaponReminder("surgical", "Surgical", "^surgical$"),
  weaponReminder("suppress", "Suppress", "^suppress$"),
  weaponReminder("passThrough", "Pass Through", "^pass[- ]through$"),
  weaponReminder("selectiveFire", "Selective Fire", "^selective fire$"),
  // Not after moving is automated; this is for not moving after it fired.
  weaponReminder("heavy", "Heavy", "^heavy$"),
];

const unitTraits = (names: string[]) => `^(${names.join("|")})\\b`;

/** The AD Pool for a game of so many points. */
function adPoolFor(points: Expr): Expr {
  return {
    op: "+",
    args: [6, { op: "*", args: [2, { op: "ceil", args: [{ op: "/", args: [points, 20] }] }] }],
  };
}

/** A rule the players apply by hand, named in the attack while `when` holds. */
function attackReminder(id: string, when: Expr): Effect {
  return { id, when: { event: "action.declared" }, if: when, do: [{ do: "manual", reminder: id }] };
}

/** Units that fly or jump over any terrain. */
const PASS_OVER = ["FLYING", "JUMP"];
/** Traversable terrain: infantry crosses it (1 DU), others can't (mounted infantry moves as a mech). */
const infantryCrosses = [
  { keywords: [...PASS_OVER, "AGILE"] },
  { keywords: ["MOUNTED"], blocks: true },
  { keywords: ["INFANTRY"], slows: 1 },
  { keywords: ["*"], blocks: true },
];
/** Weapon arcs of fire, in degrees. */
const FIRE_ARCS = [45, 90, 135, 180, 225, 270, 315];
/** `to` lies outside the weapon's arc of fire from `from` (all round when unset). */
const outsideArcOf = (from: string, to: string): Expr => ({
  all: [
    { cmp: ">", a: ref("weapon.arc"), b: 0 },
    { cmp: "<", a: ref("weapon.arc"), b: 360 },
    {
      not: {
        any: FIRE_ARCS.map((w) => ({
          all: [
            { cmp: "==", a: ref("weapon.arc"), b: w },
            { query: { kind: "inArc", from, to, arc: `fire${w}` } },
          ],
        })),
      },
    },
  ],
});
const outsideArc = outsideArcOf("attacker", "target");
/**
 * Unit special rules (abilities at the bottom of a card), shown as reminders
 * when they matter: in an attack the unit makes or takes, during the
 * activations, or at scoring. Matched by name; the text is the player's.
 */
const abilityTimings: AbilityTiming[] = [
  {
    attack: "defender",
    match: unitTraits([
      "evasive",
      "hard shell",
      "camouflage",
      "unpinnable",
      "thick armou?r",
      "nimble",
      "small target",
      "large target",
      "terrain expert",
      "flying",
      "mounted",
    ]),
  },
  { attack: "attacker", match: unitTraits(["charger"]) },
  // Finer than the phase: for the unit activated, once it moves, or while it reacts.
  {
    on: "activation",
    match: unitTraits([
      "fire base",
      "capable",
      "disciplined",
      "lone wolf",
      "commander",
      "jamming",
      "unwavering",
      "inert",
      "silent",
      "blunt",
      "unpinnable",
    ]),
  },
  {
    on: "move",
    match: unitTraits(["fast", "slow", "agile", "tracked", "side movement", "jump", "flying", "charger"]),
  },
  { on: "reaction", match: unitTraits(["reactive", "unwavering"]) },
  { phase: "scoring", side: "either", match: unitTraits(["blunt", "flying", "mounted"]) },
];

export const fsd: GameSystem = {
  id: "fsd-1.7",
  name: "Full Spectrum Dominance",
  version: "0.3.0",
  // 1 DU is 3" on the standard 2' x 3' table (8 x 12 DU).
  units: { name: "DU", inches: 3 },
  // Any unit may wait in reserve, and arrives at least 2 DU from enemies.
  reserves: { distance: 2 },
  longRange: "double",
  defaultTable: { width: 36, depth: 24 },
  // Only enemy bases block sight; vehicles and mechs hide only behind vehicles, mechs and behemoths.
  settings: {
    los: "footprint",
    modelsBlock: true,
    visionArc: 0,
    blockers: { enemiesOnly: true, tall: ["VEHICLE", "MECH", "BEHEMOTH"] },
  },
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
    {
      // Which system line (S1-S4) the action sits on; by default its place on the card.
      id: "line",
      name: "System line",
      short: "Sys",
      of: "weapon",
      type: "number",
      aliases: ["Line", "System", "Sys"],
      default: 0,
    },
    // Multiple attacks: "x2" by the action's name, each attack at a target named up front.
    {
      id: "times",
      name: "Multiple attacks",
      short: "x",
      of: "weapon",
      type: "number",
      aliases: ["x", "Times", "Multiple"],
      pattern: "(\\d+)",
      default: 1,
    },
    // Arc of fire in degrees, centred ahead (45, 90, ... 315); 0 or 360 is all round.
    {
      id: "arc",
      name: "Arc of fire",
      short: "Arc",
      of: "weapon",
      type: "number",
      aliases: ["Arc"],
      default: 0,
    },
    // Behemoths: Systems and Attachments activating with the Core.
    { id: "Parts", name: "Parts", of: "model", type: "number", default: 0 },
    ...behemothChars,
  ],
  weaponKinds: ["ranged", "melee"],
  unitShape: { kind: "skirmish" },
  // A vehicle's front is the 180° ahead of it; everything else is rear.
  arcs: [
    { id: "front", name: "Front", from: -90, to: 90, origin: "centre" },
    { id: "rear", name: "Rear", from: 90, to: 270, origin: "centre" },
    // A behemoth's four sides, for the Systems that shield its Core.
    { id: "frontSide", name: "Front side", from: -45, to: 45, origin: "centre" },
    { id: "rightSide", name: "Right side", from: 45, to: 135, origin: "centre" },
    { id: "rearSide", name: "Rear side", from: 135, to: 225, origin: "centre" },
    { id: "leftSide", name: "Left side", from: 225, to: 315, origin: "centre" },
    // Weapons' arcs of fire, centred ahead.
    ...FIRE_ARCS.map((w) => ({
      id: `fire${w}`,
      name: `Fire arc ${w}°`,
      from: -w / 2,
      to: w / 2,
      origin: "centre" as const,
    })),
  ],
  // Movement by unit type: crossing costs 1 DU (an area: 1 DU off the move), checked along the path.
  terrain: [
    { id: "open", name: "Open", visibility: "open" },
    {
      id: "broken",
      name: "Broken ground",
      visibility: "open",
      cover: true,
      coverFor: ["INFANTRY"],
      movement: [{ keywords: [...PASS_OVER, "TRACKED", "AGILE"] }, { keywords: ["VEHICLE"], slows: 1 }],
    },
    {
      id: "traversable",
      name: "Traversable (walls, fences)",
      visibility: "obscuring",
      cover: true,
      coverFor: ["INFANTRY"],
      movement: infantryCrosses,
    },
    {
      // Vehicles and mechs drive through it; infantry crosses it as traversable.
      id: "fragile",
      name: "Fragile (barricades, wooden fences)",
      visibility: "obscuring",
      cover: true,
      coverFor: ["INFANTRY"],
      movement: [
        { keywords: [...PASS_OVER, "TRACKED", "AGILE", "MOUNTED"] },
        { keywords: ["INFANTRY"], slows: 1 },
        { keywords: ["*"] },
      ],
    },
    { id: "obscuring", name: "Obscuring (woods, scrub)", visibility: "obscuring", cover: true },
    {
      id: "blocking",
      name: "Blocking (buildings, rocks)",
      visibility: "blocking",
      blocksMovement: true,
      cover: true,
      // Behind the corner: cover when partly hidden by it, not for touching it in full view.
      coverWhenHiding: true,
      // Buildings and ruins: traversable by infantry.
      movement: infantryCrosses,
    },
    {
      id: "impassable",
      name: "Impassable (tall walls, rock formations)",
      visibility: "blocking",
      blocksMovement: true,
      cover: true,
      coverWhenHiding: true,
      movement: [{ keywords: PASS_OVER }],
    },
  ],
  statuses: [
    { id: "pinned", name: "Pinned", on: "unit" },
    { id: "activated", name: "Activated", on: "unit" },
    // Set by Interact; lost on any other action, on getting pinned, and at a new round.
    { id: "interacting", name: "Interacting", on: "unit" },
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
      // Save dice one category lower, to d6 at worst: applied in the attack's save step
      // (a relative "always" effect would be folded in twice, model then unit).
    },
    { id: "damageS1", name: "System 1 damaged", on: "unit" },
    { id: "damageS2", name: "System 2 damaged", on: "unit" },
    { id: "damageS3", name: "System 3 damaged", on: "unit" },
    { id: "damageS4", name: "System 4 damaged", on: "unit" },
    { id: "damageWPN", name: "Attachment destroyed", on: "unit" },
  ],
  resources: [
    // Rolled each round; the faces matter for AD slots.
    {
      id: "readyDice",
      name: "Activation dice",
      on: "player",
      initial: 0,
      kind: "dicePool",
      short: "AD",
      sides: 6,
      reset: "round",
      rerollOnce: true,
      // The AD Pool: dice still on cards are rolled again only once spent.
      total: ref("const.adPool"),
    },
    { id: "VP", name: "VP", on: "player", initial: 0 },
  ],
  constants: { adPool: 12, adCapacity: 8, closeCombat: 1, commandRange: 2 },
  // The AD Pool is 6, plus 2 per 20 points (or part of 20) played; the Capacity is 4 less.
  gameSize: {
    points: 60,
    constants: {
      adPool: adPoolFor(ref("game.points")),
      adCapacity: { op: "-", args: [adPoolFor(ref("game.points")), 4] },
    },
  },
  resets: [
    {
      at: "round",
      flags: ["activated", "moved", "interacting", "commanded", "reacted", "coreActivated", "used.*"],
    },
  ],
  rules: weaponRules,
  abilityTimings,
  procedures: [
    {
      id: "attack",
      name: "Attack",
      params: ["attacker", "weapon", "target"],
      steps: [
        {
          // Per Base weapons attack once from each base in range and sight of the target.
          kind: "pool",
          id: "attacks",
          count: {
            if: weaponHas("PER BASE"),
            then: {
              op: "*",
              args: [ref("weapon.dice"), { count: "attacker.models", as: "base", where: baseCanShoot }],
            },
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
              shielded("Def"),
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
              // Indirect Fire at a target out of sight: +1.
              {
                if: {
                  all: [
                    weaponHas("INDIRECT FIRE"),
                    { not: { query: { kind: "visible", from: "attacker", to: "target" } } },
                  ],
                },
                then: 1,
                else: 0,
              },
            ],
          },
          impossibleIf: {
            any: [
              { cmp: ">", a: distance, b: { op: "*", args: [ref("weapon.range"), 2] } },
              { cmp: "<", a: distance, b: ref("weapon.minRange") },
              // A minimum range of 1 DU or more can't fight in close combat.
              { all: [close, { cmp: ">=", a: ref("weapon.minRange"), b: 1 }] },
              // Outside the weapon's arc of fire the target isn't in its sight.
              outsideArc,
              // Short Range weapons can't fire at long range.
              { all: [weaponHas("SHORT RANGE"), { cmp: ">", a: distance, b: ref("weapon.range") }] },
              // Contact weapons need base contact, and can't hit a Flying unit.
              {
                all: [
                  weaponHas("CONTACT"),
                  { any: [{ not: baseContact }, { hasKeyword: "target", keyword: "FLYING" }] },
                ],
              },
            ],
          },
          roller: "attacker",
        },
        {
          // Infantry is pinned by any hit, saved or not.
          kind: "do",
          id: "pinInfantry",
          if: { hasKeyword: "target", keyword: "INFANTRY" },
          do: [{ do: "applyStatus", target: "target", status: "pinned" }, dropInteractTarget],
        },
        {
          // Roll the save dice, keep the highest, and match the hit roll. AP
          // removes dice (close combat gives AP1), leaving at least one; the
          // rear of a vehicle saves with a die one size smaller.
          kind: "test",
          id: "save",
          // A behemoth doesn't suffer from attacks from the rear; a System it is shielded by saves.
          die: shieldedOr("saveDie", {
            op: "max",
            args: [
              6,
              {
                op: "-",
                args: [
                  ref("target.saveDie"),
                  { if: { hasStatus: "target", status: "damageARM" }, then: 2, else: 0 },
                  {
                    if: {
                      all: [
                        { hasKeyword: "target", keyword: "VEHICLE" },
                        { not: isBehemoth("target") },
                        { query: { kind: "inArc", from: "target", to: "attacker", arc: "rear" } },
                      ],
                    },
                    then: 2,
                    else: 0,
                  },
                ],
              },
            ],
          }),
          dicePerInput: {
            op: "max",
            args: [
              1,
              {
                op: "-",
                args: [
                  shielded("saveDice"),
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
          if: { all: [{ has: "target.Chart" }, unshielded] },
          do: [
            { do: "damageTrack", target: "target", chart: "target.Chart", status: "pinned" },
            dropInteractTarget,
          ],
        },
        // A behemoth's shielding System takes the damage on its own chart first.
        ...SYSTEMS.map((n) => ({
          kind: "do" as const,
          id: `chartS${n}`,
          if: { all: [{ has: "target.Chart" }, shields(n)] },
          do: [
            {
              do: "damageTrack" as const,
              target: "target",
              chart: "target.Chart",
              status: "pinned",
              through: { chart: `target.Sys${n}Chart`, prefix: `s${n}`, name: `target.Sys${n}Name` },
            },
          ],
        })),
        {
          // Units without one lose the closest base per unsaved hit, and are pinned.
          kind: "do",
          id: "pinDamaged",
          if: { not: { has: "target.Chart" } },
          do: [{ do: "applyStatus", target: "target", status: "pinned" }, dropInteractTarget],
        },
        {
          kind: "allocate",
          id: "bases",
          chooser: "attacker",
          // Closest base first, and only bases the attacker sees: hits beyond them are lost
          // (fire at a unit out of sight altogether, Indirect Fire, takes the closest).
          order: { query: { kind: "distance", from: "attacker", to: "model", measure: "centre" } },
          only: {
            any: [
              { query: { kind: "visible", from: "attacker", to: "model" } },
              { not: { query: { kind: "visible", from: "attacker", to: "target" } } },
            ],
          },
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
      // A behemoth's Systems and Attachments activate with its Core, two actions each.
      activates: { op: "*", args: [2, { op: "+", args: [1, ref("self.Parts")] }] },
      // Once a round; a behemoth whose System reacted earlier can still activate its Core.
      if: {
        all: [
          { not: { hasFlag: "self", flag: "reserves" } },
          { not: { hasFlag: "self", flag: "coreActivated" } },
          {
            any: [
              { not: { hasStatus: "self", status: "activated" } },
              { all: [isBehemoth("self"), { hasFlag: "self", flag: "reacted" }] },
            ],
          },
        ],
      },
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
        { do: "setFlag", target: "self", flag: "coreActivated", value: true },
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
      // A behemoth's Core never reacts, but a System that hasn't acted may, before or
      // after the Core activates (the player picks which; the app doesn't count them).
      if: {
        all: [
          { any: [{ not: { hasStatus: "self", status: "activated" } }, isBehemoth("self")] },
          { not: { hasFlag: "self", flag: "reserves" } },
          notPinned,
          {
            any: [
              // Any target of the shot, a multiple attack's included.
              {
                all: [
                  { is: "event.action", value: "fire" },
                  { some: "event.targets", as: "shotAt", test: { same: ["shotAt", "self"] } },
                ],
              },
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
      hint: "To a move, pick the point on its path where the reaction happens. A reaction may set off another (a chain), all landing together; a unit may also deploy from reserve as a reaction",
      do: [{ do: "setFlag", target: "self", flag: "reacted", value: true }],
    },
    {
      id: "unpin",
      name: "Unpin",
      by: "unit",
      if: { hasStatus: "self", status: "pinned" },
      do: [{ do: "removeStatus", target: "self", status: "pinned" }, dropInteract],
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
      do: [dropInteract],
    },
    {
      // Each weapon is a special action: once per round, paying its AD slots.
      id: "fire",
      name: "Fire",
      by: "unit",
      if: notPinned,
      forWeapons: { not: prepared },
      // In sight, or out of sight with Indirect Fire (+1 Defense, in the hit roll); in the weapon's arc.
      target: {
        filter: { any: [{ query: { kind: "visible", from: "self", to: "it" } }, weaponHas("INDIRECT FIRE")] },
        notWhen: [{ if: outsideArcOf("self", "it"), why: "Outside the weapon's arc of fire" }],
      },
      limit: { count: 1, per: "round", perUnit: true },
      notWhen: [...damagedSystems, attachmentLost, heavyAfterMoving],
      cost: [{ resource: "readyDice", amount: 0, slotsFrom: "weapon.slots" }],
      procedure: "attack",
      // x2, x3: one action, an attack per target named.
      repeat: ref("weapon.times"),
      do: [dropInteract],
    },
    {
      // A special action marked prepared puts a token on the card: its effects
      // last while the token stays (played by hand), and it's cleared when used.
      id: "prepare",
      name: "Prepare",
      by: "unit",
      if: notPinned,
      forWeapons: prepared,
      prepares: true,
      hint: "Its effect lasts while the token stays; clear the token when the action is used or its trigger comes",
      limit: { count: 1, per: "round", perUnit: true },
      notWhen: [...damagedSystems, attachmentLost, heavyAfterMoving],
      cost: [{ resource: "readyDice", amount: 0, slotsFrom: "weapon.slots" }],
      do: [dropInteract],
    },
    // Interacting counts as prepared: lost on taking any other action, or at a new round.
    { id: "interact", name: "Interact", by: "unit", if: notPinned, sets: ["interacting"] },
    {
      // Instead of activating a unit, a player may use a support card from
      // their own cards: they name it and spend its ADs (the effect is played
      // by hand), then end the turn.
      id: "support",
      name: "Support card",
      by: "player",
      side: "active",
      custom: true,
      endsTurn: true,
      phases: ["activations"],
      hint: "Each card once a round; Single Use cards are discarded. A card's attack from a unit doesn't activate it or allow reactions, and the target keeps its cover and range bonuses",
      cost: [{ resource: "readyDice", amount: 0 }],
    },
    {
      // A unit in reserve comes on as its activation: one action fewer, no
      // command, and no die spent. Bring it on with Arrive, at least 2 DU
      // from every enemy.
      id: "deploy",
      name: "Deploy",
      by: "unit",
      side: "active",
      activates: 1,
      hint: "Disembarking from a transport is deploying too: place the bases as close to it as possible",
      if: { hasFlag: "self", flag: "reserves" },
    },
  ],
  turn: {
    rounds: 6,
    // Initiative: a D6 each plus the best Command among their units on the table (pinned ones
    // and reserves aside; Character bonuses by hand), and the winner picks who goes first.
    initiative: "rollOffEachRound",
    rollOffName: "Initiative",
    rollOff: { best: { characteristic: "Cmd", unless: "pinned" }, chooses: "higher" },
    round: [
      {
        kind: "step",
        id: "rollActivationDice",
        do: [
          { do: "gainResource", resource: "readyDice", amount: ref("const.adCapacity"), player: "owner" },
          { do: "gainResource", resource: "readyDice", amount: ref("const.adCapacity"), player: "opponent" },
        ],
      },
      // Before the activations, both players may place Ready dice on cards.
      {
        kind: "phase",
        id: "preassign",
        name: "Pre-assign ADs",
        placeDice: true,
        hint: "Reinforcement waves due this round join the Reserve (mark them in reserve)",
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
            actions: ["activate", "deploy", "react", "unpin", "move", "fire", "prepare", "interact"],
          },
        ],
      },
      {
        kind: "phase",
        id: "scoring",
        name: "Scoring",
        hint: "Objectives: an unpinned unit interacting in base contact at round end controls one, unless an unpinned enemy interacting within 1 DU contests it. Infantry always count as interacting; mechs (behemoths too) only for contesting; vehicles must Interact. Draw Victory Cards as the scenario says. At the end of the game, lose 1 VP per 5 points of units removed",
      },
      // Discard dice from cards, and place Ready dice for next round.
      { kind: "phase", id: "cleanup", name: "Cleanup", placeDice: true },
    ],
  },
  // Reminders in the attack panel, for rules the players play by hand.
  coreEffects: [
    attackReminder("Lost when firing", isBehemoth("attacker")),
    attackReminder("Damage to transported units", { hasKeyword: "target", keyword: "TRANSPORT" }),
    attackReminder("Wrecks (optional)", {
      any: [
        { hasKeyword: "target", keyword: "VEHICLE" },
        { hasKeyword: "target", keyword: "MECH" },
      ],
    }),
    attackReminder("System damage effects", { any: SYSTEMS.map(shields) }),
  ],
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
