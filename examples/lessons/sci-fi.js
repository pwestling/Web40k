// A lesson package for Open Battle's teaching mode: a guided first turn of the
// built-in sci-fi battle game. Lesson packages are plain data, read without
// running anything (src/teach/lesson.ts), so anyone can write one.

export const manifest = {
  id: "open-battle.lessons.sci-fi",
  name: "First game: Sci-fi battle",
  version: "1.0.0",
  author: "Open Battle",
  api: 1,
  kind: "lesson",
  systems: ["forty-k"],
  requires: [],
  adds: "A guided first turn: move, shoot, charge and fight, against a computer opponent.",
};

export const lessons = [
  {
    id: "first-turn",
    title: "Your first turn",
    system: "forty-k",
    summary: "Move, shoot, charge and fight, then watch the other side do the same.",
    you: 0,
    // Your infantry and theirs start close enough to trade shots and maybe charge.
    place: [
      { seat: 0, unit: 0, at: { x: 0, y: 11 } },
      { seat: 1, unit: 0, at: { x: 0, y: -6 } },
    ],
    steps: [
      {
        say: "You command the blue army at the near edge; the computer plays red. A turn runs through five phases: Command, Movement, Shooting, Charge and Fight. Let's play one.",
      },
      {
        say: "This is the Command phase. Both sides gain a Command point (CP, top bar) to spend on stratagems later. Nothing else to do: press ▶ at the top for the Movement phase.",
        until: { phase: "movement" },
      },
      {
        say: "Your Line Troopers are selected. Drag them towards the enemy: their card shows how far they've moved against their Move of 6\".",
        show: { seat: 0, unit: 0 },
        until: { did: ["models/move", "normalMove", "advance"] },
      },
      {
        say: "Move any other units you like the same way. When you're done, press ▶ for the Shooting phase.",
        until: { phase: "shooting" },
      },
      {
        say: "On the Line Troopers' card, press Shoot beside a weapon (the Rng column says how far it reaches), then click an enemy unit. The roll panel then walks you through hits, wounds and saves.",
        show: { seat: 0, unit: 0 },
        until: { did: ["shoot", "attack/declare"] },
      },
      {
        say: "Finish the rolls in the panel. Shoot with other units if you like, then press ▶ for the Charge phase.",
        until: { phase: "charge" },
      },
      {
        say: 'A unit can charge an enemy within 12". Select one and press Charge (2D6): you roll two dice and must reach the enemy with that many inches. If none is close enough, press ▶.',
        until: { any: [{ did: ["charge", "roll:charge"] }, { phase: "fight" }] },
      },
      {
        say: "Fight phase: units in contact with an enemy can Fight. Do that if you can, then press ▶ to end your turn.",
        until: { theirTurn: true },
      },
      {
        say: "Now the red army plays its turn. When it shoots or fights you, the roll panel asks you to roll your saves.",
        until: { yourTurn: true },
      },
      {
        say: "That's a whole round. The battle runs for five; play on as long as you like. \"What can I do now?\" at the bottom left always says what's possible.",
      },
    ],
  },
];
