// A starter game for the module workshop: rank-and-flank regiments that move
// as blocks with a facing (wheel, reform, turn, march). Each player in turn
// moves, then the blocks in contact clash. Change anything: the workshop
// reloads it onto the test table every time you save (Ctrl+S).
//
// Everything a package can use is in the SDK tab, on the right; in the editor,
// type ctx. or view. for suggestions.

export const manifest = {
  id: "me.my-ranked", // change "me" to your name: it must stay the same across versions
  name: "My rank-and-flank game",
  version: "0.1.0",
  author: "Me",
  api: 1,
  kind: "system",
  systems: ["my-ranked"],
  requires: [],
  adds: "A whole small game: regiments in blocks; the front rank strikes, rear ranks add a bonus.",
};

/** The rules as data: characteristics, dice and the turn (the SDK tab lists the keys). */
const system = {
  id: "my-ranked",
  name: "My rank-and-flank game",
  version: "0.1.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "Hit", name: "Hits on", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  // Arcs from a block's facing: what is in front, on a flank or behind it.
  arcs: [
    { id: "front", name: "Front", from: -45, to: 45, origin: "baseCorners" },
    { id: "rightFlank", name: "Right flank", from: 45, to: 135, origin: "baseCorners" },
    { id: "rear", name: "Rear", from: 135, to: 225, origin: "baseCorners" },
    { id: "leftFlank", name: "Left flank", from: 225, to: 315, origin: "baseCorners" },
  ],
  weaponKinds: ["melee"],
  terrain: [],
  unitShape: { kind: "ranked", minFiles: 4, manoeuvres: ["wheel", "reform", "turn", "march"] },
  rules: [],
  procedures: [],
  actions: [],
  turn: {
    rounds: 4,
    round: [
      {
        kind: "playerTurns",
        segments: [
          { kind: "phase", id: "move", name: "Move" },
          { kind: "phase", id: "clash", name: "Clash" },
        ],
      },
    ],
  },
};

/** A regiment of `count` models with the same stats, `files` wide. */
function unit(name, count, stats, files = 5) {
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: { shape: "rect", widthMm: 25, depthMm: 25 },
    files,
    sheet: { weapons: {}, abilities: [], keywords: [], points: count * 10 },
    models: Array.from({ length: count }, () => ({ profile: { name, chars }, weapons: [] })),
  };
}

/** One regiment a side for the test table. */
const samples = [
  { name: "Red host", units: [unit("Red spears", 15, { M: 4, A: 1, Hit: 4, W: 1 })], warnings: [] },
  { name: "Blue host", units: [unit("Blue swords", 12, { M: 4, A: 1, Hit: 3, W: 1 }, 4)], warnings: [] },
];

const alive = (state, u) => u.modelIds.map((id) => state.models[id]).filter((m) => !m.destroyed);
const stat = (model, key) => Number(model.profile.chars[key]) || 0;

/** Enemy units within 1" of this one. */
function inReach(view, unitId) {
  const me = view.state.units[unitId];
  return Object.values(view.state.units).filter(
    (u) => u.owner !== me.owner && alive(view.state, u).length && view.distance(unitId, u.id) <= 1,
  );
}

/** Clash: the front rank rolls its Attacks, plus a die for each full rank behind it (up to 2). */
function* fight(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  const left = alive(state, me);
  const files = me.formation?.files ?? 5;
  const front = left.slice(0, files);
  const ranks = Math.min(2, Math.floor(left.length / files) - 1);
  const need = Math.max(...front.map((m) => stat(m, "Hit")));
  const dice = front.reduce((n, m) => n + stat(m, "A"), 0) + Math.max(0, ranks);
  yield ctx.note(`${me.name} clash with ${target.name}`);
  const roll = yield ctx.roll(`${dice}d6`, "hits", me.id, need);
  let wounds = roll.rolls.filter((r) => r >= need).length;
  for (const m of alive(state, target)) {
    if (!wounds) break;
    const take = Math.min(wounds, stat(m, "W") - (m.woundsLost ?? 0));
    wounds -= take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed: woundsLost >= stat(m, "W") });
  }
  yield ctx.set(`fought:${me.id}`, state.turn.round);
}

export default {
  module: {
    id: "my-ranked",
    version: "0.1.0",
    api: 1,
    system,
    app: {
      sample: (seat) => samples[seat],
      layout: () => ({ terrain: [], objectives: [], zones: [] }),
    },
    actions: [
      {
        id: "clash",
        name: "Clash",
        by: "unit",
        phases: ["clash"],
        available: (view, actor) => {
          if (view.own[`fought:${actor.unitId}`] === view.round) return "Already fought this round";
          return inReach(view, actor.unitId).length ? true : 'No enemy within 1"';
        },
        targets: (view, actor) => inReach(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        run: fight,
      },
    ],
    procedures: {},
    hooks: {},
  },
};
