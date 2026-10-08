import { stateAt, stateHash, type GameRecord, type LoggedEvent, type Rng } from "../core";
import { createLoopbackNetwork } from "../net/loopback";
import { Session } from "../net/session";
import type { MailFile } from "./file";
import { t } from "../i18n";

type Verdict =
  | { ok: true }
  | {
      ok: false;
      /** What doesn't check out, in a sentence for the player. */
      why: string;
      /** The first event that came out differently, if it got that far. */
      seq?: number;
    };

/** Strip what differs between devices for the same play: the clock and which device logged it. */
const same = (a: LoggedEvent, b: LoggedEvent) =>
  a.seq === b.seq && a.by === b.by && JSON.stringify(a.event) === JSON.stringify(b.event);

/**
 * Replay a file's intents from where it starts, with its dice, and check the
 * events come out as the file says: the same rolls, and only moves the rules
 * resolve. Rules packages (the sandbox) resolve asynchronously, so this waits
 * for the replay to settle.
 */
export async function replaySegment(record: GameRecord, file: MailFile, rng: Rng): Promise<Verdict> {
  if (stateHash(stateAt(record)) !== file.base.hash)
    return { ok: false, why: t("It starts from a different game from yours.") };
  const ats = file.events.map((e) => e.at);
  let clock = 0;
  const session = new Session({
    transport: createLoopbackNetwork().connect("mail-verify"),
    role: "host",
    record,
    rng,
    now: () => ats[clock++] ?? ats.at(-1) ?? 0,
    onChange: () => {},
  });
  try {
    for (const { intent, by } of file.intents) session.dispatch(intent, by);
    // Let any sandboxed resolutions finish (they queue the intents after them).
    let last = -1;
    for (let i = 0; i < 200 && session.log.events.length !== last; i++) {
      last = session.log.events.length;
      await new Promise((r) => setTimeout(r, 0));
    }
    const got = session.log.events.filter((e) => e.seq > file.base.seq);
    for (let i = 0; i < Math.max(got.length, file.events.length); i++) {
      const a = got[i];
      const b = file.events[i];
      if (!a || !b || !same(a, b))
        return {
          ok: false,
          why: !b
            ? t("Its moves, played again here, come out differently: it leaves something out.")
            : !a
              ? t("It has results its moves don't produce: something was added or changed.")
              : t("A roll or result in it doesn't match what its moves and dice give here: it was changed."),
          seq: (b ?? a)!.seq,
        };
    }
    return { ok: true };
  } finally {
    session.leave();
  }
}
