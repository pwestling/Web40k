# Changelog

What changed in each release of Open Battle. The in-app **What's new** on the start page shows the highlights; this file has the whole list.

## 0.1.0 (2026-10-08)

The first release: a complete tabletop for miniatures wargames in the browser, peer to peer, with four games built in.

### Play

- **Rift Lanterns, our own game.** An original skirmish game that ships with the app (CC BY 4.0): four warbands with their own stand-in figures, silhouettes and colours, three missions scored in the top bar, glowing lanterns that take the holder's colour and ring when they change hands, and a starter table with open firing lanes. Play now from the start page, nothing to import.
- **Four game systems built in.** A squad-based sci-fi battle game in phases, a rank-and-flank fantasy game with regiment blocks, magic and psychology, Conquest-style regiments with a secret command stack, and Full Spectrum Dominance with activation dice, areas of control, reactions and support cards. Each has a made-up sample army and a one-click demo.
- **A 3D table with a top-down view.** Drag units with live distance, coherency and engagement range; ranked blocks wheel, reform, turn and march.
- **True and abstract line of sight.** Traced from each model's eyes against terrain and models, or with stand-in heights for games that use them. Cover, hidden units and higher ground come from the same check.
- **Attack automation.** Pick a weapon and a target; the panel works out who is in range and what to roll, and every number can be changed. Abilities that play themselves for the sci-fi game's common rules.
- **Advisory rules.** The app measures, rolls and reminds, and the table warnings panel lists every check, but nothing is ever blocked. Undo takes back a whole action.
- **Missions and secrets.** Missions with suggested scores a player confirms; secret objectives and hidden orders committed on their owner's device and revealed with proof they weren't changed.

### Together

- **Online, 1v1 or 2v2.** Host a room and send the link. Others join, watch, or take over as host. Teams of two share CP and VP.
- **Table talk and voice.** Pings, arrows, areas, chat and reactions, plus push-to-talk or open-mic voice over the same peer connections.
- **Table companion.** Play on a real table with real models: the phone keeps the game, takes your own dice ("A phone each" or "One phone for both of us"), and asks what it can't see, such as models in range and cover.
- **Play by mail.** A game across days with signed turn files, commit-reveal dice and an optional mailbox on the self-host kit.
- **Chess clocks and event nights.** Time limits worked out from the game log; Swiss rounds in the campaign book.
- **Campaign book.** A shared, hashed book of games with a league table, a map and unit stories, and campaign rules as packages.
- **Broadcast view.** A stream view with a commentator camera, a spectator delay and end-of-game moment cards.

### After the game

- **Replays and "What if".** Scrub back through any game, download it as a replay file, or branch a new game from any moment.
- **Annotated replays.** Notes and marks on moments, chapters, and review rooms where a coach leads and others follow.
- **Battle stats.** Dice luck, the biggest swing of each round, and calls for the rolls of a lifetime.

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
