var e=`// Rift Lanterns: a small skirmish game of our own, written in the Open Battle
// module workshop. Four warbands scramble for lanterns fallen into a rift.
// Players take turns activating one unit at a time: it moves, then shoots or
// fights. Rules: games/rift-lanterns/README.md. Licence: CC BY 4.0.

export const manifest = {
  id: "open-battle.rift-lanterns",
  name: "Rift Lanterns",
  version: "1.3.2",
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
  version: "1.3.2",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  defaultTable: { width: 36, depth: 24 },
  characteristics: [
    { id: "M", name: "Move", of: "model", type: "distance", format: '{v}"' },
    { id: "Shoot", name: "Shoot", of: "model", type: "number" },
    { id: "Range", name: "Range", of: "model", type: "distance", format: '{v}"' },
    { id: "Fight", name: "Fight", of: "model", type: "number" },
    { id: "Hit", name: "Hits on", of: "model", type: "number", format: "{v}+" },
    { id: "Save", name: "Saves on", of: "model", type: "number", format: "{v}+" },
    { id: "W", name: "Wounds", of: "model", type: "number" },
  ],
  weaponKinds: [],
  // Scored from the mission, shown in the top bar (UX 325).
  resources: [{ id: "VP", name: "Victory points", short: "VP", on: "player", initial: 0 }],
  terrain: [
    { id: "ruin", name: "Ruin", cover: true },
    { id: "thicket", name: "Thicket", cover: true, visibility: "obscuring" },
    // Can't be walked through: the app flags a move whose path goes into or through one.
    { id: "wreck", name: "Wreck", blocksMovement: true, blocksSight: true },
    { id: "open", name: "Open ground" },
  ],
  unitShape: { kind: "skirmish" },
  rules: [],
  procedures: [],
  actions: [],
  constants: { engagementRange: 1 },
  // Advisory, in the Table warnings panel and on the card (UX 326).
  checks: [
    {
      id: "moveDistance",
      name: "Move distance",
      when: { event: "move.end" },
      require: {
        cmp: "<=",
        a: { ref: "event.inchesMoved" },
        b: { op: "+", args: [{ ref: "event.allowed" }, 0.05] },
      },
      message: "Moved further than its Move this round.",
    },
  ],
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
  WARDENS: { name: "Wardens of the Wick", color: "#c9a44c", about: "Shield-bearing lamp guards." },
  THORNKIN: { name: "Thornkin", color: "#5d8f3e", about: "Hounds and walking briars." },
  COGWRIGHTS: { name: "Cogwright Guild", color: "#5f84ad", about: "Gearmen, drones and a strider." },
  GLOAM: { name: "Gloam Choir", color: "#8a6bb8", about: "Robed singers and dusk stalkers." },
};

const RULES = {
  WARDENS: { name: "Shieldwall", mark: "🛡", text: "Saves against shooting succeed on one less." },
  THORNKIN: {
    name: "Regrow",
    mark: "🌿",
    text: "At the start of each round, every wounded model heals 1 wound.",
  },
  COGWRIGHTS: {
    name: "Overcharge",
    mark: "⚙",
    text: "When this unit shoots it may overcharge: 2 more dice, but each 1 rolled is a wound on the shooters.",
  },
  GLOAM: { name: "Veiled", mark: "🌒", text: "Can't be shot from more than 12\\" away." },
};

/** A faction rule as the tray and the log name it when it acts: "🛡 Shieldwall". */
const named = (faction) => \`\${RULES[faction].mark} \${RULES[faction].name}\`;

/**
 * A unit of \`count\` models with the same stats. \`look\` is the stand-in
 * figure's shape, or \`[shape, ...gear]\` for one with add-ons; the faction
 * gives its colour.
 */
function unit(faction, name, count, mm, look, points, stats, height) {
  const [shape, ...gear] = Array.isArray(look) ? look : [look];
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
      look: { shape, color: FACTIONS[faction].color, ...(gear.length ? { gear } : {}) },
      ...(height ? { height } : {}),
    })),
  };
}

const army = (faction, units) => ({
  name: FACTIONS[faction].name,
  about: FACTIONS[faction].about,
  // Its player takes the faction's colour, so figures and bases match.
  color: FACTIONS[faction].color,
  points: units.reduce((n, u) => n + u.sheet.points, 0),
  units,
  warnings: [],
});

/** One warband per faction, about 100 points each. */
const ARMIES = [
  army("WARDENS", [
    unit("WARDENS", "Wick Guard", 5, 28, ["trooper", "shield", "pole"], 50, {
      M: 5,
      Shoot: 1,
      Range: 18,
      Fight: 1,
      Hit: 4,
      Save: 4,
      W: 1,
    }),
    unit("WARDENS", "Lamplighters", 2, 28, ["trooper", "lamp"], 25, {
      M: 6,
      Shoot: 2,
      Range: 24,
      Fight: 1,
      Hit: 3,
      Save: 5,
      W: 1,
    }),
    unit("WARDENS", "Warden-Captain", 1, 40, ["brute", "shield"], 25, {
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
    unit("THORNKIN", "Thorn Slingers", 4, 28, ["trooper", "thorns", "unarmed"], 35, {
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
      "mound",
      25,
      { M: 5, Shoot: 0, Range: 0, Fight: 4, Hit: 3, Save: 4, W: 4 },
      3.2,
    ),
  ]),
  army("COGWRIGHTS", [
    unit("COGWRIGHTS", "Gearmen", 4, 28, ["trooper", "cog"], 40, {
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
    unit("GLOAM", "Dusk Stalkers", 3, 28, ["trooper", "hunched", "blades"], 35, {
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

/** Enemy units still standing. */
const enemies = (state, me) =>
  Object.values(state.units).filter((u) => opponents(state, me.owner, u.owner) && alive(state, u).length);

/** The longest Range among the unit's shooters (0: it can't shoot). */
const reach = (state, me) =>
  Math.max(
    0,
    ...alive(state, me)
      .filter((m) => stat(m, "Shoot") > 0)
      .map((m) => stat(m, "Range")),
  );

/**
 * Enemy units this one can shoot: one shooter both sees it and has it within
 * its own Range (and, \`veil\`, within 12" of a Veiled target).
 * At a real table nothing here is measured: every enemy is offered and the players say (\`told\`).
 */
function shootable(view, unitId, veil = true) {
  const state = view.state;
  const me = state.units[unitId];
  if (view.atTable) return reach(state, me) ? enemies(state, me) : [];
  const shooters = alive(state, me).filter((m) => stat(m, "Shoot") > 0);
  if (!shooters.length) return [];
  return enemies(state, me).filter((u) => {
    const limit = veil && has(u, "GLOAM") ? 12 : Infinity;
    return shooters.some((m) => {
      const d = view.distance(m.id, u.id);
      return d <= Math.min(stat(m, "Range"), limit) && view.visible(m.id, u.id);
    });
  });
}

/**
 * Why this unit can't take an action now, or null: one unit activates at a
 * time, on its side's go, and only once a round (moving counts as its go).
 */
function notItsGo(view, unitId) {
  const state = view.state;
  const me = state.units[unitId];
  if (!me) return "No such unit";
  if (acted(view, unitId)) return "Already acted this round";
  if (seatOf(state, me.owner) !== state.turn.activeSeat) return "Not your go";
  const other = Object.values(state.units).find((u) => u.id !== unitId && u.status?.acting);
  if (other) return \`\${other.name} are activating: end their go first\`;
  if (me.status?.activated && !me.status?.acting) return "Already activated this round";
  return null;
}

/** A model's base radius in inches (a round base, or the longer side of another). */
const baseRadius = (m) => {
  const b = m.base ?? {};
  const mm = b.shape === "round" ? b.diameterMm : Math.max(b.widthMm ?? 0, b.depthMm ?? 0);
  return (mm || 0) / 25.4 / 2;
};

/** Whether the line from \`a\` to \`b\` crosses a terrain piece's footprint (\`margin\` widens it). */
function crosses(piece, a, b, margin = 0) {
  const c = Math.cos(piece.facing ?? 0);
  const s = Math.sin(piece.facing ?? 0);
  const local = (p) => {
    const dx = p.x - piece.position.x;
    const dy = p.y - piece.position.y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  };
  const p = local(a);
  const q = local(b);
  const hw = piece.width / 2 + margin;
  const hd = piece.depth / 2 + margin;
  // Clip the segment to the rectangle (Liang-Barsky): it crosses if anything is left.
  let t0 = 0;
  let t1 = 1;
  for (const [d, from, lo, hi] of [
    [q.x - p.x, p.x, -hw, hw],
    [q.y - p.y, p.y, -hd, hd],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (from < lo || from > hi) return false;
      continue;
    }
    let ta = (lo - from) / d;
    let tb = (hi - from) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * In cover: most of the target's models the shooters can see are in cover
 * terrain or seen past it. One model in a ruin doesn't hide the rest. A
 * thicket between a shooter and a model it sees gives cover whatever the
 * table's line of sight (true line of sight sees through its foliage).
 */
function inCover(view, unitId, target) {
  const state = view.state;
  const shooters = alive(state, state.units[unitId]).filter((m) => stat(m, "Shoot") > 0);
  const thickets = (state.terrain ?? []).filter((p) => p.category === "thicket");
  let seen = 0;
  let covered = 0;
  for (const m of alive(state, target)) {
    const by = shooters.filter((s) => view.visible(s.id, m.id));
    if (!by.length) continue;
    seen++;
    const past = by.some((s) =>
      thickets.some(
        (p) => crosses(p, s.position, m.position) && !crosses(p, s.position, s.position, baseRadius(s)),
      ),
    );
    if (past || view.inCover(unitId, m.id)) covered++;
  }
  return covered * 2 > seen;
}

/** Enemy units within 1" (at a real table: any enemy, and the players say). */
function inContact(view, unitId) {
  const state = view.state;
  const me = state.units[unitId];
  if (view.atTable) return enemies(state, me);
  return Object.values(state.units).filter(
    (u) => opponents(state, me.owner, u.owner) && alive(state, u).length && view.distance(unitId, u.id) <= 1,
  );
}

/**
 * \`hits\` wounds on a unit, model by model, after its saves (\`saveMod\` lowers
 * the score needed; \`why\` names the rule that lowered it). \`saves: false\`
 * takes them straight (Overcharge burns).
 */
function* wound(ctx, target, hits, { saveMod = 0, why = "", saves = true } = {}) {
  if (!hits) {
    if (ctx.view.atTable && saves)
      yield ctx.ask(target.owner, \`\${target.name}: no hits, nothing to take off\`, [
        { id: "done", label: "Done" },
      ]);
    return 0;
  }
  const state = ctx.view.state;
  const models = alive(state, target);
  if (!models.length) return 0;
  const save = Math.max(2, stat(models[0], "Save") - saveMod);
  let unsaved = hits;
  if (saves && save <= 6) {
    // At a real table the phone goes to the defender for their saves (PX print and play).
    if (ctx.view.atTable)
      yield ctx.ask(
        target.owner,
        \`roll \${hits} \${hits === 1 ? "save" : "saves"} for \${target.name} (\${save}+)\`,
        [{ id: "roll", label: "Roll" }],
      );
    const roll = yield ctx.roll(\`\${hits}d6\`, \`saves on \${save}+\${why ? \` (\${why})\` : ""}\`, target.id, save);
    unsaved = roll.rolls.filter((r) => r < save).length;
  }
  let dealt = 0;
  let gone = 0;
  let marked = 0;
  for (const m of models) {
    if (!unsaved) break;
    const left = stat(m, "W") - (m.woundsLost ?? 0);
    const take = Math.min(unsaved, left);
    unsaved -= take;
    dealt += take;
    const woundsLost = (m.woundsLost ?? 0) + take;
    yield ctx.emit({ type: "model/wounds", id: m.id, woundsLost, destroyed: woundsLost >= stat(m, "W") });
    if (woundsLost >= stat(m, "W")) gone++;
    else marked += take;
  }
  // At a real table, what to do with the models: the app can't lift them off.
  if (ctx.view.atTable) {
    const what = gone
      ? \`take \${gone} \${gone === 1 ? "model" : "models"} off the table\`
      : marked
        ? \`mark \${marked} \${marked === 1 ? "wound" : "wounds"}\`
        : "every hit saved, nothing to take off";
    const more =
      gone && marked ? \`, and mark \${marked} \${marked === 1 ? "wound" : "wounds"} on the next\` : "";
    yield ctx.ask(target.owner, \`\${target.name}: \${what}\${more}\`, [{ id: "done", label: "Done" }]);
  }
  return dealt;
}

/** Shoot: each model rolls its Shoot dice, hitting on its Hits-on (one more against a target in cover). */
function* shoot(ctx, args) {
  const state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  const shooters = alive(state, me).filter((m) => stat(m, "Shoot") > 0);
  if (!shooters.length) {
    yield ctx.note(\`\${me.name} have nothing to shoot with\`);
    return;
  }
  const cover = ctx.view.atTable ? !!args.told?.cover : inCover(ctx.view, me.id, target);
  const need = Math.min(6, Math.max(...shooters.map((m) => stat(m, "Hit"))) + (cover ? 1 : 0));
  let dice = shooters.reduce((n, m) => n + stat(m, "Shoot"), 0);
  let overcharged = false;
  if (has(me, "COGWRIGHTS")) {
    const answer = yield ctx.ask(
      me.owner,
      \`\${named("COGWRIGHTS")}: \${me.name} take 2 more dice, but each 1 rolled burns one of them.\`,
      [
        { id: "yes", label: "Overcharge" },
        { id: "no", label: "Hold steady" },
      ],
    );
    overcharged = answer === "yes";
    if (overcharged) {
      dice += 2;
      yield ctx.note(\`\${named("COGWRIGHTS")}: \${me.name} push their engines past safe\`);
    }
  }
  yield ctx.note(\`\${me.name} shoot at \${target.name}\${cover ? " (in cover)" : ""}\`);
  const roll = yield ctx.roll(\`\${dice}d6\`, \`hits on \${need}+\${cover ? " (cover)" : ""}\`, me.id, need);
  const hits = roll.rolls.filter((r) => r >= need).length;
  const wall = has(target, "WARDENS");
  if (wall && hits) yield ctx.note(\`\${named("WARDENS")}: \${target.name} lock shields\`);
  yield* wound(ctx, target, hits, wall ? { saveMod: 1, why: named("WARDENS") } : {});
  if (overcharged) {
    const burns = roll.rolls.filter((r) => r === 1).length;
    if (burns) {
      const lost = yield* wound(ctx, me, burns, { saves: false });
      yield ctx.note(
        \`\${named("COGWRIGHTS")} burns: \${lost} \${lost === 1 ? "wound" : "wounds"} on the \${me.name}\`,
      );
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
    const roll = yield ctx.roll(\`\${dice}d6\`, \`hits on \${need}+ in the fight\`, from.id, need);
    yield* wound(ctx, to, roll.rolls.filter((r) => r >= need).length);
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

/** The seat holding each lantern: the most models within 3" (measured from the base's edge, as every distance here is), nobody on a tie. */
function holders(state) {
  const out = {};
  for (const o of state.objectives) {
    const count = {};
    for (const m of Object.values(state.models)) {
      if (m.destroyed || !m.unitId) continue;
      if (Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) - baseRadius(m) > 3) continue;
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
    summary:
      "Three lanterns lie across the middle of the rift. At the end of each round, each side scores 1 for each lantern it holds.",
    setup: (table) => ({
      zones: edgeZones(table, 6),
      objectives: [
        { id: "west", position: { x: -table.width / 3, y: 0 }, label: "West lantern", look: "lantern" },
        { id: "middle", position: { x: 0, y: 0 }, label: "Middle lantern", look: "lantern" },
        { id: "east", position: { x: table.width / 3, y: 0 }, label: "East lantern", look: "lantern" },
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
      "Break the enemy warband. One lantern in the middle: holding it at the end of a round scores 1. At the end of the game, each enemy unit wiped out scores 2.",
    setup: (table) => ({
      zones: edgeZones(table, 6),
      objectives: [{ id: "middle", position: { x: 0, y: 0 }, label: "Middle lantern", look: "lantern" }],
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
        // Counted from the wounds, not the table: a real table scores it as it stands.
        measures: false,
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
      "One lantern burns in the middle: from round 2, holding it at the end of a round scores 2. At the end of the game, each of your units with a model in the enemy's deployment strip scores 2.",
    setup: (table) => ({
      zones: edgeZones(table, 6),
      objectives: [{ id: "last", position: { x: 0, y: 0 }, label: "The last lantern", look: "lantern" }],
    }),
    scoring: [
      {
        id: "last",
        name: "The last lantern",
        at: { roundEnd: true, fromRound: 2 },
        suggest: (game, seat) =>
          game.turn.round >= 2 && heldBy(game, seat).length ? { vp: 2, why: "holds the last lantern" } : null,
        ask: {
          question: 'Do you hold the last lantern (most models within 3")? It scores from round 2.',
          answers: [
            { label: "Yes", vp: 2, why: "holds the last lantern" },
            { label: "No", vp: 0, why: "doesn't hold it" },
          ],
        },
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
        ask: {
          question: "How many of your units have a model in the enemy's deployment strip?",
          answers: [0, 1, 2, 3].map((n) => ({
            label: String(n),
            vp: n * 2,
            why: \`\${plural(n, "unit")} in the enemy's ground\`,
          })),
        },
      },
    ],
  },
];

/** The starter table: ruins, thickets, a wreck and barricades, the same from both sides. */
function layout(table) {
  const half = [
    // Spaced so each deployment strip has open lanes to shoot down (Rift Lanterns playtest).
    { id: "a", template: "Ruin", x: -12.5, y: 4.5, facing: 0 },
    { id: "b", template: "Woods", x: 4.5, y: 5.5, facing: 0 },
    { id: "c", template: "Small ruin", x: 14.5, y: 4, facing: Math.PI / 2 },
    { id: "d", template: "Barricade", x: -4.5, y: 5.5, facing: 0 },
    { id: "e", template: "Container", x: 10, y: 3.5, facing: Math.PI / 2 },
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
// The rules in words
// ---------------------------------------------------------------------------

/**
 * The rulebook's words (#47). The app's rules page, the docs (RULES.md) and
 * the print-and-play rules sheet put these round tables made from the data
 * above (warbands, units, missions, the starter table), so the rules a player
 * reads are the rules the game plays.
 */
const RULEBOOK = {
  intro:
    "A small skirmish game for two players, about an hour long, played with three units a side. Lanterns have fallen into a rift, and four warbands go down after them.",
  sections: [
    {
      id: "need",
      title: "What you need",
      text: [
        'A table 36" x 24" (a kitchen table will do), a tape measure in inches, a handful of six-sided dice, and a warband each: your own models, or the stand-ins from the print-and-play sheets. Put some ruins, thickets and wrecks on the table: books and boxes work.',
        "On a screen, Open Battle does the measuring and the dice. At a real table it can still keep the score: open it on a phone and pick **At a real table**.",
      ].join("\\n\\n"),
    },
    {
      id: "turn",
      title: "The turn",
      text: [
        "The game lasts **5 rounds**. In each round, players take turns activating one unit at a time, starting with the player who goes first, until every unit has gone. An activated unit:",
        "1. **Moves** up to its Move in inches. Wrecks can't be walked through.",
        "2. Then takes **one action**: **Shoot** or **Fight**. That ends its activation.",
        "3. A unit that only moves ends its activation there.",
        "When one player has no units left to activate, the other activates theirs in turn. The round ends when every unit has gone.",
      ].join("\\n"),
    },
    {
      id: "shooting",
      title: "Shooting",
      text: [
        "Pick an enemy unit that a shooter can see and that is within the shooter's Range. A unit locked in a fight (an enemy within 1\\") can't shoot.",
        "- Each model rolls its **Shoot** dice. Each die that rolls the unit's **Hits on** number or higher (4+ means a 4, 5 or 6) is a hit; it needs **one more** (5+ for a 4+) if the target is in cover: when most of the target models the shooters can see are in or touching a ruin or thicket, or seen past one.",
        "- The target rolls a die for each hit. Each die that rolls the target's **Saves on** number or higher saves that hit.",
        "- Each hit not saved takes 1 wound. Models lose wounds in turn; a model with none left is out.",
      ].join("\\n"),
    },
    {
      id: "fighting",
      title: "Fighting",
      text: 'Pick an enemy unit within 1". The attackers roll their **Fight** dice and hit and wound as when shooting (no cover in a fight). Then, if any of the target are left, they strike back the same way.',
    },
    {
      id: "lanterns",
      title: "Holding a lantern",
      text: 'A side **holds** a lantern if it has more models within 3" of it than the other side. Nobody holds it on a tie. The side with more victory points at the end of round 5 wins.',
    },
  ],
  /** The quick-reference card, a line each. */
  quickRef: [
    "**5 rounds.** Take turns activating one unit each.",
    "**Activate:** move up to Move, then Shoot or Fight (or just move).",
    '**Shoot:** see it, in Range, no enemy within 1". Shoot dice; each at the Hits on number or higher hits (one more in cover).',
    '**Fight:** an enemy within 1". Fight dice; each at the Hits on number or higher hits; they strike back.',
    "**Saves:** a die per hit; each at the Saves on number or higher saves it. Each unsaved hit is a wound.",
    '**Lanterns:** most models within 3" holds it; a tie holds nothing.',
  ],
};

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export default {
  module: {
    id: "rift-lanterns",
    version: "1.3.2",
    api: 1,
    system,
    app: {
      sample: (seat) => ARMIES[seat === 1 ? 2 : 0],
      armies: ARMIES,
      layout,
      templateCategory: CATEGORIES,
      missions: MISSIONS,
      rulebook: RULEBOOK,
    },
    actions: [
      {
        id: "shoot",
        name: "Shoot",
        by: "unit",
        phases: ["activations"],
        available: (view, actor) => {
          const why = notItsGo(view, actor.unitId);
          if (why) return why;
          if (view.atTable) return reach(view.state, view.state.units[actor.unitId]) ? true : "Can't shoot";
          if (inContact(view, actor.unitId).length) return "Locked in a fight";
          if (shootable(view, actor.unitId).length) return true;
          // Something would be in reach but for the dusk: say which rule hides it.
          if (shootable(view, actor.unitId, false).length)
            return \`\${named("GLOAM")}: the Gloam can't be shot from more than 12" away\`;
          return "No enemy in sight and range";
        },
        targets: (view, actor) => shootable(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        // At a real table the players say what the board would measure.
        told: (view, actor, targetId) => {
          const me = view.state.units[actor.unitId];
          const target = view.state.units[targetId];
          if (!me || !target) return [];
          return [
            { id: "clear", question: \`No enemy within 1" of \${me.name}\`, need: true },
            {
              id: "seen",
              question: \`A shooter can see \${target.name}, within \${reach(view.state, me)}"\`,
              need: true,
            },
            ...(has(target, "GLOAM")
              ? [{ id: "near", question: \`\${named("GLOAM")}: \${target.name} within 12"\`, need: true }]
              : []),
            {
              id: "cover",
              question: \`In cover: most of \${target.name} in or touching a ruin or thicket, or seen past one (hits need one more)\`,
            },
          ];
        },
        run: shoot,
      },
      {
        id: "fight",
        name: "Fight",
        by: "unit",
        phases: ["activations"],
        available: (view, actor) => {
          const why = notItsGo(view, actor.unitId);
          if (why) return why;
          return inContact(view, actor.unitId).length ? true : 'No enemy within 1"';
        },
        targets: (view, actor) => inContact(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        told: (view, actor, targetId) => {
          const target = view.state.units[targetId];
          return target ? [{ id: "contact", question: \`\${target.name} within 1"\`, need: true }] : [];
        },
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
          const hurt = alive(state, u).filter((m) => (m.woundsLost ?? 0) > 0);
          if (!hurt.length) continue;
          yield ctx.note(\`\${named("THORNKIN")}: \${u.name} knit back together (\${hurt.length} healed)\`);
          for (const m of hurt)
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