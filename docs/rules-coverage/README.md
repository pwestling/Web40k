# Rules coverage matrices

One file per system: core rules by name with our own paraphrase (no rules text), the app's status, the code and the
test. Audit #55. Since then a status's relative characteristic change applies once, not twice (`applyContinuous`).
[40k](40k.md) · [The Old World](tow.md) · [FSD](fsd.md) · [Conquest](conquest.md) · [Rift Lanterns](rift-lanterns.md)

Status key: **automated** (the app does it), **advisory check** (the app warns, the player decides), **manual
reminder** (the app shows it at the right time, the player resolves it), **missing** (nothing).

| System        | automated | advisory check | manual reminder | missing | rows |
| ------------- | --------- | -------------- | --------------- | ------- | ---- |
| 40k           | 73        | 12             | 23              | 2       | 110  |
| The Old World | 73        | 8              | 12              | 0       | 93   |
| FSD           | 84        | 10             | 22              | 11      | 127  |
| Conquest      | 59        | 11             | 6               | 5       | 81   |
| Rift Lanterns | 31        | 3              | 0               | 0       | 34   |

## Known gaps that need engine work

The eleven listed after #55 were closed in #57. Still open (each matrix's own notes say more):

- FSD Selective Fire: a sight query that leaves enemy bases out (a reminder for now).
- FSD reactions that answer a reaction (chains): one reaction per action is offered.
- 40k: a charge must end engaged with every declared target; waits on the declared targets from the charge picker (UX 396).
