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

### Playing a game

1. **Pick how to play.** _Play on this screen_ is hotseat: one browser, both sides. _Host online_ creates
   a room; send the page URL to your opponent, who clicks _Join_ (anyone else can _Watch_). Tick _Same
   browser_ to play between two tabs with no network at all.
2. **Bring armies.** _Import army list_ reads a BattleScribe or New Recruit roster (`.ros`, `.rosz`, or
   New Recruit's JSON export). Check the guessed base sizes, then deploy. _Sample army_ loads one of two
   small made-up armies for trying things out. Units appear in your deployment zone.
3. **Deploy**, choose who goes first in the top bar, and press _Start battle_.
4. **Play the turn.** The top bar tracks round, active player and phase, and gives both players 1 CP
   each Command phase. VP and CP have +/- buttons.
   - Click a model to select its unit and see its datasheet. Drag to move the whole unit; Shift-drag
     moves one model. The label shows the distance moved this phase against what is allowed (M plus
     any advance roll; the charge roll in the Charge phase; 3" in the Fight phase). Models out of
     coherency get a red ring; enemies' engagement range shows while you drag.
   - _Advance_, _Charge_ and _Battle-shock test_ roll the dice and record the result on the unit.
   - _Shoot_ or _Fight_ on a weapon opens the attack panel. Pick a target (from the list, or click it on
     the table). The panel works out models in range, attacks (rapid fire, blast), hit/wound/save
     targets (S vs T, AP, cover, invulnerable saves), keywords (sustained, lethal, devastating,
     twin-linked, anti, torrent, melta, heavy, lance) and feel no pain. Every number can be changed
     before declaring. Then roll each step, or _Roll everything_. Damage goes on the target's models
     automatically (wounded models first) and slain models leave the table.
   - Objectives show who controls them (OC within 3").
5. **Terrain, height and line of sight.** Terrain pieces are made of boxes (walls, floors, blocks,
   foliage), and the same boxes drive drawing, line of sight and floors. There is no physics: models
   stand on a level and never fall or collide.
   - _Edit terrain_ opens the terrain panel: add ruins, tall ruins, containers, woods, barricades,
     craters and hills; drag pieces and objectives; rotate with Q/E; set each piece's category
     (exposed, light, dense, solid); duplicate or delete. Pick a deployment preset, reset to the
     standard table, and save or load layouts as JSON.
   - Models dropped on a floor or hill stand on it. With a unit selected, R/F (or the ▲/▼ buttons)
     move it up or down a floor. Distances, engagement range and coherency count height.
   - _Line of sight_ on a unit card draws sight lines to every enemy unit: green fully visible, yellow
     partly visible (in cover), red hidden. Lines are traced from the model's eye line to points over
     the target's body, stopped by terrain and (optionally) other models. _Model's eye view_ puts the
     camera at a model's head; Esc leaves it. _X-ray terrain_ makes terrain see-through.
   - The attack panel uses the same check for visibility, cover, higher ground and hidden units in
     dense terrain. The terrain panel picks whether cover is −1 to hit or +1 to the save, and whether
     models block sight. Category rules are a best guess and can always be overridden.
6. **Fix anything by hand.** Rules are advisory: wounds, statuses, CP and VP can all be edited, and
   _Undo_ takes back your last action. The game autosaves in the host's browser (_Resume last game_
   in the lobby) and the replay bar scrubs back through everything that happened.

### Connecting over the internet

Browsers find each other through public Nostr relays by default; after that, game data goes directly
between them over WebRTC. If that is unreliable, run your own small signalling relay:

```sh
pnpm relay        # ws://localhost:8787 (set PORT to change)
```

and open the app with `?signal=wss://your-relay-host` (the parameter is kept on invite links), or build
with `VITE_SIGNAL_URL=wss://your-relay-host`. A page served over https needs a `wss://` relay, so put it
behind TLS (any reverse proxy, or a host such as Fly.io or Render). Players behind strict NATs may also
need a TURN server: `?turn=turn:host:3478&turnUser=u&turnPass=p`, or `VITE_TURN_URL`, `VITE_TURN_USER`
and `VITE_TURN_PASS` at build time.

### Hosting

Every push to `main` builds the site to the `gh-pages` branch. To serve it, set the repository's
**Settings → Pages → Source** to "Deploy from a branch" and pick `gh-pages`.

| Command          | What it does                           |
| ---------------- | -------------------------------------- |
| `pnpm dev`       | Dev server with hot reload             |
| `pnpm test`      | Unit tests (Vitest)                    |
| `pnpm typecheck` | TypeScript, strict                     |
| `pnpm lint`      | ESLint                                 |
| `pnpm format`    | Prettier                               |
| `pnpm build`     | Production build into `dist/` (static) |
| `pnpm relay`     | Self-hosted signalling relay           |

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
  systems/ Game-specific code. wh40k/ has the roster importer, attack
           suggestions, coherency, objectives and the table layout.
  ui/      HTML overlay: lobby, top bar, datasheet, attack panel, log.
  store.ts Zustand store wiring a Session to React.
```

**Rules are data.** The repo contains no unit stats, points or rules text. Game-specific rules come
in two layers (`src/core/content/schema.ts`):

- A `GameSystem` describes how a game plays: characteristics, dice procedures (such as hit, wound,
  save, damage), turn structure (IGOUGO phases or alternating activations), statuses, resources,
  actions, keyword rules written as "when X, if Y, do Z" effects, and advisory checks such as
  coherency.
- A `ContentPack` holds the units, models and weapons, imported by players at runtime (for example
  converted from [BSData](https://github.com/BSData)). A `Roster` is one player's army.

Rule checks are advisory: they warn and players decide. Anything not yet expressible becomes a
`manual` reminder. `src/core/content/examples/` has draft systems for 40k-style, Old World-style,
Conquest-style and Full Spectrum Dominance games, to keep the schema honest about being generic.

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
