// A lesson package for Open Battle's teaching mode: a guided first round of the
// built-in Full Spectrum Dominance game. Plain data (src/teach/lesson.ts).

export const manifest = {
  id: "open-battle.lessons.fsd",
  name: "First game: Full Spectrum Dominance",
  version: "1.0.0",
  author: "Open Battle",
  api: 1,
  kind: "lesson",
  systems: ["fsd"],
  requires: [],
  adds: "A guided first round: activations, moving and firing, against a computer opponent.",
};

export const lessons = [
  {
    id: "first-round",
    title: "Activations",
    system: "fsd",
    summary: "Activate a unit, move and fire, then take turns with the other side.",
    you: 0,
    place: [
      { seat: 0, unit: 1, at: { x: -6, y: 9 } },
      { seat: 1, unit: 1, at: { x: -6, y: -9 } },
    ],
    steps: [
      {
        say: "You command blue at the near edge; the computer plays red. Each round both sides get activation dice. You take turns: one unit each, back and forth, until both sides run out.",
      },
      {
        say: "Your Rifle Squad is selected. Press Activate on its card to spend one of your activation dice on it.",
        show: { seat: 0, unit: 1 },
        until: { did: "activate" },
      },
      {
        say: "An activated unit has two actions. Press Move and drag it, or Fire at an enemy it can see.",
        until: { did: ["move", "fire"] },
      },
      {
        say: "Use its second action if you like, then press End activation at the top.",
        until: { any: [{ did: "turn/endActivation" }, { theirTurn: true }] },
      },
      {
        say: "Red activates one of its units now. If it fires at you, the panel may offer a reaction or ask for a roll.",
        until: { yourTurn: true },
      },
      {
        say: "Your turn again: activate another unit. Keep going until the dice run out; then the round is scored and a new one starts.",
      },
    ],
  },
];
