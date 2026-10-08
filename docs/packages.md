# Writing a rules package

A rules package adds rules to a game system that Open Battle already knows. For example, it can add a unit ability, an army rule or a house rule. Each package is a single JavaScript file. Players load it from the lobby, and the host shares it with everyone at the table, so every player runs exactly the same bytes.

For a complete working package, see [`examples/packages/second-wind.js`](../examples/packages/second-wind.js). It adds one invented rule to the Old World system.

**Never put Games Workshop text, art, stats or points in a package you publish.** Write the rule in your own words and let players enter the numbers. The same rule applies to this repository.

## The file

A package is an ES module with no imports. It exports two things:

```js
export const manifest = {
  id: "you.my-rules", // stable across versions
  name: "My rules",
  version: "1.0.0",
  author: "You",
  api: 1, // the game module API version (MODULE_API in src/sdk)
  kind: "extension", // adds to a built-in system
  systems: ["tow"], // a prefix matches: "tow" covers "tow-hand", "forty-k" covers "forty-k-11"
  requires: [],
  adds: "One sentence the consent sheet shows players before the code runs.",
};

export default {
  actions: [], // buttons on the unit card
  procedures: {}, // rules other code (or data) can start by id
  functions: {}, // pure helpers data expressions can call
  hooks: {}, // procedures run when phases and rounds start and end
  rules: [], // data: rules (keywords, abilities) in the system's rules schema
  abilityTimings: [], // data: when abilities matching some text come up
};
```

The app reads the manifest as data, without running anything, so it can show the consent sheet first. That means the manifest must be a plain literal. Variables, function calls, spreads and `${}` templates are rejected.

The types for everything below live in `src/sdk/index.ts`. To get type checking, write the package in TypeScript against that file and then compile it to a single `.js` file with no imports.

## Actions

An action is a button on the unit card:

```js
{
  id: "secondWind",
  name: "Second wind",
  by: "unit",
  phases: ["strategy"], // phase ids from the system's turn structure
  applies: (view, actor) => true, // hide it from units that could never take it
  available: (view, actor) => true || "why not", // greyed out, with the reason shown
  targets: (view, actor) => [{ unitId, label }], // optional: the player picks one
  run: function* (ctx, args) { ... }, // args.unit, and args.target if it takes one
}
```

`applies`, `available` and `targets` run every time the card redraws, so keep them quick and side-effect free.

## Procedures: rules as generators

A rule is a generator function. It yields commands and receives each command's result back:

| Command                                      | Result                | What it does                                                                                        |
| -------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `ctx.roll("3d6", label, unitId?, need?)`     | `{ rolls, total }`    | Rolls dice with the host's dice. With `need`, the log shows "3+: 2 of 3" instead of a sum.          |
| `ctx.ask(player, question, options)`         | the chosen option id  | Shows the question to that player and waits for an answer.                                          |
| `ctx.note(text)`                             | none                  | Adds a line to the game log.                                                                        |
| `ctx.emit(event)`                            | none                  | Changes the table with an ordinary game event, e.g. `model/wounds` or `unit/status`.                |
| `ctx.set(key, value)`                        | none                  | Stores the package's own state, which you read back as `ctx.view.own[key]`.                         |
| `ctx.run(procedure, roles)`                  | `{ steps, outcomes }` | Runs one of the system's data procedures (an attack sequence or a test) to its end.                 |
| `ctx.secret(player, key, question, options)` | the commitment        | Asks a player to choose in secret. Their device keeps the choice; the table gets only a commitment. |
| `ctx.reveal(player, key)`                    | the chosen option id  | Has that player's device reveal the secret. Every player checks it against the commitment.          |

The first `note` of a rule becomes its heading in the log, and later notes and rolls appear under it. If the rule asks a question before writing anything, the first line it writes afterwards becomes the heading.

### The one hard rule: be deterministic

Only the host runs a rule. To resume after a question, a reconnect or a change of host, it replays the rule from the start and feeds back the recorded results. The replay must yield the same commands in the same order, or the rule is stopped and the log says so. In practice:

- Read the game only through `ctx.view`, which includes `ctx.view.state`, and get randomness only from `ctx.roll`.
- Never use `Math.random`, `Date` or timers, and never keep state in variables outside the generator.
- Keep anything that must last between rules in `ctx.set` and `ctx.view.own`.

### Secrets

A secret (a hidden order, a secret objective) never leaves its owner's device until they reveal it. `ctx.secret` puts a SHA-256 commitment of the choice and a random salt in the game, at `ctx.view.state.secrets[player][key]`. Nobody else can read it, the host included. `ctx.reveal` has the owner's device send the choice and the salt, and every player's app checks them against the commitment, so a secret can't be changed after it was committed. A revealed secret's value is at `secrets[player][key].revealed.value`.

## Turn hooks

`hooks` runs procedures when the turn moves on:

```js
hooks: {
  phaseStart: { strategy: function* (ctx, args) { ... } }, // args: { phase, round, player }
  phaseEnd: { combat: function* (ctx, args) { ... } },
  roundStart: function* (ctx, args) { ... },
  activationEnd: function* (ctx, args) { ... }, // games where units activate one at a time
}
```

The host starts them one after another, in this order: phase end, round start, phase start. If one asks a question, the next waits for the answer. `args.player` is the player whose turn it is.

## Campaign rules

Two more hooks run only in games played for a campaign book. A package can
use them to add experience, honours and scars to a campaign (roadmap 24b):

```js
hooks: {
  beforeGame: function* (ctx, args) { ... }, // once the battle starts
  afterGame: function* (ctx, args) { ... },  // once it's over and scored, before the book records it
}
```

