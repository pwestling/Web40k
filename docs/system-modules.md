# Write a system module

A system module teaches Open Battle a whole game: how its turn runs, what its units look like, how far they move, how they fight, what the table looks like and how a sample army plays. The four built-in games are system modules, in `src/systems/`:

| Folder     | System id       | Shown as                |
| ---------- | --------------- | ----------------------- |
| `wh40k`    | `forty-k-11`    | Sci-fi battle           |
| `tow`      | `tow-hand`      | Rank and flank          |
| `conquest` | `conquest-hand` | Conquest                |
| `fsd`      | `fsd-1.7`       | Full Spectrum Dominance |

This guide is for adding a game to the repo itself. If you want to add rules to a game that already exists, or ship a game that players load at runtime without a new build, write a rules package instead: see [packages.md](packages.md). Both use the same `GameModule` shape from `src/sdk/index.ts`, and the package guide covers the code side (generator procedures, `ctx`, determinism, secrets, turn hooks) in detail. This page covers what a built-in module adds on top and how the four existing ones fit together.

**No publisher IP.** Everything in a module is mechanics written in your own words, invented sample armies and invented missions. Never commit unit names, stats, points, rules text or art from a published game. Players bring their own armies at runtime.

## Anatomy of a module

A module is one `GameModule<SystemModule>` value, exported from `src/systems/<folder>/module.ts`. The smallest built-in one is Full Spectrum Dominance:

```ts
// src/systems/fsd/module.ts
export const fsdModule: GameModule<SystemModule> = {
  id: fsd.id,
  version: fsd.version,
  api: 1,
  system: fsd,
  app: {
    sample: fsdSample,
    layout: (t) => fsdLayout(t.width, t.depth),
    templateCategory: FSD_CATEGORIES,
    missions: [holdTheField()],
  },
};
```

It has these parts:

| Part         | Type                                        | What it is                                                                                    |
| ------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `system`     | `GameSystem` (`src/core/content/schema.ts`) | The rules as data: characteristics, dice, turn structure, actions, procedures, keyword rules. |
| `app`        | `SystemModule` (`src/systems/app.ts`)       | App glue: sample armies, the starting table, army list import, panels, missions, extra dice.  |
| `actions`    | `CodeAction[]` (`src/sdk`)                  | Buttons on the unit card whose rule runs as code.                                             |
| `procedures` | `Record<Id, CodeProcedure>`                 | Rules as generator functions that other rules, buttons or data can start.                     |
| `functions`  | `Record<Id, PureFn>`                        | Pure helpers that data expressions call with `{ call: "id", args }`.                          |
| `hooks`      | `TurnHooks`                                 | Procedures run when a phase or round starts or ends, or an activation ends.                   |

`registerModule` in `src/systems/index.ts` wires all of these up: it registers the system with the engine, registers code procedures under the system's id (a code action runs as the procedure with the same id), registers pure functions and turn hooks, and adds the module to the list the app reads with `gameModule(id)` and `systemModule(id)`.

### The system: rules as data

`GameSystem` is the part every module has. The fields that shape a game most are:

- `units`: `"inch"`, `"cm"`, or a custom unit such as Full Spectrum Dominance's `{ name: "DU", inches: 3 }`.
- `defaultTable`: table size in inches, for example `{ width: 72, depth: 48 }`.
- `dice`, `defaultDie` and optionally `dieLadder` for "step the die up" rules.
- `characteristics`: the stat line, for models, weapons and units. Each has an `id` (what rules refer to), a `type` and `aliases` that match column names in imported army lists.
- `unitShape`: `{ kind: "skirmish" }` for models that move freely, kept together by coherency checks, or `{ kind: "ranked", ... }` for rigid blocks that wheel, reform, turn and march.
- `turn`: the turn structure (see below).
- `actions`: what units and players can do. An action can cost resources, have a limit, require a condition, react to an event, move the unit, start a procedure or apply effects directly.
- `procedures`: data procedures such as an attack sequence (roll to hit, roll to wound, save, damage) run by the procedure runner in `src/core/content/runner.ts`.
- `rules`, `coreEffects` and `statuses`: keyword rules and always-on effects, written as "when X, if Y, do Z".
- `checks`: advisory warnings, for example "bases within 1 DU" after a move.
- `terrain`: the system's terrain categories and what each does to movement, sight and cover.
- `constants`: named numbers rules can read as `const.<id>`.
- `settings`: table settings the system plays with by default, such as its line of sight mode.

