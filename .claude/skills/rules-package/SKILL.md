---
name: rules-package
description: Write or change an Open Battle rules package (a single JS file players load at runtime) that adds rules to a game or a whole new game. Use when asked for a house rule, an ability, a mod, or a new game as a package.
---

# Write a rules package

A package is one ES module with no imports, run in a sandboxed worker and shared peer to peer by its SHA-256. Every byte change is a new version every player must accept again.

## Steps

1. **Pick the kind.** `kind: "extension"` adds to a built-in system (`systems: ["tow"]`, a prefix match). `kind: "system"` brings a whole game and exports `{ module }`. Read [docs/packages.md](../../../docs/packages.md) for the part you need.
2. **Start from an example**, never a blank file:
   - one rule on an existing game: `examples/packages/second-wind.js`
   - campaign rules: `examples/packages/battle-scars.js`
   - a small whole game with hooks and a side panel: `examples/packages/arena.js`
   - workshop templates: `examples/workshop/{skirmish,ranked,activations}.js`
   - finished games: `games/rift-lanterns/rift-lanterns.js`, `games/brinewatch/brinewatch.js`
3. **Write the manifest as a plain literal.** The app reads it without running the file, so no variables, calls, spreads or template strings. Set `api` to `MODULE_API` from `src/sdk/index.ts`, give a stable `id` (`author.name`), a semver `version`, and an `adds` sentence that tells a stranger what the code will do.
4. **Write the rules** against the types in `src/sdk/index.ts`:
   - keywords and simple modifiers as data (`rules`), anything with branches or loops as a generator procedure;
   - read the game only through `ctx.view`, roll only with `ctx.roll`, keep lasting state with `ctx.set`;
   - no `Math.random`, `Date`, timers, or variables outside the generator: the host replays procedures from the start on reconnect;
   - keep `applies`, `available` and `targets` quick and pure; any call over 250 ms shuts the package off.
5. **Bump `version`** in the manifest on every published change (patch for fixes, minor for new rules, major when a saved game or replay would play differently).
6. **Test it.** `src/sandbox/sandbox.test.ts` shows how to load a package under Vitest and play intents against it. For a whole game, also run it in the Module workshop's **Check** and **Soak bot**, or add it to `src/soak/workshop.soak.test.ts`.
7. **Run the `ip-check` skill** on the file before it is shared.
8. **List it** (optional): put it at a stable raw link and add a row to `docs/community-modules.md` with its fingerprint (the workshop's Export tab writes the row).

## Don't

- Don't import anything; the sandbox has no network and no modules.
- Don't put a publisher's names, stats, points or rules text in the file. Players bring their own army data.
- Don't change a published package's `id`: saved games and ladders name it.