Both get `args.units`: every campaign unit on the table, each with `key`,
`unitId`, `name`, `owner` and its story so far (`games`, `kills`, `xp`,
`honours`, `scars`). For `afterGame`, each unit also has this game's `slain`
and `survived`.

`afterGame` gives awards by emitting them:

```js
yield ctx.emit({ type: "campaign/award", key: u.key, unitId: u.unitId, xp: 1 });
yield ctx.emit({ type: "campaign/award", key: u.key, unitId: u.unitId, scar: "Old wound" });
```

The book adds each award to the unit's story when it records the game. The
awards are in the log, just like the rolls behind them, so every player's copy
of the book comes out the same.

`beforeGame` applies effects carried over from earlier games, using ordinary
table events or notes.

`examples/packages/battle-scars.js` is a worked example. Its rules are
invented ones that work in any game.

## Data rules

`rules`, `abilityTimings`, and `actions` entries without a `run`, are plain data in the system's rules schema (`src/core/content/schema.ts`). They are added to the system on every player's screen that runs the package, so previews and panels show them as well. A data rule with the same id as a built-in one replaces it.

## Data calling code

Rules written as data can use package code in two ways:

- `{ "call": "myFunction", "args": [...] }` inside any expression calls one of the package's `functions`. While a game uses a package, the host resolves every action in the sandbox, so these calls always reach the package. Its signature is `(view, ...args) => number | boolean`, and it must be pure. A bare `{ "ref": "unit" }` argument passes the unit or model it names.
- `{ "do": "script", "procedure": "myRule", "args": { ... } }` in a data effect starts a code procedure once the data procedure finishes.

## A whole game

A package can also bring an entire game system. Set `kind: "system"` and list the new system's id in `systems`, then export `{ module }`. The module has the same shape as a built-in one (`GameModule` in `src/sdk`):

```js
export default {
  module: {
    id: "arena", version: "1.0.0", api: 1,
    system, // the rules as data: characteristics, dice, turn structure, rules, procedures, actions
    app: { sample: (seat) => roster, layout: (table) => ({ terrain: [], objectives: [], zones: [] }) },
    actions: [...], procedures: {...}, hooks: {...}, functions: {...},
  },
};
```

Once a player trusts the package, its game appears in the lobby's **Game** list, and a game started with it names the package so every player gets the code.

The rest of `app` (`PackageApp` in `src/sdk`) is optional, and all of it runs in the sandbox:

- `sample(seat)` and `layout(table)` run once when the package loads, and the results are handed to the app as data.
- `armies` lists every sample army players can pick from (one per faction). Without it, **Add an army** offers the two `sample` gives.
- A sample army's model can say how it looks: `look: { shape, color }` draws a stand-in figure (`trooper`, `brute`, `robed`, `beast`, `walker`, `drone` or `vehicle`) in that colour, and `height` sets its line-of-sight height in inches.
- In `layout`, a terrain entry can name one of the app's terrain templates instead of listing solids: `{ template: "Ruin", id: "r1", position: { x, y }, facing }` (Ruin, Small ruin, Tall ruin, Container, Woods, Barricade, Crater, Hill). `templateCategory` maps each template to one of the game's terrain categories.
- `missions` are picked at setup, like a built-in game's (`Mission` in `src/sdk`). They run in the sandbox: `setup` once for the system's `defaultTable` (scaled to the table played on), and each `suggest` as the game goes, with the answers handed to the app.
- `importRoster(fileName, data)` reads an army list file (`data` is its bytes) and returns a roster shaped like `sample`'s. The lobby's **Add an army** uses it for the package's game.
- `rankRules(game, unit)` returns `{ width, maxBonus }` for rank-and-file games, and `leaving(game)` lists the units that must leave the table. Both run after every event, and the app reads their latest answers.
- `sidePanel(view)` describes a panel of the game's own, as data: a `title`, text `lines`, and `buttons` that each start one of the package's procedures (`{ label, procedure, args?, player?, disabled? }`). It is redrawn after every event; return `null` to hide it.

[`examples/packages/arena.js`](../examples/packages/arena.js) is a complete small game, and [`games/rift-lanterns`](../games/rift-lanterns/README.md) is a whole one, with factions, missions and stand-in figures.

## The sandbox

A package's code never runs on the page itself. It runs in a Web Worker started inside a sandboxed iframe, which means:

- It has its own empty origin, so it can't reach the app's storage or cookies.
- A content security policy blocks all network access.
- It can read the game and suggest results, and nothing more.

The worker keeps its own copy of the game, updated with every event, so calls into it are small.

If any call into the package (`available`, `targets`, a step of a rule) takes longer than 250 ms, the sandbox is shut down for the rest of the game, and players see that the package's rules are off. Keep loops bounded.

## Trying it

The quickest way is the **Module workshop** on the start page: an editor that checks your code against the SDK's types as you type (a wrong key, event type or `ctx` call is underlined with the reason, and hovering shows a type and its comment), starter templates, a test table that reloads your package every time you save (Ctrl+S), the soak bot, a **Check** button that gives one verdict (types, loading with the shape check, and a two-round bot game), and export as a file or as a pull request for the [community modules](community-modules.md) gallery.

By hand:

1. Run `pnpm dev`, choose the game system in the lobby and click **Load package…**. Read the consent sheet, then click **Load it**.
2. Start a game, open **Game settings** and tick the package.
3. When you host online, the other players are asked to accept the package. Their copy comes from you over the peer connection and is checked against its SHA-256 hash.

Changing a single byte creates a new version with a new hash, so every player has to accept it again. To unit-test a package, `src/sandbox/sandbox.test.ts` shows how to load one into the sandbox engine under Vitest and play intents against it.
