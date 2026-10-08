# Play by mail

A game that lives across days. Each player takes their turn when they can, and
the app makes a small file to pass on by email, chat or anything else. Code:
`src/mail/`.

## How a game goes

1. **Start.** In the lobby, open *Play by mail* and press *Start a mail game*.
   You get a hotseat table for your chosen game. Set it up: armies, terrain,
   deployment. Then press *Send invitation*. The invitation carries the game
   so far as a replay file, including figures and rules packages.
2. **Join.** Your opponent opens the invitation with *Open a file from your
   opponent*. They play the other side.
3. **Take turns.** Whoever has the move plays, then presses *Send to …*. The
   file holds everything since the last one. The other player opens it with
   *Open their file*, and it's their move.

A move doesn't have to be a whole turn. When the game waits on the other side,
for a reaction or a decision, the strip says "over to them now". Send the file
then, and they answer.

While it's your move you can roll your opponent's dice for them, such as their
saves, because dice have no choices in them. Their decisions wait for them.
Nothing before your stretch can be undone; it's already been seen.

Games are kept on each device (`localStorage`) and listed in the lobby. The
files are the backup: *Save mine again* re-saves the last one.

## What's checked

Every file is checked by the player who receives it.

- **Signature.** Each device has an ECDSA P-256 key (`keys.ts`). A player's
  first file ties their key to their side. Later files from that side must be
  signed with the same key.
- **Start point.** A file must start exactly where the last file ended (same
  event count, same state hash). If it doesn't, it's refused.
- **Every result.** A file carries what its sender asked for (the intents) as
  well as what happened (the events). The receiver replays the intents with
  the file's dice (`verify.ts`), and the events must come out identical. That
  catches fudged rolls, edited events and moves the rules wouldn't resolve.

If a file fails a check, the strip lists what failed, and the player chooses
*Don't open it* or *Open it anyway*. Enforcement is advisory everywhere in
Open Battle, and this is no different.

## Dice no one picks

These are commit–reveal seeds, one per file (`dice.ts`):

- Each file commits to a fresh secret seed by sending `SHA-256(seed)`. It also
  reveals the seed the sender committed to in their previous file.
- A file's dice come from the revealed seed mixed with the opponent's latest
  commitment, together with the game id and the file number.
- The sender chose their seed before the opponent's commitment existed. The
  opponent chose theirs without seeing the sender's seed. So neither could
  steer the dice. The receiver checks the revealed seed against the earlier
  commitment.
- Files strictly alternate. A second file in a row could otherwise pick a seed
  after seeing the opponent's commitment.

Limits, stated plainly:

- **The first file from each player has no earlier seed.** The invitation and
  the joining reply use dice anyone could work out. Those files set the game
  up, and the battle's dice are fair from the third file on.
- **The player with the move can know their dice in advance.** Their device
  holds both inputs, so someone determined, with developer tools, could preview
  rolls before choosing moves. They can't change a roll, but they can know it.
  Closing this gap needs a third party, such as a public randomness beacon or a
  mailbox on the self-hosted relay that stamps each roll.

## Not yet

- A mailbox on the self-hosted relay, so files pass without copying.
- Web push notifications. The tab title says when it's your move.
- Compressed text, for pasting a file into chat.
