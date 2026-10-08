# Contributing to Open Battle

Thanks for helping. Open Battle is a browser-based, peer-to-peer tabletop for miniatures wargames. This page covers how to get it running, what to check before you push, how the code is laid out, and the few rules the project holds to.

## Setup

You need Node 22 or newer and [pnpm](https://pnpm.io). `corepack enable` gives you the right pnpm version.

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

The landing page has a **Try it now** card for each built-in game. One click sets up a hotseat game with two sample armies, which is the quickest way to see a change.

To try an online game on one machine, open two tabs: host in one and join in the other, or tick **Same browser** under **More ways to play** to skip the network.

## Before you push

CI runs these, so run them locally first:

```sh
pnpm format       # Prettier (CI runs pnpm format:check)
pnpm lint         # ESLint
pnpm typecheck    # tsc -b, the real type check
pnpm test         # Vitest unit tests
```

Two notes:

- Type check with `pnpm typecheck` (or `pnpm tsc -b`). The root `tsconfig.json` only holds project references, so `tsc --noEmit -p .` checks nothing and always passes.
- CI also runs `pnpm soak`, which plays 20 seeded bot games per system with dropped connections, host changes, undo and branching thrown in. It takes a few minutes, so you don't have to run it every time, but do run it if you touch the engine, the network session or a system module. A failure names its seed; `SOAK_FROM=<seed> SOAK_SEEDS=1 pnpm soak` replays just that game, and `SOAK_TRACE=1` prints every move. A nightly job runs 200 seeds per system.

## Code layout

```
src/
  core/        The generic engine: game state, intents and events, the reducer and
               log, geometry, line of sight, terrain, ranked formations, dice,
               attacks, secrets, teams, branching. No DOM, three.js or network
               imports, so it runs the same on every peer and in tests.
    content/   The rules schema (GameSystem, schema.ts), the expression evaluator,
               the data procedure runner, turn structure and action play.
  sdk/         The game module API: GameModule, code actions and procedures,
               turn hooks, missions. Built-in systems and rules packages both use it.
  systems/     The built-in game modules, one folder each: wh40k/, tow/, conquest/,
               fsd/. index.ts registers them; app.ts defines SystemModule, the app glue.
  missions/    Shared sample missions and scoring helpers.
  net/         Transport interface, Trystero (WebRTC) and in-memory loopback
               transports, and the Session that keeps peers in sync, reconnects
               them and hands over the host role.
  packages/    Rules packages: manifests, the local library, sharing between peers.
  sandbox/     Runs package code in a Worker inside a sandboxed iframe.
  render/      The React Three Fiber scene: table, terrain, models, regiments,
               rulers, templates, casualties, cameras.
  ui/          The HTML overlay: lobby, top bar, unit card, attack and charge
               panels, dice tray, terrain editor, replay bar, problem reports.
  assets/      Uploaded figure and terrain model pipeline (parse, simplify, encode, cache).
  talk/        Table talk: pings, arrows, areas, chat and reactions.
  voice/       Voice chat over the game's peer connections.
  broadcast/   Stream view, commentator camera and end-of-game moments.
  secrets/     Keeps a player's secrets (hidden orders, secret objectives) on their device.
  soak/        The soak bot and its seeded games (pnpm soak).
  dev/         Development-only harnesses for perf and in-browser soak runs.
  store.ts     The zustand store that wires a Session to React.
examples/packages/   Example rules packages.
scripts/             Perf, load and browser soak scripts (pnpm perf, perf:load, soak:browser).
server/              The optional self-hosted signalling relay.
docs/                Guides for package and module authors and self-hosters.
```

## Principles

- **Rules are advisory.** The engine measures, highlights, rolls and reminds, but it never blocks a move or a roll. Every number can be edited and every action can be undone. Players stay in charge, as at a real table. If you add a check, make it a warning, not a wall.
- **The game is an event log.** Players send _intents_. Only the host turns an intent into a numbered, fully resolved _event_ (this is where dice are rolled) and appends it to the log. Every peer applies the same events in the same order, so the table is always the starting state with the log folded over it. Live sync, undo, late joining, spectating, replays and "What if" branches all come from that one log. Code in `src/core` must stay deterministic: no `Math.random`, no clocks, no reading from the DOM.
- **Game modules are typed TypeScript.** A system's rules are partly data (`GameSystem`: characteristics, dice, turn structure, keyword rules, data procedures) and partly code (actions, generator procedures, turn hooks, pure functions). Use data for simple keywords and modifiers, and code when a rule needs branches or loops. See [docs/system-modules.md](docs/system-modules.md).
- **No publisher IP in the repo.** Never commit unit names, stats, points, rules text, artwork or models from Games Workshop or any other publisher. Sample armies, missions and rules in this repo are invented. Describe built-in games by how they play ("Sci-fi battle", "Rank and flank"), not by trademarked names, on screen.
- **Player data stays with players.** Army lists, uploaded figures and published rules are imported by players at runtime and never committed, not even as test fixtures. Write test rosters by hand with made-up names.

## Reporting a bug

The best bug report includes a problem report file:

1. In a game, open the left-hand menu (**☰ Menu** if it is hidden) and press **Report a problem**, next to **Download replay**. It downloads one `.json` file.
2. If the app crashed, the crash screen offers **Download a problem report** instead.
3. Open a [bug report](https://github.com/pwestling/web40k/issues/new?template=bug_report.yml) and attach the file.

The file is a replay with extra details: the app build, the rules packages in use, recent console errors, sync checksums and connection stats. Anyone can open it with **Open a replay file** on the landing page, and the viewer jumps to the moment the report was made. Nothing is sent anywhere; you download it and choose who to give it to. See the bug report form for exactly what it contains.

## More docs

- [docs/system-modules.md](docs/system-modules.md): write a game system module.
- [docs/packages.md](docs/packages.md): write a rules package that players load at runtime.
- [docs/self-host.md](docs/self-host.md): run your own copy of the app, signalling relay and TURN server.

## Pull requests

Keep pull requests focused, say what you changed and how you tested it, and include a screenshot for UI changes. By contributing you agree that your work is released under the [MIT License](LICENSE).
