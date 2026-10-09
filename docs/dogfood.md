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

## The fixes: #56, 2026-10-09

Every finding sent on above was fixed on main (8fa82da to a6e3c37), along with what UX and PX raised while checking the fixes. Each path was re-played in the browser, and the ones a script can drive are in `pnpm smoke`.

| Finding                                                           | Fix                                                                                                                                              | Smoke check             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Playing the computer meant its sample army against yours          | Play the computer asks for your army (the shelf, the sample, or a roster) and shows one confirm line with both sides' points (UX 408)            | solo-own-army           |
| Auto-deploy put armies at the back, or in contact (TOW)           | Deploys to the front of each mission zone, about 20–24″ apart                                                                                    | solo-own-army           |
| Hotseat started with no mission; a reload lost the game           | The first mission is preset, None warns at Start battle, and Resume leads the lobby (UX 394, 395)                                                | hotseat-resume          |
| 8 s waits on empty saves in solo                                  | No wait when there's nothing to roll, a countdown ring, and "Roll my saves for me" (UX 404)                                                      | solo-saves              |
| Charge rolled with no target                                      | Charge asks which unit(s) with the rules' reasons, the roll carries the targets, the log and card say made or failed (UX 396, 411, 412)          | card-actions            |
| Shooting one target with many weapons was a click per weapon      | "Shoot everything at…", and Shooting says what this turn's move means for Heavy and Assault (UX 397, 398)                                        | card-actions            |
| One click on a status chip undid a regiment's activation          | Chips only show; the ⋯ beside them changes one, and Undo activation asks first (UX 399)                                                          | card-actions            |
| FSD and Conquest stats overflowed the card; the TOW card was long | Stats in rows of seven, numbered systems on their own rows; stats first, manoeuvres under Move, unavailable actions folded (UX 400, 401)         | card-widths             |
| Mail: the invitee saw Start battle; the invite named no one       | Only the inviter starts; the invite says "Ana invites you to Sci-fi battle (1 vs 1, Crossfire)"; mail games preset the mission too (UX 402, 405) | (two browsers, by hand) |
| The fourth player's name prompt came 20 s late                    | The name is asked while the table connects and used the moment they sit down (UX 403)                                                            | p2p-host-join           |
| 2 vs 2 hid under More ways to play                                | A 1 vs 1 / 2 vs 2 switch beside Host a game (UX 406)                                                                                             | (by hand)               |
| The replay bar wrapped after the game                             | What if, Share and Review fold into ⋯ once the game is over (UX 407)                                                                             | (by hand)               |
| Clips: the whole battle ran 2–3 minutes                           | The reel comes first; "The whole battle, cut down" is about a minute; the camera frames each attack; caption spacing matches the page            | clip-options            |
| Solo log opened with joins and renames                            | Join lines take the name set before the battle, renames during setup aren't logged, and deploy lines name the force only (UX 409, 410)           | (unit tests)            |
| Fight phase coach said "Player 1's turn" against the fight order  | It leads with whose pick it is; the computer takes its picks, in the player's turn too (PX #57 review)                                           | (unit tests, by hand)   |

The 40k charge's declared targets are kept on the unit as `chargeAt.<id>` flags until its next turn, so the rules can check that the charge move ends engaged with each.

## Round 2: #62, 2026-10-09

### How we played

- The same Playwright driver as round 1, on a development build served by `vite preview`. The scripts tapped, dragged and clicked like a player, and read the store only to find where a unit stands on screen.
- Touch games ran in emulated touch-only contexts: an iPad (1180×820) and a phone (390×844), with `scripts/touch.mjs` for taps and drags.
- The 40k roster for #53 came from `.bsdata/` and was not committed.
- Open tables ran over the local Nostr relay (`?nostr=ws://localhost:7777`).

### What we played

| Game                                        | Input         | Result                 | Notes                                             |
| ------------------------------------------- | ------------- | ---------------------- | ------------------------------------------------- |
| Rift Lanterns vs Sharp                      | Mouse         | Lost 4–6               | Review ran in the sandbox workers (package game)  |
| 40k sample armies vs Sharp, #58 build       | Mouse         | Lost 35–55             | 5 rounds; #57/#58 rules live                      |
| Rift Lanterns vs Steady                     | iPad touch    | Won 9–5                | Review started with the menu folded (UX 432)      |
| 40k Necron roster vs Steady, #53 teach      | Mouse         | (setup)                | Imported, matched points, taught a rule           |
| Rift Lanterns vs Steady                     | Phone touch   | Lost 0–9, then won 6–5 | The first game was lost to the camera bugs below  |
| 40k, posted on Open tables, joined by phone | Mouse + phone | (opening)              | Post, find, join, ready, deploy and a synced move |

