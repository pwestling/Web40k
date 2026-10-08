# Rank-and-flank magic and psychology

The rank-and-flank game (in the style of The Old World) runs magic and psychology as code procedures in `src/systems/tow`. Everything is advisory: results land in the log, and players can still play anything by hand. The mechanics come from general knowledge of the game and haven't been checked against the rules. Open Battle ships no rules text, spells or army data.

## Spells are your data

A wizard is a unit with a wizard level. Its spells are plain data: a name, numbers and a kind, never the spell's text. They come from two places:

- **Your army list.** A BattleScribe or New Recruit roster gives the level ("Level 2 Wizard") and any spell profiles with a casting value. A spell's text from your list still shows on the unit card.
- **A spell list file.** On the army screen, **Add spells from a list** reads a JSON file. A wizard whose list names a lore in the file ("Lore of Herds") gets that lore's spells; a wizard that names none gets them all.

```json
{
  "spells": [
    {
      "name": "Spark Lance",
      "lore": "Hedge",
      "cv": 8,
      "range": 18,
      "kind": "missile",
      "hits": "D6",
      "strength": 4
    },
    { "name": "Leaden Limbs", "lore": "Bone", "cv": 8, "range": 18, "kind": "hex", "remains": true }
  ]
}
```

| Field                    | Meaning                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `name`                   | The spell's name.                                                                                                |
| `cv`                     | Casting value: 2D6 plus the wizard's level must reach it.                                                        |
| `range`                  | In inches. `0` means the wizard's own unit.                                                                      |
| `kind`                   | `missile`, `vortex`, `assailment`, `enchantment`, `hex` or `conveyance`.                                         |
| `hits`, `strength`, `ap` | For damage spells: hits as `D6`, `2D6` or a number, at this Strength. Without them, you play the effect by hand. |
| `remains`                | For enchantments and hexes: it stays until it's dispelled, not just until your next turn.                        |
| `lore`                   | Which lore it belongs to, for matching spells to wizards.                                                        |

[`examples/spells/sample-lores.json`](../examples/spells/sample-lores.json) has invented spells to try. The sample armies' Hedge Seer and Bone Shaman already know some.

## Casting

**Cast a spell** shows on a wizard's unit in the phase that matches each spell's kind:

| Phase    | Kinds                                               |
| -------- | --------------------------------------------------- |
| Strategy | Enchantment (on your own units), Hex                |
| Movement | Conveyance (on your own units)                      |
| Shooting | Magic missile (needs line of sight), Magical vortex |
| Combat   | Assailment (on an enemy in base contact)            |

1. **The casting roll.** The wizard rolls 2D6 plus its level against the casting value.
   - A double 1 always fails.
   - A double 6 is cast with irresistible force, which can't be dispelled, and then miscasts.
2. **Dispel.** The opponent may try with one of their wizards: 2D6 plus its level must equal or beat the casting roll. A double 1 fails.
3. **The effect.**
   - Damage spells roll their hits, then to wound and saves, and casualties come off the rear rank.
   - Enchantments and hexes mark their target (shown on its Charge panel, where you can end one by hand). They last until the start of the caster's side's next turn, or until dispelled if they remain in play.
   - A wizard may **Dispel a spell in play** in its own Strategy phase.
   - Conveyances and spells without numbers are played by hand.
4. **Miscast.** Roll 2D6 on Open Battle's own table:
   - 2 to 4: D6 Strength 6 hits on the wizard's unit.
   - 5 to 9: the wizard loses a wound with no saves.
   - 10 to 12: the wizard is drained and can't cast again this turn.

Each wizard tries each spell once a turn.

## Psychology

Special rules are read by name from the unit's rules and keywords, so "Causes Fear" and "Fear" both work.

- **Leadership tests** are 2D6 equal to or under Leadership, and a double 1 always passes.
  - **Inspiring Presence:** a unit within 12" of its General (a unit with a General keyword) uses the General's Leadership if it's higher.
  - **Battle Standard:** a unit within 12" of the Battle Standard (a model or rule by that name) re-rolls a failed test once.
- **Fear:**
  - Charging a Fear-causing enemy takes a Fear test first. On a fail, the charge isn't made this turn.
  - In combat, a unit facing Fear tests each round. On a fail, it hits only on 6s.
  - Units that cause Fear themselves don't test.
- **Terror:** being charged by a Terror-causing unit takes a test. On a fail, the unit flees.
- **Frenzy:** +1 Attack, and the unit must pursue. It counts as Immune to Psychology, and loses Frenzy when it loses a combat.
- **Hatred:** the unit re-rolls missed hits the first time it fights a foe, and must pursue.
- **Stupidity:** a test at the start of the unit's turn. On a fail, it's marked stupid for the turn and played by hand.
- **Immune to Psychology:** no Panic, Fear or Terror tests, and it can't flee from a charge.

Not covered yet: Fear auto-breaking, Frenzy's compulsory charge, the movement of stupid units, magic items, and magical vortex templates.
