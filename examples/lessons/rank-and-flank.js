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
        say: "That's a whole round. Bring your blocks into contact to fight; a unit that loses badly may flee. Once you play on, \"What can I do now?\" at the top of the screen always says what's possible.",
      },
    ],
  },
  {
    id: "break-and-panic",
    title: "Break and panic",
    system: "tow",
    summary: "Charge a small unit, break it, and watch its friends test for Panic.",
    you: 0,
    // Red holds against your charge, so the fight happens (UX 317).
    answers: ["hold"],
    // Your spears face red's slingers a couple of inches away.
    place: [
      { seat: 0, unit: 0, at: { x: 0, y: 6.5 } },
      { seat: 1, unit: 4, at: { x: 0, y: 1 } },
      // The warband (and its General's Leadership) well away; a dim Bog Hulk beside the slingers.
      { seat: 1, unit: 0, at: { x: -22, y: -10 } },
      { seat: 1, unit: 3, at: { x: 6, y: 0 } },
    ],
    steps: [
      {
        say: "A regiment that breaks shakes its friends: any unit within 6\" of a friend that flees from combat or is destroyed takes a Panic test, and may run too. Red's slingers stand just ahead of your spears, with a Bog Hulk beside them.",
      },
      {
        say: "Your spears are Drilled: they march near the enemy without a test, and may redress their ranks for free before moving. Press ▶ for Movement.",
        until: { phase: "movement" },
      },
      {
        say: "Your spears are selected. Press Declare charge and pick the slingers, then move into contact with the Charge panel or by dragging.",
        show: { seat: 0, unit: 0 },
        point: "Declare charge",
        until: { engaged: true },
      },
      {
        say: "Press ▶ until the Combat phase.",
        until: { phase: "combat" },
      },
      {
        say: "Press Fight. Both sides strike, then the loser takes a break test.",
        show: { seat: 0, unit: 0 },
        point: "Fight",
        // If the charge fell short there's nothing to fight: the step ends with the turn.
        until: { any: [{ did: "combat" }, { theirTurn: true }] },
        // Keyed on what the rules logged: the break test, then the Bog Hulk's Panic test (UX 319).
        after: [
          {
            if: "said:keeps more than half its models",
            say: "The slingers broke and fled, and the Bog Hulk failed its Panic test: it fell back in good order, and rallies at the end of the move.",
          },
          {
            if: "said:fails its Panic test",
            say: "The slingers broke and fled, and the Bog Hulk failed its Panic test and fled with them.",
          },
          {
            if: "said:keeps its nerve",
            say: "The slingers broke and fled. The Bog Hulk beside them took a Panic test and kept its nerve.",
          },
          {
            if: "said:breaks (",
            say: "The slingers broke and fled.",
          },
          {
            if: "said:falls back in good order",
            say: "The slingers lost and fell back in good order: that isn't fleeing, so nobody tests for Panic.",
          },
          {
            if: "said:Combat result",
            say: "The slingers held. The fight goes on next turn.",
          },
          {
            say: "Your charge didn't reach them this time, so there was no fight.",
          },
        ],
      },
      {
        say: "Panic tests also come when a unit loses a quarter of its models to shooting or magic. You can roll one by hand from a unit's card when the rules call for it.",
      },
    ],
  },
];
