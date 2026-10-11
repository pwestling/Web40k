# Simultaneous phases: both sides at once

Roadmap #81. A system can mark a phase **simultaneous**: every seated player
does their own part of it at the same time, whoever's turn it is, and the
phase moves on once each of them has said they are done. 40k's Command phase
is one: while the player whose turn it is gains CP, takes Battle-shock tests
and scores, the other draws and picks their own mission cards and plays
anything of theirs that belongs to the opponent's Command phase. In a 2v2 game
the two players of a side test their own units at once.

Nothing here blocks anyone: rules are advisory. ▶ (`turn/next`) still moves
the phase on straight away (the UI should ask "Ben isn't done yet. Go on
anyway?" first).

Code: `src/core/content/simultaneous.ts` (queries and the reducer step),
`Segment.simultaneous` in `src/core/content/schema.ts`, `TurnState.ready` in
`src/core/types.ts`.

## Declaring one (systems and packages)

```ts
// GameSystem.turn.round, any phase segment
{ kind: "phase", id: "command", name: "Command", simultaneous: true, actions: ["battleShockTest"] }
```

- **Inside `playerTurns`** (40k): the phase still belongs to the active side.
  An action's `side` keeps its meaning (`"active"`: the side whose turn it is;
  `"inactive"`: the other side), and both sides act at the same time. Package
  code sees the turn as before (`ctx.view.turn`).
- **Outside `playerTurns`** (a round-level phase that is nobody's turn): every
  seated player counts as the active one, so `side: "active"` actions and
  abilities are each player's for their own units (`sharedPhase(state)`).

Steps inside the phase (`kind: "step"`, such as 40k's `gainCp`) still run once
as the phase begins, for both players as they say.

## State (synced, in the log)

```ts
// src/core/types.ts
interface TurnState {
  // ...round, activeSeat, phase, firstSeat
  /** In a simultaneous phase: the players who said they are done. Any change of phase clears it. */
  ready?: PlayerId[];
}
```

The phase moves on, exactly as `turn/next` would (phase-end windows, scoring
moments, phase-start triggers), with the event that makes the last seated
player ready. Players without a seat (watchers) are never waited for; in a
2v2 game all four players are.

## Intents and events

| Intent                                 | Event                                                | Notes                                                                                                          |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `{ type: "turn/ready" }`               | `{ type: "turn/ready", player, ready: true, seed? }` | "I'm done". `seed` is set when it is the last one and moves the phase on (the dice of the next phase's steps). |
| `{ type: "turn/ready", ready: false }` | `{ type: "turn/ready", player, ready: false }`       | "Not done after all", while the others haven't all said so.                                                    |
| `{ type: "turn/next" }`                | `{ type: "turn/next", seed }` (unchanged)            | Moves on at once, whoever is ready (advisory override; hotseat).                                               |

The host refuses `turn/ready` from a player without a seat, outside a
simultaneous phase, or when it changes nothing (already ready). Undo takes a
ready back like any other event.

## The query

```ts
import { simultaneousPhase, isReady, waitingFor, sharedPhase } from "../core/content/simultaneous";

/** The simultaneous phase on now, or null. */
simultaneousPhase(state: GameState): {
  phase: string; // the phase id ("command")
  name: string;
  ready: PlayerId[]; // said they are done, in order
  waiting: PlayerId[]; // seated players it still waits for
  shared: boolean; // outside player turns: nobody's turn
} | null;

isReady(state, player): boolean;
waitingFor(state): PlayerId[];
/** A simultaneous phase outside player turns: every player counts as active. */
sharedPhase(state): boolean;
```

## Usage (UI)

```tsx
const game = useGame();
const together = simultaneousPhase(game);
if (together) {
  // Each seated player I control who isn't done gets "Done": dispatch({ type: "turn/ready" }, me).
  // "Waiting for Ben": together.waiting (names); the active side's ▶ can still send turn/next after a confirm.
  // A player who is done can take it back: dispatch({ type: "turn/ready", ready: false }, me).
}
```

The UI is Sprint's, in the top bar (`TopBar.tsx`: "Done ▶", "Waiting for …",
"Not done", "Go on anyway"); it is not part of the engine change.

## Secrets

Mission cards drawn at once are no problem: each card is a secret under the
drawing player's own key (`mission:<nnn>` or `deck:<deck>:<nnn>`, committed
with `secret/commit` from that player), so two players drawing in the same
moment never touch each other's entries. A code procedure's `ctx.secret`
asks one player and waits on them alone.

## Bots and the soak

- Every bot policy is wrapped by `guarded` (`src/bot/moves.ts`): in a
  simultaneous phase its "move on" (`turn/next`) becomes `turn/ready` for its
  own player, the side whose turn it isn't says it is ready once it has
  nothing else to do, and a bot that is ready waits (no move) for the others.
  In bot-versus-bot matches both sides act, then both say ready.
- The soak bot (`src/soak/bot.ts`) acts for every seated player in a
  simultaneous phase and moves on with `turn/ready` from each, now and then
  with `turn/next` instead (the override).
