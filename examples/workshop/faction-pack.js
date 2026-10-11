// A faction pack to start from (#79). Everything in it is invented: the
// Vanguard Legion is one of the app's own sample armies, and the rules below
// were made up for this file. A pack teaches the app what rules do BY NAME:
// unit abilities, army and detachment rules, enhancements and stratagems.
// Never put a publisher's rules text in a pack: names, and your own words.
//
// In the workshop, pick an army (Army tab): it lists the names in that army,
// and "Build" writes a rule for a name into `faction` below, as data. Test
// table plays your army with the pack on it; Export downloads the file to
// host anywhere. See docs/faction-packs.md for the format.

/** Read as data before anything runs: a plain literal, no variables or calls. */
export const manifest = {
  id: "me.my-faction-pack",
  name: "My faction pack",
  version: "0.1.0",
  author: "Me",
  api: 1,
  kind: "faction",
  systems: ["forty-k"],
  requires: [],
  adds: "Rules for the invented Vanguard Legion: three unit abilities, a faction rule, and the Spearhead Muster detachment's rule and two stratagems.",
};

// The rules, keyed by name. Each says what it does in one of four ways:
// - teach: what "Teach it this rule" builds (when, who, what), the easiest;
// - auto: the automated-ability parts the app's ability reader writes;
// - effects: rules-schema effects, as a package's data rules write them;
// - code: the pack's own code plays it (give the file a default export with
//   hooks, as docs/packages.md shows).
// A rule with only a summary is played by hand, with your words as its reminder.
// The workshop writes this literal back when you build a rule, so keep notes
// up here rather than inside it.
export const faction = {
  faction: "Vanguard Legion",
  rules: [
    {
      name: "Shoulder to Shoulder",
      summary: "Each model in this army ignores a lost wound on a 6.",
      teach: { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "fnp", x: 6 }] },
    },
  ],
  abilities: [
    {
      name: "Hold the Line",
      summary: "While this unit is within range of an objective, add 1 to its saving throws.",
      teach: {
        when: { kind: "attacks" },
        who: { kind: "self" },
        what: [{ kind: "save", by: 1 }],
        onObjective: "within",
      },
    },
    {
      name: "Rally Call",
      summary: "Once per battle, for one phase: re-roll failed Hit rolls for this unit's attacks.",
      teach: {
        when: { kind: "attacks" },
        who: { kind: "self" },
        what: [{ kind: "reroll", roll: "hit", which: "failed" }],
        oncePerBattle: true,
      },
    },
    {
      name: "Steady Gait",
      summary: "This model can shoot after it Falls Back.",
    },
  ],
  detachments: [
    {
      name: "Spearhead Muster",
      rules: [
        {
          name: "Drilled Volleys",
          summary: "Ranged attacks of a unit that stayed still re-roll Hit rolls of 1.",
          teach: {
            when: { kind: "attacks", weapon: "ranged", when: "stationary" },
            who: { kind: "self" },
            what: [{ kind: "reroll", roll: "hit", which: "ones" }],
          },
        },
      ],
      enhancements: [],
      stratagems: [
        {
          name: "Focused Fire",
          cp: 1,
          side: "active",
          phases: ["shooting"],
          target: { notYet: "shot" },
          summary: "Your unit's ranged attacks add 1 to the Wound roll this phase.",
          teach: {
            when: { kind: "attacks", weapon: "ranged" },
            who: { kind: "self" },
            what: [{ kind: "modify", roll: "wound", by: 1 }],
          },
        },
        {
          name: "Smoke Drill",
          cp: 1,
          side: "inactive",
          phases: ["shooting"],
          once: "turn",
          summary: "Ranged attacks against your unit subtract 1 from the Hit roll this phase.",
          teach: {
            when: { kind: "attacks", weapon: "ranged" },
            who: { kind: "self" },
            what: [{ kind: "against", roll: "hit", by: -1 }],
          },
        },
      ],
    },
  ],
};
