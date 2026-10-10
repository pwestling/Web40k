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

A ranked result (`RankedResult` in `src/core/ranked.ts`) records `rules`: the build that wrote it and every package the game ran, by id, version and hash, with the game's own package marked `game`. Both players sign it along with the score, and each signer first checks:

- the build is their own, so a signed result means both ran it;
- every package is in their own library, and it is the game itself exactly when the file's own manifest says `kind: "system"` (the host can't relabel house rules as the game);
- the shared dice of every round rolled the same on their device (below).

Ratings are worked out on each device, one ladder at a time (`ladderKey` in `src/ranked/ratings.ts`):

- **Named rulesets.** [`rulesets.json`](../rulesets.json) names seasons: a system, the app versions and the sets of package hashes that play as it. A result that matches counts on that season's ladder. A change that plays the same (a typo, a label) adds its hash to the season; a balance change starts a new season with a new id, so old ratings are never rewritten. A test fails when a game shipped in `games/` changes without an entry, so nobody forgets.
- **Everything else** counts on a ladder named by its exact rules: the system, the app version (the build before `+`) and the hash of every package. A buffed copy of a game, a house rule, a fork's build (`0.1.0-<name>`) or a new release each get their own ladder, so nothing changes a rating on another's.
- **Results from before rulesets** record no `rules` and keep to a ladder of their own. Current clients never write one: the host refuses a result that doesn't match what its build would write, and a signer refuses one that doesn't match theirs. Only two players running old builds together could still make one.

**The farming bar.** Keys cost nothing to make, so a player's rating moves only against an opponent who has played five counted games against three different keys. Games against newer keys still count towards that bar. The same two keys count at most three games a day.

## Shared dice

In a ranked game no one device decides a roll (`src/core/sharedDice.ts`, `src/ranked/dice.ts`):

1. The host commits to a secret seed (its SHA-256) in the log.
2. The other ranked player answers with a seed of their own, in the clear.
3. Each event's dice come from both seeds and the event's number, and the log keeps the intent each event came from.
4. When a battle round ends, the host reveals its seed and commits to the next. The other player rolls the round's events again from the log and checks they come out the same. A result whose dice don't check out can't be signed.

A rules package's event is checked by the seed its sandbox was given; running the package again to check its output is still to do. A host that leaves or reloads starts a new commitment, and the stretch it never revealed is counted as unchecked.

What's left: once both seeds are in, the host knows the round's dice, so a modified host could see a roll coming and choose its moves. Answering each roll with a fresh seed from the other player would close that, at the cost of a message per roll.

**Overrides.** Rules are advisory, so players can still edit any roll or wound. Every edit is in the replay; listing them in what both sign is planned.

## Promises for package authors

- A package's `id` names it for good: keep it across versions. Saved games, campaign books and ladders refer to it.
- Use semver in `version`: patch for fixes, minor for new rules, major when an existing game would play differently.
- `api` is the module API version (`MODULE_API` in `src/sdk/index.ts`). A change to `src/sdk` that existing packages would notice raises it. Only `api: 1` exists so far; when 2 arrives, the app should refuse older packages by name, with the reason, rather than run them wrongly.
- Every byte change is a new hash, so every player is asked again and a ranked game with it lands on its own ladder.

## Promises for forks

The code is MIT; fork freely. A fork marks its version with a prerelease tag (`0.1.0-<name>` in `package.json`), so its build string names it and its ranked games keep to their own ladders. If it keeps `PROTOCOL` unchanged and plays by it, it can join Open Battle tables and post to the board ([board-protocol.md](board-protocol.md)). A fork that changes the protocol must change `PROTOCOL`, so players see a clear "can't play together" message instead of a table that drifts. See [GOVERNANCE.md](../GOVERNANCE.md#the-open-battle-name) for when a fork should use its own name.

## Shared servers

Every server the app talks to is open source and lives in this repository (`server/`): the signalling relay, the open tables and ranked results board, and the play-by-mail mailbox. Anyone can run their own with the [self-host kit](self-host.md).

They serve modded clients too. The board stores any result whose two signatures hold, whatever build or packages it came from; it never decides what counts. Its protocol is written down in [board-protocol.md](board-protocol.md). Each client sorts results into ladders by the rules they record, so a modded client's games land on their own ladder and never change ratings on the plain one. A future server feature must keep both properties: open source here, and open to any client that speaks the protocol.

## Changing any of this

Changes to the protocol, the module API, or what a ranked result signs need a proposal first. See [GOVERNANCE.md](../GOVERNANCE.md#changes-that-need-a-proposal).
