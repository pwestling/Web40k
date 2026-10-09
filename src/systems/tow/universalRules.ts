import type { Expr, RuleDef } from "../../core/content";

/**
 * The core rulebook's universal special rules (#66), found by name in an
 * imported list: a unit's rules ("Regeneration (5+)", "Hatred (High Elves)")
 * and its weapons' ("Killing Blow"). Names and our own one-line paraphrase
 * only, from the players' rules index; the players' own lists carry the text.
 *
 * Most are played by this module's code (combat.ts, psychology.ts, ranks.ts,
 * characters.ts, reminders.ts, magic.ts), so the rule here says so
 * (`played: "code"`) and an imported unit shows it as automated. Saves and
 * armour change the model's characteristics, so the shooting procedure and
 * close combat both read them.
 */

const ref = (r: string): Expr => ({ ref: r });

/** Played by the module's code: by name (a pattern), on the unit, the model or a weapon. */
const code = (
  id: string,
  name: string,
  match: string,
  appliesTo: RuleDef["appliesTo"] = ["unit", "model"],
): RuleDef => ({
  id,
  name,
  match,
  appliesTo,
  effects: [],
  played: "code",
});

/** A save value from the rule's name ("Ward save (5+)"), keeping a better one the model already has. */
const save = (id: string, name: string, match: string, characteristic: string): RuleDef => ({
  id,
  name,
  match,
  params: [{ id: "x", type: "number" }],
  appliesTo: ["model"],
  effects: [
    {
      when: { event: "always" },
      do: [
        {
          do: "setCharacteristic",
          target: "self",
          characteristic,
          to: {
            if: { cmp: ">", a: ref(`self.${characteristic}`), b: 0 },
            then: { op: "min", args: [ref(`self.${characteristic}`), ref("param.x")] },
            else: ref("param.x"),
          },
        },
      ],
    },
  ],
});

/** Armour worn: its armour value, unless the model already has a better one. */
const armour = (id: string, name: string, match: string, value: number): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["model"],
  effects: [
    {
      when: { event: "always" },
      do: [
        {
          do: "setCharacteristic",
          target: "self",
          characteristic: "armour",
          to: { op: "min", args: [ref("self.armour"), value] },
        },
      ],
    },
  ],
});

/** A shield or a barded mount: armour one better (after the armour worn, so listed after it). */
const better = (id: string, name: string, match: string): RuleDef => ({
  id,
  name,
  match,
  appliesTo: ["model"],
  effects: [
    {
      when: { event: "always" },
      do: [{ do: "modifyCharacteristic", target: "self", characteristic: "armour", by: -1 }],
    },
  ],
});

export const universalRules: RuleDef[] = [
  // Saves: Ward save (X+) and Regeneration (X+) set the model's ward and regeneration values.
  save("wardSave", "Ward save", "^ward(?:\\s+save)?\\s*\\(\\s*(?<x>[2-6])\\+?\\s*\\)", "ward"),
  save("regeneration", "Regeneration", "^regeneration\\s*\\(\\s*(?<x>[2-6])\\+?\\s*\\)", "regen"),
  // Armour worn (light 6+, heavy 5+, full plate 4+), then a shield and barding one better each.
  armour("lightArmour", "Light Armour", "^light armou?r\\b", 6),
  armour("heavyArmour", "Heavy Armour", "^heavy armou?r\\b", 5),
  armour("fullPlate", "Full Plate Armour", "^full plate armou?r\\b", 4),
  better("shield", "Shield", "^shield\\b(?!\\s*wall)"),
  better("barding", "Barding", "^barding\\b"),
  // Psychology (combat.ts, psychology.ts, reminders.ts).
  code("fear", "Fear", "^(?:causes\\s+)?fear\\b(?!\\s+of\\b)"),
  code("terror", "Terror", "^(?:causes\\s+)?terror\\b"),
  code("frenzy", "Frenzy", "^frenzy\\b"),
  code("hatred", "Hatred", "^hatred\\b"),
  code("stupidity", "Stupidity", "^stupidity\\b"),
  code("stubborn", "Stubborn", "^stubborn\\b"),
  code("unbreakable", "Unbreakable", "^unbreakable\\b"),
  code("immuneToPsychology", "Immune to Psychology", "^immune to psychology\\b"),
  // Attacks (combat.ts strike, woundAndSave; the shooting procedure above for missiles).
  code("armourBaneUnit", "Armour Bane", "^armou?r bane\\b"),
  code("killingBlow", "Killing Blow", "^killing blow\\b", ["weapon", "unit", "model"]),
  code("monsterSlayer", "Monster Slayer", "^monster slayer\\b", ["weapon", "unit", "model"]),
  code("poisonedAttacks", "Poisoned Attacks", "^poisoned attacks\\b", ["weapon", "unit", "model"]),
  code("flamingAttacks", "Flaming Attacks", "^flaming attacks\\b", ["weapon", "unit", "model"]),
  code("flammable", "Flammable", "^flammable\\b"),
  code("multipleWoundsUnit", "Multiple Wounds", "^multiple wounds\\s*\\("),
  code("strikeFirst", "Strike First", "^strike first\\b", ["weapon", "unit", "model"]),
  code("strikeLast", "Strike Last", "^strike last\\b", ["weapon", "unit", "model"]),
  code("furiousCharge", "Furious Charge", "^furious charge\\b"),
  code("impactHits", "Impact Hits", "^impact hits\\s*\\("),
  code("stompAttacks", "Stomp Attacks", "^stomp attacks\\s*\\("),
  code("thunderstomp", "Thunderstomp", "^thunderstomp\\b"),
  code("pressOfBattle", "Press of Battle", "^press of battle\\b"),
  code("parry", "Parry", "^parry\\b"),
  code("requiresTwoHands", "Requires Two Hands", "^requires two hands\\b", ["weapon", "unit", "model"]),
  code("fightInExtraRank", "Fight in Extra Rank", "^fight in extra rank\\b", ["weapon", "unit", "model"]),
  code("cavalrySupport", "Cavalry Support", "^cavalry support\\b"),
  code("massedInfantry", "Massed Infantry", "^massed infantry\\b"),
  // Movement and Leadership.
  code("swiftstride", "Swiftstride", "^swiftstride\\b"),
  code("drilled", "Drilled", "^drilled\\b"),
  code("warband", "Warband", "^warband\\b"),
  code("horde", "Horde", "^horde\\b"),
  code("moveThroughCover", "Move Through Cover", "^move through cover\\b"),
  code("ironShodWheels", "Iron Shod Wheels", "^iron shod wheels\\b"),
  // Formations the regiment may take (reminders.ts warns about any other).
  code("closeOrder", "Close Order", "^close order\\b"),
  code("openOrder", "Open Order", "^open order\\b"),
  code("skirmishers", "Skirmishers", "^skirmishers?\\b"),
  code("lumbering", "Lumbering", "^lumbering\\b"),
  // Shooting.
  code("volleyFire", "Volley Fire", "^volley fire\\b", ["weapon", "unit", "model"]),
  code("quickShot", "Quick Shot", "^quick shot\\b", ["weapon", "unit", "model"]),
  code("largeTarget", "Large Target", "^large target\\b"),
  // Who may join whom (characters.ts).
  code("clumsy", "Clumsy", "^clumsy\\b"),
  code("loner", "Loner", "^loner\\b"),
  // Magic (magic.ts).
  code("magicResistance", "Magic Resistance", "^magic resistance\\b"),
];
