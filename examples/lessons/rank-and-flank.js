// A lesson package for Open Battle's teaching mode: a guided first turn of the
// built-in rank-and-flank game (played by hand). Plain data (src/teach/lesson.ts).

export const manifest = {
  id: "open-battle.lessons.rank-and-flank",
  name: "First game: Rank and flank",
  version: "1.0.0",
  author: "Open Battle",
  api: 1,
  kind: "lesson",
  systems: ["tow"],
  requires: [],
  adds: "A guided first turn with regiment blocks: march, shoot and fight, against a computer opponent.",
};

export const lessons = [
  {
    id: "first-turn",
    title: "Moving blocks",
    system: "tow",
    summary: "March a regiment, shoot with your archers, then watch the other side.",
    you: 0,
    steps: [
      {
        say: "You command blue at the near edge; the computer plays red. Your units are regiments: blocks of models in ranks that move together. A turn runs Strategy, Movement, Shooting and Combat.",
      },
      {
        say: "Nothing happens in the Strategy phase of a first turn. Press ▶ at the top for Movement.",
        until: { phase: "movement" },
      },
      {
        say: "Your spear regiment is selected. Drag the block forwards: it keeps its ranks, and the ruler shows how far it has gone against its Move. The card has buttons to wheel and turn.",
        show: { seat: 0, unit: 0 },
        until: { did: ["unit/move", "models/move"] },
      },
      {
        say: "To charge, drag a block into contact with an enemy; the enemy may react first. Press ▶ for the Shooting phase.",
        until: { phase: "shooting" },
      },
      {
        say: "Your archers are selected. Press Shoot and pick an enemy in range, or press ▶ if nothing is close enough.",
        show: { seat: 0, unit: 1 },
        until: { any: [{ did: "shoot" }, { phase: "combat" }] },
      },
      {
        say: "Combat: blocks in contact fight. Press ▶ to end your turn when you're done.",
        until: { theirTurn: true },
      },
      {
        say: "Now red plays its turn. If it charges you, you'll be asked how to react.",
        until: { yourTurn: true },
      },
      {
        say: "That's a whole round. Bring your blocks into contact to fight; a unit that loses badly may flee. \"What can I do now?\" at the bottom left always says what's possible.",
      },
    ],
  },
];
