# Board protocol

The board is where Open Battle players find each other and share ranked results: open tables, online events and signed results. It is open source ([`server/board.mjs`](../server/board.mjs)) and open to any client that speaks this protocol, modded or not. The board stores and serves; it never decides what counts. Each client checks everything it reads and works out its own ladders ([compatibility.md](compatibility.md)).

This is version 1. Changes to it need a proposal ([GOVERNANCE.md](../GOVERNANCE.md#changes-that-need-a-proposal)).

## Where it lives

- **Nostr** (the default for the public app): events of kind 30078 on public relays, tagged `t=open-battle-table` (open tables), `t=open-battle-result` (ranked results, one address per replay) or `t=open-battle-event` (online events). See [`src/opentables/nostr.ts`](../src/opentables/nostr.ts).
- **HTTP** (a self-hosted site's relay with `OPEN_TABLES=on`): the paths below, under the site's `/relay`. Every path answers both as `/board/...` and as `/v1/board/...`; new clients should use `/v1`.

The public results are public data: anyone can read every result with `GET /v1/board/results` (or the Nostr tag) and recompute or mirror the ladders.

## HTTP endpoints

| Method and path           | Body                        | What it does                                      |
| ------------------------- | --------------------------- | ------------------------------------------------- |
| `GET /v1/board`           |                             | The open tables that are up: `{posts: [...]}`     |
| `POST /v1/board`          | `{post, key, token}`        | Put a table up, or change it (same `token`)       |
| `POST /v1/board/withdraw` | `{id, token}`               | Take a table down                                 |
| `POST /v1/board/report`   | `{id, why}`                 | Report a table; three addresses hide it           |
| `GET /v1/board/results`   |                             | Every ranked result kept: `{results: [...]}`      |
| `POST /v1/board/results`  | `{result, sigs, declined?}` | Add a ranked result                               |
| `GET /v1/board/events`    |                             | Online events and entries: `{docs: [{doc, sig}]}` |
| `POST /v1/board/events`   | `{doc, sig}`                | The newest of each event or entry is kept         |

Answers are JSON. Errors are `{error}` with 400 (malformed), 403 (not yours), 429 (too many from one address) or 503 (full).

Limits: 300 tables, 10 per address; 60 results per address per hour, 20,000 kept; 600 event documents per address per hour, 5,000 kept.

## Ranked results

A result is the object both players sign (`RankedResult` in [`src/core/ranked.ts`](../src/core/ranked.ts)): the system, size, rounds, both players' keys, names and VP, the winner, the replay's SHA-256, the time, and since this version the `rules` it was played under. It travels in its canonical spelling (`canonResult`), so its JSON text is exactly what was signed.

- **Keys** are ECDSA P-256 public keys written as `x.y`, the JWK `x` and `y` in base64url.
- **Signatures** are ECDSA with SHA-256 over UTF-8 text, base64 (the raw `r || s` WebCrypto produces).
- **Signed:** each player signs `open-battle-result:` followed by the result's JSON. `sigs` holds them by seat.
- **Declined:** one player signs the result; the other signs `open-battle-decline:<why>:` followed by the result's JSON, with `why` one of `agreed` or `broke`. `declined` is `{seat, why, sig}`, and the decliner's place in `sigs` is `null`. A declined result never counts on a ladder but counts in the sign rate.

The board keeps a result only if its signatures hold, so nobody can fill it with results no one signed. It keeps one result per replay hash. It does not check the score, the rules, or anything else: clients do.

## What clients check

A client reading results checks both signatures itself (`checkSigned` in [`src/ranked/verify.ts`](../src/ranked/verify.ts)), then files each result on the ladder for its rules (`ladderKey` in [`src/ranked/ratings.ts`](../src/ranked/ratings.ts)) and applies the farming bar there. A modded client's results land on their own ladder, so they never change ratings on the plain one.
