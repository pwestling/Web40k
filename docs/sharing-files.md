# Sharing files by link

Players share what they make (figure packs, tables, armies, standees and
replays) by putting the file anywhere that serves it over https and passing on
the link. The project hosts, lists and links none of these files.

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

Code: `src/share/links.ts` and `src/share/OpenLink.tsx`.