### What worked

- #57/#58 live in 40k: the Heavy note ("Moved 10.2″ this turn: no Heavy +1 to hit"), the charge declaration with its 12″ message, Braced Firing's Apply, Indirect Fire said once, and the computer's fights shown as "The computer is rolling…".
- The What now fight coach follows the fight order (fixed in #56), including the computer's picks.
- Game review for package games runs in the sandbox workers. It starts by itself at Battle over, with the dot on Stats and on the folded ☰ Menu.
- Try the better move opens a branch just before the choice, and the better target is in the shoot list.
- #53 on a real roster: Implacable Eradication (re-roll wound 1s) was taught from the card. The card shows "Automatic: Implacable Eradication", and the attack panel applies it.
- Open tables from a phone: the post shows "Porter is waiting for an opponent · here now", Join asks for a name, the post comes down when the seat fills, and Start battle waits for Ready (or "Start anyway").

### Fixed in this pass

| Finding                                                                          | Fix                                                                               | Commit           |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------- |
| Package games had no Game review                                                 | The review worker loads the package in its sandbox                                | 56e9c4f          |
| Rift: Shoot was still offered after Battle over, and started a script            | Unit actions refuse past the last round; code actions hide                        | a28840e          |
| The chart ended at 53% for a finished 6–4 game                                   | The last point is the result                                                      | a28840e          |
| The Resume tile showed the package id and the wrong round                        | The package name, and "Back to {game}: Battle over" for a finished game           | a28840e, 1219f76 |
| Follow action eased the camera mid-drag: a Bastion Walker chased the pointer 43″ | The director never moves under a drag, and doesn't follow your own drags          | b433257          |
| The review called an attack-panel shot "missed: could still shoot"               | Attacks declared in the panel are judged (0 → 31 on the 40k game)                 | bb7b8dc          |
| Touch players couldn't end a unit's go without moving it                         | "Hold: end its go here" on the unit card                                          | 1219f76          |
| "You wins"                                                                       | "You win"                                                                         | 1219f76          |
| A Rift fight in the review lost its target                                       | The script step keeps its target                                                  | 1219f76          |
| Phone: the director's overview left two of three units off screen                | The overview is the opening view's distance                                       | f50c3de          |
| Phone: the unit card sheet covered the selected unit, so drags did nothing       | The table sits in the upper third on a phone                                      | f50c3de          |
| Review: the computer's takeaways said "30 of your 31 choices"                    | Against the computer only your takeaways show                                     | b2170bd          |
| Review: "13 attacks gave up about 130 VP" (the evaluator's scale)                | Tips count choices; no VP figure                                                  | b2170bd          |
| Review: "Ended the turn without Field Marshal Normal move…"                      | "Field Marshal still had something to do (Normal move, closing on Cinder Brutes)" | b2170bd          |
| "You's most valuable unit"                                                       | "Your most valuable unit"                                                         | b2170bd          |
| Try the better move's hint left out the unit                                     | It names it                                                                       | this commit      |

UX 71 and 72 and the PX feel pass on Game review landed alongside (a28840e, 350cdbc, ae800cd).

### Sent on

- **Rules engine:** Teach it can't express Reanimation Protocols (no regain-wounds effect) or Implacable's objective condition. Sharp's shooting marks favour the Pyre Speaker strongly (evaluator, #63).
- **UX:** Charge (2D6) is enabled and counted in What now with no enemy within 12″. Shoot everything offers only out-of-range targets. "Feel No Pain: damage" shows beside "Feel no pain 5+". A model climbing a crate adds the climb to the logged move. A drag on a unit beside the selected one can grab the neighbour; picking could prefer the selected unit. Phone touch targets under 36 px: VP −/+ (19×16), the replay bar and the table-talk row. Resume says "hotseat" for a game against the computer.
- **PX:** a Hazardous die in the tray, as a feel idea.
