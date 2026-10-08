# Abilities that play themselves (40k)

Imported lists carry each unit's ability text. That text is the player's: it
never goes in the repository. On the player's device,
`src/systems/wh40k/recognize.ts` reads it and proposes the rule it describes.
The player confirms each proposal ("Automate this?") on the army import or on
the unit card. Anything not read in full, or not confirmed, stays a reminder.

## What it reads

The recognizer matches wording patterns, not stored text. A whole ability must
be understood, sentence by sentence, or nothing is proposed.

- Its own attacks: `each time a model in this unit makes a (ranged|melee) attack
(that targets a <keyword> unit), (if this unit made a charge move / remained
stationary this turn,) …` followed by one or more of: re-roll a hit/wound roll
  of 1, (you can) re-roll the hit/wound roll, add 1 to / subtract 1 from the
  hit/wound roll, that attack has the [weapon ability] ability.
- Attacks against it: `each time a (ranged|melee) attack targets this unit,
subtract 1 from the hit/wound roll`.
- `weapons equipped by models in this unit have the [lethal hits] ability`: the
  engine's own weapon rule, with its parameters written in.
- `models in this unit have the feel no pain 5+ ability`.
- Triggers: `at the start of / at the end of / in your <phase> phase, (if this
model is on the battlefield,) you gain 1CP` or `one model in this unit regains
up to D3 lost wounds`.
- Scoping in front of any of these: `once per battle, … until the end of the
phase,`; `while this model is leading a unit,`; and auras, `while a friendly
<keywords> unit is within 6" of this model,`.

Feel No Pain, invulnerable saves and the other core abilities already bind as
system rules (`unitRules` in forty-k.ts), so they count as automated without a
proposal.

## How it runs

- `Ability.auto` (core/types.ts) holds the parts read and the effects they
  compile to. `RuleRef.def` carries an inline rule, so `unitView` adds
  `autoRules(state, unit)`: the unit's own automated abilities, plus auras from
  units in range (base to base, friendly or enemy by `opposed()`, keywords by
  phrase). The attack procedure then fires them like any rule, and the attack
  preview names them.
- While leading: only while the unit has `status.attached`.
- Once per battle: the unit card's "Use" button sets `auto.<name>` (cleared at
  the end of the phase by the 40k resets) and `autoUsed.<name>`.
- Triggers run in `stepTurn` (core/content/turn.ts) on the owner's turn, with
  dice through `die()`. `state.triggered` lists what went off; the game log
  shows it under the phase header.
- `unit/automate {id, ability, auto | null}` switches one ability; only the
  unit's owner can send it.

Re-rolls of damage rolls and save modifiers are not read yet: the attack
procedure has no hook for them.
