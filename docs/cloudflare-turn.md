# TURN for the hosted site, through Cloudflare

Most players connect to each other directly. Some networks (many offices,
schools, phone carriers and hotel wifi) don't allow that, and those players
need a **TURN server** to pass their game along. The hosted site
(https://pwestling.github.io/Web40k/) gets one from Cloudflare's TURN service:

- A small Cloudflare Worker (`server/turn-worker.mjs`) asks Cloudflare for
  logins that expire after a few hours and hands them to the page.
- The page fetches logins as it opens, and fetches fresh ones before they
  run out. If the Worker doesn't answer, games still work wherever a direct
  connection does, as before.
- The TURN key's API token stays a Worker secret. The page only ever sees
  logins that expire.

Self-hosting with docker compose instead? That has its own TURN server
(coturn): see [self-host.md](self-host.md).

## What to create (once)

You need a Cloudflare account. Cloudflare's TURN service has a free monthly
allowance; check its current pricing page before you turn it on.

1. **A TURN key.** In the Cloudflare dashboard go to **Realtime → TURN
   Server** and create a key (name it "Open Battle"). Note its **Turn
   Token ID** and **API Token**.
2. **The Worker.** Pick one of the ways below. Either way, the Worker is
   called `open-battle-turn`, and its address looks like
   `https://open-battle-turn.<your-subdomain>.workers.dev/`.
3. **The Worker's secrets.** Set these once, from a computer with Node:

   ```sh
   cd deploy/cloudflare-turn
   npx wrangler login
   npx wrangler secret put TURN_KEY_ID          # paste the Turn Token ID
   npx wrangler secret put TURN_KEY_API_TOKEN   # paste the API Token
   ```

   You can also set them in the dashboard: **Workers & Pages →
   open-battle-turn → Settings → Variables and Secrets**, as type "Secret".

4. **Tell the site.** In the GitHub repository go to **Settings → Secrets and
   variables → Actions → Variables** and add a variable named
   `TURN_CONFIG_URL`, set to the Worker's address. The next push to `main`
   (or running the "Deploy" workflow) builds the site with it.

### Deploying the Worker

From your computer:

```sh
cd deploy/cloudflare-turn
npx wrangler deploy
```

Or from GitHub: add the repository secrets `CLOUDFLARE_API_TOKEN` (an API
token with the "Edit Cloudflare Workers" template) and
`CLOUDFLARE_ACCOUNT_ID` (on the dashboard's Workers page), then go to
**Actions → TURN worker → Run workflow**.

`deploy/cloudflare-turn/wrangler.toml` lists the pages allowed to ask for
logins (`ALLOWED_ORIGINS`): the hosted site and local dev servers. If you
serve the site from somewhere else too, add its address there and deploy
again.

## Checking it works

- Open the Worker's address from the site's own page (or with
  `curl -H "Origin: https://pwestling.github.io" <worker address>`). It
  answers `{"turn":[…],"ttl":14400}`. An `error` in the answer says what's
  missing, such as an unset secret.
- On the site, **Check my connection** (in the lobby) shows
  "TURN: works" under Details.
- To try a game that goes only through TURN, add `?forceTurn=1` to both
  players' addresses.
