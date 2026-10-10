---
name: propose-change
description: Draft an Open Battle proposal issue from a diff or an idea when a change touches the protocol, MODULE_API, ranked results, rulesets.json, the board protocol or governance. Use before opening a PR that needs a proposal (GOVERNANCE.md).
---

# Propose a change

Some changes affect every player, saved game or package author. [GOVERNANCE.md](../../../GOVERNANCE.md#changes-that-need-a-proposal) lists them; they get a **Proposal** issue that stays open for at least seven days.

## Does this need one?

Look at the diff (`git diff main...HEAD`) for any of these:

- `src/protocol.ts` (`PROTOCOL`), `src/net/transport.ts` messages, or the shape of an intent or event in `src/core/actions.ts`
- `src/sdk` in a way an existing package would notice (`MODULE_API`)
- `src/core/ranked.ts` (`RankedResult`, `canonResult`), `src/ranked/ratings.ts` (ladders, the farming bar), `src/core/sharedDice.ts`
- `rulesets.json`
- `server/board.mjs` or [docs/board-protocol.md](../../../docs/board-protocol.md)
- `LICENSE`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`

If none, say so and stop.

## Draft it

Fill the fields of `.github/ISSUE_TEMPLATE/proposal.yml`, in plain words:

1. **What does it change?** The areas from the list above.
2. **What changes, and why.** What a player or package author would notice, then the reason. Two short paragraphs.
3. **What happens to existing games, packages, results and forks.** Be concrete: do saved games and replays still load and play the same? Do published packages still run? Do results already signed still verify (`canonResult` must spell old results as before)? What does a build without the change see when it meets one with it (bump `PROTOCOL` if they can't share a table)?
4. **Pull request.** The branch or PR, if there is one.

Read [docs/compatibility.md](../../../docs/compatibility.md) for what each version number promises. Give the draft to the person to post; don't open the issue yourself unless asked.
