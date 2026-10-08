var e=`// Rift Lanterns: a small skirmish game of our own, written in the Open Battle
// module workshop. Four warbands scramble for lanterns fallen into a rift.
// Players take turns activating one unit at a time: it moves, then shoots or
// fights. Rules: games/rift-lanterns/README.md. Licence: CC BY 4.0.

export const manifest = {
  id: "open-battle.rift-lanterns",
  name: "Rift Lanterns",
  version: "1.0.0",
  author: "Open Battle contributors",
  api: 1,
  kind: "system",
  systems: ["rift-lanterns"],
  requires: [],
  adds: "A whole small skirmish game: four warbands, three missions and a starter table. CC BY 4.0.",
};

// ---------------------------------------------------------------------------
// The rules as data
// ---------------------------------------------------------------------------

/** What the shared terrain templates count as here. */
const CATEGORIES = {
  Ruin: "ruin",
  "Small ruin": "ruin",
  "Tall ruin": "ruin",
  Woods: "thicket",
  Barricade: "ruin",
  Crater: "ruin",
  Container: "wreck",
  Hill: "open",
};

const system = {
  id: "rift-lanterns",
  name: "Rift Lanterns",
  version: "1.0.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  defaultTable: { width: 36, depth: 24 },
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance" },
    { id: "Shoot", name: "Shoot", of: "model", type: "number" },
    { id: "Range", name: "Range", of: "model", type: "distance" },
    { id: "Fight", name: "Fight", of: "model", type: "number" },
    { id: "Hit", name: "Hits on", of: "model", type: "number" },
    { id: "Save", name: "Saves on", of: "model", type: "number" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  weaponKinds: [],
  terrain: [
    { id: "ruin", name: "Ruin", cover: true },
    { id: "thicket", name: "Thicket", cover: true, visibility: "obscuring" },
    { id: "wreck", name: "Wreck", blocksMovement: true, blocksSight: true },
    { id: "open", name: "Open ground" },
  ],
  unitShape: { kind: "skirmish" },
  rules: [],
  procedures: [],
  actions: [],
  constants: { engagementRange: 1 },
  turn: {
    rounds: 5,
    round: [
      {
        // Players alternate: each activation is one unit moving, then shooting or fighting.
        kind: "alternate",
        id: "activations",
        pool: { kind: "units" },
        activation: [{ kind: "phase", id: "activation", name: "Activation", actions: ["shoot", "fight"] }],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// The warbands
// ---------------------------------------------------------------------------

const FACTIONS = {
  WARDENS: { name: "Wardens of the Wick", color: "#c9a44c" },
  THORNKIN: { name: "Thornkin", color: "#5d8f3e" },
  COGWRIGHTS: { name: "Cogwright Guild", color: "#5f84ad" },
  GLOAM: { name: "Gloam Choir", color: "#8a6bb8" },
};

const RULES = {
  WARDENS: { name: "Shieldwall", text: "Saves against shooting succeed on one less." },
  THORNKIN: { name: "Regrow", text: "At the start of each round, every wounded model heals 1 wound." },
  COGWRIGHTS: {
    name: "Overcharge",
    text: "When this unit shoots it may overcharge: 2 more dice, but each 1 rolled is a wound on the shooters.",
  },
  GLOAM: { name: "Veiled", text: "Can't be shot from more than 12\\" away." },
};

/**
 * A unit of \`count\` models with the same stats. \`look\` is the stand-in
 * figure's shape; the faction gives its colour.
 */
function unit(faction, name, count, mm, look, points, stats, height) {
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: { shape: "round", diameterMm: mm },
    sheet: {
      weapons: {},
      abilities: [{ name: RULES[faction].name, text: RULES[faction].text }],
      keywords: [faction],
      points: points,
    },
    models: Array.from({ length: count }, () => ({
      profile: { name, chars },
      weapons: [],
      look: { shape: look, color: FACTIONS[faction].color },
      ...(height ? { height } : {}),
    })),
  };
}

const army = (faction, units) => ({
  name: FACTIONS[faction].name,
  points: units.reduce((n, u) => n + u.sheet.points, 0),
  units,
  warnings: [],
});

/** One warband per faction, about 100 points each. */
const ARMIES = [
  army("WARDENS", [
    unit("WARDENS", "Wick Guard", 5, 28, "trooper", 50, {
      M: 5,
      Shoot: 1,
      Range: 18,
      Fight: 1,
      Hit: 4,
      Save: 4,
      W: 1,
    }),
    unit("WARDENS", "Lamplighters", 2, 28, "trooper", 25, {
      M: 6,
      Shoot: 2,
      Range: 24,
      Fight: 1,
      Hit: 3,
      Save: 5,
      W: 1,
    }),
    unit("WARDENS", "Warden-Captain", 1, 40, "brute", 25, {
      M: 5,
      Shoot: 1,
      Range: 12,
      Fight: 3,
      Hit: 3,
      Save: 3,
      W: 3,
    }),
  ]),
  army("THORNKIN", [
    unit(
      "THORNKIN",
      "Briar Hounds",
      3,
      40,
      "beast",
      40,
      { M: 8, Shoot: 0, Range: 0, Fight: 2, Hit: 4, Save: 6, W: 2 },
      1.6,
    ),
    unit("THORNKIN", "Thorn Slingers", 4, 28, "trooper", 35, {
      M: 6,
      Shoot: 1,
      Range: 12,
      Fight: 1,
      Hit: 4,
      Save: 6,
      W: 1,
    }),
    unit(
      "THORNKIN",
      "Old Bramble",
      1,
      50,
      "brute",
      25,
      { M: 5, Shoot: 0, Range: 0, Fight: 4, Hit: 3, Save: 4, W: 4 },
      3.2,
    ),
  ]),
  army("COGWRIGHTS", [
    unit("COGWRIGHTS", "Gearmen", 4, 28, "trooper", 40, {
      M: 5,
      Shoot: 1,
      Range: 24,
      Fight: 1,
      Hit: 4,
      Save: 4,
      W: 1,
    }),
    unit(
      "COGWRIGHTS",
      "Spark Drones",
      2,
      32,
      "drone",
      25,
      { M: 8, Shoot: 2, Range: 12, Fight: 0, Hit: 4, Save: 5, W: 1 },
      2.4,
    ),
    unit(
      "COGWRIGHTS",
      "Strider",
      1,
      50,
      "walker",
      35,
      { M: 6, Shoot: 3, Range: 24, Fight: 2, Hit: 4, Save: 3, W: 4 },
      3.4,
    ),
  ]),
  army("GLOAM", [
    unit("GLOAM", "Hushed Choir", 4, 28, "robed", 40, {
      M: 6,
      Shoot: 1,
      Range: 18,
      Fight: 1,
      Hit: 4,
      Save: 5,
      W: 1,
    }),
    unit("GLOAM", "Dusk Stalkers", 3, 28, "trooper", 35, {
      M: 7,
      Shoot: 0,
      Range: 0,
      Fight: 2,
      Hit: 3,
      Save: 5,
      W: 1,
    }),
    unit(
      "GLOAM",
      "Cantor of Ash",
      1,
      32,
      "robed",
      25,
      { M: 6, Shoot: 2, Range: 18, Fight: 1, Hit: 3, Save: 4, W: 3 },
      2.4,
    ),
  ]),
];

// ---------------------------------------------------------------------------
// Helpers on the game state
// ---------------------------------------------------------------------------

const alive = (state, u) => u.modelIds.map((id) => state.models[id]).filter((m) => m && !m.destroyed);
const stat = (model, key) => Number(model.profile?.chars[key]) || 0;
const has = (u, keyword) => (u.sheet?.keywords ?? []).includes(keyword);
const seatOf = (state, player) => state.players[player]?.seat;
const opponents = (state, a, b) => {
  const sa = seatOf(state, a);
  const sb = seatOf(state, b);
  return sa !== undefined && sb !== undefined && sa !== sb;
};

/** Enemy units this one can shoot: seen, in range of a shooter, and not veiled beyond 12". */
function shootable(view, unitId) {
  const state = view.state;
  const me = state.units[unitId];
  const range = Math.max(
    0,
    ...alive(state, me)
      .filter((m) => stat(m, "Shoot") > 0)
      .map((m) => stat(m, "Range")),
  );
  if (!range) return [];
  return Object.values(state.units).filter((u) => {
    if (!opponents(state, me.owner, u.owner) || !alive(state, u).length) return false;
    const d = view.distance(unitId, u.id);
    if (d > range || (has(u, "GLOAM") && d > 12)) return false;
    return view.visible(unitId, u.id);
  });
}

/** Enemy units within 1". */
function inContact(view, unitId) {
  const state = view.state;
  const me = state.units[unitId];
  return Object.values(state.units).filter(
    (u) => opponents(state, me.owner, u.owner) && alive(state, u).length && view.distance(unitId, u.id) <= 1,
  );
}

/** \`hits\` wounds on a unit, model by model, after its saves (\`saveMod\` lowers the score needed). */
function* wound(ctx, target, hits, saveMod, label) {
  if (!hits) return 0;
  const state = ctx.view.state;
  const models = alive(state, target);
  if (!models.length) return 0;
  const save = Math.max(2, stat(models[0], "Save") - saveMod);
  let unsaved = hits;
  if (save <= 6) {
    const roll = yield ctx.roll(\`\${hits}d6\`, \`\${label} saves\`, target.id, save);
    unsaved = roll.rolls.filter((r) => r < save).length;
  }
  let dealt = 0;
  for (const m of models) {
    if (!unsaved) break;
    const left = stat(m, "W") - (m.woundsLost ?? 0);
    const take = Math.min(unsaved, left);
    unsaved -= take;
    dealt += take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed: woundsLost >= stat(m, "W") });
  }
  return dealt;
}

/** Shoot: each model rolls its Shoot dice, hitting on its Hits-on (one more against a target in cover). */
function* shoot(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  const shooters = alive(state, me).filter((m) => stat(m, "Shoot") > 0);
  const cover = ctx.view.inCover(me.id, target.id);
  const need = Math.min(6, Math.max(...shooters.map((m) => stat(m, "Hit"))) + (cover ? 1 : 0));
  let dice = shooters.reduce((n, m) => n + stat(m, "Shoot"), 0);
  let overcharged = false;
  if (has(me, "COGWRIGHTS")) {
    const answer = yield ctx.ask(me.owner, \`Overcharge \${me.name}? 2 more dice, but each 1 wounds them.\`, [
      { id: "yes", label: "Overcharge" },
      { id: "no", label: "Hold steady" },
    ]);
    overcharged = answer === "yes";
    if (overcharged) dice += 2;
  }
  yield ctx.note(\`\${me.name} shoot at \${target.name}\${cover ? " (in cover)" : ""}\`);
  const roll = yield ctx.roll(\`\${dice}d6\`, "hits", me.id, need);
  const hits = roll.rolls.filter((r) => r >= need).length;
  yield* wound(ctx, target, hits, has(target, "WARDENS") ? 1 : 0, target.name);
  if (overcharged) {
    const burns = roll.rolls.filter((r) => r === 1).length;
    if (burns) {
      yield ctx.note(\`\${me.name} burn themselves: \${burns}\`);
      yield* wound(ctx, me, burns, 0, me.name);
    }
  }
  yield ctx.set(\`acted:\${me.id}\`, state.turn.round);
}

/** Fight: the attackers strike with their Fight dice, then whoever is left of the target strikes back. */
function* fight(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  yield ctx.note(\`\${me.name} fight \${target.name}\`);
  const strike = function* (from, to) {
    const fighters = alive(ctx.view.state, from).filter((m) => stat(m, "Fight") > 0);
    if (!fighters.length) return;
    const need = Math.max(...fighters.map((m) => stat(m, "Hit")));
    const dice = fighters.reduce((n, m) => n + stat(m, "Fight"), 0);
    const roll = yield ctx.roll(\`\${dice}d6\`, \`\${from.name} strike\`, from.id, need);
    yield* wound(ctx, to, roll.rolls.filter((r) => r >= need).length, 0, to.name);
  };
  yield* strike(me, target);
  yield* strike(target, me);
  yield ctx.set(\`acted:\${me.id}\`, state.turn.round);
}

const acted = (view, unitId) => view.own[\`acted:\${unitId}\`] === view.round;

// ---------------------------------------------------------------------------
// The table and the missions
// ---------------------------------------------------------------------------

/** Deployment strips \`deep\` inches along the long edges: seat 0 at +y, seat 1 at -y. */
function edgeZones(table, deep) {
  const hx = table.width / 2;
  const hy = table.depth / 2;
  const strip = (seat, y0, y1) => ({
    seat,
    points: [
      { x: -hx, y: y0 },
      { x: hx, y: y0 },
      { x: hx, y: y1 },
      { x: -hx, y: y1 },
    ],
  });
  return [strip(0, hy - deep, hy), strip(1, -hy, -(hy - deep))];
}

/** The seat holding each lantern: the most models within 3", nobody on a tie. */
function holders(state) {
  const out = {};
  for (const o of state.objectives) {
    const count = {};
    for (const m of Object.values(state.models)) {
      if (m.destroyed || !m.unitId) continue;
      if (Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) > 3) continue;
      const seat = seatOf(state, m.owner);
      if (seat === undefined) continue;
      count[seat] = (count[seat] ?? 0) + 1;
    }
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
    out[o.id] = ranked[0] && ranked[0][1] !== ranked[1]?.[1] ? Number(ranked[0][0]) : null;
  }
  return out;
}
const heldBy = (state, seat) =>
  Object.entries(holders(state))
    .filter(([, s]) => s === seat)
    .map(([id]) => id);

/** Enemy units wiped out. */
const fallen = (state, seat) =>
  Object.values(state.units).filter((u) => {
    const s = seatOf(state, u.owner);
    return (
      s !== undefined &&
      s !== seat &&
      u.modelIds.length &&
      u.modelIds.every((id) => state.models[id]?.destroyed)
    );
  });

const plural = (n, one) => \`\${n} \${one}\${n === 1 ? "" : "s"}\`;

const MISSIONS = [
  {
    id: "lantern-grab",
    name: "Lantern Grab",
    summary: "Three lanterns lie across the middle of the rift. Hold them at the end of each round.",
    setup: (table) => ({
      zones: edgeZones(table, 6),
      objectives: [
        { id: "west", position: { x: -table.width / 3, y: 0 } },
        { id: "middle", position: { x: 0, y: 0 } },
        { id: "east", position: { x: table.width / 3, y: 0 } },
      ],
    }),
    scoring: [
      {
        id: "hold",
        name: "Lanterns held",
        at: { roundEnd: true },
        suggest: (game, seat) => {
          const n = heldBy(game, seat).length;
          return { vp: n, why: \`\${plural(n, "lantern")} held\` };
        },
        ask: {
          question: 'How many lanterns do you hold (most models within 3")?',
          answers: [0, 1, 2, 3].map((n) => ({
            label: String(n),
            vp: n,
            why: \`\${plural(n, "lantern")} held\`,
          })),
        },
      },
    ],
  },
  {
    id: "snuff-them-out",
    name: "Snuff Them Out",
    summary:
      "Break the enemy warband. Each enemy unit wiped out is worth 2; holding the middle lantern, 1 a round.",
    setup: (table) => ({
      zones: edgeZones(table, 6),
      objectives: [{ id: "middle", position: { x: 0, y: 0 } }],
    }),
    scoring: [
      {
        id: "middle",
        name: "Middle lantern",
        at: { roundEnd: true },
        suggest: (game, seat) =>
          heldBy(game, seat).length ? { vp: 1, why: "holds the middle lantern" } : null,
        ask: {
          question: "Do you hold the middle lantern?",
          answers: [
            { label: "Yes", vp: 1, why: "holds the middle lantern" },
            { label: "No", vp: 0, why: "doesn't hold it" },
          ],
        },
      },
      {
        id: "broken",
        name: "Units wiped out",
        at: { gameEnd: true },
        suggest: (game, seat) => {
          const n = fallen(game, seat).length;
          return { vp: n * 2, why: \`\${plural(n, "enemy unit")} wiped out\` };
        },
      },
    ],
  },
  {
    id: "last-lantern",
    name: "The Last Lantern",
    summary:
      "One lantern burns in the middle: 2 a round for holding it from round 2. At the end, 2 for each unit in the enemy's deployment zone.",
    setup: (table) => ({
      zones: edgeZones(table, 6),
      objectives: [{ id: "last", position: { x: 0, y: 0 } }],
    }),
    scoring: [
      {
        id: "last",
        name: "The last lantern",
        at: { roundEnd: true },
        suggest: (game, seat) =>
          game.turn.round >= 2 && heldBy(game, seat).length ? { vp: 2, why: "holds the last lantern" } : null,
      },
      {
        id: "deep",
        name: "Deep in their ground",
        at: { gameEnd: true },
        suggest: (game, seat) => {
          // Seat 0's zone is at +y: deep in seat 1's ground is the far -y strip, and the other way round.
          const deep = (y) => (seat === 0 ? y < -game.table.depth / 2 + 6 : y > game.table.depth / 2 - 6);
          const n = Object.values(game.units).filter(
            (u) => seatOf(game, u.owner) === seat && alive(game, u).some((m) => deep(m.position.y)),
          ).length;
          return { vp: n * 2, why: \`\${plural(n, "unit")} in the enemy's ground\` };
        },
      },
    ],
  },
];

/** The starter table: ruins, thickets, a wreck and barricades, the same from both sides. */
function layout(table) {
  const half = [
    { id: "a", template: "Ruin", x: -10, y: 5, facing: 0 },
    { id: "b", template: "Woods", x: 2, y: 6, facing: 0.3 },
    { id: "c", template: "Small ruin", x: 12, y: 3, facing: Math.PI / 2 },
    { id: "d", template: "Barricade", x: -4, y: 2, facing: 0 },
    { id: "e", template: "Container", x: -15, y: -2, facing: 0.5 },
  ];
  const terrain = [];
  for (const { id, template, x, y, facing } of half) {
    terrain.push({ template, id: \`\${id}1\`, position: { x, y }, facing });
    terrain.push({ template, id: \`\${id}2\`, position: { x: -x, y: -y }, facing: facing + Math.PI });
  }
  const first = MISSIONS[0].setup(table);
  return { terrain, objectives: first.objectives, zones: first.zones };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export default {
  module: {
    id: "rift-lanterns",
    version: "1.0.0",
    api: 1,
    system,
    app: {
      sample: (seat) => ARMIES[seat === 1 ? 2 : 0],
      armies: ARMIES,
      layout,
      templateCategory: CATEGORIES,
      missions: MISSIONS,
    },
    actions: [
      {
        id: "shoot",
        name: "Shoot",
        by: "unit",
        phases: ["activations"],
        available: (view, actor) => {
          if (acted(view, actor.unitId)) return "Already acted this round";
          if (inContact(view, actor.unitId).length) return "Locked in a fight";
          return shootable(view, actor.unitId).length ? true : "No enemy in sight and range";
        },
        targets: (view, actor) => shootable(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        run: shoot,
      },
      {
        id: "fight",
        name: "Fight",
        by: "unit",
        phases: ["activations"],
        available: (view, actor) => {
          if (acted(view, actor.unitId)) return "Already acted this round";
          return inContact(view, actor.unitId).length ? true : 'No enemy within 1"';
        },
        targets: (view, actor) => inContact(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        run: fight,
      },
    ],
    procedures: {},
    hooks: {
      // Regrow: Thornkin heal a wound on every wounded model as each round begins.
      roundStart: function* (ctx) {
        const state = ctx.view.state;
        for (const u of Object.values(state.units)) {
          if (!has(u, "THORNKIN")) continue;
          for (const m of alive(state, u))
            if ((m.woundsLost ?? 0) > 0)
              yield ctx.emit({
                type: "model/wounds",
                id: m.id,
                woundsLost: m.woundsLost - 1,
                destroyed: false,
              });
        }
      },
    },
  },
};
`;export{e as default};