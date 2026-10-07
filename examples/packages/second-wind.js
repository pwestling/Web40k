// An example rules package for Open Battle: one invented rule, written as
// code, added to the built-in hand-played Old World system. It is plain
// JavaScript with no imports, so it can be loaded as it is (Rules packages
// → Load a package file). See docs/packages.md for how packages work.

/**
 * The manifest is read as data before any code runs (the consent sheet shows
 * it), so it must be a plain literal: no variables, calls or template
 * expressions.
 */
export const manifest = {
  id: "example.second-wind",
  name: "Second Wind (example)",
  version: "1.0.0",
  author: "Open Battle examples",
  api: 1,
  kind: "extension",
  systems: ["tow"],
  requires: [],
  adds: "Second wind: once per battle, in the Strategy phase, a battered unit may roll a D6 for each fallen model; each 6 gets back up.",
};

const used = (unitId) => `secondWind:${unitId}`;

/**
 * The rule. A code procedure is a generator: it yields commands (roll, ask,
 * note, emit, set) and gets their results back. It must be deterministic:
 * the host replays it from the start to resume after a question, so it may
 * only read the game through `ctx.view` and roll through `ctx.roll`.
 */
function* secondWind(ctx, args) {
  const state = ctx.view.state;
  const unit = state.units[args.unit];
  const fallen = unit.modelIds.filter((id) => state.models[id].destroyed);
  const pick = yield ctx.ask(
    unit.owner,
    `${unit.name} has ${fallen.length} fallen. Catch its second wind now? It works once per battle.`,
    [
      { id: "roll", label: `Roll ${fallen.length}D6: each 6 gets up` },
      { id: "wait", label: "Not yet" },
    ],
  );
  if (pick !== "roll") {
    yield ctx.note(`${unit.name} saves its second wind`);
    return;
  }
  yield ctx.note(`${unit.name} catches its second wind`);
  const roll = yield ctx.roll(`${fallen.length}d6`, "second wind", unit.id, 6);
  const back = roll.rolls.filter((r) => r === 6).length;
  for (const id of fallen.slice(0, back))
    yield ctx.emit({ type: "model/wounds", id, woundsLost: 0, destroyed: false });
  yield ctx.set(used(unit.id), true);
  yield ctx.note(back ? `${back} of ${unit.name} get back up` : `None of ${unit.name} get back up`);
}

export default {
  actions: [
    {
      id: "secondWind",
      name: "Second wind",
      by: "unit",
      phases: ["strategy"],
      // Only units that have lost someone see it.
      applies: (view, actor) =>
        view.state.units[actor.unitId].modelIds.some((id) => view.state.models[id].destroyed),
      available: (view, actor) => {
        const unit = view.state.units[actor.unitId];
        if (view.own[used(unit.id)]) return "Already used this battle";
        if (unit.status && unit.status.fleeing) return "Fleeing units can't";
        if (unit.modelIds.every((id) => view.state.models[id].destroyed)) return "The unit is gone";
        return true;
      },
      run: secondWind,
    },
  ],
};
