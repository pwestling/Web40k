// An example faction pack for Open Battle (#76). Everything in it is invented:
// the Ashen Host is one of the app's own sample armies, and the Cinder Court
// detachment, its enhancements and stratagems were made up for this file.
// It is plain JavaScript with no imports. A player loads a pack by pasting
// the link to its file in the army import ("Faction packs"); see
// docs/faction-packs.md for the format.

/**
 * Read as data before anything runs (the consent sheet shows it): a plain
 * literal, no variables, calls or template expressions.
 */
export const manifest = {
  id: "example.cinder-court",
  name: "Cinder Court (example)",
  version: "1.0.0",
  author: "Open Battle examples",
  api: 1,
  kind: "faction",
  systems: ["forty-k"],
  requires: [],
  adds: "Rules for the invented Ashen Host: three unit abilities, the Cinder Court detachment (one rule, two enhancements) and four stratagems.",
};

/**
 * The rules, keyed by name. Also read as data, never run: the same plain
 * literal rules as the manifest. Each rule says what it does in one of four
 * ways (auto, teach, effects or code); summaries are the author's own words.
 */
export const faction = {
  faction: "Ashen Host",
  rules: [
    {
      name: "Ashen Resolve",
      summary: "Each time an attack targets a unit from this army, subtract 1 from the Wound roll.",
      teach: {
        when: { kind: "attacks" },
        who: { kind: "self" },
        what: [{ kind: "against", roll: "wound", by: -1 }],
      },
    },
  ],
  abilities: [
    {
      name: "Endless Tide",
      summary: "At the start of your Command phase, one destroyed model returns to this unit.",
      teach: {
        when: { kind: "phase", phase: "command", at: "start" },
        who: { kind: "self" },
        what: [{ kind: "heal", amount: "1", revive: true }],
      },
    },
    {
      name: "Searing Grip",
      summary: "Re-roll Damage rolls of 1 for this model's attacks.",
      // The automated-ability parts of #38; the app compiles their effects.
      auto: { parts: [{ kind: "attack", side: "making", roll: "damage", reroll: "ones" }] },
    },
    {
      name: "Burning Bulk",
      summary:
        "After this model ends a Charge move, roll a D6 for each enemy unit it is engaged with: on a 5+, that unit suffers 1 mortal wound.",
      // Data can't say "after a charge move, for each engaged unit": the code below plays it.
      code: "hooks.charge",
    },
  ],
  detachments: [
    {
      name: "Cinder Court",
      rules: [
        {
          name: "Embers Rise",
          summary:
            "Each time a model in your army makes a melee attack after charging, add 1 to the Wound roll.",
          teach: {
            when: { kind: "attacks", weapon: "melee", when: "charged" },
            who: { kind: "self" },
            what: [{ kind: "modify", roll: "wound", by: 1 }],
          },
        },
      ],
      enhancements: [
        {
          name: "Coal-Heart Sigil",
          summary: "The bearer ignores a lost wound on a 5+.",
          // Rules-schema effects, as a package's data rules write them.
          effects: [{ when: { event: "always" }, do: [{ do: "ignoreDamage", atLeast: 5 }] }],
        },
        {
          name: "Veil of Soot",
          summary:
            'Ranged attacks against friendly units within 6" of the bearer subtract 1 from the Hit roll.',
          teach: {
            when: { kind: "attacks", weapon: "ranged" },
            who: { kind: "aura", side: "friendly", range: 6 },
            what: [{ kind: "against", roll: "hit", by: -1 }],
          },
        },
      ],
      stratagems: [
        {
          name: "Banked Embers",
          cp: 1,
          side: "active",
          phases: ["shooting"],
          target: { notYet: "shot" },
          summary: "Your unit's ranged attacks add 1 to the Hit roll this phase.",
          teach: {
            when: { kind: "attacks", weapon: "ranged" },
            who: { kind: "self" },
            what: [{ kind: "modify", roll: "hit", by: 1 }],
          },
        },
        {
          name: "Choking Ash",
          cp: 1,
          side: "inactive",
          phases: ["shooting"],
          summary: "Attacks against your unit subtract 1 from the Hit roll this phase.",
          teach: {
            when: { kind: "attacks" },
            who: { kind: "self" },
            what: [{ kind: "against", roll: "hit", by: -1 }],
          },
        },
        {
          name: "Kiln-Hardened",
          cp: 2,
          side: "either",
          phases: ["fight"],
          target: { keywords: "Infantry" },
          summary: "Your Infantry unit has a 4+ invulnerable save this phase.",
          teach: { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "invuln", x: 4 }] },
        },
        {
          name: "Drifting Cinders",
          cp: 1,
          side: "active",
          phases: ["movement"],
          target: false,
          // No effect the app runs: it costs its CP and the players play it.
          summary: "Pick a spot on the table: until your next turn, it blocks sight like a ruin.",
        },
      ],
    },
  ],
};

/** "Burning Bulk" by name, as the pack matches it: case and punctuation don't count. */
const named = (a, name) =>
  a.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() === name;

/**
 * The code, which runs in the game's sandbox like any rules package's (see
 * docs/packages.md): deterministic, reading the game only through ctx.view
 * and rolling only through ctx.roll.
 */
function* burningBulk(ctx, args) {
  if (args.kind !== "move" || !args.landed) return;
  const state = ctx.view.state;
  const unit = state.units[args.unitId];
  if (!unit || !(unit.sheet?.abilities ?? []).some((a) => named(a, "burning bulk"))) return;
  for (const enemyId of ctx.view.engaged(unit.id)) {
    const enemy = state.units[enemyId];
    const model = enemy && enemy.modelIds.map((id) => state.models[id]).find((m) => m && !m.destroyed);
    if (!model) continue;
    yield ctx.note(`${unit.name}'s Burning Bulk`);
    const roll = yield ctx.roll("1d6", "Burning Bulk", unit.id, 5);
    if (roll.total < 5) continue;
    const lost = (model.woundsLost ?? 0) + 1;
    const wounds = Number(model.profile?.chars?.W ?? 1) || 1;
    yield ctx.emit({ type: "model/wounds", id: model.id, woundsLost: lost, destroyed: lost >= wounds });
    yield ctx.note(`${enemy.name} suffers 1 mortal wound`);
  }
}

export default {
  hooks: { charge: burningBulk },
};
