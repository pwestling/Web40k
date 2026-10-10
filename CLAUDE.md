# Open Battle

A browser-based, peer-to-peer tabletop for miniatures wargames: React Three Fiber on the page, WebRTC between players, and a host-authoritative event log. Start with [docs/architecture.md](docs/architecture.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Rules that never bend

- **No publisher IP.** Never commit unit names, stats, points, rules text, art or models from Games Workshop or any other publisher, not even in tests or comments. Sample armies are invented. Run the `ip-check` skill when in doubt.
- **`src/core` is deterministic.** No `Math.random`, `Date`, timers or DOM. Dice come from the rng passed in. Package and module procedures read the game only through `ctx.view` and roll only with `ctx.roll`.
- **Everything peers must agree on is an event in the log.** Undo, replays, late joining, "What if" branches and desync checks all depend on it.
- **Rules are advisory.** A check is a warning the player can override, never a wall.
- **Compatibility is a promise.** Read [docs/compatibility.md](docs/compatibility.md) before changing an event's shape, the network messages, `MODULE_API` or what a ranked result signs.

## Checks

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

- Type check with `pnpm typecheck` (`tsc -b`). `tsc --noEmit -p .` checks nothing here.
- Run `pnpm soak` after touching `src/core`, `src/net` or a system module. A failure names its seed: `SOAK_FROM=<seed> SOAK_SEEDS=1 pnpm soak`.
- `pnpm i18n:check` runs in CI: wrap new on-screen text in `t()` (see [docs/translating.md](docs/translating.md)).
- `pnpm smoke <name>` drives the built app in a browser for one path.

## Where things go

- CSS goes in the area's sheet under `src/styles/`, never a new `styles.css`.
- New game systems: `src/systems/<id>/` ([docs/system-modules.md](docs/system-modules.md)), or a package file ([docs/packages.md](docs/packages.md)).
- Our own CC BY games live in `games/`.

## Skills

`.claude/skills/` has guided workflows: `rules-package`, `system-module`, `ip-check`, `verify-change` and `propose-change`.
