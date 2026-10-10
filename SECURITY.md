# Security

Open Battle runs code from rules packages on players' machines and connects strangers peer to peer, so security reports matter.

## Report a problem

Please don't open a public issue. Use [GitHub's private vulnerability reporting](https://github.com/pwestling/web40k/security/advisories/new), and include steps to reproduce and the app version (shown under **What's new**).

We aim to reply within a week and to credit you in the release notes, unless you'd rather not be named.

## In scope

- Escaping the package sandbox: a package reaching the page, storage, cookies or the network.
- A peer changing another player's game, secrets or ranked result beyond what the protocol allows.
- Forging or replaying ranked signatures, or getting an unsigned result counted.
- Running script through imported files (rosters, TTS saves, replays, figures, standees).
- The self-host kit's relay, mailbox or board.

## Out of scope

- A host editing their own dice or wounds: rules are advisory and every edit is in the log. Ranked fairness is tracked in [docs/compatibility.md](docs/compatibility.md).
- Public signalling relays run by third parties.