The turn structure is a list of segments. A phase is a window where listed actions are offered. `playerTurns` gives each player a full turn of the nested segments (I go, you go). `alternate` has players take turns activating one thing from a pool. Here is Full Spectrum Dominance's round: roll a pool of activation dice, place some on cards' slots ahead of time, alternate spending them, then score and tidy up. A phase with `placeDice` opens a window for placing pool dice on cards; a dice pool with a `total` counts dice still on cards against the next roll.

```ts
// src/core/content/examples/fsd.ts
round: [
  {
    kind: "step",
    id: "rollActivationDice",
    do: [
      { do: "gainResource", resource: "readyDice", amount: ref("const.adCapacity"), player: "owner" },
      { do: "gainResource", resource: "readyDice", amount: ref("const.adCapacity"), player: "opponent" },
    ],
  },
  { kind: "phase", id: "preassign", name: "Pre-assign ADs", placeDice: true },
  {
    kind: "alternate",
    id: "activations",
    pool: { kind: "resource", resource: "readyDice" },
    actionsPerActivation: 2,
    activation: [
      {
        kind: "phase",
        id: "activation",
        name: "Activations",
        actions: ["activate", "deploy", "react", "unpin", "move", "fire", "prepare", "interact"],
      },
    ],
  },
  { kind: "phase", id: "scoring", name: "Scoring" },
  { kind: "phase", id: "cleanup", name: "Cleanup", placeDice: true },
],
```

Where the system data lives is a matter of history: the sci-fi and Full Spectrum Dominance systems are in `src/core/content/examples/` (`forty-k.ts`, `fsd.ts`), and the rank-and-flank and Conquest systems are in their own folders (`src/systems/tow/system.ts`, `src/systems/conquest/system.ts`). New systems should follow the second pattern and keep everything in their folder.

### Line of sight

Line of sight is a per-game choice, set in `system.settings` and stored on each game as `GameState.settings` (`TableSettings` in `src/core/types.ts`):

- `los: "true"` (the default) traces lines from model to model against the actual terrain and model shapes.
- `los: "heights"` uses stand-in heights: each terrain piece is a flat-topped block, each model a cylinder, and sight clears if the line between their tops clears everything in between.
- `los: "footprint"` ignores height: lines run from base centre to base centre, and each terrain piece is open, obscuring or blocking.
- `modelsBlock` says whether models block sight, and `visionArc` limits sight to an arc around each model's facing (90 degrees in the rank-and-flank games).

A single terrain piece can override the mode with its own `sight` field, so a hill can be a stand-in block even in a true line of sight game.

### Data or code?

Use data for anything the schema can say: a keyword that adds an attack, a modifier in cover, a resource cost, a simple check. Use code when a rule needs branches, loops or questions. The rank-and-flank combat, charge reactions and panic tests are code (`src/systems/tow/combat.ts`), offered on the unit card as `CodeAction`s:

```ts
// src/systems/tow/combat.ts
export const towActions: CodeAction[] = [
  // ...
  {
    id: "panic",
    name: "Panic test",
    by: "unit",
    available: panicAvailable, // true, or a reason it can't be taken right now
    run: panic, // a CodeProcedure: yields ctx.roll, ctx.note, ctx.emit, ...
  },
];
```

Data can call code too. Conquest's command stack decides which regiment may activate next with a pure function, `nextCard` in `src/systems/conquest/command.ts`, which its data actions call as `{ call: "nextCard", args: [...] }`.

Code procedures must be deterministic: only the host runs them, and it replays them from the start to resume after a question or a change of host. Read the game through `ctx.view`, get dice only from `ctx.roll`, and keep state in `ctx.set`. [packages.md](packages.md) explains the commands and the rules in full; they apply to built-in modules exactly as they do to packages.

### The app glue

`SystemModule` in `src/systems/app.ts` is what the app needs besides the rules. Only `sample` and `layout` are required.

