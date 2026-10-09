var e=`// Brinewatch: a skirmish game of our own, written in the Open Battle module
// workshop. Crews of five to ten scavenge a drowned harbour town at low
// tide, climbing its broken towers. Players take turns activating one model
// at a time: each has 2 action points to move, shoot, fight or stand guard.
// Rules: games/brinewatch/README.md. Licence: CC BY 4.0.

export const manifest = {
  id: "open-battle.brinewatch",
  name: "Brinewatch",
  version: "1.0.0",
  author: "Open Battle contributors",
  api: 1,
  kind: "system",
  systems: ["brinewatch"],
  requires: [],
  adds: "A whole skirmish game: model-by-model activations with action points, guards, hidden lurkers, three crews, three missions and a three-game campaign. CC BY 4.0.",
};

// ---------------------------------------------------------------------------
// The rules as data
// ---------------------------------------------------------------------------

/** Action points each model has for its go. */
const AP = 2;
/** How much higher a shooter must stand than its target to have vantage. */
const VANTAGE = 2;
/** The game lasts this many rounds. */
const ROUNDS = 4;

/** What the shared terrain templates count as here. */
const CATEGORIES = {
  Ruin: "ruin",
  "Small ruin": "ruin",
  "Tall ruin": "ruin",
  Woods: "reeds",
  Barricade: "ruin",
  Crater: "ruin",
  Container: "hulk",
  Hill: "open",
};

const system = {
  id: "brinewatch",
  name: "Brinewatch",
  version: "1.0.0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  defaultTable: { width: 30, depth: 22 },
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
  resources: [{ id: "VP", name: "Victory points", short: "VP", on: "player", initial: 0 }],
  terrain: [
    { id: "ruin", name: "Ruin", cover: true },
    // Reeds hide what is past them: shots through them are Obscured (the module checks the line).
    { id: "reeds", name: "Reed bed", cover: true },
    { id: "hulk", name: "Hulk", blocksMovement: true, blocksSight: true },
    { id: "open", name: "Open ground" },
  ],
  statuses: [
    {
      id: "guard",
      name: "On guard",
      on: "unit",
      hint: "Shoots the first enemy that ends a move, or goes to shoot or fight, in its sight and range.",
    },
    { id: "hidden", name: "Hidden", on: "unit", hint: "A lurker in its secret hideout, until it emerges." },
  ],
  // A guard lasts until it fires or the round ends.
  resets: [
    { at: "round", flags: ["guard"] },
    { at: "activation", flags: ["shot", "fought"] },
  ],
  unitShape: { kind: "skirmish" },
  rules: [],
  procedures: [],
  actions: [],
  constants: { engagementRange: 1, actionPoints: AP },
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
      message: "Moved further than its action points allow (Move for each point not spent on an action).",
    },
  ],
  turn: {
    rounds: ROUNDS,
    round: [
      {
        // Players alternate model by model; each go has 2 action points.
        kind: "alternate",
        id: "activations",
        pool: { kind: "units" },
        actionsPerActivation: { ref: "const.actionPoints" },
        activation: [
          {
            kind: "phase",
            id: "activation",
            name: "Activation",
            actions: [],
            hint: "Activate one ready model: 2 action points to move, shoot, fight or stand guard.",
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// The crews
// ---------------------------------------------------------------------------

const FACTIONS = {
  TOLL: {
    name: "Tollkeepers",
    color: "#b8863b",
    about: "Harbour wardens with long guns, holding the watchtowers.",
  },
  GULL: { name: "Gullrunners", color: "#3f8f8a", about: "Quick smugglers with hooks and knives." },
  DEEP: { name: "Deepkin", color: "#7b5aa6", about: "A shell-backed choir that walks up out of the water." },
};

const RULES = {
  TOLL: {
    name: "Steady Watch",
    mark: "🔭",
    text: "Their guard shots hit as normal shots do (no snap penalty).",
  },
  GULL: { name: "Slippery", mark: "🪝", text: "Guard shots at them need one more to hit." },
  DEEP: {
    name: "Undertow",
    mark: "🐚",
    text: "A Deepkin model that takes an enemy out in a fight gets 1 action point back.",
  },
};

/** Model abilities by keyword, with their words for the card. */
const ABILITIES = {
  LEADER: { name: "Leader", text: "The crew's leader. Some missions score for taking it out." },
  SNIPER: { name: "Long Eye", text: "With vantage, its shots hit on one less." },
  LURKER: {
    name: "Lurker",
    text: "Hides in a secret hideout at the start of the battle, and emerges there when it acts.",
  },
};

/** A faction rule as the log names it: "🔭 Steady Watch". */
const named = (faction) => \`\${RULES[faction].mark} \${RULES[faction].name}\`;

/**
 * One model (a unit of one): \`look\` is its stand-in figure's shape, or
 * \`[shape, ...gear]\`; \`kinds\` its keywords besides the faction.
 */
function model(faction, name, role, look, points, stats, kinds = [], height) {
  const [shape, ...gear] = Array.isArray(look) ? look : [look];
  const chars = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]));
  return {
    name,
    base: { shape: "round", diameterMm: kinds.includes("LEADER") ? 32 : 28 },
    sheet: {
      weapons: {},
      abilities: [
        { name: RULES[faction].name, text: RULES[faction].text },
        ...kinds.map((k) => ABILITIES[k]),
      ],
      keywords: [faction, ...kinds],
      points,
    },
    models: [
      {
        profile: { name: role, chars },
        weapons: [],
        look: { shape, color: FACTIONS[faction].color, ...(gear.length ? { gear } : {}) },
        ...(height ? { height } : {}),
      },
    ],
  };
}

const crew = (faction, models) => ({
  name: FACTIONS[faction].name,
  about: FACTIONS[faction].about,
  color: FACTIONS[faction].color,
  points: models.reduce((n, u) => n + u.sheet.points, 0),
  units: models,
  warnings: [],
});

const WARDEN = { M: 6, Shoot: 2, Range: 20, Fight: 2, Hit: 4, Save: 4, W: 3 };
const LONG_GUN = { M: 5, Shoot: 2, Range: 30, Fight: 1, Hit: 3, Save: 5, W: 2 };
const CUTTER = { M: 7, Shoot: 1, Range: 8, Fight: 3, Hit: 4, Save: 5, W: 2 };
const HOOKSHOT = { M: 6, Shoot: 3, Range: 18, Fight: 1, Hit: 4, Save: 6, W: 2 };
const SHELLGUARD = { M: 5, Shoot: 2, Range: 16, Fight: 3, Hit: 4, Save: 3, W: 3 };

/** Three crews, about 100 points each, five to ten models. */
const ARMIES = [
  crew("TOLL", [
    model(
      "TOLL",
      "Captain Orrin",
      "Toll Captain",
      ["brute", "shield"],
      20,
      { M: 6, Shoot: 3, Range: 18, Fight: 3, Hit: 3, Save: 4, W: 4 },
      ["LEADER"],
    ),
    model("TOLL", "Ness", "Long-gun", ["trooper", "pole"], 15, LONG_GUN, ["SNIPER"]),
    model("TOLL", "Harl", "Long-gun", ["trooper", "pole"], 15, LONG_GUN, ["SNIPER"]),
    model("TOLL", "Brack", "Warden", ["trooper", "shield"], 13, WARDEN),
    model("TOLL", "Tamsin", "Warden", ["trooper", "shield"], 13, WARDEN),
    model("TOLL", "Joss", "Warden", ["trooper", "shield"], 13, WARDEN),
    model(
      "TOLL",
      "Pim",
      "Tide-rat",
      ["trooper", "hunched"],
      11,
      { M: 7, Shoot: 2, Range: 12, Fight: 2, Hit: 4, Save: 5, W: 2 },
      ["LURKER"],
    ),
  ]),
  crew("GULL", [
    model(
      "GULL",
      "Mother Skerry",
      "Gull Boss",
      ["trooper", "blades"],
      18,
      { M: 7, Shoot: 2, Range: 12, Fight: 4, Hit: 3, Save: 5, W: 4 },
      ["LEADER"],
    ),
    model("GULL", "Fin", "Cutter", ["trooper", "blades"], 11, CUTTER),
    model("GULL", "Wick", "Cutter", ["trooper", "blades"], 11, CUTTER),
    model("GULL", "Dace", "Cutter", ["trooper", "blades"], 11, CUTTER),
    model("GULL", "Rook", "Cutter", ["trooper", "blades"], 11, CUTTER),
    model("GULL", "Sable", "Hookshot", ["trooper", "cog"], 13, HOOKSHOT),
    model("GULL", "Lugg", "Hookshot", ["trooper", "cog"], 13, HOOKSHOT),
    model(
      "GULL",
      "Mudskulk",
      "Lurker",
      ["trooper", "hunched"],
      12,
      { M: 7, Shoot: 1, Range: 10, Fight: 3, Hit: 3, Save: 5, W: 2 },
      ["LURKER"],
    ),
  ]),
  crew("DEEP", [
    model(
      "DEEP",
      "Abbess Maren",
      "Abbess of the Deep",
      "robed",
      22,
      { M: 5, Shoot: 2, Range: 16, Fight: 4, Hit: 3, Save: 3, W: 5 },
      ["LEADER"],
      2.4,
    ),
    model("DEEP", "Corran", "Shellguard", "mound", 16, SHELLGUARD, [], 1.8),
    model("DEEP", "Tull", "Shellguard", "mound", 16, SHELLGUARD, [], 1.8),
    model("DEEP", "Vesk", "Shellguard", "mound", 16, SHELLGUARD, [], 1.8),
    model(
      "DEEP",
      "Ilse",
      "Choir-diver",
      "robed",
      16,
      { M: 5, Shoot: 3, Range: 24, Fight: 1, Hit: 4, Save: 4, W: 3 },
      ["SNIPER"],
    ),
    model(
      "DEEP",
      "The Drowned One",
      "Drowned One",
      ["robed", "hunched"],
      14,
      { M: 6, Shoot: 1, Range: 8, Fight: 4, Hit: 3, Save: 4, W: 3 },
      ["LURKER"],
    ),
  ]),
];

// ---------------------------------------------------------------------------
// Helpers on the game state
// ---------------------------------------------------------------------------

const alive = (state, u) =>
  u ? u.modelIds.map((id) => state.models[id]).filter((m) => m && !m.destroyed) : [];
const has = (u, keyword) => (u?.sheet?.keywords ?? []).includes(keyword);
const factionOf = (u) => ["TOLL", "GULL", "DEEP"].find((f) => has(u, f));
const seatOf = (state, player) => state.players[player]?.seat;
const opponents = (state, a, b) => {
  const sa = seatOf(state, a);
  const sb = seatOf(state, b);
  return sa !== undefined && sb !== undefined && sa !== sb;
};
const hidden = (u) => !!u?.status?.reserves;
const heightOf = (m) => m?.z ?? 0;
const plural = (n, one, many = \`\${one}s\`) => \`\${n} \${n === 1 ? one : many}\`;

/** @typedef {{ honours: string[], scars: string[] }} Story */
/** A campaign model's honours and scars, as \`beforeGame\` filed them. */
const story = (state, unitId) =>
  /** @type {Story} */ (state.modules?.brinewatch?.[\`story:\${unitId}\`] ?? { honours: [], scars: [] });
const marked = (state, unitId, name) => {
  const s = story(state, unitId);
  return s.honours.includes(name) || s.scars.includes(name);
};

/** A model's characteristic, with its campaign honours and scars. */
function stat(state, m, key) {
  const base = Number(m?.profile?.chars[key]) || 0;
  if (!m?.unitId) return base;
  if (key === "M")
    return base + (marked(state, m.unitId, "Fleet") ? 1 : 0) - (marked(state, m.unitId, "Limp") ? 1 : 0);
  if (key === "Fight") return base + (marked(state, m.unitId, "Brawler") ? 1 : 0);
  return base;
}

/** Enemy models on the table (not hidden, not out of action). */
const enemies = (state, me) =>
  Object.values(state.units).filter(
    (u) => opponents(state, me.owner, u.owner) && alive(state, u).length && !hidden(u),
  );

/** Enemy models within 1" (at a real table: any enemy, and the players say). */
function inContact(view, unitId) {
  const state = view.state;
  const me = state.units[unitId];
  if (hidden(me)) return [];
  if (view.atTable) return enemies(state, me);
  return enemies(state, me).filter((u) => view.distance(unitId, u.id) <= 1);
}

/** Whether \`from\` can shoot \`to\` now: it sees it, has it in Range, and isn't locked in a fight. */
function canShoot(view, fromId, toId) {
  const state = view.state;
  const me = state.units[fromId];
  const m = alive(state, me)[0];
  if (!m || hidden(me) || stat(state, m, "Shoot") <= 0) return false;
  if (view.atTable) return true;
  if (inContact(view, fromId).length) return false;
  return view.distance(fromId, toId) <= stat(state, m, "Range") && view.visible(fromId, toId);
}

/** Enemies this model can shoot. */
const shootable = (view, unitId) =>
  enemies(view.state, view.state.units[unitId]).filter((u) => canShoot(view, unitId, u.id));

/** A model's base radius in inches. */
const baseRadius = (m) =>
  (m.base?.diameterMm ?? Math.max(m.base?.widthMm ?? 0, m.base?.depthMm ?? 0)) / 25.4 / 2;

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
 * How a shot from one model at another stands: Vantage (the shooter stands
 * 2" or more higher), Cover (the target is in cover from it and the
 * shooter has no vantage), Obscured (the line passes through a reed bed
 * neither model stands in).
 */
function sightOf(view, shooter, target) {
  const state = view.state;
  const s = alive(state, state.units[shooter])[0];
  const t = alive(state, state.units[target])[0];
  if (!s || !t) return { vantage: false, cover: false, obscured: false };
  const vantage = heightOf(s) >= heightOf(t) + VANTAGE;
  const cover = !vantage && view.inCover(s.id, t.id);
  const obscured = (state.terrain ?? []).some(
    (p) =>
      p.category === "reeds" &&
      crosses(p, s.position, t.position) &&
      !crosses(p, s.position, s.position, baseRadius(s)) &&
      !crosses(p, t.position, t.position, baseRadius(t)),
  );
  return { vantage, cover, obscured };
}

// ---------------------------------------------------------------------------
// Action points and goes
// ---------------------------------------------------------------------------

/** Action points the model has left: all of them before its go, none once it's spent. */
function pointsLeft(state, u) {
  if (!u) return 0;
  if (!u.status?.acting) return u.status?.activated ? 0 : AP;
  return Math.max(0, Number(u.status.actionBudget ?? AP) - Number(u.status.actionsTaken ?? 0));
}

/**
 * Why this model can't take an action now, or null: one model goes at a
 * time, on its side's go, while it has action points (\`cost\`) left.
 */
function notItsGo(view, unitId, cost = 1) {
  const state = view.state;
  const me = state.units[unitId];
  if (!me || !alive(state, me).length) return "No such model";
  if (seatOf(state, me.owner) !== state.turn.activeSeat) return "Not your go";
  const other = Object.values(state.units).find((u) => u.id !== unitId && u.status?.acting);
  if (other) return \`\${other.name} is activating: end its go first\`;
  if (me.status?.activated && !me.status?.acting) return "Expended: it has had its go this round";
  if (pointsLeft(state, me) < cost) return "No action points left";
  return null;
}

/** The record of a model's moving this round: how far it has gone, and the points that took. */
/** @typedef {{ round: number, path: number, points: number, last: { x: number, y: number, z: number } }} PathRecord */
const pathOf = (view, unitId) => {
  const rec = /** @type {PathRecord | undefined} */ (view.own[\`path:\${unitId}\`]);
  return rec && rec.round === view.round ? rec : null;
};

/**
 * Moving costs action points: 1 for each Move's worth (or part of one) the
 * model has gone this go, climbing included. The core's move check is told
 * how far the points not spent on actions take it.
 */
function* chargeMove(ctx, unitId) {
  const view = ctx.view;
  const state = view.state;
  const u = state.units[unitId];
  const m = alive(state, u)[0];
  if (!m || !u.status?.acting) return;
  const rec = pathOf(view, unitId);
  const from = rec?.last ?? {
    x: m.phaseStart?.x ?? m.position.x,
    y: m.phaseStart?.y ?? m.position.y,
    z: m.phaseStartZ ?? 0,
  };
  const step = Math.hypot(m.position.x - from.x, m.position.y - from.y) + Math.abs(heightOf(m) - from.z);
  if (step < 0.05 && rec) return;
  const path = (rec?.path ?? 0) + step;
  const move = Math.max(1, stat(state, m, "M"));
  const points = path < 0.05 ? 0 : Math.ceil((path - 0.05) / move);
  const before = rec?.points ?? 0;
  yield ctx.set(\`path:\${unitId}\`, {
    round: view.round,
    path: Math.round(path * 100) / 100,
    points,
    last: { x: m.position.x, y: m.position.y, z: heightOf(m) },
  });
  const taken = Number(u.status.actionsTaken ?? 0);
  if (points > before)
    yield ctx.emit({ type: "unit/status", id: unitId, key: "actionsTaken", value: taken + points - before });
  yield* allowance(ctx, unitId);
}

/** The move check's allowance: Move for every point not spent on an action this go. */
function* allowance(ctx, unitId) {
  const state = ctx.view.state;
  const u = state.units[unitId];
  const m = alive(state, u)[0];
  if (!m) return;
  const onMoves = pathOf(ctx.view, unitId)?.points ?? 0;
  const onActions = Math.max(0, Number(u.status?.actionsTaken ?? 0) - onMoves);
  const value = stat(state, m, "M") * Math.max(0, AP - onActions);
  if (u.status?.allowance !== value)
    yield ctx.emit({ type: "unit/status", id: unitId, key: "allowance", value });
}

// ---------------------------------------------------------------------------
// Shooting, fighting, guards
// ---------------------------------------------------------------------------

/** Unsaved hits as wounds on a model; returns whether it is out of action. */
function* wound(ctx, target, hits, save, why = "") {
  if (!hits) return false;
  const state = ctx.view.state;
  const m = alive(state, target)[0];
  if (!m) return false;
  let unsaved = hits;
  if (save <= 6) {
    if (ctx.view.atTable)
      yield ctx.ask(target.owner, \`roll \${plural(hits, "save")} for \${target.name} (\${save}+)\`, [
        { id: "roll", label: "Roll" },
      ]);
    const roll = yield ctx.roll(\`\${hits}d6\`, \`saves on \${save}+\${why ? \` (\${why})\` : ""}\`, target.id, save);
    unsaved = roll.rolls.filter((r) => r < save).length;
  }
  if (!unsaved) return false;
  const woundsLost = (m.woundsLost ?? 0) + unsaved;
  const out = woundsLost >= stat(state, m, "W");
  yield ctx.emit({
    type: "model/wounds",
    id: m.id,
    woundsLost: Math.min(woundsLost, stat(state, m, "W")),
    destroyed: out,
  });
  yield ctx.note(
    out ? \`\${target.name} is out of action\` : \`\${target.name} takes \${plural(unsaved, "wound")}\`,
  );
  return out;
}

/**
 * One model shoots another. Hits on its Hits on, one more if Obscured, one
 * more for a snap shot (a guard's); with vantage a Long Eye hits on one
 * less. Saves on the target's Saves on, one less in cover (vantage takes
 * the cover away).
 * @param {{ snap?: boolean, told?: Record<string, boolean> }} [how] a guard's snap shot; what the players told
 */
function* shootAt(ctx, shooterId, targetId, how = {}) {
  const { snap = false, told } = how;
  const view = ctx.view;
  const state = view.state;
  const me = state.units[shooterId];
  const target = state.units[targetId];
  const s = alive(state, me)[0];
  if (!s || !alive(state, target).length) return false;
  const sight = view.atTable
    ? { vantage: !!told?.vantage, cover: !told?.vantage && !!told?.cover, obscured: !!told?.obscured }
    : sightOf(view, shooterId, targetId);
  const snapPenalty = snap && !has(me, "TOLL") ? 1 : 0;
  const slippery = snap && has(target, "GULL") ? 1 : 0;
  const eye = sight.vantage && has(me, "SNIPER") ? 1 : 0;
  const keen = marked(state, me.id, "Keen Eye") ? 1 : 0;
  const shaky = marked(state, me.id, "Shaky Hand") ? 1 : 0;
  const need = Math.min(
    6,
    Math.max(
      2,
      stat(state, s, "Hit") + (sight.obscured ? 1 : 0) + snapPenalty + slippery + shaky - eye - keen,
    ),
  );
  const why = [
    sight.vantage && "vantage",
    sight.obscured && "obscured",
    snap && (snapPenalty ? "snap shot" : \`snap shot, \${named("TOLL")}\`),
    slippery && named("GULL"),
    eye && "Long Eye",
  ].filter(Boolean);
  yield ctx.note(
    \`\${me.name} \${snap ? "fires from guard at" : "shoots at"} \${target.name}\${why.length ? \` (\${why.join(", ")})\` : ""}\`,
  );
  const roll = yield ctx.roll(\`\${stat(state, s, "Shoot")}d6\`, \`hits on \${need}+\`, me.id, need);
  const hits = roll.rolls.filter((r) => r >= need).length;
  const t = alive(state, target)[0];
  const save = Math.max(2, stat(state, t, "Save") - (sight.cover ? 1 : 0));
  return yield* wound(ctx, target, hits, save, sight.cover ? "cover" : "");
}

/**
 * Guards answer an enemy that ends a move, or goes to shoot or fight, in
 * their sight and range: each guard that can fires a snap shot, once.
 */
function* guards(ctx, moverId, what) {
  if (ctx.view.atTable) return;
  for (const g of Object.values(ctx.view.state.units)) {
    const state = ctx.view.state;
    const mover = state.units[moverId];
    if (!mover || !alive(state, mover).length || hidden(mover)) return;
    if (!g.status?.guard || !opponents(state, g.owner, mover.owner) || !alive(state, g).length) continue;
    if (!canShoot(ctx.view, g.id, moverId)) continue;
    yield ctx.emit({ type: "unit/status", id: g.id, key: "guard", value: null });
    yield ctx.note(\`\${g.name}, on guard, sees \${mover.name} \${what}\`);
    yield* shootAt(ctx, g.id, moverId, { snap: true });
  }
}

function* shoot(ctx, args) {
  yield ctx.emit({ type: "unit/status", id: args.unit, key: "shot", value: true });
  yield* guards(ctx, args.unit, "take aim");
  if (!alive(ctx.view.state, ctx.view.state.units[args.unit]).length) return;
  yield* shootAt(ctx, args.unit, args.target, { told: args.told });
  yield* allowance(ctx, args.unit);
}

/** Fight: the attacker strikes with its Fight dice, then the target strikes back if it still stands. */
function* fight(ctx, args) {
  yield ctx.emit({ type: "unit/status", id: args.unit, key: "fought", value: true });
  yield* guards(ctx, args.unit, "close in to fight");
  let state = ctx.view.state;
  const me = state.units[args.unit];
  const target = state.units[args.target];
  if (!alive(state, me).length || !alive(state, target).length) return;
  yield ctx.note(\`\${me.name} fights \${target.name}\`);
  const strike = function* (from, to) {
    const s = ctx.view.state;
    const m = alive(s, from)[0];
    const t = alive(s, to)[0];
    if (!m || !t || stat(s, m, "Fight") <= 0) return false;
    const need = stat(s, m, "Hit");
    const roll = yield ctx.roll(\`\${stat(s, m, "Fight")}d6\`, \`hits on \${need}+ in the fight\`, from.id, need);
    return yield* wound(ctx, to, roll.rolls.filter((r) => r >= need).length, stat(s, t, "Save"));
  };
  const won = yield* strike(me, target);
  if (!won) yield* strike(target, me);
  state = ctx.view.state;
  if (
    won &&
    has(me, "DEEP") &&
    alive(state, state.units[me.id]).length &&
    state.units[me.id].status?.acting
  ) {
    yield ctx.note(\`\${named("DEEP")}: \${me.name} rides the swell (1 action point back)\`);
    const taken = Number(state.units[me.id].status.actionsTaken ?? 0);
    yield ctx.emit({ type: "unit/status", id: me.id, key: "actionsTaken", value: Math.max(0, taken - 1) });
  }
  yield* allowance(ctx, args.unit);
}

/** Stand guard: the rest of its go is spent watching. */
function* standGuard(ctx, args) {
  const u = ctx.view.state.units[args.unit];
  yield ctx.note(\`\${u.name} stands guard\`);
  yield ctx.emit({ type: "unit/status", id: u.id, key: "guard", value: true });
  yield ctx.emit({ type: "unit/status", id: u.id, key: "actionsTaken", value: AP });
}

// ---------------------------------------------------------------------------
// Hidden lurkers
// ---------------------------------------------------------------------------

/** The three hideouts on a side's half: west, middle and east, ahead of its deployment strip. */
function hideouts(table, seat) {
  const y = (table.depth / 2 - 4.5) * (seat === 0 ? 1 : -1);
  return [
    { id: "west", label: "West hideout", x: -table.width / 3, y },
    { id: "middle", label: "Middle hideout", x: 0, y },
    { id: "east", label: "East hideout", x: table.width / 3, y },
  ];
}

/** Where a lurker comes out at a hideout: its spot, or the nearest free place around it. */
function emergeAt(state, spot, m) {
  const free = (p) =>
    Object.values(state.models).every(
      (o) =>
        o.id === m.id ||
        o.destroyed ||
        hidden(state.units[o.unitId]) ||
        Math.hypot(o.position.x - p.x, o.position.y - p.y) > 1.3,
    );
  for (let ring = 0; ring < 4; ring++)
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = (k / Math.max(1, ring * 6)) * Math.PI * 2;
      const p = { x: spot.x + Math.cos(a) * ring * 1.4, y: spot.y + Math.sin(a) * ring * 1.4 };
      if (free(p)) return p;
    }
  return { x: spot.x, y: spot.y };
}

/** A hidden lurker reveals its hideout (checked against what it committed) and is set up there. */
function* emerge(ctx, unitId) {
  const state = ctx.view.state;
  const u = state.units[unitId];
  const m = alive(state, u)[0];
  if (!m || !hidden(u)) return;
  const where = yield ctx.reveal(u.owner, \`hideout:\${u.id}\`);
  const seat = seatOf(state, u.owner);
  const spot = hideouts(state.table, seat).find((h) => h.id === where) ?? hideouts(state.table, seat)[1];
  const to = emergeAt(ctx.view.state, spot, m);
  yield ctx.emit({ type: "unit/reserve", id: u.id, reserve: false, moves: [{ id: m.id, to }] });
  yield ctx.emit({ type: "unit/status", id: u.id, key: "hidden", value: null });
  yield ctx.note(\`\${u.name} emerges from the \${spot.label.toLowerCase()}\`);
  yield ctx.set(\`path:\${u.id}\`, {
    round: ctx.view.round,
    path: 0,
    points: 0,
    last: { x: to.x, y: to.y, z: 0 },
  });
}

function* emergeAction(ctx, args) {
  yield* emerge(ctx, args.unit);
  yield* guards(ctx, args.unit, "come out of hiding");
  yield* allowance(ctx, args.unit);
}

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

/**
 * Who holds each marker: the side with more models within \`reach\` inches
 * of it (and, \`up\`, standing at least that high), nobody on a tie.
 */
function holders(state, reach = 2, up = 0) {
  const out = {};
  for (const o of state.objectives) {
    const count = {};
    for (const m of Object.values(state.models)) {
      if (m.destroyed || !m.unitId || hidden(state.units[m.unitId])) continue;
      if (heightOf(m) < up) continue;
      if (Math.hypot(m.position.x - o.position.x, m.position.y - o.position.y) - baseRadius(m) > reach)
        continue;
      const seat = seatOf(state, m.owner);
      if (seat === undefined) continue;
      count[seat] = (count[seat] ?? 0) + 1;
    }
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
    out[o.id] = ranked[0] && ranked[0][1] !== ranked[1]?.[1] ? Number(ranked[0][0]) : null;
  }
  return out;
}
const heldBy = (state, seat, reach, up) =>
  Object.entries(holders(state, reach, up))
    .filter(([, s]) => s === seat)
    .map(([id]) => id);

/** Enemy models out of action. */
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

/** The starter table's tall ruins, by the table's size: their top floors are where the bells hang. */
const TOWERS = [
  { x: -9, y: 1.5, facing: 0 },
  { x: 9, y: -1.5, facing: Math.PI },
];
/** The top floor's middle of a tall ruin placed at \`t\` (see the Tall ruin template: its floors sit in the back corner). */
const belfry = (t, table) => {
  const lx = -1.4;
  const ly = -1.4;
  const c = Math.cos(t.facing);
  const s = Math.sin(t.facing);
  return { x: ((t.x + lx * c + ly * s) * table.width) / 30, y: ((t.y - lx * s + ly * c) * table.depth) / 22 };
};

const MISSIONS = [
  {
    id: "salvage",
    name: "Low Tide Salvage",
    summary:
      "Three salvage caches lie across the middle of the town. At the end of each round, each side scores 1 for each cache it holds.",
    setup: (table) => ({
      zones: edgeZones(table, 4),
      objectives: [
        { id: "west", position: { x: -table.width / 3, y: 0 }, label: "West cache" },
        { id: "middle", position: { x: 0, y: 0 }, label: "Middle cache" },
        { id: "east", position: { x: table.width / 3, y: 0 }, label: "East cache" },
      ],
    }),
    scoring: [
      {
        id: "caches",
        name: "Caches held",
        at: { roundEnd: true },
        suggest: (game, seat) => {
          const n = heldBy(game, seat).length;
          return { vp: n, why: \`\${plural(n, "cache")} held\` };
        },
        ask: {
          question: 'How many caches do you hold (more models within 2")?',
          answers: [0, 1, 2, 3].map((n) => ({ label: String(n), vp: n, why: \`\${plural(n, "cache")} held\` })),
        },
      },
    ],
  },
  {
    id: "bells",
    name: "The Bell Towers",
    summary:
      "A warning bell hangs on the top floor of each tall ruin. From round 2, at the end of each round, each side scores 2 for each bell it holds from up on the floors.",
    setup: (table) => ({
      zones: edgeZones(table, 4),
      objectives: TOWERS.map((t, i) => ({
        id: i ? "east-bell" : "west-bell",
        position: belfry(t, table),
        label: i ? "East bell" : "West bell",
      })),
    }),
    scoring: [
      {
        id: "bells",
        name: "Bells held",
        at: { roundEnd: true, fromRound: 2 },
        suggest: (game, seat) => {
          if (game.turn.round < 2) return null;
          const n = heldBy(game, seat, 3, VANTAGE).length;
          return n ? { vp: n * 2, why: \`\${plural(n, "bell")} held from the floors\` } : null;
        },
        ask: {
          question: 'How many bells do you hold (more models within 3" of it, standing 2" or more up)?',
          answers: [0, 1, 2].map((n) => ({ label: String(n), vp: n * 2, why: \`\${plural(n, "bell")} held\` })),
        },
      },
    ],
  },
  {
    id: "cut-the-line",
    name: "Cut the Line",
    summary:
      "One marker in the middle: holding it at the end of a round scores 1. At the end of the game, the enemy Leader out of action scores 3, and half or more of their crew out of action scores 2.",
    setup: (table) => ({
      zones: edgeZones(table, 4),
      objectives: [{ id: "line", position: { x: 0, y: 0 }, label: "The line" }],
    }),
    scoring: [
      {
        id: "line",
        name: "The line",
        at: { roundEnd: true },
        suggest: (game, seat) => (heldBy(game, seat).length ? { vp: 1, why: "holds the line" } : null),
        ask: {
          question: 'Do you hold the line (more models within 2" of the marker)?',
          answers: [
            { label: "Yes", vp: 1, why: "holds the line" },
            { label: "No", vp: 0, why: "doesn't hold it" },
          ],
        },
      },
      {
        id: "leader",
        name: "Leader out",
        at: { gameEnd: true },
        measures: false,
        suggest: (game, seat) =>
          fallen(game, seat).some((u) => has(u, "LEADER"))
            ? { vp: 3, why: "the enemy Leader is out of action" }
            : null,
      },
      {
        id: "broken",
        name: "Crew broken",
        at: { gameEnd: true },
        measures: false,
        suggest: (game, seat) => {
          const theirs = Object.values(game.units).filter((u) => {
            const s = seatOf(game, u.owner);
            return s !== undefined && s !== seat;
          }).length;
          return theirs && fallen(game, seat).length * 2 >= theirs
            ? { vp: 2, why: "half or more of the enemy crew out" }
            : null;
        },
      },
    ],
  },
];

/** The starter table: two tall ruins with bells, ruins, reed beds, barricades and hulks, the same from both sides. */
function layout(table) {
  const half = [
    { id: "a", template: "Tall ruin", ...TOWERS[0] },
    { id: "b", template: "Woods", x: 3.5, y: 4, facing: 0 },
    { id: "c", template: "Barricade", x: -1.5, y: 2.5, facing: 0 },
    { id: "d", template: "Container", x: 13, y: 3.5, facing: Math.PI / 2 },
    { id: "e", template: "Small ruin", x: -3, y: 7.5, facing: 0 },
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
// The campaign
// ---------------------------------------------------------------------------

const HONOURS = ["Keen Eye", "Brawler", "Fleet"];
const SCARS = { 1: "Lost", 2: "Limp", 3: "Shaky Hand" };

/**
 * Before a campaign game: each model's honours and scars are filed for the
 * rules to read, and a Lost model sits the game out.
 */
function* beforeGame(ctx, args) {
  for (const s of args.units) {
    const honours = s.honours ? s.honours.split(/,\\s*/).filter(Boolean) : [];
    const scars = s.scars ? s.scars.split(/,\\s*/).filter(Boolean) : [];
    if (!honours.length && !scars.length) continue;
    yield ctx.set(\`story:\${s.unitId}\`, { honours, scars });
    yield ctx.note(\`\${s.name}: \${[...honours, ...scars].join(", ")}\`);
    if (scars.includes("Lost")) {
      const m = alive(ctx.view.state, ctx.view.state.units[s.unitId])[0];
      if (m)
        yield ctx.emit({
          type: "model/wounds",
          id: m.id,
          woundsLost: stat(ctx.view.state, m, "W"),
          destroyed: true,
        });
      yield ctx.note(\`\${s.name} is lost and sits this game out\`);
    }
  }
}

/**
 * After a campaign game: 1 experience for coming through, 1 for each enemy
 * taken out (2 at most); an honour at 3 and 6 experience; a model taken out
 * rolls for a scar.
 */
function* afterGame(ctx, args) {
  for (const s of args.units) {
    if (s.scars.includes("Lost")) continue;
    const xp = (s.survived ? 1 : 0) + Math.min(2, s.slain ?? 0);
    if (xp) yield ctx.emit({ type: "campaign/award", key: s.key, unitId: s.unitId, xp });
    const held = s.honours ? s.honours.split(/,\\s*/) : [];
    for (const at of [3, 6])
      if (s.xp < at && s.xp + xp >= at) {
        const roll = yield ctx.roll("1d3", \`honour: \${s.name}\`, s.unitId);
        const pick = [0, 1, 2]
          .map((k) => HONOURS[(roll.rolls[0] - 1 + k) % 3])
          .find((h) => !held.includes(h));
        if (pick) {
          held.push(pick);
          yield ctx.emit({ type: "campaign/award", key: s.key, unitId: s.unitId, honour: pick });
        }
      }
    if (!s.survived) {
      const roll = yield ctx.roll("1d6", \`scar: \${s.name}\`, s.unitId);
      const scar = SCARS[roll.rolls[0]];
      if (scar && !s.scars.includes(scar))
        yield ctx.emit({ type: "campaign/award", key: s.key, unitId: s.unitId, scar });
      else yield ctx.note(\`\${s.name} walks it off\`);
    }
  }
  yield ctx.note("The campaign book has each model's experience, honours and scars");
}

// ---------------------------------------------------------------------------
// The computer opponent
// ---------------------------------------------------------------------------

/** The chance one die rolls \`need\` or more. */
const chance = (need) => Math.max(0, Math.min(6, 7 - need)) / 6;

/**
 * Sight and cover between two models, kept by where both stand: the
 * computer asks the same pairs over and over while it tries moves out, and
 * terrain doesn't move.
 */
const sightMemo = new Map();
const where = (m) =>
  \`\${Math.round(m.position.x * 20)},\${Math.round(m.position.y * 20)},\${Math.round(heightOf(m) * 20)}\`;
function seenFrom(view, s, t) {
  const key = \`\${where(s)}|\${where(t)}|\${s.id}|\${t.id}\`;
  let hit = sightMemo.get(key);
  if (!hit) {
    if (sightMemo.size > 50000) sightMemo.clear();
    const visible = view.visible(s.id, t.id);
    hit = { visible, cover: visible && view.inCover(s.id, t.id) };
    sightMemo.set(key, hit);
  }
  return hit;
}

/**
 * The points' worth of a target one shot is likely to take, as the rules
 * would roll it now (sight, range, cover, vantage), or 0 if it can't shoot
 * it: wounds likely taken, no more than it has left, at its points per wound.
 * (A share of what it has left would make a wounded enemy worth keeping
 * alive as a target.)
 */
function expectedShot(view, from, to) {
  const state = view.state;
  const s = alive(state, from)[0];
  const t = alive(state, to)[0];
  if (!s || !t || stat(state, s, "Shoot") <= 0) return 0;
  const gap =
    Math.hypot(s.position.x - t.position.x, s.position.y - t.position.y) - baseRadius(s) - baseRadius(t);
  if (gap > stat(state, s, "Range")) return 0;
  const seen = seenFrom(view, s, t);
  if (!seen.visible) return 0;
  const vantage = heightOf(s) >= heightOf(t) + VANTAGE;
  const hit = chance(
    Math.min(6, Math.max(2, stat(state, s, "Hit") - (vantage && has(from, "SNIPER") ? 1 : 0))),
  );
  const save = chance(Math.max(2, stat(state, t, "Save") - (seen.cover && !vantage ? 1 : 0)));
  const wounds = stat(state, s, "Shoot") * hit * (1 - save);
  const full = Math.max(1, stat(state, t, "W"));
  return (Math.min(wounds, full - (t.woundsLost ?? 0)) * (to.sheet?.points ?? 10)) / full;
}

/**
 * What the computer should weigh beyond points and objectives: the shots
 * each side has on the other as the models stand (sight, range, cover and
 * vantage), each shooter at its best target, so it looks for vantage and
 * cover and keeps out of open lanes.
 */
function botEvaluate(state, seat, view) {
  const all = Object.values(state.units).filter((u) => seatOf(state, u.owner) !== undefined);
  const units = all.filter((u) => !hidden(u) && alive(state, u).length);
  const mine = units.filter((u) => seatOf(state, u.owner) === seat);
  const theirs = units.filter((u) => seatOf(state, u.owner) !== seat);
  // Scaled by every model in the game, standing or not, so a model taken out doesn't change the scale.
  const points = all.reduce((n, u) => n + (u.sheet?.points ?? 10), 0);
  const per = (36 / Math.max(1, all.length)) * (all.length / Math.max(1, points));
  const shots = (by, at) =>
    by.reduce((n, u) => n + Math.max(0, ...at.map((t) => expectedShot(view, u, t))), 0);
  return 0.35 * per * (shots(mine, theirs) - shots(theirs, mine));
}

// ---------------------------------------------------------------------------
// The rules in words
// ---------------------------------------------------------------------------

const RULEBOOK = {
  intro:
    "A skirmish game for two players, about an hour long, played with a crew of five to ten models each. At low tide the drowned harbour town of Brinewatch comes up out of the sea, and three crews climb its broken towers for what the water left.",
  sections: [
    {
      id: "need",
      title: "What you need",
      text: [
        'A table 30" x 22", a tape measure in inches, a handful of six-sided dice, and a crew each: your own models or the print-and-play stand-ins. Put plenty of terrain on the table, some of it tall: ruins with upper floors, reed beds (a fluffy cloth will do) and a couple of hulks (boxes).',
        "On a screen, Open Battle measures, rolls and keeps every rule. At a real table it keeps the score: open it on a phone and pick **At a real table**.",
      ].join("\\n\\n"),
    },
    {
      id: "turn",
      title: "Rounds and goes",
      text: [
        \`The game lasts **\${ROUNDS} rounds**. Each model is its own unit. In each round players take turns giving one **ready** model its **go**, starting with the player who goes first, until every model is **expended**. Then all are ready again.\`,
        \`- A model's go has **\${AP} action points** (AP). Spend them on the actions below, in any order and mix. Its go ends when they are spent, or when its player ends it.\`,
        "- When one player has no ready models left, the other gives theirs their goes in turn.",
        "- A model can't be activated twice in a round.",
      ].join("\\n"),
    },
    {
      id: "actions",
      title: "Actions",
      text: [
        "1. **Move (1 AP):** up to its Move in inches. Climbing up or down counts: a floor is 3\\" up. A second Move costs another point. Hulks can't be walked through.",
        '2. **Shoot (1 AP):** at an enemy it can see within its Range, if no enemy is within 1" of it. Once a go.',
        '3. **Fight (1 AP):** an enemy within 1". Once a go.',
        "4. **Stand guard (1 AP):** it watches; this ends its go, whatever it has left.",
        "5. **Emerge (1 AP):** a hidden Lurker comes out of its hideout.",
      ].join("\\n"),
    },
    {
      id: "shooting",
      title: "Shooting",
      text: [
        "Roll the shooter's **Shoot** dice. Each die that rolls its **Hits on** number or higher hits. The target rolls a die for each hit; each that rolls its **Saves on** number or higher saves it. Each hit not saved takes a wound; a model with no wounds left is **out of action**.",
        "- **Cover:** a target in or behind a ruin or reed bed, from the shooter's view, saves on one less (a 4+ save becomes 3+).",
        "- **Obscured:** a shot through a reed bed neither model stands in needs one more to hit.",
        \`- **Vantage:** a shooter standing \${VANTAGE}\\" or more higher than its target (up a floor) takes its cover away. A model with **Long Eye** also hits on one less with vantage.\`,
      ].join("\\n"),
    },
    {
      id: "fighting",
      title: "Fighting",
      text: "The attacker rolls its **Fight** dice and hits and wounds as when shooting (no cover in a fight). If the target is still standing, it strikes back the same way.",
    },
    {
      id: "guard",
      title: "Standing guard",
      text: [
        "A model on guard watches until it fires or the round ends. The first time an enemy model **ends a move**, **emerges**, or **goes to shoot or fight** where the guard can see it and has it in Range (and no enemy is within 1\\" of the guard), the guard fires at it at once, before that enemy's shot or blow: a **snap shot** that needs one more to hit. Then it is off guard.",
      ].join("\\n"),
    },
    {
      id: "lurkers",
      title: "Hidden lurkers",
      text: [
        'Each crew has a **Lurker**. As the first round starts, the Lurkers are set aside, and each player secretly picks one of their three **hideouts** for each of their Lurkers: west, middle or east, 4.5" ahead of their deployment strip. Write it down; Open Battle keeps the choice sealed on your device.',
        "- A hidden Lurker's go can be spent hiding (end it at once), or on **Emerge**: reveal the hideout and set it up there, then spend its other point.",
        "- Any Lurker still hidden when round 3 begins emerges then, without spending a go.",
      ].join("\\n"),
    },
    {
      id: "markers",
      title: "Holding a marker",
      text: 'A side **holds** a marker when it has more models within 2" of it than the other side (the bells: within 3" and standing 2" or more up). Nobody holds it on a tie. The side with more victory points after round 4 wins.',
    },
    {
      id: "campaign",
      title: "The campaign",
      text: [
        "Play the three missions in order with the same crews, and keep a campaign book (Open Battle's **Campaign** keeps it for you). After each game:",
        "- **Experience:** each model gets 1 for coming through and 1 for each enemy it took out (2 at most).",
        '- **Honours:** at 3 and at 6 experience, roll a D3: 1 **Keen Eye** (hits on one less shooting), 2 **Brawler** (+1 Fight), 3 **Fleet** (+1" Move). Already have it? Take the next.',
        '- **Scars:** a model taken out rolls a D6: 1 **Lost** (it sits out every later game), 2 **Limp** (-1" Move), 3 **Shaky Hand** (needs one more to hit shooting), 4-6 it walks it off.',
        "The crew with more wins after three games takes the town.",
      ].join("\\n"),
    },
  ],
  words: {
    army: "crew",
    armies: "crews",
    unit: "model",
    units: "models",
    marker: "marker",
    markers: "markers",
    reach: 2,
  },
  terrainColors: { reeds: "#6f8f4e", hulk: "#5b4636" },
  quickRef: [
    \`**\${ROUNDS} rounds.** Take turns giving one ready model its go; it's then expended.\`,
    \`**A go: \${AP} AP.** Move, Shoot, Fight 1 each (Shoot and Fight once a go); Stand guard 1 and ends the go.\`,
    '**Shoot:** see it, in Range, no enemy within 1". Hits on Hits on; one more if Obscured.',
    '**Cover:** saves on one less. **Vantage** (2" higher) takes cover away.',
    "**Guard:** snap shot (one more to hit) at the first enemy that moves, shoots or fights in sight.",
    "**Lurkers:** hide in a secret hideout; Emerge (1 AP) reveals it.",
  ],
};

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

/** The side panel: each side's ready and expended models, its guards and its hidden lurkers. */
function sidePanel(view) {
  const state = view.state;
  if (state.turn.round < 1) return null;
  const lines = [];
  for (const p of Object.values(state.players)) {
    if (p.seat === undefined) continue;
    const mine = Object.values(state.units).filter((u) => u.owner === p.id && alive(state, u).length);
    if (!mine.length) continue;
    const ready = mine.filter((u) => !u.status?.activated).length;
    const guard = mine.filter((u) => u.status?.guard).map((u) => u.name);
    const lurking = mine.filter(hidden).length;
    lines.push(
      \`\${p.name || \`Side \${p.seat + 1}\`}: \${ready} ready, \${mine.length - ready} expended\` +
        (guard.length ? \`; on guard: \${guard.join(", ")}\` : "") +
        (lurking ? \`; \${plural(lurking, "lurker")} hidden\` : ""),
    );
  }
  return { title: "The crews", lines };
}

const act = (id, name, cost, run, extra) => ({
  id,
  name,
  by: "unit",
  phases: ["activations"],
  cost,
  run,
  ...extra,
});

export default {
  module: {
    id: "brinewatch",
    version: "1.0.0",
    api: 1,
    system,
    app: {
      sample: (seat) => ARMIES[seat === 1 ? 1 : 0],
      armies: ARMIES,
      layout,
      templateCategory: CATEGORIES,
      missions: MISSIONS,
      rulebook: RULEBOOK,
      sidePanel,
    },
    bot: {
      evaluate: botEvaluate,
      climbs: true,
      moveInches: (state, u) => stat(state, alive(state, u)[0], "M") || 6,
    },
    actions: [
      act("shoot", "Shoot", 1, shoot, {
        available: (view, actor) => {
          const why = notItsGo(view, actor.unitId);
          if (why) return why;
          const me = view.state.units[actor.unitId];
          if (hidden(me)) return "Hidden: emerge first";
          if (me.status?.shot) return "Already shot this go";
          if (stat(view.state, alive(view.state, me)[0], "Shoot") <= 0) return "Can't shoot";
          if (!view.atTable && inContact(view, actor.unitId).length) return "Locked in a fight";
          return shootable(view, actor.unitId).length ? true : "No enemy in sight and range";
        },
        targets: (view, actor) => shootable(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        told: (view, actor, targetId) => {
          const me = view.state.units[actor.unitId];
          const target = view.state.units[targetId];
          if (!me || !target) return [];
          return [
            { id: "clear", question: \`No enemy within 1" of \${me.name}\`, need: true },
            {
              id: "seen",
              question: \`\${me.name} can see \${target.name}, within \${stat(view.state, alive(view.state, me)[0], "Range")}"\`,
              need: true,
            },
            { id: "vantage", question: \`\${me.name} stands 2" or more higher (vantage)\` },
            { id: "cover", question: \`\${target.name} is in or behind a ruin or reed bed (cover)\` },
            { id: "obscured", question: "The shot passes through a reed bed (obscured)" },
          ];
        },
      }),
      act("fight", "Fight", 1, fight, {
        available: (view, actor) => {
          const why = notItsGo(view, actor.unitId);
          if (why) return why;
          if (view.state.units[actor.unitId].status?.fought) return "Already fought this go";
          return inContact(view, actor.unitId).length ? true : 'No enemy within 1"';
        },
        targets: (view, actor) => inContact(view, actor.unitId).map((u) => ({ unitId: u.id, label: u.name })),
        told: (view, actor, targetId) => {
          const target = view.state.units[targetId];
          return target ? [{ id: "contact", question: \`\${target.name} within 1"\`, need: true }] : [];
        },
      }),
      act("guard", "Stand guard", 1, standGuard, {
        available: (view, actor) => {
          const why = notItsGo(view, actor.unitId);
          if (why) return why;
          const me = view.state.units[actor.unitId];
          if (hidden(me)) return "Hidden: emerge first";
          if (me.status?.guard) return "Already on guard";
          if (stat(view.state, alive(view.state, me)[0], "Shoot") <= 0) return "Can't shoot";
          return true;
        },
      }),
      act("emerge", "Emerge", 1, emergeAction, {
        applies: (view, actor) => has(view.state.units[actor.unitId], "LURKER"),
        available: (view, actor) => {
          const why = notItsGo(view, actor.unitId);
          if (why) return why;
          return hidden(view.state.units[actor.unitId]) ? true : "Not hidden";
        },
      }),
    ],
    procedures: {},
    hooks: {
      roundStart: function* (ctx) {
        const state = ctx.view.state;
        if (ctx.view.atTable) return;
        if (state.turn.round === 1) {
          // Hidden deployment: the lurkers are set aside, and each player picks their hideouts in secret.
          const lurkers = Object.values(state.units).filter(
            (u) => has(u, "LURKER") && !hidden(u) && alive(state, u).length,
          );
          for (const u of lurkers) {
            const seat = seatOf(state, u.owner);
            const m = alive(state, u)[0];
            const off = { x: m.position.x, y: (state.table.depth / 2 + 1.5) * (seat === 0 ? 1 : -1) };
            yield ctx.emit({ type: "unit/reserve", id: u.id, reserve: true, moves: [{ id: m.id, to: off }] });
            yield ctx.emit({ type: "unit/status", id: u.id, key: "hidden", value: true });
          }
          for (const u of lurkers) {
            const seat = seatOf(ctx.view.state, u.owner);
            yield ctx.secret(
              u.owner,
              \`hideout:\${u.id}\`,
              \`Where does \${u.name} hide? Only you will know until it emerges.\`,
              hideouts(ctx.view.state.table, seat).map((h) => ({ id: h.id, label: h.label })),
            );
          }
          if (lurkers.length) yield ctx.note(\`\${plural(lurkers.length, "lurker")} slip into hiding\`);
        }
        if (state.turn.round === 3)
          for (const u of Object.values(state.units))
            if (has(u, "LURKER") && hidden(u) && alive(state, u).length) yield* emerge(ctx, u.id);
      },
      // Moving costs action points, and guards watch for it.
      moved: function* (ctx, args) {
        if (ctx.view.atTable) return;
        yield* chargeMove(ctx, args.unitId);
        yield* guards(ctx, args.unitId, "move");
      },
      beforeGame,
      afterGame,
    },
  },
};
`;export{e as default};