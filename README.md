# Web40k

An open source, browser-based, peer-to-peer tabletop for playing Warhammer 40,000. Think Tabletop
Simulator, but built around 40k: inch-based measuring, bases, units, dice pools and phases.

40k is the primary target, but the engine is deliberately generic. The test for that is whether the same
engine can also run rank-and-file games such as Warhammer: The Old World and Conquest: The Last Argument
of Kings, and other free-movement skirmish games such as Full Spectrum Dominance.

No install and no game server: one player hosts, shares a link, and the browsers talk to each other
directly over WebRTC.

> Web40k is an unofficial fan project and is not affiliated with or endorsed by Games Workshop.
> Warhammer 40,000 and related names are trademarks of Games Workshop Ltd. This repository ships no
> Games Workshop artwork, models or rules text.

## Getting started

Requires Node 22+ and [pnpm](https://pnpm.io) (`corepack enable` will provide it).

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Click **Solo** to play locally, or **Host** to create a room and open the same URL in another browser
(or send it to a friend) and click **Join**. Drag your own models to move them; the label shows how far
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

## Architecture

```
src/
  core/    Generic engine: state, intents → events, reducer, base geometry
           (round/oval/rect, edge-to-edge distance), ranked formations, dice
           expressions, the content schema and effect evaluation. No DOM,
           three.js or network imports, so it is unit-testable and identical
           on every peer.
  systems/ One module per game system (currently 40k): characteristics,
           phases, turn structure and system-specific mechanics.
  net/     Transport interface, Trystero (WebRTC) and in-memory implementations,
           and the Session that keeps peers in sync.
  render/  React Three Fiber scene: table, bases, drag-to-move, rulers.
  ui/      HTML overlay: lobby, players, dice, log.
  store.ts Zustand store wiring a Session to React.
```

**Systems and content are separate.** A `GameSystem` (`src/core/system.ts`) describes a game's
characteristics, phases, turn structure (player turns or alternating unit activations) and default
formation (skirmish or ranked). The repo contains no unit stats, points or rules text: players import a
`ContentPack` (`src/core/content.ts`), for example converted from [BSData](https://github.com/BSData). Rules
are encoded as data so the engine can automate them: weapon keywords are typed, and abilities are lists
of effects ("when the attacker makes a hit roll, if the target is a VEHICLE, re-roll ones"). Anything not
yet expressible becomes a `manual` reminder shown to players.

**Units and bases.** One world unit is one inch; the default table is 60" × 44". Base sizes are kept in
millimetres, as they are printed, and can be round, oval or rectangular, with a facing. Skirmish units
(40k) place models freely; ranked units are rigid blocks that move, wheel and pivot together.

**Sync model.** The host is authoritative. A player's action is sent as an _intent_; the host turns it
into a fully resolved _event_ (this is where dice are rolled), applies it, and broadcasts it with a
sequence number. Everyone applies the same events in the same order, and late joiners receive a
snapshot. This keeps dice honest between friends and makes desyncs easy to reason about. If the host
leaves, the game currently ends; host migration and commit-reveal dice are natural next steps.

## License

[MIT](./LICENSE)
