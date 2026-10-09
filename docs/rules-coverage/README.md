# Rules coverage matrices

One file per system: core rules by name with our own paraphrase (no rules text), the app's status, the code and the
test. Audit #55. Since then a status's relative characteristic change applies once, not twice (`applyContinuous`).
[40k](40k.md) · [The Old World](tow.md) · [FSD](fsd.md) · [Conquest](conquest.md) · [Rift Lanterns](rift-lanterns.md)

Status key: **automated** (the app does it), **advisory check** (the app warns, the player decides), **manual
reminder** (the app shows it at the right time, the player resolves it), **missing** (nothing).

| System        | automated | advisory check | manual reminder | missing | rows |
| ------------- | --------- | -------------- | --------------- | ------- | ---- |
| 40k           | 73        | 13             | 24              | 0       | 110  |
| The Old World | 95        | 12             | 12              | 0       | 119  |
| FSD           | 105       | 11             | 31              | 0       | 147  |
| Conquest      | 77        | 14             | 7               | 0       | 98   |
| Rift Lanterns | 31        | 3              | 0               | 0       | 34   |

## Known gaps that need engine work

The eleven listed after #55 were closed in #57; #58 closed Selective Fire, the 40k declared charge targets and the
last missing rows (no matrix row is missing now). Still open (each matrix's own notes say more):

- FSD reactions that answer a reaction (chains): one reaction per action is offered; a chain is a manual reminder.
  It needs a stack of open reactions in core play.ts.
