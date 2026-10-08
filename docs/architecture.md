# Architecture

A map of the code, for finding your way in. The README's "How it works" has the ideas; this says where they live.

## The one flow

```
player input ─► Intent ─► host: resolveLogged (rolls dice) ─► LoggedEvent ─► record
                                                                    │
                     every peer: applyEvent in order ◄──────────────┘
                                    │
                         GameState ─► React UI + three.js table
```

- A **GameState** (`src/core/types.ts`) is plain, serialisable data: players, units, models, terrain, the turn, and whatever a game module keeps.
- A **GameRecord** is the starting state plus the numbered events. `stateAt(record, seq)` rebuilds any moment; undo, replays, branching, late joiners and play by mail all read the record.
- Only the host turns intents into events (`src/net/session.ts`), so only the host rolls dice. Clients send intents and apply what comes back. If the host leaves, another player takes over from the same record.
- The UI never changes the state directly. It calls `dispatch(intent)` on the store (`src/store.ts`), which sends it to the session.

## Folders under `src/`

| Folder                           | What it holds                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`                          | The engine, with no React or three.js: types, reducer, event log, dice, geometry, line of sight, terrain, regiments, attacks, secrets, teams, clocks. `core/units.ts` has the small unit helpers (`aliveModels`, `isAlive`, `centreAbove`). Import from `../core`.                                                                |
| `core/content/`                  | Rules as data: the schema, the expression language (`expr.ts`), the procedure runner that plays attack sequences step by step (`runner.ts`), turn structure (`turn.ts`), and checks for module data (`validate.ts`).                                                                                                              |
| `systems/`                       | The built-in games: `wh40k`, `tow` (The Old World), `conquest`, `fsd`. Each exports a `SystemModule` (`systems/app.ts`): its rules data and code, starting table, sample armies and panels. 40k army import and ability recognition live in `systems/wh40k`.                                                                      |
| `sdk/`                           | The public API that game modules and packages write against. Everything a community module may use comes from here.                                                                                                                                                                                                               |
| `sandbox/`                       | Runs package games (rules loaded at runtime) in a worker, so their code can't touch the page. The engine side asks the worker for each event.                                                                                                                                                                                     |
| `packages/`                      | Loading, hashing and sharing rules packages; peers compare the package's SHA-256 and warn on a mismatch.                                                                                                                                                                                                                          |
| `net/`                           | Sessions and transports: Trystero (WebRTC over Nostr or our relay), a loopback for hotseat and tests, the host's log, checksums, host hand-over.                                                                                                                                                                                  |
| `store.ts`                       | The zustand store: the record, the current state, selection, scrub position, view settings, and `dispatch`.                                                                                                                                                                                                                       |
| `render/`                        | The 3D table (React Three Fiber). `Board.tsx` is the scene; `TablePieces.tsx` (grid, zones, terrain, objectives), `ModelOverlay.tsx` (rings, ghosts, hover labels) and `boardLabels.tsx` (rulers, range outlines, sight lines) are its pieces. Regiments, templates, casualties, cameras and table talk each have their own file. |
| `ui/`                            | The React screens and panels around the table: lobby, top bar, unit cards, attack and procedure panels (`SystemPanels.tsx`, `ProcedurePanels.tsx`), dice tray, game log text (`gameLog.ts`), warnings, odds, stats. Shared UI helpers: `distance.ts` (lengths in the game's units), `files.ts` (saving files), `systemLabels.ts`. |
| `missions/`                      | Missions and scoring suggestions.                                                                                                                                                                                                                                                                                                 |
| `bot/`                           | The computer opponent: the policy and evaluator, the Thinker, the worker it thinks in, and `SoloBot.tsx` which plays its moves.                                                                                                                                                                                                   |
| `soak/`                          | The soak bot: random legal play to find crashes and desyncs (`pnpm soak`).                                                                                                                                                                                                                                                        |
| `teach/`                         | Lessons and the coach.                                                                                                                                                                                                                                                                                                            |
| `replay/`, `share/`              | Replay files and the viewer; clips, picture cards and round cards for sharing.                                                                                                                                                                                                                                                    |
| `mail/`                          | Play by mail: signed turn files, commit-reveal dice, and the mailbox client.                                                                                                                                                                                                                                                      |
| `campaign/`                      | The campaign book: leagues, maps, unit stories, campaign rules.                                                                                                                                                                                                                                                                   |
| `tables/`, `figures/`, `assets/` | Saved tables, the figure library, and the model import pipeline (glTF/STL to compressed meshes).                                                                                                                                                                                                                                  |
| `talk/`, `voice/`, `broadcast/`  | Table talk (pings, drawings, chat), voice over WebRTC, and caster/broadcast views.                                                                                                                                                                                                                                                |
| `companion/`                     | The phone companion for games on a real table.                                                                                                                                                                                                                                                                                    |
| `printplay/`                     | Print and play: the rulebook page and PDF for Rift Lanterns.                                                                                                                                                                                                                                                                      |
| `workshop/`                      | The module workshop: editor, test table, export.                                                                                                                                                                                                                                                                                  |
| `i18n/`                          | `t`, `tc`, `tn` and the PO catalogs. See [translating.md](translating.md).                                                                                                                                                                                                                                                        |
| `sw/`, `viewer/`, `dev/`         | The service worker, the stand-alone replay viewer build, and dev-only tools.                                                                                                                                                                                                                                                      |

Outside `src/`: `games/` holds Rift Lanterns, our own game, written as a package. `server/` holds the signalling relay and the play-by-mail mailbox. `scripts/` holds the browser checks (`pnpm smoke`, `pnpm soak:browser`, perf, screenshots). `examples/` holds sample packages, lessons and workshop templates.

## Rules that keep it working

- **Everything that changes the game goes through the log.** If peers must agree on it, it's an event. Table talk, camera moves and highlights are not.
- **Core is deterministic.** No DOM in `src/core`, and dice come from the rng passed in (the host's, in `resolveLogged`), never from `Math.random` directly. Applying an event must give every peer the same state; that is what makes replays and desync checks work.
- **Game IP stays out.** Built-in systems ship rules mechanics only. Unit data, names and stats come from what players import.
- **Lengths are inches internally.** Show them with `lengthText` / `distanceText` from `ui/distance.ts`, which use the game's own units.

## Checks

`pnpm format:check`, `pnpm lint`, `pnpm tsc -b`, `pnpm vitest run`, `pnpm i18n:check` and `pnpm deadcode` (knip: unused files, exports and dependencies) all run in CI. `pnpm smoke` drives the real app in a browser.

The unit tests take about 53 seconds on four cores. The bot's whole-game tests in `src/bot/bot.test.ts` are the longest file (about 44 seconds).
