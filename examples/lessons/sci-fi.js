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
        point: "▶",
        until: { phase: "movement" },
      },
      {
        say: "Your Line Troopers are selected. Drag them towards the enemy: their card shows how far they've moved against their Move of 6\".",
        show: { seat: 0, unit: 0 },
        until: { did: ["models/move", "normalMove", "advance"] },
        after: "Good. Moving first lets you pick the fights.",
      },
      {
        say: "Move any other units you like the same way. When you're done, press ▶ for the Shooting phase.",
        point: "▶",
        until: { phase: "shooting" },
      },
      {
        say: "On the Line Troopers' card, press Shoot beside a weapon (the Rng column says how far it reaches), pick the Ashen Thralls as the target, then press Declare attack.",
        show: { seat: 0, unit: 0 },
        point: "Declare attack",
        until: { did: ["attack:ranged", "shoot"] },
      },
      {
        say: "Now roll: the panel on the right goes hits, then wounds, then their saves, then damage. Press the blue button each time.",
        point: "Roll to hit",
        until: { any: [{ did: ["attack:done", "attack/clear", "procedure/clear"] }, { phase: "charge" }] },
        after: [
          { if: "slain >= 5", say: "{slain} of the {target} down from one volley. They'll feel that." },
          { if: "slain > 0", say: "{slain} of the {target} down. Every model counts." },
          { say: "Nothing got through that time. Dice are like that." },
        ],
      },
      {
        say: "Shoot with other units if you like, then press ▶ for the Charge phase.",
        point: "▶",
        until: { phase: "charge" },
      },
      {
        say: "A unit can charge an enemy within 12\". Select your Line Troopers and press Charge (2D6): two dice say how far they can go. If nothing is close enough, press ▶.",
        show: { seat: 0, unit: 0 },
        point: "Charge (2D6)",
        until: { any: [{ did: ["charge", "roll:charge"] }, { phase: "fight" }] },
      },
      {
        if: "roll > 0",
        say: "You rolled {roll}\". If the gap to the enemy is no more than that, drag the Line Troopers into contact; the ruler shows how far they've gone. If it's too far, the charge fails: press ▶.",
        until: { any: [{ engaged: true }, { phase: "fight" }] },
        after: [
          { if: "engaged", say: "Contact! Charging units fight first." },
          { say: "Short. Charges fail sometimes; that's the game." },
        ],
      },
      {
        say: "Press ▶ for the Fight phase.",
        point: "▶",
        until: { phase: "fight" },
      },
      {
        if: "engaged",
        say: "Fight phase: press Fight on the Line Troopers' card, pick the unit they're in contact with, press Declare attack and roll.",
        show: { seat: 0, unit: 0 },
        point: "Fight",
        until: { any: [{ did: ["attack:done", "attack/clear", "procedure/clear"] }, { theirTurn: true }] },
        after: [
          { if: "slain > 0", say: "{slain} cut down in the melee." },
          { say: "They held. Combat can drag on into the next turn." },
        ],
      },
      {
        say: "That's your turn. Press ▶ to end it: the red army goes next.",
        point: "▶",
        until: { theirTurn: true },
      },
      {
        say: "Red's turn. Watch it move and shoot. When it shoots you, your saves are yours to roll: press Roll saves in the panel when it comes up.",
        point: "Roll saves",
        until: { any: [{ all: [{ engaged: true }, { phase: "fight", side: "them" }] }, { yourTurn: true }] },
        after: [
          { if: "lost > 0", say: "{lost} of yours down. Time for payback." },
          { say: "Not a scratch on you." },
        ],
      },
      {
        if: "engaged",
        hold: true,
        say: "They charged you! In the Fight phase both sides fight. Select your unit in contact, press Fight, pick them, Declare attack and roll.",
        point: "Fight",
        until: { any: [{ did: ["attack:done", "attack/clear", "procedure/clear"] }, { yourTurn: true }] },
        after: [
          { if: "slain > 0", say: "{slain} of them down. That'll teach them." },
          { say: "Nothing this time, but you stood your ground." },
        ],
      },
      {
        say: "Red finishes its turn.",
        until: { yourTurn: true },
      },
      {
        say: "That's a whole round. The battle runs for five; play on as long as you like, and \"What can I do now?\" at the top of the screen always says what's possible.",
      },
    ],
    done: {
      title: "First turn done",
      ticks: [
        { label: "Moved", did: ["models/move", "normalMove", "advance"] },
        { label: "Shot", did: ["attack:ranged", "shoot"] },
        { label: "Charged", did: ["roll:charge", "charge"] },
        { label: "Fought", did: ["attack:melee", "fight"] },
      ],
    },
  },
];
