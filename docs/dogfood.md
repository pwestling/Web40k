# Dogfood log

We play whole games in the browser the way a player would. This log records what broke, what felt slow and what was confusing. Small things get fixed in the same pass. Bigger ones go to the UX and Player Experience reviews.

## Round 1: #54, 2026-10-08

### How we played

- Two Chromium browsers drove the real app through Playwright, using fake microphones for voice. They connected over a local Nostr relay (`?nostr=ws://localhost:7777`), which handled both signalling and Open tables. That way nothing went out to public relays.
- The 40k rosters came from `scripts/bsdata.mjs` and stayed in the git-ignored `.bsdata/` folder.
- The scripts clicked, typed and used the keyboard just as a player does. They never wrote to the store.
- After the first 40k game the rest ran on a production build (`vite preview`), because the dev server's reloads broke games in progress. The mail game used a local mailbox (`pnpm mailbox`).

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

- The defender's screen offered the attacker's "Cancel" as well as "Roll to hit". Rolling for the other player is deliberate, because the dice hold no choices, but cancelling someone else's declared attack is surprising. _Fixed later in this pass:_ only the attacker sees Cancel.
- The shoot panel fires one weapon at a time. A 40k player thinks "this unit shoots everything at that unit". For a Dreadnought with four guns, that's four rounds of picking a weapon, picking a target, declaring and rolling. A "Shoot everything at…" option would match how the game is played. (UX)
- On Ana's turn, the Command phase also listed Ben's "Reanimation Protocols", which is an end-of-_your_-Command-phase rule. _Fixed later in this pass:_ BSData writes "your" with a non-breaking space, which the timing match didn't see. The roster import and the timing match now read it as a space.
- In the Shooting phase the unit card said "Moved 0.0″ of 8″ this phase". _Fixed later in this pass:_ the budget line shows only while moving, or once the unit has moved. A count of how far the unit moved this _turn_ would still answer the question players actually ask ("did it move? can it shoot heavy?"). (UX)
- Auto-deploy lines both armies up on their back edges, about 35″ apart. On a 44″ × 60″ table that means one and a half turns of walking before most guns are in range. (PX: deployment that puts players into the game sooner)
- Charge (2D6) rolls without a declared target. A unit 30″ away rolls a 7 and nothing says the charge failed or why. (UX, Rules engine)
- With no mission picked, a 40k game ends in a 0–0 draw after five rounds of fighting. "Start anyway" skips the mission picker. (UX, PX)
- 40k cover showed as "−1 to hit". It's a game setting (Game settings → Cover: −1 to hit or +1 to save), and −1 to hit is the default. Worth checking that default against the current edition. (Rules engine)
- The whole-battle clip of a game with no standout moments ran about 200 s. (PX)

### Solo, 40k against Steady

**Fixed in this pass**

