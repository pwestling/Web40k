# Web40k

An open source, browser-based, peer-to-peer tabletop for playing Warhammer 40,000. Think Tabletop
Simulator, but built around 40k: inch-based measuring, round bases, units, dice pools and phases.

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
  core/    Pure game rules and state: types, intents → events, reducer, geometry.
           No DOM, three.js or network imports, so it is unit-testable and
           identical on every peer.
  net/     Transport interface, Trystero (WebRTC) and in-memory implementations,
           and the Session that keeps peers in sync.
  render/  React Three Fiber scene: table, bases, drag-to-move, rulers.
  ui/      HTML overlay: lobby, players, dice, log.
  store.ts Zustand store wiring a Session to React.
```

**Units.** One world unit is one inch; the table is 60" × 44" (Strike Force). Base sizes are kept in
millimetres, as they are printed.

**Sync model.** The host is authoritative. A player's action is sent as an _intent_; the host turns it
into a fully resolved _event_ (this is where dice are rolled), applies it, and broadcasts it with a
sequence number. Everyone applies the same events in the same order, and late joiners receive a
snapshot. This keeps dice honest between friends and makes desyncs easy to reason about. If the host
leaves, the game currently ends; host migration and commit-reveal dice are natural next steps.

## License

[MIT](./LICENSE)
