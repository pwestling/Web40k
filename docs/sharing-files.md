# Sharing files by link

Players share what they make (figure packs, tables, armies, standees and
replays) between their browsers as torrents, or by putting the file anywhere
that serves it over https and passing on the link. The project hosts, lists
and links none of these files.

- **Share from this device:** on the front door, _Open or share a file by link_,
  then _Share a file from this device_ with a file saved from Open Battle. The
  tab seeds it over WebRTC (WebTorrent) and hands a copy to the site's seed
  nodes, and you get a share link with the magnet in it. Anyone who opens the
  link fetches it from the players who have it, or from a seed node, and seeds
  it on while their tab is open.
- **Private:** tick _Private_ and the file is encrypted (AES-GCM) before it
  leaves the device. The key is only in the share link's `#key=` fragment,
  which browsers never send to a server; trackers and seed nodes hold opaque
  bytes. Anyone with the whole link can open it, so share it like a password.
- **Seed nodes:** `server/seeder.mjs` (in the self-host kit at `/seed`, see
  [self-host.md](self-host.md)). It keeps files under their SHA-256 and serves
  them as the torrent's web seed. A magnet alone can't start from a web seed,
  so a browser that finds no players within a few seconds fetches the seed
  node's copy directly, checks its hash, and seeds it on. Without a seed node a
  link works only while someone who has the file keeps a tab open.
- **Settings:** trackers come from `?trackers=`, the site's `config.json` or
  `VITE_TRACKERS` (public WebTorrent trackers by default); seed nodes from
  `?seeders=`, `config.json` or `VITE_SEEDERS` (none by default).

- **Open a link:** on the front door, _Open or share a file by link_. The app
  fetches the file, shows what it is, its size and its SHA-256, and opens it
  only after a yes. Code inside a replay's rules packages still waits for its
  own yes, as with packages from a player.
- **Share link:** paste where your file lives to get
  `https://<app>/?open=<link>`. Whoever opens it gets the same question.
- **Changed files:** each link is remembered with the hash it gave. If the
  same link later gives other bytes, the question says so.
- **Where to host:** any static host that allows other sites to read its files
  (CORS): GitHub Pages, raw GitHub files (a `github.com/.../blob/...` link is
  turned into its raw address), Codeberg Pages, Netlify, or your own server.
- **Limits:** 96 MB a file; each model inside a figure pack keeps its own cap.

Rules packages and faction packs have their own links and consent: see
[packages.md](packages.md) and [faction-packs.md](faction-packs.md).

Code: `src/share/links.ts`, `src/share/torrent.ts`, `src/share/bucket.ts`, `src/share/OpenLink.tsx`
and `server/seeder.mjs`. `node scripts/share-smoke.mjs` (after `pnpm build`)
has two browsers share through a local tracker and seed node.

## Your own bucket

A player can keep their shared files in their own S3-compatible bucket
(Cloudflare R2, Amazon S3, Backblaze B2, MinIO): _Your own storage bucket_
under the share button. Each shared file is uploaded to
`<bucket>/open-battle/<sha256>` and its public address becomes one of the
torrent's web seeds, so the player's own storage keeps their links alive. The
keys stay in that browser's localStorage and sign each upload there (AWS
Signature V4 via `aws4fetch`); nothing else ever sees them. Use an API token
that can only write to that one bucket.

On R2: make a bucket, turn on its public `r2.dev` address (or a custom
domain), create an API token with _Object Read & Write_ on that bucket, and
add a CORS policy so the app's pages may upload:

```json
[
  {
    "AllowedOrigins": ["https://pwestling.github.io", "https://your-site.example"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["content-length"]
  }
]
```

The endpoint is `https://<account id>.r2.cloudflarestorage.com` with region
`auto`. Other providers work the same way with their own endpoint and region.

## Takedowns

A seed node operator sets `SEED_CONTACT` (shown at `/seed/info`) and
`SEED_ADMIN_TOKEN`, and drops a file with
`curl -X DELETE -H "Authorization: Bearer $TOKEN" https://<site>/seed/blob/<sha256>`.
The hash is then blocked, so the same bytes can't be posted again. The hash is
in the magnet link's `ws=` address.
