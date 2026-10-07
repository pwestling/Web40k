// An example whole-game rules package for Open Battle: "Arena", a tiny
// invented skirmish game. It brings its own rules data, sample warbands, a
// table layout, one rule written as code, one turn hook, its own army list
// reader and a side panel. Load it from the
// lobby (Load package…); once it's trusted it shows in the Game list. See
// docs/packages.md for how packages work.

export const manifest = {
  id: "example.arena",
  name: "Arena (example game)",
  version: "1.0.0",
  author: "Open Battle examples",
  api: 1,
  kind: "system",
  systems: ["arena"],
  requires: [],
  adds: "A whole small game: two warbands, move then fight, each hit takes a wound.",
};

/** The rules as data, in the engine's schema (src/core/content/schema.ts). */
const system = {
  id: "arena",
  name: "Arena",
  version: "1.0.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "A", name: "Attacks", of: "model", type: "number" },
    { id: "Hit", name: "Hits on", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  weaponKinds: ["melee"],
  terrain: [
    { id: "pillar", name: "Pillar", blocksMovement: true, blocksSight: true, visibility: "blocking" },
  ],
  unitShape: { kind: "skirmish" },
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
          { kind: "phase", id: "fight", name: "Fight" },
        ],
      },
    ],
  },
};

const BASE = { shape: "round", diameterMm: 32 };

function warband(name, count, stats) {
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: BASE,
    sheet: { weapons: {}, abilities: [], keywords: [], points: count * 10 },
    models: Array.from({ length: count }, () => ({ profile: { name, chars }, weapons: [] })),
  };
}

const samples = [
  {
    name: "Red gladiators",
    units: [
      warband("Net fighters", 4, { M: 6, A: 2, Hit: 4, W: 1 }),
      warband("Champion", 1, { M: 5, A: 4, Hit: 3, W: 3 }),
    ],
    warnings: [],
  },
  {
    name: "Blue gladiators",
    units: [
      warband("Spear fighters", 5, { M: 5, A: 1, Hit: 3, W: 1 }),
      warband("Brute", 1, { M: 4, A: 3, Hit: 4, W: 4 }),
    ],
    warnings: [],
  },
];

/** Two broken pillars either side of the centre, and each warband's gate: the 8" at its end of the arena. */
function arenaLayout(width, depth) {
  const pillar = (id, x, y) => ({
    id,
    name: "Pillar",
    category: "pillar",
    position: { x, y },
    width: 3,
    depth: 3,
    facing: 0,
    solids: [{ kind: "block", x: 0, y: 0, z: 0, w: 3, d: 3, h: 5 }],
  });
  const hx = width / 2;
  const hy = depth / 2;
  const gate = (seat, y0, y1) => ({
    seat,
    points: [
      { x: -hx, y: y0 },
      { x: hx, y: y0 },
      { x: hx, y: y1 },
      { x: -hx, y: y1 },
    ],
  });
  return {
    terrain: [pillar("p1", -8, 3), pillar("p2", 8, -3)],
    objectives: [],
    zones: [gate(0, hy - 8, hy), gate(1, -hy, -(hy - 8))],
  };
}

const alive = (state, unit) => unit.modelIds.map((id) => state.models[id]).filter((m) => !m.destroyed);
const stat = (model, key) => Number(model.profile.chars[key]) || 0;

/** Strike: every model rolls its Attacks; each roll of its Hits-on or more is a wound, taken by the target in order. */
function* strike(ctx, args) {
  const state = ctx.view.state;
  const unit = state.units[args.unit];
  const target = state.units[args.target];
  const strikers = alive(state, unit);
  const need = Math.max(...strikers.map((m) => stat(m, "Hit")));
  const dice = strikers.reduce((n, m) => n + stat(m, "A"), 0);
  yield ctx.note(`${unit.name} strike ${target.name}`);
  const roll = yield ctx.roll(`${dice}d6`, "strike", unit.id, need);
  let wounds = roll.rolls.filter((r) => r >= need).length;
  let lost = 0;
  for (const m of alive(state, target)) {
    if (!wounds) break;
    const take = Math.min(wounds, stat(m, "W") - (m.woundsLost ?? 0));
    wounds -= take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    const destroyed = woundsLost >= stat(m, "W");
    if (destroyed) lost++;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed });
  }
  yield ctx.set(`struck:${unit.id}`, state.turn.round);
  yield ctx.note(lost ? `${lost} of ${target.name} fall` : `${target.name} stand firm`);
}

/** Enemy units within 1" of this one. */
function inReach(view, unitId) {
  const me = view.state.units[unitId];
  return Object.values(view.state.units).filter(
    (u) => u.owner !== me.owner && alive(view.state, u).length && view.distance(unitId, u.id) <= 1,
  );
}

const module = {
  id: "arena",
  version: "1.0.0",
  api: 1,
  system,
  app: {
    sample: (seat) => samples[seat],
    layout: (table) => arenaLayout(table.width, table.depth),
    // Army lists: a JSON file like {"name": "My gladiators", "units": [{"name": "Brute", "count": 1, "M": 4, "A": 3, "Hit": 4, "W": 4}]}.
    importRoster: (fileName, data) => {
      const list = JSON.parse(new TextDecoder().decode(data));
      const units = (list.units ?? []).map((u) =>
        warband(String(u.name), Number(u.count) || 1, {
          M: u.M ?? 5,
          A: u.A ?? 1,
          Hit: u.Hit ?? 4,
          W: u.W ?? 1,
        }),
      );
      return {
        name: String(list.name ?? fileName),
        units,
        warnings: units.length ? [] : ["No units in this list"],
      };
    },
    // A panel of its own: the crowd's score, and a taunt any player can shout.
    sidePanel: (view) => {
      const fallen = {};
      for (const u of Object.values(view.state.units))
        fallen[u.owner] =
          (fallen[u.owner] ?? 0) + u.modelIds.filter((id) => view.state.models[id].destroyed).length;
      const lines = Object.values(view.state.players).map((p) => `${p.name}: ${fallen[p.id] ?? 0} fallen`);
      return {
        title: `Arena, round ${view.round || "–"}`,
        lines,
        buttons: [
          {
            label: "Taunt",
            procedure: "taunt",
            disabled: view.round ? undefined : "The games haven't begun",
          },
        ],
      };
    },
  },
  actions: [
    {
      id: "strike",
      name: "Strike",
      by: "unit",
      phases: ["fight"],
      available: (view, actor) => {
        if (view.own[`struck:${actor.unitId}`] === view.round) return "Already struck this round";
        if (!alive(view.state, view.state.units[actor.unitId]).length) return "Nobody left";
        return inReach(view, actor.unitId).length ? true : 'No enemy within 1"';
      },
      targets: (view, actor) => inReach(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
      run: strike,
    },
  ],
  procedures: {
    taunt: function* (ctx) {
      yield ctx.note("A taunt echoes round the arena");
    },
  },
  hooks: {
    roundStart: function* (ctx, args) {
      yield ctx.note(`Round ${args.round}: the crowd roars`);
    },
  },
};

export default { module };
