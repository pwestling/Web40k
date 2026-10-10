# Host your own Open Battle

Open Battle runs in the browser and players connect to each other directly. A server only does a few
small jobs:

1. **Serves the app** (static files). [Caddy](https://caddyserver.com) does this, with HTTPS.
2. **Introduces players** to each other (signalling). That's `server/relay.mjs`, a tiny WebSocket relay.
   No game data passes through it.
3. **Relays traffic for players who can't connect directly** (TURN). Some networks block direct links:
   many offices, schools, hotels and mobile carriers. [coturn](https://github.com/coturn/coturn) relays
   for them. (The hosted site uses Cloudflare's TURN service instead: see
   [cloudflare-turn.md](cloudflare-turn.md).)
4. **Holds play-by-mail turns** until the other player picks them up. That's `server/mailbox.mjs`. It
   keeps signed files and checks nothing about the game: each player's app checks them (see
   [correspondence.md](correspondence.md)).

`docker-compose.yml` runs all four. It needs no account with any service: any Linux machine with Docker
works, whether that's a cheap VPS or a computer at home.

## What you need

- A Linux machine with [Docker and Compose](https://docs.docker.com/engine/install/). 1 CPU and 1 GB of
  RAM is plenty. Building the app needs about 2 GB of RAM; add swap on a smaller machine.
- For play over the internet, a domain name (or a free subdomain from a dynamic DNS service) whose
  A/AAAA record points at the machine.
- These ports open in the machine's firewall (and forwarded by your router, at home):

  | Port        | Protocol  | For                         |
  | ----------- | --------- | --------------------------- |
  | 80, 443     | TCP       | the app, HTTPS certificates |
  | 443         | UDP       | HTTP/3 (optional)           |
  | 3478        | UDP + TCP | TURN                        |
  | 49160–49359 | UDP       | TURN's relay ports          |

## Set up

```sh
git clone https://github.com/pwestling/Web40k.git open-battle
cd open-battle
cp .env.example .env
```

Edit `.env`:

- `DOMAIN`: your domain, e.g. `battle.example.com`.
- `SITE_ADDRESS`: normally the same as `DOMAIN`.
- `TURN_SECRET`: a long random string. Generate one with `openssl rand -hex 32`. The relay and TURN
  refuse to start while it's still the example or shorter than 16 characters.
- `TURN_EXTERNAL_IP`: this machine's public IP **if it sits behind NAT**. That covers a home router,
  and clouds such as AWS, GCP and Oracle, where the public IP isn't on the network card. Leave it empty on
  a VPS whose public IP is on the machine (`ip addr` shows it).
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (optional): turn on web push, so a play-by-mail player can
  be notified when it's their move. Make the pair once, after the first build:

  ```sh
  docker compose run --rm mailbox node mailbox.mjs --vapid
  ```

  Paste both lines into `.env` and run `docker compose up -d` again. Without them, players see their move
  in the tab title, and in the lobby when they open the app. Push goes through the browser maker's push
  service (as all web push does), but it carries nothing: the app fetches the turn from your server.

Then start it:

```sh
docker compose up -d --build
```

The first build takes a few minutes. Caddy fetches an HTTPS certificate for your domain on its own.

## Check it

Open `https://your-domain/health`. It checks all three parts from your browser:

- **Web app**: the app is being served.
- **Signalling relay**: your browser can open the relay's WebSocket.
- **TURN**: your browser asked TURN for a relay address, using the server's own login, and got one.
  The page also shows the server's own check (a STUN request from the relay to coturn).

`https://your-domain/health.json` gives the server-side half as JSON (status 503 when TURN doesn't
answer), for an uptime monitor.

Then open `https://your-domain`, host a game and send the link to a friend. To prove TURN carries a
game, add `?forceTurn=1` to the address before hosting: every connection then goes through TURN. In
the game menu, **Report a problem** downloads a file whose `report.net.peers` shows each link's `route`
(`relay → relay` means TURN).

## How it fits together

```
browser ──https──▶ Caddy ── /              the app (static files)
                         ├─ /relay        ─▶ relay (WebSocket signalling)
                         ├─ /config.json  ─▶ relay (signalling URL + TURN login)
                         ├─ /health.json  ─▶ relay (server-side health)
                         ├─ /mailbox      ─▶ mailbox (play-by-mail turns, web push)
                         └─ /health          the health page
browser ◀──udp/tcp 3478──▶ coturn (host network)
```

The app image is built with `VITE_SITE_CONFIG=config.json`, so at startup the app asks the server where
to meet and how to reach TURN. The relay answers with a TURN login that lasts 24 hours, signed with
`TURN_SECRET` (coturn's `use-auth-secret`), so the secret itself never reaches a browser. One image fits
any domain. It also tells the app about the mailbox (`MAILBOX_URL: "on"` in the compose file).

A mail game's mailbox is named by a long random id that only its two players have; there are no
accounts. Files are kept in the `mailbox_data` volume, and a mailbox nobody has touched for 60 days
(`MAILBOX_TTL_DAYS`) is forgotten. Players' devices keep their own copy of every game regardless.

**Open tables**, the board where players post a game for strangers to join, is off on a self-hosted
site. Set `OPEN_TABLES=on` in `.env` to turn it on for your group. The relay then keeps the board in
memory (`server/board.mjs`, at `/relay/board`) and the app reads it from there, never from the public
Nostr relays the hosted app uses. A post has only what its player typed: a display name, the game, its
size and time, language, live or by mail, and whether voice is on. Posts come down when the seats fill,
when the host leaves, or after their time, and three reports from different addresses hide one.

coturn uses the host's network, so it sees players' real addresses and its relay ports need no mapping.
It refuses to relay to private and loopback addresses, so nobody can use it to reach machines on your
own network.

## Home network, no domain

To play on a LAN, set `SITE_ADDRESS=http://192.168.1.20` (this machine's LAN address) and
`DOMAIN=192.168.1.20`. The app is then served over plain HTTP, and players on the same network connect
without TURN. Voice chat needs HTTPS, so it won't work this way. For internet play from home, use a
(dynamic DNS) domain, forward the ports above on your router, and set `TURN_EXTERNAL_IP` to your public
IP.

To test everything on one machine, set `DOMAIN` and `SITE_ADDRESS` to `localhost`, and
`TURN_ALLOW_PRIVATE=1` so TURN may relay between two browsers on the same machine. Caddy then uses its
own local certificate, which your browser will warn about.

## Updating

```sh
git pull
docker compose up -d --build
```

Players in the middle of a game keep playing: they're connected to each other, not to the server.
Everyone in a room should be on the same version (the app warns when they're not), so update between
games.

## Troubleshooting

- **The health page says TURN didn't give a relay address.** Check that UDP and TCP 3478, and UDP
  49160–49359, are open in every firewall: the cloud provider's, the machine's (`ufw`), and your router.
  Behind NAT, set `TURN_EXTERNAL_IP`. `docker compose logs turn` shows coturn's view.
- **No HTTPS certificate.** The DNS record must point at this machine, and ports 80 and 443 must be
  reachable from the internet. `docker compose logs app` shows Caddy's attempts.
- **"Looking for the game's host…" forever.** The host's page must stay open. Check that both players
  opened the same address. The app's **Check my connection** (on the start page) tests the network.
- **A different relay range.** Set `TURN_MIN_PORT` and `TURN_MAX_PORT` in the `turn` service's
  environment in `docker-compose.yml`, and open the same range in your firewall.

## Without Docker

The pieces are ordinary:

- `pnpm install && VITE_SITE_CONFIG=config.json pnpm build` produces `dist/`, which any web server can
  serve.
- `node server/relay.mjs` runs the relay (needs `@trystero-p2p/ws-relay`). Its settings are described
  at the top of the file.
- Route `/relay`, `/config.json` and `/health.json` to the relay, as `deploy/Caddyfile` does.
- `node server/mailbox.mjs` runs the mailbox (no dependencies). Route `/mailbox` to it and set
  `MAILBOX_URL=on` for the relay, or point the app at it with `?mailbox=` or `VITE_MAILBOX_URL`.
- Run coturn with the options in `deploy/coturn.sh`.

Without `VITE_SITE_CONFIG`, the app takes the same settings from the page address instead:
`?signal=wss://host/relay&turn=turn:host:3478&turnUser=…&turnPass=…`. See `src/net/config.ts`.
