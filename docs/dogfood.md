# Dogfood log

We play whole games in the browser the way a player would. This log records what broke, what felt slow and what was confusing. Small things get fixed in the same pass. Bigger ones go to the UX and Player Experience reviews.

## Round 1: #54, 2026-10-08

### How we played

- Two Chromium browsers drove the real app through Playwright, using fake microphones for voice. They connected over a local Nostr relay (`?nostr=ws://localhost:7777`), which handled both signalling and Open tables. That way nothing went out to public relays.
- The 40k rosters came from `scripts/bsdata.mjs` and stayed in the git-ignored `.bsdata/` folder.
- The scripts clicked, typed and used the keyboard just as a player does. They never wrote to the store.

### 40k over two browsers, with voice

Ana (Space Marines, Gladius) hosted and Ben (Necrons, Awakened Dynasty) joined from the invite link.

**What worked**

- Importing and deploying both rosters.
- Both voice buttons.
- Moving with the keyboard: `]` picks the next unit and the arrow keys move it an inch at a time, with "Moved 5.0″ of 5″" on the card.
- Each player's camera faces the enemy, so "up" means forward for both.
- The shoot panel lists targets with their distances and says when one is out of range.
- "Roll everything" plays an attack through to damage, and the log line reads well.
- A Vite reload in the middle of a turn reconnected both players and the game carried on.

**Fixed in this pass**

- The Command phase listed the same army rule once per unit: "Oath of Moment" five times, and "Reanimation Protocols" five times. It now shows one line, "Ancient in Terminator Armor and 4 other units: Oath of Moment", and Apply marks all of them.
- "1 hit, 1 critical" read like two hits. It now reads "1 hit (1 critical)".
- Every attack by a fresh Ballistus Dreadnought reminded us of "Damaged: 1-4 Wounds Remaining". That reminder now only shows once a model is down to that many wounds.
- After firing the lascannon, the shoot panel opened on the lascannon again, and nothing stopped it from firing twice. The panel now opens on a weapon the unit hasn't used this phase, and marks used ones "· used this phase". This is a warning only, so a player can still override it.
- On a long rule name, "⚙ Teach it" wrapped onto two lines.
- The "⚙ Teach it" chips at import touched each other.
- Rule bullets put a `<ul>` inside a `<p>`, so React logged DOM-nesting errors (UX 392).

**Sent on**

- The defender's screen offers the attacker's "Roll to hit" and "Cancel". Rolling for the other player is deliberate, because the dice hold no choices. Cancelling someone else's declared attack is surprising, though. (UX)
- The shoot panel fires one weapon at a time. A 40k player thinks "this unit shoots everything at that unit". For a Dreadnought with four guns, that's four rounds of picking a weapon, picking a target, declaring and rolling. A "Shoot everything at…" option would match how the game is played. (UX)
- On Ana's turn, the Command phase also lists Ben's "Reanimation Protocols", which is an end-of-_your_-Command-phase rule. (Rules engine: ability timing ignores whose turn it is when the text says "your")
- The unit card says "Moved 0.0″ of 8″ this phase" in the Shooting phase. A count of how far the unit moved this turn would answer the question players actually ask ("did it move? can it shoot heavy?"). (UX)
- Auto-deploy lines both armies up on their back edges, about 35″ apart. On a 44″ × 60″ table that means one and a half turns of walking before most guns are in range. (PX: deployment that puts players into the game sooner)
