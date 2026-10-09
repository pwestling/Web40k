# Rules coverage matrices

One file per system: core rules by name with our own paraphrase (no rules text), the app's status, the code and the
test. Audit #55. Since then a status's relative characteristic change applies once, not twice (`applyContinuous`).
[40k](40k.md) · [The Old World](tow.md) · [FSD](fsd.md) · [Conquest](conquest.md) · [Rift Lanterns](rift-lanterns.md)

Status key: **automated** (the app does it), **advisory check** (the app warns, the player decides), **manual
reminder** (the app shows it at the right time, the player resolves it), **missing** (nothing).

| System        | automated | advisory check | manual reminder | missing | rows |
| ------------- | --------- | -------------- | --------------- | ------- | ---- |
| 40k           | 73        | 12             | 23              | 2       | 110  |
| The Old World | 71        | 8              | 11              | 2       | 92   |
| FSD           | 84        | 10             | 22              | 11      | 127  |
| Conquest      | 55        | 9              | 7               | 10      | 81   |
| Rift Lanterns | 31        | 3              | 0               | 0       | 34   |

## Known gaps that need engine work

- `actionTargets(state, unit, action, weapon)` now has the weapon in scope (40k Indirect Fire uses it); FSD's target filters don't use it yet (FSD).
- Re-rolling a single die face (`reroll: { values: [6] }`) isn't supported (Conquest Inspired).
- Charges: no landed / fell-short event; targets not limited to front arc and sight (Conquest).
- March limits (half rate sideways/back, not within 1" of an enemy); command stand removed last (Conquest).
- Plain activations (`startActivation`) don't refuse a unit already activated this round; `script/start` now checks a code action's `available` (Rift Lanterns).
- Weapon rules by name pattern (`hasRule`, e.g. Multiple Shots); Command sub-phase steps (TOW).
