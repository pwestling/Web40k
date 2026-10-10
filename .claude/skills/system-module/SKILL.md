---
name: system-module
description: Add or change a built-in Open Battle game system module under src/systems (rules data, code actions and procedures, sample army, layout, soak). Use when changing how a built-in game plays or adding a new built-in game.
---

# Add or change a system module

Built-in games are typed `GameModule`s in `src/systems/<id>/`. The full guide is [docs/system-modules.md](../../../docs/system-modules.md); this is the checklist.

## Adding a system

1. Copy the closest built-in system (`fsd/` is the most compact) to `src/systems/<id>/`.
2. `system.ts`: a `GameSystem` whose `id` names game and edition (`"ridge-1"`). The id is stored in every save and replay: never change it later.
3. `sample.ts`: invented sample armies only. `layout.ts`: a starter table.
4. Code actions, procedures, hooks and functions in their own files, deterministic (see below).
5. `module.ts`, then register it in `BUILT_IN` in `src/systems/index.ts`.
6. Front door: `FRONT` in `src/ui/systemLabels.ts` and `LISTS` in `src/ui/ArmyGuide.tsx`, with a plain description, never a trademark.
7. Tests: `validateSystem(system)` equals `[]`; a rules test copying `src/systems/fsd/fsd.test.ts`; and `src/soak/<id>.soak.test.ts` calling `soakSuite("<id>")`.

## Changing a system

- Use data for keywords and modifiers, code when a rule needs branches or loops.
- A change that makes an existing replay play differently changes the game for ranked ladders. Say so in the commit message and in `CHANGELOG.md`, and see [docs/compatibility.md](../../../docs/compatibility.md).
- Update the rules coverage matrix in `docs/rules-coverage/` when a rule moves from manual to automated.

## Determinism

- No `Math.random`, `Date`, timers or DOM in rules code. Dice only through `ctx.roll` or the rng passed in.
- Read the game through `ctx.view`; keep lasting state with `ctx.set`.
- Rules are advisory: report problems as warnings the player can override.

## Verify

Run the `verify-change` skill. For a system change, `pnpm soak` is required, not optional.
