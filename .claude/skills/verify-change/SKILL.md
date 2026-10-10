---
name: verify-change
description: Run the right Open Battle checks for a change before pushing (format, lint, typecheck, tests, soak, i18n, smoke) and check compatibility impact. Use before every push or pull request.
---

# Verify a change

## Always

```sh
pnpm format
pnpm lint
pnpm typecheck      # tsc -b; `tsc --noEmit -p .` checks nothing
pnpm test           # or `pnpm vitest run <path>` for the area you touched first
```

## Depending on what changed

| Touched                                                         | Also run                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/core`, `src/net`, `src/systems`, `src/sandbox`, `src/soak` | `pnpm soak` (replay a failure with `SOAK_FROM=<seed> SOAK_SEEDS=1 pnpm soak`) |
| On-screen text                                                  | `pnpm i18n:check`                                                             |
| Exports or files added or removed                               | `pnpm deadcode`                                                               |
| A path a player clicks through                                  | `pnpm smoke <name>` (list in `scripts/smoke.mjs`)                             |
| Bot evaluator or game review                                    | `REVIEW_BENCH=1 npx vitest run src/review/bench`                              |
| Sample armies, rules text, tests with rosters, `games/`         | the `ip-check` skill                                                          |

## Compatibility

Ask of the diff, and say the answer in the commit or pull request:

- Does an event, intent or network message change shape? Bump `PROTOCOL` in `src/protocol.ts`.
- Does a saved game or replay now play differently on a built-in system? Note it in `CHANGELOG.md`: it changes that game's ranked ruleset.
- Does `src/sdk` change in a way an existing package would notice? That is a `MODULE_API` question; read [docs/compatibility.md](../../../docs/compatibility.md).
- Does what a ranked result signs change? Old signatures must still verify.

## Before calling it done

Re-read the diff as a reviewer would, and push only when everything above is clean.
