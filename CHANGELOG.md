# Changelog

What changed in each release of Open Battle. The in-app **What's new** on the start page shows the highlights; this file has the whole list.

## Unreleased

- **Ladders keep different rules apart.** A ranked result now records the rules it was played under (the app build and every rules package, by hash), and both players check and sign them. Named seasons in `rulesets.json` share a ladder; any other rules, a house rule or a modded copy of a game, get a ladder of their own. See [docs/compatibility.md](docs/compatibility.md).
- **Shared dice in ranked games.** No one device decides a roll: the host commits to a secret seed, the opponent adds one, and each round's dice are checked once the host's seed is shown. A result whose dice don't check out can't be signed.
- **No farming the ladder.** A rating moves only against an opponent who has played five games against three different players.
- **Different versions at one table.** Players' apps say which version they run when they meet, and a banner names both when they differ. A player whose version can't share the table is kept out of the game rather than shown a table that drifts.
- **The board checks signatures.** A self-hosted board keeps a ranked result only if both signatures hold, and answers under `/v1`. Its protocol is in [docs/board-protocol.md](docs/board-protocol.md).
- **Stratagems as a hand of cards.** Drag a card onto a unit to play it, or click it and then the unit. A card the rules say no to asks "Play it anyway?", and the log says it was played anyway. After a roll with failed dice, a re-roll card pops up by the dice ("Re-roll a 2? · 1 CP") and re-rolls just that die.
- **Charge by dragging.** In the Charge phase, drag your unit onto an enemy: the tag says how far it is and what the 2D6 needs, and letting go declares the charge instead of moving there.
- **Roll the dice yourself.** Under 🔊, hold to shake your dice in the tray and let go to throw them, or roll real dice and tap in the faces. Other players see "Ana is shaking…" while you shake.
- **For contributors.** [GOVERNANCE.md](GOVERNANCE.md), a code of conduct, a security policy, a pull request template, [docs/compatibility.md](docs/compatibility.md), and [CLAUDE.md](CLAUDE.md) with Claude Code skills for writing packages and modules, checking for publisher IP, verifying a change and drafting a proposal, and a Proposal issue form.

## 0.1.0 (2026-10-10)

The first release: a complete tabletop for miniatures wargames in the browser, peer to peer, with four game systems and two games of our own built in.

### Play

- **Rift Lanterns, our own game.** An original skirmish game that ships with the app (CC BY 4.0): four warbands with their own stand-in figures, silhouettes and colours, three missions scored in the top bar, glowing lanterns that take the holder's colour and ring when they change hands, and a starter table with open firing lanes. Play now from the start page, nothing to import. Its rules page is made from the game's own module, so it never drifts from what the app plays, and **Print and play** makes an A4 or US Letter PDF in the browser: the rules, a card per unit with wound boxes, lantern and wound tokens, round and VP tracks, rulers, a quick-reference card, and fold-over stand-in figures with bases at true size. The table companion knows it too: players say what they see, the phone keeps the score.
- **Four game systems built in.** A squad-based sci-fi battle game in phases, a rank-and-flank fantasy game with regiment blocks, magic and psychology, Conquest-style regiments with a secret command stack, and Full Spectrum Dominance with activation dice, areas of control, reactions and support cards. Each has a made-up sample army and a one-click demo.
- **A 3D table with a top-down view.** Drag units with live distance, coherency and engagement range; ranked blocks wheel, reform, turn and march.
- **True and abstract line of sight.** Traced from each model's eyes against terrain and models, or with stand-in heights for games that use them. Cover, hidden units and higher ground come from the same check.
- **Attack automation.** Pick a weapon and a target; the panel works out who is in range and what to roll, and every number can be changed. Abilities that play themselves for the sci-fi game's common rules.
- **Brinewatch, our second game.** A CC BY skirmish game of action points, climbing and close quarters, written as a workshop package and played with Play now like Rift Lanterns.
- **Play the computer.** Steady and Sharp opponents that try each move on a copy of the table with the dice rolled; Sharp plans whole turns and weighs the enemy's answer. Bring your own army or a sample one, in every built-in game.
- **Real rosters beyond the sci-fi game.** Old World, Conquest and Full Spectrum Dominance rosters import, and their universal special rules play themselves. Faction rules (detachment, enhancements, stratagems) come from the roster.
- **Teach it this rule.** A no-code rule builder for abilities the app doesn't know yet, kept with the army on the shelf.
- **Your painted army on the table.** Photograph your figures with a phone; the app cuts them out and stands them on the table as photo standees, shared with your opponent.
- **Tablet touch play.** Drag, rotate, measure and pick on a touch screen.
- **Advisory rules.** The app measures, rolls and reminds, and the table warnings panel lists every check, but nothing is ever blocked. Undo takes back a whole action.
- **Missions and secrets.** Missions with suggested scores a player confirms; secret objectives and hidden orders committed on their owner's device and revealed with proof they weren't changed.