- The computer's side was called "Player 2" in the army showcase and through deployment. It only became "The Warden of Ash (Steady)" once the battle started. Now both sides are named from deployment: "You" and the computer's character.
- The recording pill had turned into a full-width bar over the top bar when an earlier merge (#45) lost its rules. It's a pill again.
- A tall clip's score header said "Round 6" of a five-round game in its last frames. Past the last round it now says "Battle over".
- The log said "2 wounds · 0 models slain" when a model took wounds and lived, which read as a tally of nothing. It now says "2 wounds lost".
- Escape didn't close the "Bring your army" guide or other dialogs. Escape now closes the top dialog.
- Keyboard moves (`]` and the arrow keys) moved a unit without starting its activation. In games with activations (Rift Lanterns, Conquest) there was then no "End activation", only "Pass".

**Sent on**

- You can't play the computer with your own imported army; only the sample armies. (PX, UX)
- Clip framing shows the whole table, small, for every moment. In a wide or tall clip the units in the moment are a few pixels high. (PX)
- A hotseat game is gone after a reload. You land back on the lobby, and "Resume last game" is at the bottom of the page. (UX)

### Rift Lanterns against Sharp

Sharp won 2–1 on lanterns. The wide highlights reel recorded cleanly.

### The Old World (Rank and flank) and Conquest, both sides

**Fixed in this pass**

- Regiments with no weapons (spears, riders, the Marshal) offered "Shoot", which opened an empty weapon list. Shoot is now disabled with "No weapon for this".
- Conquest's What now said "Nothing to do this phase" while you were meant to order your command stack. Before your top card was drawn, it said "Drag a unit". It now says to put the cards in order and press Lock in stack, then to draw the top card to see which regiment acts.
- At the end of a game, the left panel's last row (Stats, Download replay, Review this game, Report a problem) wrapped word by word into three-line buttons. The buttons now wrap whole.

**Sent on**

- The Old World's shoot panel says "long range" for targets that are beyond long range too. ProcedurePanels' range note doesn't know a maximum. (Rules engine)
- The Old World unit card is very long. The stat line ends up below the fold. (UX)
- Conquest's status chips ("Activated") are toggles, so a click lets a regiment activate again. That's a fine override, but it's one stray click away. (UX)
- The clip caption's phase line paints with wide gaps: "Round 2 · Player 2 · Command". (PX)
- The clip panel estimated "about 60 s" for the whole Old World battle and recorded 119 s. For Conquest it estimated 65 s and recorded 142 s. The test machine was busy, so this may be the box rather than the estimate. (PX)

### Full Spectrum Dominance, both sides

We placed nothing in Pre-assign, then activated the Command Team with the Rifle Squad (the "Activate with 1" button is clear), moved, and fired at long range. The rest of the game ran through to the end.

**Fixed in this pass**

- When Player 2 could react, the reaction prompt sat _under_ the table's floating unit names and the What now card. Its buttons were half covered. What now also said the panel was "at the bottom right"; it's at the top. The prompt now sits above both, and What now says "at the top".

**Sent on**

- After "0 of 2 succeed" on the hit roll, the attack still asks for "Roll save" and then "Roll damage", which are two clicks on empty steps. The Hit row also doesn't say what the dice needed (two 5s missed at long range). (Rules engine, UX)
- The log says "Command Team activates (2 actions)" and doesn't name the Rifle Squad that came along. (Rules engine)
- The unit card's stat table (System 1–4 columns) is wider than the card and is clipped. (UX)
- Nudging a unit with the arrow keys moved it without a Move action. The table warning "Moved without a Move action" caught it, which is the advisory behaviour we want.

### The table companion on a phone (390 × 844)

"Find an opponent" is on the phone lobby's first screen (UX 383). At a real table, sample armies deploy from a preview with their bases, the unit card asks you to tick what's true ("No enemy within 1″", "A shooter can see…") before Shoot is enabled, and the dice tray and save prompt read well.

**Fixed in this pass**

- The Log tab showed eight lines in a 260 px scroll box, with the rest of the phone screen empty. The log now fills the tab.

### 40k by mail, two browsers and a local mailbox

Cora started a mail game, picked the Crossfire mission, deployed and sent the invitation. Dax opened the invite link, deployed and sent it back. Cora started the battle and played a turn. Dax's browser picked up her file from the mailbox, and replayed her turn. Dax played a turn and sent it, and it came back to Cora. Every hand-off arrived without a reload.

**Fixed in this pass**

- Dax looked at the table from Cora's edge. A mail game is a hotseat game under the hood, and the camera always took seat 1 for hotseat. It now takes the side this browser plays.

**Sent on**

- The invite card says "You've been invited to a game by mail" without saying who invited you or to which game. It could read the invitation first: "Cora invites you to a game of Sci-fi battle". (UX)
- Before he sent his side back, Dax saw an enabled "Start battle ▶", while the bar said Cora starts the battle. (UX)

### Open tables, a starter table, the army shelf and clocks

Ana hosted, picked the starter table "Close quarters" and the Crossfire mission, set a 45-minute chess clock, imported an Orks roster from `.bsdata/`, saved it to her shelf ("Your army shelf (1)") and posted the table. Ben opened Open tables from the lobby, saw "Ana is waiting for an opponent · New players welcome · Sci-fi battle · 460 points", joined and deployed. The post came down when the seats filled. After Start battle, Ana's clock ran down while Ben's held at 45:00 on both screens.

**Fixed in this pass**

- The post form's Size was empty, though a 460-point army was already on the table. It now starts as "460 points" until the host types something else.
- Ben typed his name in the lobby, but the join card on Open tables asked for it again. The lobby kept the name only when you hosted. It now keeps it as you type, so Open tables and mail invites offer it.

### 2 vs 2, four browsers

**Fixed in this pass**

- Hosting online with "2 vs 2" opened a 1 vs 1 room: the third and fourth players sat at "Joining the game…" forever. The lobby set the team size before WebRTC had loaded, when there was no game to set it on yet. "A phone each" lost its companion setting the same way. Both now apply once the room exists.

With that, Ana and Cy shared the near side and Ben and Di the far side. The top bar read "Ana & Cy" and "Ben & Di", and CP was shared. Ana and Cy each moved their own units in the same Movement phase, Ben and Di had no ▶ during it, and Cy's ▶ handed the turn to "Ben & Di".

**Sent on**

- "2 vs 2" is under More ways to play, below the Host a game button that it changes. (UX)
- The fourth player's name prompt came about 20 seconds after they sat down, so they showed as "Player 4" until then. (UX)

### 40k against the new Sharp

A full five rounds against The Iron Tactician on the current build (1f1db90). It closes in on the tanks and picks its targets well. The game still ended 0–0 because it had no mission, which PX raised too.

**Fixed in this pass (PX review of Sharp)**

- The computer rolled the player's saves for them about a second after its hits landed, because the attacker may roll the defender's steps (UX 217). Saves are the only thing the player does during the computer's turn. The computer now leaves the player's own rolls to them and rolls them itself only after 8 seconds.
- Try and Play the computer now start with the game's first mission (Crossfire in Sci-fi battle), so there's something to score. Before, every one of them ended "A draw 0–0".

**Sent on**

- In replay, the replay bar's "What if…", "Back to live" and "Review with notes" wrap onto two lines each. (UX)

### The clips

Every game above except the 2v2 round was recorded with Share… → A clip:

| Game                        | Shape  | What                | Length |
| --------------------------- | ------ | ------------------- | ------ |
| 40k over two browsers       | Square | The whole battle    | 200 s  |
| 40k against Steady          | Tall   | The highlights reel |        |
| Rift Lanterns against Sharp | Wide   | The highlights reel |        |
| The Old World               | Wide   | The whole battle    | 119 s  |
| Conquest                    | Tall   | The whole battle    | 143 s  |
| Full Spectrum Dominance     | Square | The whole battle    | 54 s   |
| 40k against the new Sharp   | Square | The whole battle    |        |

The clips are in the session's scratch space, not the repository: the 40k ones show imported roster names.