- `sample(seat)` returns an `ImportedRoster` (`src/systems/wh40k/roster.ts`): an invented army for seat 0 or 1. The **Try it now** demos and the **Sample army** button use it. Use made-up names and numbers.
- `layout(table)` returns a `Layout` (`src/core/actions.ts`): terrain pieces, objectives and deployment zones for a table of that size. `makePiece` in `src/systems/wh40k/layout.ts` builds a piece from one of the shared terrain templates ("Ruin", "Woods", "Hill" and so on).
- `templateCategory` maps those shared template names to the system's own terrain categories, so the terrain editor places the right kind of piece.
- `importRoster(fileName, data)` reads an army list file. Without it, the app uses the BattleScribe and New Recruit reader in `src/systems/wh40k/roster.ts`.
- `rankRules(game, unit)` gives rank width and the rank bonus cap for ranked units.
- `chargeRoll`, `fleeDice`, `templates`, `specialDice` and `scatter` set up the charge panel, flee and pursuit rolls, blast and flame templates, and dice with named faces in the dice tray.
- `panel` is a React component drawn during play, for a system that needs a panel of its own (Conquest's command stack).
- `leaving(game)` lists what's still undone in this phase, so **Next phase** can ask before moving on.
- `dedicatedUi` switches on the sci-fi game's own attack editor and phase moves. Other systems use the generic action and procedure panels, which is what a new system should do.
- `secretObjectives` names the game's hidden objectives, kept on each owner's device until revealed.
- `missions` lists the `Mission`s players can pick at setup (see below).

### Missions

A `Mission` (`src/sdk/index.ts`) says where the armies deploy, where the objectives go and how victory points are scored. At each scoring moment the app suggests each side's score from `suggest`, and a player confirms or changes it. Nothing is scored without a person saying so. `holdTheField()` in `src/missions/holdTheField.ts` is a small invented mission any system can use; `src/missions/common.ts` has helpers such as `edgeZones`, `objective` and `holders`. A mission can also have a `deck` of secret mission cards.

## The four built-in modules

|               | Sci-fi battle (`wh40k`)                                    | Rank and flank (`tow`)                                                                                        | Conquest (`conquest`)                                                                                     | Full Spectrum Dominance (`fsd`)                                                                                 |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Turn          | I go, you go: five phases per player turn, 5 rounds        | I go, you go: four phases per player turn, 6 rounds                                                           | Command phase, then alternating activations (two actions each), then Victory; 10 rounds                   | Roll activation dice, pre-assign them to cards, then alternate spending them (simultaneous reactions); 6 rounds |
| Units         | Free models (`skirmish`) with coherency                    | Ranked blocks, rank width by troop type                                                                       | Ranked blocks of stands, two wide                                                                         | Free bases (`skirmish`)                                                                                         |
| Distance      | Inches, 60" x 44" table                                    | Inches, 72" x 48"                                                                                             | Inches, 72" x 48"                                                                                         | DU (3"), 36" x 24"                                                                                              |
| Line of sight | `true` (default)                                           | `true`, 90° vision arc                                                                                        | `true`, 90° vision arc                                                                                    | `footprint`                                                                                                     |
| Attacks       | Data procedure, plus its own attack editor (`dedicatedUi`) | Shooting as data; close combat as code                                                                        | Data procedures (clash and volley)                                                                        | Data procedure, saves opposed to the hit roll                                                                   |
| Code          | `functions`: `enemyGap`, `belowHalf`                       | `actions`: charge, fight, panic                                                                               | `procedures` (morale, reinforcements), `functions` (`nextCard`), `actions` (characters joining regiments) | Areas of control as table `checks`; the rest is data                                                            |
| App extras    | Secret objectives, missions                                | Army import, `rankRules`, templates, scatter and artillery dice, flee dice, 2D6-keep-highest charge, missions | Command stack `panel`, `leaving`, `rankRules`, 1D6 charge, sample mission                                 | Sample mission, dice on card slots, prepared tokens, support cards, reserves                                    |
| Secrets       | Secret objectives                                          | None                                                                                                          | Each command card is a secret until drawn                                                                 | None                                                                                                            |

Full Spectrum Dominance shows how far data alone can go. Rank and flank is the model for a game with complex code rules and its own army import. Conquest is the model for a game with its own panel and hidden information.

## Add a new system

Say you are adding a made-up skirmish game, "Ridge", in `src/systems/ridge/`. The quickest route is to copy the built-in system closest to yours and change it.

1. **Write the system.** Create `src/systems/ridge/system.ts` exporting a `GameSystem`. Give it an `id` that names the game and edition, say `"ridge-1"` (it's stored in every saved game and replay, so don't change it later), a `name`, a `version`, and at least `units`, `dice`, `defaultDie`, `characteristics`, `weaponKinds`, `unitShape`, `rules`, `procedures`, `actions` and `turn`. Set `settings.los` if your game doesn't use true line of sight. Start small: a turn structure, a move action and one attack procedure is enough to play.

2. **Write a sample army.** Create `sample.ts` exporting `ridgeSample(seat: 0 | 1): ImportedRoster`. Each unit needs a name, a base (`{ shape: "round", diameterMm: 32 }` and the like), a sheet with weapons, abilities, keywords and points, and its models with profiles keyed by your characteristic ids. `src/systems/fsd/sample.ts` is a compact example. Invent everything.

3. **Write a layout.** Create `layout.ts` exporting `ridgeLayout(width, depth): Layout` and a `RIDGE_CATEGORIES` map from template names to your terrain category ids. `src/systems/fsd/layout.ts` builds a point-symmetric table in about 50 lines.

4. **Add code where data falls short.** Put code actions, procedures, functions and hooks in their own files and import them into the module. Keep them deterministic.

5. **Write the module.** Create `module.ts`:

   ```ts
   import type { GameModule } from "../../sdk";
   import type { SystemModule } from "../app";
   import { holdTheField } from "../../missions/holdTheField";
   import { ridge } from "./system";
   import { ridgeSample } from "./sample";
   import { ridgeLayout, RIDGE_CATEGORIES } from "./layout";

   export const ridgeModule: GameModule<SystemModule> = {
     id: ridge.id,
     version: ridge.version,
     api: 1,
     system: ridge,
     app: {
       sample: ridgeSample,
       layout: (t) => ridgeLayout(t.width, t.depth),
       templateCategory: RIDGE_CATEGORIES,
       missions: [holdTheField()],
     },
   };
   ```

6. **Register it.** Add `ridgeModule` to `BUILT_IN` in `src/systems/index.ts`. The game now appears in the lobby's **Game** list.

7. **Give it a front door.** Add an entry to `FRONT` in `src/ui/systemLabels.ts` (a plain title, a one-line pitch and what an army is called) to get a **Try it now** card on the landing page, and an entry to `LISTS` in `src/ui/ArmyGuide.tsx` so **Bring your army** explains where lists come from. Use a plain description as the title, not a publisher's trademark.

8. **Play it.** Run `pnpm dev`, click your **Try it now** card and play a few rounds against yourself. Press **?** for the controls and **What can I do now?** to check that the right actions are offered each phase.

## Test it

Every built-in system has tests next to it, and you should add the same three kinds.

**The data is valid.** `validateSystem(system)` in `src/core/content/validate.ts` returns a list of broken references: every action, procedure, rule, status, resource, table, arc and plan that something refers to must exist. A phase that offers an action you renamed, or an action that spends a resource you never defined, shows up here. `src/core/content/content.test.ts` checks the example systems with it. Add a test that expects `validateSystem(ridge)` to equal `[]`.

**The rules play out.** Build a game from events and intents, with a seeded random number generator so the dice are the same every run. `src/systems/fsd/fsd.test.ts` is the pattern to copy: its `setup()` seats two players, picks the system with a `game/system` intent, lays out the table, deploys both sample armies with `spawnIntents` from `src/systems/wh40k/deploy.ts`, and then plays intents through `resolveIntent` and `applyEvent`. From there you can check that `currentSlot(state)` moves through your turn structure, that `unitActions(state, unitId)` offers the right actions, and that attacks change wounds the way they should. Import `"../index"` (as `src/systems/conquest/conquest.test.ts` does) when your test needs code procedures registered. `src/systems/tow/combat.test.ts` tests code procedures directly.

**It survives real games.** The soak bot in `src/soak/` plays whole seeded games over in-memory peers: random legal moves, dropped and rejoining players, the host leaving mid-game, undo and "What if" branches. A game fails if any peer's log or table differs from the host's, if anything throws, if a question has no legal answer, or if the game never ends. Adding your system is one file, `src/soak/ridge.soak.test.ts`:

```ts
import { describe } from "vitest";
import { soakSuite } from "./suite";

describe("soak", () => soakSuite("ridge-1"));
```

Run it with `pnpm soak` (plain `pnpm test` skips soak files). A failure prints its seed; `SOAK_FROM=<seed> SOAK_SEEDS=1 pnpm soak` replays that game, and `SOAK_TRACE=1` prints every move. The bot finds legal moves through the same action rules the app uses, so most systems need nothing more. If yours needs the bot to do something special, as Conquest's command stack does, that goes in `src/soak/bot.ts`. In an activation game, check that the bot only moves the turn on once units have acted; if rounds end after a single activation, that's the place to look.

Before you open a pull request, run the full set of checks in [CONTRIBUTING.md](../CONTRIBUTING.md#before-you-push).
