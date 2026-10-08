// A lesson package for Open Battle's teaching mode: a guided first round of the
// built-in Conquest game (played by hand). Plain data (src/teach/lesson.ts).

export const manifest = {
  id: "open-battle.lessons.conquest",
  name: "First game: Conquest",
  version: "1.0.0",
  author: "Open Battle",
  api: 1,
  kind: "lesson",
  systems: ["conquest"],
  requires: [],
  adds: "A guided first round: the command stack, drawing cards and activating regiments, against a computer opponent.",
};

export const lessons = [
  {
    id: "first-round",
    title: "The command stack",
    system: "conquest",
    summary: "Order your stack, draw a card and activate a regiment, then trade turns.",
    you: 0,
    steps: [
      {
        say: "You command blue at the near edge; the computer plays red. Each round you secretly put your regiments in order: your command stack. Then the sides take turns drawing the top card and activating that regiment.",
      },
      {
        say: "Open Command stack on the left, use the arrows to put your regiments in the order you want them to act, and press Lock in stack. Then press ▶ for the Action phase.",
        until: { any: [{ did: "secret/commit" }, { phase: "actions" }] },
      },
      {
        say: "Press ▶ when your stack is locked in.",
        until: { phase: "actions" },
      },
      {
        say: "Press Draw in the Command stack to turn up your top card, then press Activate on that regiment's card.",
        until: { did: "activate" },
      },
      {
        say: "The regiment has two actions. March forwards, or Volley or Clash if an enemy is in reach.",
        until: { did: ["march", "volley", "clash", "charge"] },
      },
      {
        say: "Take its second action if you like, then press End activation at the top.",
        until: { any: [{ did: "turn/endActivation" }, { theirTurn: true }] },
      },
      {
        say: "Red draws its top card and activates that regiment now.",
        until: { yourTurn: true },
      },
      {
        say: "Your turn again: draw your next card. When every regiment has gone, the round ends and you build a new stack.",
      },
    ],
  },
];
