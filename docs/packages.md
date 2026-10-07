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

| Command                                  | Result                | What it does                                                                               |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `ctx.roll("3d6", label, unitId?, need?)` | `{ rolls, total }`    | Rolls dice with the host's dice. With `need`, the log shows "3+: 2 of 3" instead of a sum. |
| `ctx.ask(player, question, options)`     | the chosen option id  | Shows the question to that player and waits for an answer.                                 |
| `ctx.note(text)`                         | none                  | Adds a line to the game log.                                                               |
| `ctx.emit(event)`                        | none                  | Changes the table with an ordinary game event, e.g. `model/wounds` or `unit/status`.       |
| `ctx.set(key, value)`                    | none                  | Stores the package's own state, which you read back as `ctx.view.own[key]`.                |
| `ctx.run(procedure, roles)`              | `{ steps, outcomes }` | Runs one of the system's data procedures (an attack sequence or a test) to its end.        |

The first `note` of a rule becomes its heading in the log, and later notes and rolls appear under it. If the rule asks a question before writing anything, the first line it writes afterwards becomes the heading.

### The one hard rule: be deterministic

Only the host runs a rule. To resume after a question, a reconnect or a change of host, it replays the rule from the start and feeds back the recorded results. The replay must yield the same commands in the same order, or the rule is stopped and the log says so. In practice:

- Read the game only through `ctx.view`, which includes `ctx.view.state`, and get randomness only from `ctx.roll`.
- Never use `Math.random`, `Date` or timers, and never keep state in variables outside the generator.
- Keep anything that must last between rules in `ctx.set` and `ctx.view.own`.

## Data calling code

Rules written as data can use package code in two ways:

- `{ "call": "myFunction", "args": [...] }` inside any expression calls one of the package's `functions`. Its signature is `(view, ...args) => number | boolean`, and it must be pure. A bare `{ "ref": "unit" }` argument passes the unit or model it names.
- `{ "do": "script", "procedure": "myRule", "args": { ... } }` in a data effect starts a code procedure once the data procedure finishes.

## The sandbox

A package's code never runs on the page itself. It runs in a Web Worker started inside a sandboxed iframe, which means:

- It has its own empty origin, so it can't reach the app's storage or cookies.
- A content security policy blocks all network access.
- It can read the game and suggest results, and nothing more.

The worker keeps its own copy of the game, updated with every event, so calls into it are small.

If any call into the package (`available`, `targets`, a step of a rule) takes longer than 250 ms, the sandbox is shut down for the rest of the game, and players see that the package's rules are off. Keep loops bounded.

## Trying it

1. Run `pnpm dev`, choose the game system in the lobby and click **Load package…**. Read the consent sheet, then click **Load it**.
2. Start a game, open **Game settings** and tick the package.
3. When you host online, the other players are asked to accept the package. Their copy comes from you over the peer connection and is checked against its SHA-256 hash.

Changing a single byte creates a new version with a new hash, so every player has to accept it again. To unit-test a package, `src/sandbox/sandbox.test.ts` shows how to load one into the sandbox engine under Vitest and play intents against it.