### Together

- **Online, 1v1 or 2v2.** Host a room and send the link. Others join, watch, or take over as host. Teams of two share CP and VP.
- **Open tables and Live now.** A public board of games looking for players, and any public game to watch as it happens.
- **Online events.** Swiss rounds with no server: the organiser's browser pairs the rounds, and players sign their results.
- **Player cards and ranked games.** A card with your record, and ranked games both players sign.
- **Table talk and voice.** Pings, arrows, areas, chat and reactions, plus push-to-talk or open-mic voice over the same peer connections.
- **Table companion.** Play on a real table with real models: the phone keeps the game, takes your own dice ("A phone each" or "One phone for both of us"), and asks what it can't see, such as models in range and cover.
- **Play by mail.** A game across days with signed turn files, commit-reveal dice and an optional mailbox on the self-host kit.
- **Chess clocks and event nights.** Time limits worked out from the game log; Swiss rounds in the campaign book.
- **Campaign book.** A shared, hashed book of games with a league table, a map and unit stories, and campaign rules as packages.
- **Broadcast view.** A stream view with a commentator camera, a spectator delay and end-of-game moment cards.

### After the game

- **Replays and "What if".** Scrub back through any game, download it as a replay file, or branch a new game from any moment.
- **Game review.** The computer goes over a finished game, scores each decision, and shows the better move with how sure it is.
- **Annotated replays.** Notes and marks on moments, chapters, and review rooms where a coach leads and others follow.
- **Battle stats.** Dice luck, the biggest swing of each round, and calls for the rolls of a lifetime.
- **Share the battle.** Download a replay as one web page that opens in any browser, even offline; record a clip of the highlights reel or any stretch with the dice in frame; save end-of-game and round cards sized for posting.

### Your stuff

- **Army import.** BattleScribe and New Recruit rosters, with missing stats filled in by players. Save armies to the army shelf.
- **Figures and terrain.** Drop 3D models onto units, keep a figure library, upload terrain models, and build tables in the terrain editor with saved and starter tables.
- **Rules packages.** Sandboxed packages that add rules or a whole new game, shared peer to peer and checked by hash.

### For everyone

- **Learn to play.** A guided first game for each system against the computer, with a coach.
- **Front door.** Try it now demos, army guides, a "What can I do now?" hint and a controls sheet.
- **Translations.** The whole interface in German and French (machine drafts, open for review), with game words translated.
- **Accessibility.** Keyboard play, text size, colour-blind side colours with shapes, and a screen-reader announcer.
- **Install and play offline.** The app keeps itself on the device; games on one screen, lessons, replays and saved things work without a network.
- **Dice that feel good.** A felt dice tray with sound, your own dice colours and finishes, an army showcase at battle start, and table ambience.

### For hosts and contributors

- **Module workshop.** Write a game system in the browser from a template, checked against the SDK's types as you type, play it on a test table that reloads on every save, soak it with the bot, and export it as a package or for the community modules gallery. **Check** gives one verdict: types, loading and a short bot game.
- **Self-host kit.** Docker Compose with the app, a signalling relay and a TURN server.
- **Playtest kit.** Report a problem bundles a replay with the errors; a crash screen and a connection check.
- **Tests.** Unit tests, a soak bot playing seeded games every night, and browser smoke tests through each way into the app.
