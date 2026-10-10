# Writing a faction pack

A faction pack teaches Open Battle the rules of one faction's armies **by name**. A list exported from an army builder names its units' abilities, its detachment, the enhancements it took and maybe its stratagems; the text it carries is the player's, and the app can only read a little of it. A pack says, for each of those names, what the rule does, so the app can play it: rerolls and modifiers in attacks, invulnerable saves, wounds back at the start of a phase, auras, stratagems in the play panel with their cost, timing and target.

A pack is a rules package (see [packages.md](packages.md)): one JavaScript file, identified by the SHA-256 of its bytes, and any code in it runs in the same sandbox as a package's. The example is [`examples/faction-packs/cinder-court.js`](../examples/faction-packs/cinder-court.js). Its faction, the Ashen Host, is one of the app's own invented sample armies; its detachment, enhancements and stratagems were invented for it.

**Never put a publisher's rules text, art, stats or points in a pack.** Key rules by their names, say what they do as data, and write any summary in your own words. This repository holds no packs for published games, links to none and lists none.

## How players use one

1. In the army import ("Faction packs"), the player pastes the link to your pack's file and presses **Load a pack from a link**. A GitHub page link is read as its raw file. Your host must allow other sites to read the file (CORS); GitHub raw files and most static hosts do.
2. The app fetches it and reads its manifest and data without running anything. The consent sheet shows the pack's name, version and author, its link, its SHA-256 (with the short fingerprint players compare), what it adds, how many rules in the player's army it knows, and whether it has code.
3. On **Load it**, the bytes are trusted and the link is **pinned** to that hash. The same bytes load again without a question. If the file at the link changes, the next load shows the consent sheet again, saying the link held a different file when it was pinned; on Cancel the old pin stays.
4. The pack applies to every army of its game as the army is read (a list, a sample army or an army from the shelf): each ability, detachment rule, enhancement and stratagem whose name matches gets the pack's rule. Names match whatever their case, accents, punctuation or spacing, and a cost in the name ("(1CP)") is ignored, so "Smoke-Veil", "smoke veil" and "SMOKE VEIL (1 CP)" are one name. A rule the player taught themselves ("Teach it this rule") stays theirs.
5. The import's coverage lines count what packs play ("· 3 by faction packs").

The army keeps the pack's ref (id, name, version, hash, link), so it travels in the shelf's `.army.json` and in the army the player deploys. The rules a pack put on an army are part of the army's data, so every player at the table sees and plays the same rules. If one player's army was made with other bytes of a pack than another's, or than the copy this device pinned, the import panel warns them to compare. A pack with code joins the game's rules packages when its army is deployed, so its code runs for everyone from the same bytes, with the usual check, peer-to-peer sharing and consent.

## The file

```js
export const manifest = {
  id: "you.my-faction", // stable across versions
  name: "My faction",
  version: "1.0.0",
  author: "You",
  api: 1,
  kind: "faction",
  systems: ["forty-k"], // a prefix matches: "forty-k" covers "forty-k-11"
  requires: [],
  adds: "One sentence the consent sheet shows.",
};

export const faction = {
  faction: "My faction", // the faction as lists name it
  rules: [], // the faction's own army-wide rules
  abilities: [], // unit abilities by name, on any unit
  detachments: [{ name: "My detachment", rules: [], enhancements: [], stratagems: [] }],
  stratagems: [], // stratagems for any detachment
};

export default { hooks: {}, functions: {}, procedures: {}, actions: [] }; // optional code
```

Both `manifest` and `faction` are read as data before anything runs, so they must be plain literals: objects, arrays, strings, numbers, booleans and null. Variables, function calls, spreads and `${}` templates are rejected. To get type checking, write the pack in TypeScript against `FactionPack` from `src/sdk/index.ts` (`export const faction: FactionPack = { ... }`) and compile it to one `.js` file with no imports.

A pack with no `export default` is data only: nothing in it runs, and it never joins a game's rules packages.

## Rules

Each entry in `rules`, `abilities`, a detachment's `rules` and `enhancements` is:

```js
{
  name: "Rule name",
  summary: "Your own one line, shown when the army doesn't carry the rule.",
  // and one of:
  teach: { ... },
  auto: { ... },
  effects: [ ... ],
  code: "hooks.charge",
}
```

The first of `auto`, `teach`, `effects` and `code` it has is used.

- **`teach`** is what the app's "Teach it this rule" window builds (`Teaching` in `src/systems/wh40k/teach.ts`): `when` (`{ kind: "attacks", weapon?, when?: "charged" | "stationary", against? }` or `{ kind: "phase", phase, at: "start" | "end", anyTurn? }`), `who` (`self`, `leading`, or `{ kind: "aura", side, range, keyword? }`) and `what`, a list of `reroll`, `modify`, `against`, `save`, `invuln`, `fnp`, `stat`, `gain` and `heal`. It's the easiest way to write most rules.
- **`auto`** is the automated-ability data the app's ability reader produces (`AbilityAuto` in `src/core/types.ts`): `parts` such as `{ kind: "attack", side: "making", roll: "damage", reroll: "ones" }`, plus `aura`, `trigger`, `whileLeading`, `oncePerBattle` or `onObjective`. Leave `effects` out and the app compiles them from the parts.
- **`effects`** are rules-schema effects (`Effect` in `src/core/content/schema.ts`), as a package's data rules write them. They can call the pack's code: `{ call: "myFunction" }` in an expression, `{ do: "script", procedure: "myProcedure" }` as an action.
- **`code`** says the pack's code plays the rule; the string names where, for the reader. The rule counts as automated and its card says the pack plays it.

Where they go:

- `abilities` match unit abilities on any unit of the army, and enhancements too.
- `rules` match the army's rules (the faction's own). When the army is that `faction` and doesn't list one, it's added, in your summary's words. Army rules apply to every unit of the army.
- A detachment applies when the army's detachment has its name. Its `rules` work like `rules`, and are added when the list doesn't carry them. Its `enhancements` match like `abilities`.

## Stratagems

A stratagem adds what the play panel needs to offer it:

```js
{
  name: "Stratagem name",
  cp: 1,
  side: "active", // the player's own turn; "inactive": the opponent's; "either"
  phases: ["shooting"], // the system's phase ids; none for any phase
  once: "turn", // "phase" (the default), "turn" or "battle"
  target: { keywords: "Infantry", notYet: "shot" }, // one of the player's units (the default); false for none
  summary: "Your own one line.",
  teach: { ... }, // or auto or effects: what it does to its target until the end of the phase
}
```

A stratagem the list already has (by name) takes the pack's cost, timing and target, and its effect; the list's own text stays. Stratagems the list doesn't have are added. One with no effect costs its CP and the players play it. The computer opponent spends CP on pack stratagems the same way it does on taught ones.

## Code

Code works as in any rules package ([packages.md](packages.md)): turn hooks (`phaseStart`, `charge`, `moved` and the rest), code actions on the unit card, procedures and pure functions. It runs only in a game, in the sandbox, from the bytes the game names. Find the units a rule belongs to by their abilities' names, matched as loosely as the app matches them; the example's `Burning Bulk` is played by a `charge` hook this way.

Keep code deterministic: read the game only through `ctx.view` and roll only through `ctx.roll`.

## Checking a pack

- `readFactionPack` (`src/packages/faction.ts`) is what the app runs on a pack before the consent sheet: it reports the first problem in the manifest or the data.
- `src/packages/faction.test.ts` loads the example from a link, consents, pins, applies it to an invented army and checks the coverage counts, a changed link, name matching and its code in the sandbox. Copy it for your own pack.
