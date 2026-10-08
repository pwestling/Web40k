// An example campaign rules package for Open Battle (roadmap 24b): invented,
// generic rules for any campaign book, written as code. After each campaign
// game, units earn experience, veterans earn an honour, and units that were
// wiped out may carry a scar. Before the next game, the table is told who is
// carrying what. Plain JavaScript with no imports; see docs/packages.md.

export const manifest = {
  id: "example.battle-scars",
  name: "Battle Scars (example campaign rules)",
  version: "1.0.0",
  author: "Open Battle examples",
  api: 1,
  kind: "extension",
  systems: ["forty-k", "tow", "conquest-hand", "fsd"],
  requires: [],
  adds: "Campaign rules: experience after each game (1 for surviving, 1 for taking enemies down), Veteran at 3, and a D6 for a scar when a unit is wiped out.",
};

const SCARS = ["Shaken", "Old wound", "Grudge"];

/**
 * After the battle: `args.units` is every campaign unit on the table, with
 * this game's `slain` and `survived` and its story so far. Awards are events
 * the campaign book reads when it records the game.
 */
function* afterGame(ctx, args) {
  for (const u of args.units) {
    const xp = (u.survived ? 1 : 0) + (u.slain > 0 ? 1 : 0);
    if (xp) yield ctx.emit({ type: "campaign/award", key: u.key, unitId: u.unitId, xp });
    if (u.xp < 3 && u.xp + xp >= 3 && !u.honours.includes("Veteran"))
      yield ctx.emit({ type: "campaign/award", key: u.key, unitId: u.unitId, honour: "Veteran" });
    if (!u.survived) {
      const roll = yield ctx.roll("1d6", `scar check: ${u.name}`, u.unitId);
      const d = roll.rolls[0];
      if (d <= 2) {
        const scar = SCARS[(d + u.games) % SCARS.length];
        yield ctx.emit({ type: "campaign/award", key: u.key, unitId: u.unitId, scar });
      }
    }
  }
  yield ctx.note("The campaign book has the experience, honours and scars");
}

/** Before the battle: say who is carrying scars and honours into it. */
function* beforeGame(ctx, args) {
  for (const u of args.units) {
    if (u.scars) yield ctx.note(`${u.name} carries scars: ${u.scars}`);
    if (u.honours) yield ctx.note(`${u.name} fights with honours: ${u.honours}`);
  }
}

export default { hooks: { afterGame, beforeGame } };
