import {
  lastSeq,
  stateAt,
  stateHash,
  type GameRecord,
  type Intent,
  type LoggedEvent,
  type PlayerId,
} from "../core";
import type { ReplayFile } from "../ui/replayFile";
import { commitTo, newSeed, segmentRng, type DiceKey } from "./dice";
import { identity, sign, verifySignature } from "./keys";

/**
 * Play by mail (roadmap #23): a game that lives across days, passed back and
 * forth as small files. Each file carries one stretch of play (a segment):
 * what its sender asked for (the intents) and what came of it (the events),
 * from where the last file left off. The receiver replays the intents with the
 * segment's dice (dice.ts) and accepts the events only if they come out the
 * same (verify.ts). Files alternate strictly between the two players.
 *
 * The first file, the invitation, carries the game so far as a replay file
 * (figures and rules packages included) instead of a segment.
 */
export interface MailFile {
  format: "open-battle/mail@1";
  /** The game's id, the same on both devices. */
  game: string;
  /** This file's number in the game: 1 is the invitation, then the players take turns. */
  index: number;
  /** The sender's player and display name. */
  from: PlayerId;
  name: string;
  /** The sender's public key (keys.ts); their first file ties it to their seat. */
  key: JsonWebKey;
  /** Where this segment starts: the last event both players had, and a hash of the game there. */
  base: { seq: number; hash: number };
  /** The dice: the sender's seed from last time, and the receiver's commitment it was mixed with. */
  reveal: string | null;
  theirs: string | null;
  /** The sender's commitment to the seed they'll reveal next time. */
  commit: string;
  intents: { intent: Intent; by: PlayerId }[];
  events: LoggedEvent[];
  /** The invitation only: the whole game so far. */
  record?: ReplayFile;
  /** ECDSA signature of everything above (the file without `sig`). */
  sig: string;
}

/** The segment a player is playing now, between receiving a file and sending one. */
export interface Segment {
  index: number;
  base: { seq: number; hash: number };
  reveal: string | null;
  theirs: string | null;
  /** The seed this segment's file will commit to, revealed in the next one. */
  next: string;
  intents: { intent: Intent; by: PlayerId }[];
}

export function baseOf(record: GameRecord): { seq: number; hash: number } {
  return { seq: lastSeq(record), hash: stateHash(stateAt(record)) };
}

/** Start a segment: the next file's number, where it starts, and its dice key. */
export function startSegment(
  record: GameRecord,
  index: number,
  reveal: string | null,
  theirs: string | null,
): Segment {
  return { index, base: baseOf(record), reveal, theirs, next: newSeed(), intents: [] };
}

export function diceKey(game: string, s: Pick<Segment, "index" | "reveal" | "theirs">): DiceKey {
  return { game, index: s.index, reveal: s.reveal, theirs: s.theirs };
}

export { segmentRng };

function unsigned(file: Omit<MailFile, "sig"> & { sig?: string }): string {
  const { sig: _sig, ...rest } = file;
  return JSON.stringify(rest);
}

/** The file for a segment: its intents and the events logged since its base, signed. */
export async function buildFile(args: {
  game: string;
  from: PlayerId;
  name: string;
  segment: Segment;
  record: GameRecord;
  invitation?: ReplayFile;
}): Promise<MailFile> {
  const { game, from, name, segment, record, invitation } = args;
  const id = await identity();
  const body: Omit<MailFile, "sig"> = {
    format: "open-battle/mail@1",
    game,
    index: segment.index,
    from,
    name,
    key: id.publicKey,
    base: segment.base,
    reveal: segment.reveal,
    theirs: segment.theirs,
    commit: await commitTo(segment.next),
    intents: segment.intents,
    events: record.events.filter((e) => e.seq > segment.base.seq),
    ...(invitation ? { record: invitation } : {}),
  };
  return { ...body, sig: await sign(unsigned(body), id) };
}

/** Read a file's text: the parsed file, or why it isn't one. */
export function parseFile(text: string): MailFile | string {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return "That isn't a play-by-mail file (it doesn't read as JSON).";
  }
  const f = v as Partial<MailFile>;
  if (f?.format !== "open-battle/mail@1") return "That isn't a play-by-mail file.";
  if (
    typeof f.game !== "string" ||
    typeof f.index !== "number" ||
    !Array.isArray(f.events) ||
    !Array.isArray(f.intents)
  )
    return "That play-by-mail file is damaged.";
  return f as MailFile;
}

export async function signatureOk(file: MailFile): Promise<boolean> {
  return verifySignature(unsigned(file), file.sig, file.key);
}

/** The file's name when saved. */
export function fileName(file: MailFile): string {
  return `open-battle-mail-${file.game.slice(0, 8)}-${String(file.index).padStart(3, "0")}.json`;
}
