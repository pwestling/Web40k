# Rift Lanterns

A small skirmish game for two players, about an hour long, played with three units a side. Lanterns have fallen into a rift, and four warbands go down after them.

Rift Lanterns is Open Battle's own game. Everything in it (names, rules, stats, missions, the starter table and the stand-in figures) is original, so it can be played, shown and shared freely. It is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): credit "Rift Lanterns, Open Battle contributors". The whole game is one file, [rift-lanterns.js](rift-lanterns.js), written in the module workshop; [WORKSHOP.md](WORKSHOP.md) is what writing it taught us.

**To play:** press **Play now** under Rift Lanterns on Open Battle's start page. To play a friend, host a game and pick Rift Lanterns in the Game list.

## The turn

The game lasts **5 rounds**. In each round, players take turns activating one unit at a time, starting with the player who goes first, until every unit has gone. An activated unit:

1. **Moves** up to its Move in inches (drag it). Wrecks can't be walked through.
2. Then takes **one action**: **Shoot** or **Fight**. That ends its activation.
3. A unit that only moves ends its activation when you press **End activation**.

When one player has no units left to activate, the other activates theirs in turn. The round ends when every unit has gone.

## Shooting

Pick an enemy unit that a shooter can see and that is within the shooter's Range. A unit locked in a fight (an enemy within 1") can't shoot.

- Each model rolls its **Shoot** dice. Each die that rolls the unit's **Hits on** or more hits; **one more** is needed if the target is in cover: when most of the target models the shooters can see are in or touching a ruin or thicket, or seen past one.
- The target rolls a die for each hit. Each die that rolls its **Saves on** or more is saved.
- Each hit not saved takes 1 wound. Models lose wounds in turn; a model with none left is out.

## Fighting

Pick an enemy unit within 1". The attackers roll their **Fight** dice and hit and wound as when shooting (no cover in a fight). Then, if any of the target are left, they strike back the same way.

## The warbands

Each warband is about 100 points, three units.

| Warband                                             | Rule                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Wardens of the Wick**: shield-bearing lamp guards | **Shieldwall.** Saves against shooting succeed on one less.                                                        |
| **Thornkin**: hounds and walking briars             | **Regrow.** At the start of each round, every wounded model heals 1 wound.                                         |
| **Cogwright Guild**: gearmen, drones and a strider  | **Overcharge.** When the unit shoots it may overcharge: 2 more dice, but each 1 rolled is a wound on the shooters. |
| **Gloam Choir**: robed singers and dusk stalkers    | **Veiled.** Can't be shot from more than 12" away.                                                                 |

| Unit           | Models | Move | Shoot | Range | Fight | Hits on | Saves on | Wounds | Points |
| -------------- | ------ | ---- | ----- | ----- | ----- | ------- | -------- | ------ | ------ |
| Wick Guard     | 5      | 5"   | 1     | 18"   | 1     | 4+      | 4+       | 1      | 50     |
| Lamplighters   | 2      | 6"   | 2     | 24"   | 1     | 3+      | 5+       | 1      | 25     |
| Warden-Captain | 1      | 5"   | 1     | 12"   | 3     | 3+      | 3+       | 3      | 25     |
| Briar Hounds   | 3      | 8"   | –     | –     | 2     | 4+      | 6+       | 2      | 40     |
| Thorn Slingers | 4      | 6"   | 1     | 12"   | 1     | 4+      | 6+       | 1      | 35     |
| Old Bramble    | 1      | 5"   | –     | –     | 4     | 3+      | 4+       | 4      | 25     |
| Gearmen        | 4      | 5"   | 1     | 24"   | 1     | 4+      | 4+       | 1      | 40     |
| Spark Drones   | 2      | 8"   | 2     | 12"   | –     | 4+      | 5+       | 1      | 25     |
| Strider        | 1      | 6"   | 3     | 24"   | 2     | 4+      | 3+       | 4      | 35     |
| Hushed Choir   | 4      | 6"   | 1     | 18"   | 1     | 4+      | 5+       | 1      | 40     |
| Dusk Stalkers  | 3      | 7"   | –     | –     | 2     | 3+      | 5+       | 1      | 35     |
| Cantor of Ash  | 1      | 6"   | 2     | 18"   | 1     | 3+      | 4+       | 3      | 25     |

## Missions

Both players deploy in a strip 6" deep along their long edge of a 36" x 24" table. A side **holds** a lantern if it has more models within 3" of it than the other side.

- **Lantern Grab.** Three lanterns lie across the middle. At the end of each round, each side scores 1 victory point for each lantern it holds.
- **Snuff Them Out.** One lantern in the middle. At the end of each round, the side holding it scores 1. At the end of the game, each side scores 2 for each enemy unit wiped out.
- **The Last Lantern.** One lantern in the middle. From round 2, the side holding it at the end of a round scores 2. At the end of the game, each side scores 2 for each of its units with a model in the enemy's deployment strip.

The side with more victory points at the end of round 5 wins.

## The starter table

Two ruins, two small ruins, two thickets, two barricades and two wrecks, placed the same from both sides. Ruins, small ruins and barricades are **ruins** (cover). Thickets give cover. Wrecks block movement and sight.
