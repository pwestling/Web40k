# Play by mail

A game that lives across days. Each player takes their turn when they can, and
the app makes a small file to pass on by email, chat or anything else. Code:
`src/mail/`.

## How a game goes

1. **Start.** In the lobby, open _Play by mail_ and press _Start a mail game_.
   You get a hotseat table for your chosen game. Set it up: armies, terrain,
   deployment. Then press _Send invitation_. The invitation carries the game
   so far as a replay file, including figures and rules packages.
2. **Join.** Your opponent opens the invitation with _Open a file from your
   opponent_. They play the other side.
3. **Take turns.** Whoever has the move plays, then presses _Send to …_. The
   file holds everything since the last one. The other player opens it with
   _Open their file_, and it's their move.

A move doesn't have to be a whole turn. When the game waits on the other side,
for a reaction or a decision, the strip says "over to them now". Send the file
then, and they answer.

While it's your move you can roll your opponent's dice for them, such as their
saves, because dice have no choices in them. Their decisions wait for them.
Nothing before your stretch can be undone; it's already been seen.

Games are kept on each device (`localStorage`) and listed in the lobby. The
files are the backup: _Save mine again_ re-saves the last one.

## The mailbox

On a self-hosted server ([self-host.md](self-host.md)), or with `?mailbox=`,
each new mail game gets a mailbox (`server/mailbox.mjs`, client in
`mailbox.ts`). Its id is a long random string carried inside the signed
invitation, so only the two players have it.

- _Send invitation_ posts the invitation there and offers _Copy invite link_.
  The link carries the mailbox in its `#mail=` hash; opening it joins the game.
- _Send to …_ posts each turn there. The same signed file, checked the same
  way on arrival.
- While a game waits, its page looks in the mailbox every 30 seconds and when
  the tab comes back into view. The lobby marks games whose turn has come.
- If the mailbox can't be reached, the file is saved instead, to pass on by
  hand, and _Try the mailbox again_ retries. Files always work.
- **Web push** is optional: when the server has VAPID keys, _Notify me when
  it's my move_ subscribes this browser (`src/sw/sw.template.js`). The push is
  empty; the app fetches the file from the mailbox. Without push, the tab
  title says "● Your move".

The mailbox stores files in order and refuses a different file under a
number it already has, but it doesn't vouch for anything: a server could
withhold a file, never forge one.

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
_Don't open it_ or _Open it anyway_. Enforcement is advisory everywhere in
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

- Compressed text, for pasting a file into chat.
