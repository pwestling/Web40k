import { snippetCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";

/**
 * The module workshop's autocomplete (#41): what a package can call and the
 * keys its objects take, from src/sdk/index.ts. Plain JavaScript in the
 * editor, so this is a table rather than a type checker: `ctx.` offers the
 * commands, `view.` the game view, and anywhere else the keys and snippets.
 */
const fn = (label: string, detail: string, info: string): Completion => ({
  label,
  detail,
  info,
  type: "function",
});
const prop = (label: string, detail: string, info: string): Completion => ({
  label,
  detail,
  info,
  type: "property",
});

/** ctx.*: the commands a procedure yields (`yield ctx.roll(...)`). */
export const CTX: Completion[] = [
  prop("view", ": GameView", "The game as it stands: units, distances, line of sight."),
  fn(
    "roll",
    "(dice, label?, unitId?, need?)",
    'Roll dice with the host\'s dice, e.g. ctx.roll("3d6", "hits", unitId, 4). With `need`, each die of that score or more is a success.',
  ),
  fn("note", "(text)", "A line in the game log."),
  fn("ask", "(player, question, options)", "Ask a player to choose; the result is the option id."),
  fn(
    "run",
    "(procedure, roles)",
    "Run one of the system's data procedures to the end; the result says what each step rolled.",
  ),
  fn(
    "emit",
    "(event)",
    'Change the table with an event, e.g. { type: "model/wounds", id, woundsLost, destroyed }.',
  ),
  fn("set", "(key, value)", "Remember a value for this player's package (read back from view.own[key])."),
  fn(
    "secret",
    "(player, key, question, options)",
    "A choice kept on the player's device; only a commitment goes on the table.",
  ),
  fn("reveal", "(player, key)", "Have a player reveal a secret they committed."),
];

/** view.*: the game view every hook, action and check gets. */
export const VIEW: Completion[] = [
  prop("round", ": number", "The battle round (0 while setting up)."),
  prop("phase", ": string | null", "The current phase's id."),
  prop("activePlayer", ": string | null", "Whose turn it is."),
  fn("unit", "(id)", "A unit by id."),
  fn("units", "(player?)", "Every unit, or one player's."),
  fn("distance", "(a, b)", "Closest distance between two units' bases, in the system's units."),
  fn("visible", "(from, to)", "Whether a unit can see another."),
  fn("inCover", "(from, to)", "Whether the target is in cover from the shooter."),
  fn("arc", "(of, other)", "Which arc of a unit another is in (front, flank, rear), for ranked games."),
  fn("engaged", "(unitId)", "Enemy units this one is engaged with."),
  prop("own", ": Record<string, unknown>", "This player's package values (ctx.set)."),
  prop("state", ": GameState", "The whole game state, read-only."),
];

/** Keys of the objects a package is made of, and snippets for whole pieces. */
export const KEYS: Completion[] = [
  // The manifest.
  prop("id", "manifest / module / action", "A stable id: a package's must stay the same across versions."),
  prop("name", "manifest / action", "What players see."),
  prop("version", "manifest / module", "Semantic version, e.g. 0.1.0."),
  prop("author", "manifest", "Who wrote it."),
  prop("api", "manifest / module", "The SDK version: 1."),
  prop("kind", "manifest", '"system" for a whole game, "extension" for additions to one.'),
  prop("systems", "manifest", "The system ids it brings or changes."),
  prop("requires", "manifest", "Other packages it needs."),
  prop("adds", "manifest", "One line on what it adds, shown before a player trusts it."),
  // The module.
  prop(
    "system",
    "module",
    "The rules as data: characteristics, dice, the turn (src/core/content/schema.ts).",
  ),
  prop("app", "module", "The app glue: sample armies, the table layout, rank rules, a side panel."),
  prop("actions", "module", "Code actions: buttons on a unit card or for a player."),
  prop("procedures", "module", "Named generator procedures, run by data or by ctx.run."),
  prop("hooks", "module", "Turn hooks: phaseStart, phaseEnd, roundStart, activationEnd."),
  prop("functions", "module", "Pure functions data rules can call."),
  prop("checks", "module", "(view) => warnings for the table warnings panel."),
  // A code action.
  prop("by", "action", '"unit" or "player".'),
  prop("phases", "action", "Phase ids it's offered in (an alternate's id for activations)."),
  fn("available", "(view, actor)", "true, or why not."),
  fn("targets", "(view, actor)", "The targets to pick from: { unitId, label }."),
  fn("run", "function* (ctx, args)", "What it does: yield ctx commands."),
  // App glue.
  fn("sample", "(seat)", "The test table's army for a seat."),
  fn("layout", "(table)", "Terrain, objectives and deployment zones."),
  fn("sidePanel", "(view)", "A panel of lines and buttons, or null."),
  prop("armies", "app", "Every sample army players pick from, one per faction."),
  prop("missions", "app", "Missions picked at setup: zones, objectives and scoring."),
  prop("templateCategory", "app", 'What each terrain template counts as, e.g. { Woods: "cover" }.'),
  // Hooks.
  prop("phaseStart", "hooks", "{ [phaseId]: function* (ctx) }"),
  prop("phaseEnd", "hooks", "{ [phaseId]: function* (ctx) }"),
  fn("roundStart", "function* (ctx)", "At the start of each round."),
  fn("activationEnd", "function* (ctx)", "When a unit's activation ends."),
  snippetCompletion(
    '{\n  id: "${id}",\n  name: "${Name}",\n  by: "unit",\n  phases: ["${phase}"],\n  available: (view, actor) => true,\n  targets: (view, actor) => [],\n  run: function* (ctx, args) {\n    yield ctx.note("${Name}");\n  },\n}',
    { label: "action", detail: "snippet", info: "A code action on a unit card.", type: "keyword" },
  ),
  snippetCompletion(
    'function* ${name}(ctx, args) {\n  const roll = yield ctx.roll("${2d6}", "${label}");\n  ${}\n}',
    {
      label: "procedure",
      detail: "snippet",
      info: "A generator procedure: yield commands, read their results.",
      type: "keyword",
    },
  ),
  snippetCompletion('{ kind: "phase", id: "${id}", name: "${Name}" }', {
    label: "phase",
    detail: "snippet",
    info: "A phase in the turn.",
    type: "keyword",
  }),
  snippetCompletion('{ id: "${id}", name: "${Name}", of: "model", type: "number" }', {
    label: "characteristic",
    detail: "snippet",
    info: "A stat on each model's profile.",
    type: "keyword",
  }),
  snippetCompletion(
    '{\n  id: "${id}",\n  name: "${Name}",\n  summary: "${What to do}",\n  setup: (table) => ({ zones: [], objectives: [{ id: "middle", position: { x: 0, y: 0 } }] }),\n  scoring: [\n    {\n      id: "${hold}",\n      name: "${Held}",\n      at: { roundEnd: true },\n      suggest: (game, seat) => ({ vp: 1, why: "${why}" }),\n    },\n  ],\n}',
    { label: "mission", detail: "snippet", info: "A mission: setup and scoring.", type: "keyword" },
  ),
  snippetCompletion('{ template: "${Ruin}", id: "${id}", position: { x: ${0}, y: ${0} }, facing: 0 }', {
    label: "terrain",
    detail: "snippet",
    info: "A terrain piece from a template (Ruin, Small ruin, Tall ruin, Container, Woods, Barricade, Crater, Hill).",
    type: "keyword",
  }),
  snippetCompletion('look: { shape: "${trooper}", color: "${#8a6bb8}" }', {
    label: "look",
    detail: "snippet",
    info: "A model's stand-in figure: trooper, brute, robed, beast, walker, drone or vehicle.",
    type: "keyword",
  }),
  snippetCompletion('(view) => [{ unitId: ${id}, message: "${what is wrong}", severity: "warning" }]', {
    label: "check",
    detail: "snippet",
    info: "A table warning.",
    type: "keyword",
  }),
];

/** What to offer at the cursor: ctx. or view. members, or keys and snippets. */
export function sdkCompletions(context: CompletionContext) {
  const member = context.matchBefore(/\b(ctx|view)\.\w*$/);
  if (member) {
    const dot = member.text.indexOf(".");
    return {
      from: member.from + dot + 1,
      options: member.text.startsWith("ctx") ? CTX : VIEW,
      validFor: /^\w*$/,
    };
  }
  const word = context.matchBefore(/\w+$/);
  if (!word && !context.explicit) return null;
  // Not after some other object's dot: that's that object's members, which we don't know.
  if (word && context.state.sliceDoc(word.from - 1, word.from) === ".") return null;
  return { from: word?.from ?? context.pos, options: KEYS, validFor: /^\w*$/ };
}
