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

A proposal is needed to:

- change the **network protocol** or the shape of an event (bumps `PROTOCOL`);
- change the **module API** in a way an existing package would notice (bumps `MODULE_API`);
- change **what a ranked result records or signs**, or how ratings are worked out;
- add or change a **standard ruleset** for the public ranked board;
- change the **licence**, this page, or the code of conduct.

[docs/compatibility.md](docs/compatibility.md) says what each version number promises.

## Forks

Forks are welcome; the code is MIT. A fork that changes the protocol, the reducer or what ranked results mean should use its own name and its own ranked board, so players on either side are never mixed up. See "The Open Battle name" below.

## The Open Battle name

"Open Battle" names this project and builds that play by its protocol. A build may call itself Open Battle, and post results to the public ranked board, only if it speaks the current protocol unchanged. Anything else (a fork, a rebrand, a heavily modded build) is welcome under another name, with a line saying it is based on Open Battle. This is a project policy, not a registered trademark.

## Publisher IP

No publisher's names, stats, points, rules text or art go in the repository or in listed community modules. See [CONTRIBUTING.md](CONTRIBUTING.md#principles). A maintainer removes such content as soon as it is found.

## Conduct

Everyone in project spaces follows the [Code of Conduct](CODE_OF_CONDUCT.md).
