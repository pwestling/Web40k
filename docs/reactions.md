# Reactions: windows for the waiting player

Roadmap #80. The engine opens a **reaction window** at the moments the other
side may answer (an enemy move, a target declared, saves about to be rolled,
an enemy unit that just fought, a charge roll, a failed roll that could be
re-rolled). The UI asks the reacting player only when something is playable,
and shows the other player "Ben may react…". The engine never blocks the
game: rules are advisory, and the hold on the active screen is a UI hold the
host's clock bounds (see "Holding the active player").

Code: `src/core/content/reactions.ts` (query and window logic), schema
fields in `src/core/content/schema.ts`, state in `src/core/types.ts`.

## Window ids

Standard ids (a system, package or faction pack may add its own):

| id               | Opens when                                                             | Who reacts                         |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `moveEnded`      | an enemy unit's move ends (#81: each move, not each drag)              | the other side                     |
| `movementEnded`  | the enemy's Movement phase ends (#81; before #81 this was `moveEnded`) | the other side                     |
| `targetDeclared` | an enemy declares an attack on one of your units                       | the side attacked                  |
| `beforeSaves`    | the wound roll is done and your saves are next                         | the defender                       |
| `fightPick`      | an enemy unit has just fought                                          | the other side                     |
| `chargeRolled`   | an enemy charge roll was made                                          | the side charged                   |
| `chargeDeclared` | an enemy declares a charge (The Old World's charge reactions)          | the side charged                   |
| `rerollable`     | a roll left failed dice the roller could re-roll ("Re-roll this?")     | the side that rolled (either side) |

### Where they open

**40k** (`forty-k.ts` `reactionWindows`; each core stratagem's `reacts` names its window):

| Window           | Opens at                                                                                                     | Core stratagems (and range)                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `moveEnded`      | an enemy unit's move ends in its Movement phase (see "When a move ends"); trigger `unitId` = that unit       | none core; imported ones by When text ("ends a Normal, Advance or Fall Back move") |
| `movementEnded`  | the turn moving on out of the enemy's Movement phase, if any enemy unit moved; trigger `units` = those units | Fire Overwatch (24" of a unit that moved), Rapid Ingress                           |
| `targetDeclared` | `attack/declare` (the attack panel) or a data `action/take` with a procedure and a target (the bot's shots)  | Smokescreen (the unit attacked)                                                    |
| `rerollable`     | `attack/roll` with failed dice, the attack not done (attack panel only: attack/reroll needs `state.attack`)  | Command Re-roll (`reroll` carries the dice)                                        |
| `beforeSaves`    | `attack/roll` that reaches the save stage, or a procedure step whose next test is `save`                     | none core; imported ones by When text                                              |
| `fightPick`      | `attack/clear` of a melee attack, or `procedure/clear` of an action that sets `fought`; Fight phase only     | Counter-offensive (an engaged unit not fought)                                     |
| `chargeRolled`   | `dice/roll` with charge `targets`, or a data `action/take` that sets `charged`; Charge phase only            | Heroic Intervention (12" of the charger)                                           |

Imported army stratagems answer a window by `reacts` (faction packs) or by the
window's `match` on their When text.

### When a move ends (#81)

A window with `opens: "unitMoved"` (40k's `moveEnded`) opens on the event that
finishes an enemy unit's move, in a phase the window lists:

- a `models/move` (not `setup`) or `unit/move` of a unit of the side whose turn
  it is, not in reserve,
- after which every model of the unit still on the table has moved this phase
  (moved by this event, or away from where it stood as the phase began).

So a whole unit dragged at once (or the bot's move, or a regiment's) ends its
move with that drag; a unit moved model by model ends its move with the last
model. A unit's later drags in the same phase (straightening a line) don't
open it again: `state.reactionAsked` remembers each unit a per-unit window
opened for this phase. Like every window it opens only when the other side
holds something playable for that unit, range and filters checked against the
unit that just moved (`trigger.unitId`; `trigger.seq` is the move's event). A
unit left partly where it stood never ends a move this way; the phase-end
window still lists it.

40k (11th edition, as this app reads it) has Fire Overwatch only at the end of
the opponent's Movement phase, so its core stratagems answer `movementEnded`;
`moveEnded` is for imported or faction stratagems whose When text says "just
after an enemy unit ends a Normal, Advance or Fall Back move" (or a faction
pack's `reacts: ["moveEnded"]`). A rules package can move Fire Overwatch to
each move with `reacts: [{ window: "moveEnded", range: 24 }]`.

**FSD**: its held action (`state.pending`) reads as `moveEnded` (a move) or
`targetDeclared` (a fire action); `playableReactions` lists each unit's `react`
as `action/take`. **The Old World**: the charge reaction question reads as
`chargeDeclared` (`source: "script"`), its options (Hold, Stand and shoot,
Flee) as `script/answer`. **Conquest** declares none yet.

### The bot

The reacting bot answers at once: it plays a re-roll card on its own failed
dice when it has 2 CP or more (or the dice are its saves) and sends
`attack/reroll` straight after; otherwise it passes. Playing the active side,
it doesn't wait on the other side's window (the solo bot waits out the
hold), and in bot-versus-bot matches the reacting side moves first. The soak
bot plays a reaction now and then and otherwise passes.

## State (synced, read on every screen)

```ts
// src/core/types.ts
interface GameState {
  /** The reaction window the engine opened, or null. Read it through reactionWindow(). */
  reaction?: OpenReaction | null;
  /** Per player: reactions they said not to be asked about this game ("Don't ask me this game"). "*" = all. */
  reactionMute?: Record<PlayerId, string[]>;
  /** #81: per-unit windows opened this phase ("moveEnded:<unitId>"), so a unit's move is asked about once. */
  reactionAsked?: { at: string; keys: string[] };
}

interface OpenReaction {
  window: string; // a window id above
  seat: number; // the seat that may react
  trigger: ReactionTrigger;
  /** Seq of the event that opened it; that logged event's `at` is the host's time it opened. */
  opened: number;
  /** The phase index it answers (a moveEnded window opens as the phase ends). */
  phase: number;
  /** How long (ms) the active side's screen holds for an answer; from settings.reactionHold, host-set. 0: no hold. */
  hold: number;
  /** Added after the first commit: windows the same moment opened for later (the attacker's re-roll first, then
   *  the defender's beforeSaves). Each opens when the one before closes, if its seat can play in it. */
  then?: OpenReaction[];
}

interface ReactionTrigger {
  /** The enemy unit whose action opened it: the unit that moved, shot, fought or charged. */
  unitId?: UnitId;
  /** The unit it was aimed at: the attack's or the charge's target. */
  targetId?: UnitId;
  /** Other units involved: every enemy unit that moved, every unit a charge was declared at. */
  units?: UnitId[];
  /** Dice that can be answered (rerollable: the failed ones; die = index in the roll). */
  dice?: { die: number; value: number }[];
  sides?: number;
  /** The roll's step, for rolls: "hit", "wound", "save", or a charge's "charge". */
  step?: string;
  /** The roll's total (a charge roll). */
  total?: number;
  /** The attack/roll (or dice/roll) seq the dice are from: what attack/reroll needs. */
  seq?: number;
}
```

## The query

```ts
import { reactionWindow, playableReactions, mayReact, reactionHoldUntil } from "../core/content/reactions";

/** The window open now (engine window, FSD's held action, or a code procedure's reaction question), or null. */
reactionWindow(state: GameState): ReactionWindowView | null;

interface ReactionWindowView extends OpenReaction {
  /** "window": a non-blocking engine window (state.reaction); "pending": FSD's held action (state.pending);
   *  "script": a code procedure waiting on the reacting player (The Old World's charge reaction). */
  source: "window" | "pending" | "script";
  /** The game waits on an answer (pending, script): no hold timer, it simply waits. */
  blocking: boolean;
}

/** Reactions this player can play in the open window right now (CP, once-per limits, phase, units). Empty if none. */
playableReactions(state: GameState, player: PlayerId): PlayableReaction[];

interface PlayableReaction {
  /** The action id (a stratagem, an army stratagem "army:<player>:<slug>", a unit reaction, an option id). */
  id: string;
  name: string;
  /** "1 CP", "AD 4-6", "" when free. */
  cost: string;
  window: string;
  /** The units it can be used on (the player picks one); empty when it takes no unit. */
  units: UnitId[];
  /** True when `play` needs a unit added: `{ ...play, targetId }` (player/action) or it is per unit already. */
  needsUnit: boolean;
  trigger: ReactionTrigger;
  /** Dispatch this (as the player). For player/action with needsUnit, add targetId. */
  play: Intent;
  /** For re-rolls: after `play`, dispatch { type: "attack/reroll", seq: reroll.seq, die } for the die picked. */
  reroll?: { seq: number; dice: { die: number; value: number }[] };
  /** The player said "Don't ask me this game" for this one; still playable from the hand. */
  muted: boolean;
}

/** For the other side's screen: "Ben may react…" (who, never which card), or null. */
mayReact(state: GameState, viewer: PlayerId): { seat: number; name: string } | null;

/** Host time (ms, from the opening event's logged `at`) until which the active side holds; null if no hold. */
reactionHoldUntil(record: GameRecord, state: GameState): number | null;
```

The engine opens a window only when the reacting seat has at least one
playable reaction that isn't muted, so asking whenever `reactionWindow` is
open and `playableReactions(...).filter(r => !r.muted)` is non-empty never
nags.

## Intents

- **Play**: dispatch `reaction.play` (usually `player/action`, with `targetId`
  when `needsUnit`). For a re-roll, then `attack/reroll { seq, die }`. FSD
  reactions are `action/take` (per unit); a code procedure's are
  `script/answer`.
- A `player/action` that `playableReactions` lists is accepted as played in the
  window, even when the phase has moved on since it opened (Fire Overwatch as
  the enemy's Movement phase ends, played once Shooting has begun).
- **Pass**: `{ type: "reaction/pass" }` from a player of the reacting seat. It
  closes an engine window (event `reaction/close`) or, as before, ends FSD's
  held reaction. For a code procedure's question, answer it (`script/answer`
  with its pass option, e.g. "hold").
- **Don't ask me this game**: `{ type: "reaction/mute", action: id | "*", mute: true }`
  (synced, `state.reactionMute`). Windows don't open for a seat whose every
  playable reaction is muted, so the game never waits on a muted player.

The window also closes by itself when the active side moves the game on (any
event other than table talk, clocks, rulers and the reactor's own plays) and
when the reacting player has nothing left to play.

## Holding the active player

`reactionHoldUntil(record, game)` is the opening event's host timestamp plus
`hold` (setting `reactionHold`, default 6000 ms, 0 for none). The active
side's screen holds its next step (and the solo bot waits) until then or until
the window closes, whichever is first. Every peer computes the same moment
from the log, so no timer event is needed; the engine itself never refuses
the active player's next step.

## Declaring windows (systems, packages, faction packs)

```ts
// GameSystem
reactionWindows?: ReactionWindowDef[];

interface ReactionWindowDef {
  id: string; // a standard id above, or your own
  /** The engine moment that opens it. */
  opens: "phaseEnd" | "unitMoved" | "attackDeclared" | "beforeSaves" | "attackRolled" | "unitFought" | "chargeRolled";
  /** Only in these phases (phaseEnd: the phase that is ending). */
  phases?: string[];
  /** Who reacts: the other side (default) or, for attackRolled, the side whose dice failed. */
  who?: "opponent" | "roller";
  /** Added after the first commit: for beforeSaves in a data procedure, the test step it opens before (default "save"). */
  step?: string;
  /** Case-insensitive regex tried on an imported stratagem's When text: a match says it answers this window. */
  match?: string;
  /** Default filter on the reacting player's units ("it"), with the trigger as "event" (e.g. only the unit attacked). */
  units?: Expr;
}

// ActionDef (player actions: stratagems, cards)
reacts?: { window: string; range?: Expr; units?: Expr }[];
// range: the unit must be within this many (system units) of the trigger's enemy unit(s);
// units: a filter on the candidate ("it") with the trigger as "event" (event.unit, event.target),
//        replacing the window's own `units`.

// ArmyStratagem and a faction pack's stratagem
reacts?: string[]; // window ids; else the window's `match` on its When text decides
```

A code procedure's question is a window when it names one:
`ctx.ask(player, question, options, "chargeDeclared")`.

## Usage (UI)

```tsx
const game = useGame();
const open = reactionWindow(game);
if (open && seatOf(me) === open.seat) {
  const cards = playableReactions(game, me).filter((r) => !r.muted);
  // show up to 3 cards by the dice; Yes:
  dispatch(cards[0].needsUnit ? { ...cards[0].play, targetId } : cards[0].play, me);
  if (cards[0].reroll) dispatch({ type: "attack/reroll", seq: cards[0].reroll.seq, die }, me);
  // No: dispatch({ type: "reaction/pass" }, me)
  // Don't ask me this game: dispatch({ type: "reaction/mute", action: cards[0].id, mute: true }, me)
} else {
  const other = mayReact(game, me); // "Ben may react…"
  const until = reactionHoldUntil(record, game); // hold the Roll button until then
}
```
