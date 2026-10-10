# Compatibility

Anyone can change Open Battle: fork it, write a rules package, run a modified build. This page says how those changes live side by side without splitting the players or making ranked games unfair. The short version: **a casual table plays whatever its players agree to, and a ranked game counts only on the ladder for the exact rules it was played under.**

## The four layers

Every game runs on four layers of code. Each has its own identity and its own rule for what happens when two players differ.

| Layer          | What it covers                                       | Identified by                                                    | Players differ, casual game                                             | Players differ, ranked game                     |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Protocol       | The shape of events, intents and peer messages       | `PROTOCOL` in `src/protocol.ts`                                  | A red banner: the tables can't stay in step. Both reload                | The same                                        |
| App build      | The reducer and the built-in game systems            | The release version and commit (`APP_BUILD` in `src/version.ts`) | A banner naming both builds; play on                                    | The host's build is recorded in the result      |
| Game system    | A built-in system, or a package that is a whole game | The system id, and the package's SHA-256                         | Every player gets the host's package, checked by hash                   | The game's own package doesn't split the ladder |
| Rules packages | House rules, abilities, campaign rules               | The SHA-256 of each file                                         | Each player agrees to each package once; a player without one is marked | Each set of house rules has its own ladder      |

Peers tell each other their protocol and build when they meet (`hello` and `host` messages in `src/net/transport.ts`). Builds from before this check don't send it and are taken to be compatible.

## Ranked games and ladders

A ranked result (`RankedResult` in `src/core/ranked.ts`) records `rules`: the app build that set the game's packages and every package the game ran, by id, version and hash, with the game's own package marked `game`. Both players sign it along with the score.

Ratings are worked out on each device, one ladder at a time (`ladderKey` in `src/ranked/ratings.ts`):

- A game with no house rules counts on its system's plain ladder, named after the game.
- A game with house rules counts on a ladder of its own: the system plus the sorted hashes of the added packages. Two groups who play the same house rules share a ladder without asking anyone. The ladder is named after the game and the packages ("Rift Lanterns with Battle Scars 1.0.0").
- Results from before rulesets record no `rules` and count on the plain ladder.

So a mod can never quietly change someone's rating on the plain ladder, and a community's house rules get a ladder for free.

### What ranked doesn't check yet

- **Builds.** The plain ladder of a built-in game mixes app builds. Balance changes to built-in systems are listed in `CHANGELOG.md`. A future `rulesets.json` will name the standard rulesets the public board highlights, and a balance change will start a new season rather than rewrite ratings.
- **Dice.** The host's device rolls. Signing stops a player from inventing a result, but a modified host could weight its dice. Commit-reveal dice (as play by mail uses) for ranked games are planned.
- **Overrides.** Rules are advisory, so players can edit any roll or wound. Every edit is in the replay; listing them in what both sign is planned.

## Promises for package authors

- A package's `id` names it for good: keep it across versions. Saved games, campaign books and ladders refer to it.
- Use semver in `version`: patch for fixes, minor for new rules, major when an existing game would play differently.
- `api` is the module API version (`MODULE_API` in `src/sdk/index.ts`). A change to `src/sdk` that existing packages would notice raises it. Only `api: 1` exists so far; when 2 arrives, the app should refuse older packages by name, with the reason, rather than run them wrongly.
- Every byte change is a new hash, so every player is asked again and a ranked game with it lands on its own ladder.

## Promises for forks

The code is MIT; fork freely. A fork that keeps `PROTOCOL` unchanged and plays by it can join Open Battle tables and post ranked results, which carry its build. A fork that changes the protocol must change `PROTOCOL`, so players see a clear "can't play together" message instead of a table that drifts. See [GOVERNANCE.md](../GOVERNANCE.md#the-open-battle-name) for when a fork should use its own name.

## Shared servers

Every server the app talks to is open source and lives in this repository (`server/`): the signalling relay, the open tables and ranked results board, and the play-by-mail mailbox. Anyone can run their own with the [self-host kit](self-host.md).

They serve modded clients too. The board stores any result that is shaped right and signed, whatever build or packages it came from; it never decides what counts. Each client sorts results into ladders by the rules they record, so a modded client's games land on their own ladder and never change ratings on the plain one. A future server feature must keep both properties: open source here, and open to any client that speaks the protocol.

## Changing any of this

Changes to the protocol, the module API, or what a ranked result signs need a proposal first. See [GOVERNANCE.md](../GOVERNANCE.md#changes-that-need-a-proposal).
