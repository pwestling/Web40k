# Open Battle

An open source, browser-based, peer-to-peer tabletop for miniatures wargames. Think Tabletop Simulator,
but built for wargaming: inch-based measuring, bases with facing, units, dice and phases.

Warhammer 40,000 is the primary target, but the engine is deliberately generic. The test for that is
whether the same engine can also run rank-and-file games such as Warhammer: The Old World and Conquest:
The Last Argument of Kings, and other free-movement games such as Full Spectrum Dominance.

No install and no game server: one player hosts, shares a link, and the browsers talk to each other
directly over WebRTC.

> Open Battle is an independent project and is not affiliated with or endorsed by any game publisher.
> Warhammer 40,000 and related names are trademarks of Games Workshop Ltd. This repository ships no
> publisher artwork, models, unit data or rules text.

## Getting started

Requires Node 22+ and [pnpm](https://pnpm.io) (`corepack enable` will provide it).

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Click **Solo** to play locally, or **Host** to create a room and open the same URL in another browser
(or send it to a friend) and click **Join**, or **Watch** to spectate. Drag your own models to move them; the label shows how far
they have moved in inches.

| Command          | What it does                           |
| ---------------- | -------------------------------------- |
| `pnpm dev`       | Dev server with hot reload             |
| `pnpm test`      | Unit tests (Vitest)                    |
| `pnpm typecheck` | TypeScript, strict                     |
| `pnpm lint`      | ESLint                                 |
| `pnpm format`    | Prettier                               |
| `pnpm build`     | Production build into `dist/` (static) |

## Stack

| Concern      | Choice                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 3D rendering | [three.js](https://threejs.org) via [React Three Fiber](https://r3f.docs.pmnd.rs) + [drei](https://drei.docs.pmnd.rs) |
| UI           | React 19                                                                                                              |
| State        | [Zustand](https://zustand.docs.pmnd.rs) holding a pure, serialisable game state                                       |
| Networking   | WebRTC data channels via [Trystero](https://github.com/dmotz/trystero) (Nostr relays for signalling only)             |
| Build / test | Vite, Vitest, TypeScript, ESLint, Prettier                                                                            |
| Hosting      | Any static host (GitHub Pages works)                                                                                  |

## Design principles

- **3D first, with a top-down view.** The table is a 3D scene by default. Players can switch to an
  orthographic top-down view of the same scene for precise measuring; the view is per player and never
  synced.
- **Rules are advisory.** The engine measures, highlights and reminds (out of coherency, too far,
  this re-roll applies), but it never blocks a move or a roll. Players stay in charge, as at a real table.
- **Generic engine, imported content.** See below.

## Architecture

```
src/
  core/    Generic engine: state, intents → events, reducer, base geometry
           (round/oval/rect, edge-to-edge distance), ranked formations and
           dice expressions. No DOM, three.js or network imports, so it is
           unit-testable and identical on every peer.
  net/     Transport interface, Trystero (WebRTC) and in-memory implementations,
           and the Session that keeps peers in sync.
  render/  React Three Fiber scene: table, bases, drag-to-move, rulers.
  ui/      HTML overlay: lobby, players, dice, log.
  store.ts Zustand store wiring a Session to React.
```

**Content is imported, not shipped.** The repo contains no unit stats, points or rules text. Players
import that data at runtime (for example from [BSData](https://github.com/BSData)), and rules are
encoded as data so the engine can automate them. The schema for this is being designed separately.

**Units and bases.** One world unit is one inch; the default table is 60" × 44". Base sizes are kept in
millimetres, as they are printed, and can be round, oval or rectangular, with a facing. Skirmish units
(40k) place models freely; ranked units are rigid blocks that move, wheel and pivot together.

**The game is an event log.** The host turns every player _intent_ into a numbered, fully resolved
_event_ (this is where dice are rolled) and appends it to the log (`src/core/log.ts`). The table is
always just the starting state with the log folded over it, so the same log drives live sync, undo (an
undo is itself an event, and the undone entry stays visible), late joining, spectating and replays (the
log is the replay file). If the host leaves, the game currently ends; host migration and commit-reveal
dice are natural next steps.

## License

[MIT](./LICENSE)
