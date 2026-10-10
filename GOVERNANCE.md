# Governance

Open Battle is small and moves fast, so its governance is light. This page says who decides, how a big change is proposed, and what keeps the project fair to players.

## Who decides

- **Lead maintainer:** Porter ([@pwestling](https://github.com/pwestling)). Has the final say while the project is young.
- **Maintainers:** listed in [MAINTAINERS.md](MAINTAINERS.md). They review and merge pull requests in their areas.
- **Contributors:** anyone who opens an issue or pull request.

A maintainer is someone who has landed good work in an area over a few months and is asked to help review it. Maintainers who step away move to the emeritus list.

## Normal changes

Bug fixes, features, docs, translations, new sample content and new game packages go through ordinary pull request review. One maintainer's approval is enough.

## Changes that need a proposal

Some changes affect every player, every saved game, or every package author. They need a short written proposal first: an issue with the `proposal` label saying what changes, why, and what happens to existing games. It stays open for at least seven days before a maintainer accepts or declines it.

Use the **Proposal** issue form; it adds the `proposal` label. A proposal is needed to:

- change the **network protocol** or the shape of an event (bumps `PROTOCOL`);
- change the **module API** in a way an existing package would notice (bumps `MODULE_API`);
- change **what a ranked result records or signs**, or how ratings are worked out;
- add or change a **standard ruleset** for the public ranked board (`rulesets.json`);
- change the **board protocol** ([docs/board-protocol.md](docs/board-protocol.md));
- change the **licence**, this page, or the code of conduct.

[docs/compatibility.md](docs/compatibility.md) says what each version number promises.

## Forks

Forks are welcome; the code is MIT. A fork that changes the protocol, the reducer or what ranked results mean should use its own name and its own ranked board, so players on either side are never mixed up. See "The Open Battle name" below.

## The Open Battle name

"Open Battle" names this project and its releases. The test is the build string every game records (`APP_BUILD`, the `package.json` version plus the commit): an official build carries a release version, such as `0.1.0+abc1234`. A fork or modified build marks its version with a prerelease tag naming it, `0.1.0-<name>`, so its build reads `0.1.0-<name>+<commit>` and its ranked games land on ladders of their own ([docs/compatibility.md](docs/compatibility.md)). Such builds are welcome to play with Open Battle tables and to post to the public board; they use their own name, with a line saying they're based on Open Battle. This is a project policy, not a registered trademark.

**The public board** is the `open-battle-result`, `open-battle-table` and `open-battle-event` tags on public Nostr relays, which the app at https://pwestling.github.io/Web40k/ reads and writes. Its results are public: anyone may read, recompute or mirror the ladders. Self-hosted sites run their own board ([docs/board-protocol.md](docs/board-protocol.md)).

## Contributions

Contributions come in under the licence they go out under: by opening a pull request you agree your work is released under the [MIT License](LICENSE) (code) or [CC BY 4.0](games/rift-lanterns/README.md) (our games' rules and art). There is no CLA and no sign-off line to add.

## Publisher IP

No publisher's names, stats, points, rules text or art go in the repository or in listed community modules. See [CONTRIBUTING.md](CONTRIBUTING.md#principles). A maintainer removes such content as soon as it is found.

## Conduct

Everyone in project spaces follows the [Code of Conduct](CODE_OF_CONDUCT.md).
