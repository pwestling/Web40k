import { create } from "zustand";
import { lastSeq, type GameRecord, type PlayerId, type Rng } from "../core";
import { useStore } from "../store";
import { bundleReplay, unbundleReplay } from "../ui/replayFile";
import { commitTo, newSeed } from "./dice";
import {
  baseOf,
  buildFile,
  diceKey,
  parseFile,
  segmentRng,
  signatureOk,
  startSegment,
  type MailFile,
  type Segment,
} from "./file";
import { keyId } from "./keys";
import { fetchFiles, newBox, postFile, type Box } from "./mailbox";
import { replaySegment } from "./verify";
import { t } from "../i18n";

/**
 * A play-by-mail game as this device keeps it: the game, which side is ours,
 * the stretch we're playing (or the file we sent and are waiting on), and
 * what we know of the opponent (their key, their latest dice commitment).
 */
interface MailGame {
  id: string;
  /** Our player and side. */
  me: PlayerId;
  seat: number;
  /** Display names by player, from the files. */
  names: Record<PlayerId, string>;
  record: GameRecord;
  /** The stretch we're playing; null while we wait for their file. */
  segment: Segment | null;
  /** The last file we sent (to send again), and the seed it committed to (secret until our next file). */
  sent: MailFile | null;
  committed: string | null;
  /** The opponent's public key (tied on their first file) and their latest commitment. */
  theirKey: JsonWebKey | null;
  theirCommit: string | null;
  /** When it last changed hands, for the list. */
  at: number;
  /** The game's mailbox, when it has one; turns are posted there as well as saved as files. */
  box?: Box | null;
  /** Whether our last file reached the mailbox. */
  posted?: boolean;
  /** Whether this device asked to be notified of their files. */
  push?: boolean;
}

/** A file that didn't check out, held until the player decides. */
interface Doubt {
  file: MailFile;
  problems: string[];
}

interface Mail {
  game: MailGame | null;
  doubt: Doubt | null;
  /** The last thing that went wrong opening a file. */
  error: string | null;
}

export const useMail = create<Mail>(() => ({ game: null, doubt: null, error: null }));

const LIST = "open-battle:mail-games";
const key = (id: string) => `open-battle:mail:${id}`;

/** The mail games on this device, newest first. */
export function mailGames(): { id: string; at: number; yours: boolean; vs: string; box: boolean }[] {
  try {
    const ids = JSON.parse(localStorage.getItem(LIST) ?? "[]") as string[];
    return ids
      .map((id) => loadGame(id))
      .filter((g): g is MailGame => !!g)
      .map((g) => ({
        id: g.id,
        at: g.at,
        yours: !!g.segment,
        box: !!g.box,
        vs: Object.entries(g.names).find(([p]) => p !== g.me)?.[1] ?? t("Waiting for someone to join"),
      }))
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function loadGame(id: string): MailGame | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as MailGame) : null;
  } catch {
    return null;
  }
}

function save(game: MailGame): void {
  try {
    localStorage.setItem(key(game.id), JSON.stringify(game));
    const ids = JSON.parse(localStorage.getItem(LIST) ?? "[]") as string[];
    if (!ids.includes(game.id)) localStorage.setItem(LIST, JSON.stringify([game.id, ...ids]));
  } catch {
    // Storage full: the game still plays; the files are the backup.
  }
}

export function forgetMailGame(id: string): void {
  try {
    localStorage.removeItem(key(id));
    const ids = JSON.parse(localStorage.getItem(LIST) ?? "[]") as string[];
    localStorage.setItem(LIST, JSON.stringify(ids.filter((x) => x !== id)));
  } catch {
    // Nothing to forget.
  }
}

/** The dice the session draws from: the current stretch's, swapped as files come and go. */
let dice: Rng = Math.random;
const rng: Rng = () => dice();

function update(patch: Partial<MailGame>): void {
  const game = useMail.getState().game;
  if (!game) return;
  const next = { ...game, ...patch };
  useMail.setState({ game: next });
  save(next);
}

/** Open a game on the table as this device's side of a mail game. */
async function open(game: MailGame): Promise<void> {
  dice = game.segment ? await segmentRng(diceKey(game.id, game.segment)) : Math.random;
  useMail.setState({ game, doubt: null, error: null });
  save(game);
  useStore.getState().start({
    role: "host",
    mode: "hotseat",
    name: game.names[game.me] ?? "",
    record: game.record,
    rng,
    onIntent: (intent, by) => {
      const g = useMail.getState().game;
      if (g?.segment) update({ segment: { ...g.segment, intents: [...g.segment.intents, { intent, by }] } });
    },
  });
  seat();
}

/** Tell the table which side is ours, where our stretch starts, and whether we're waiting. */
function seat(): void {
  const g = useMail.getState().game;
  useStore.setState({
    mail: g ? { seat: g.seat, floor: g.segment?.base.seq ?? lastSeq(g.record), locked: !g.segment } : null,
  });
}

// The record follows the table as it's played.
useStore.subscribe((s, prev) => {
  const g = useMail.getState().game;
  if (g && s.mail && s.record !== prev.record && s.record.initial === g.record.initial)
    update({ record: s.record });
});

/**
 * Start a mail game on a fresh hotseat table: we're side 0. Set the table up
 * (armies, terrain), then send the invitation.
 */
export async function startMailGame(name: string, system?: string): Promise<void> {
  useStore.getState().start({ role: "host", mode: "hotseat", name, ...(system ? { system } : {}) });
  const record = useStore.getState().record;
  const game: MailGame = {
    id: newSeed().slice(0, 24),
    me: "p1",
    seat: 0,
    names: { p1: name || t("Player 1") },
    record,
    segment: startSegment(record, 1, null, null),
    sent: null,
    committed: null,
    theirKey: null,
    theirCommit: null,
    at: Date.now(),
    box: newBox(),
  };
  await open(game);
  if (name) useStore.getState().dispatch({ type: "player/rename", player: "p1", name });
}

export async function resumeMailGame(id: string): Promise<void> {
  const game = loadGame(id);
  if (game) await open(game);
}

/**
 * Close our stretch and make its file: the invitation carries the whole game
 * so far; later files carry what we did since theirs.
 */
export async function sendTurn(): Promise<MailFile | null> {
  const g = useMail.getState().game;
  if (!g?.segment) return g?.sent ?? null;
  const record = useStore.getState().record;
  const invitation = g.segment.index === 1;
  // The invitation is a starting point, not a stretch to replay: it starts where the game is now.
  const segment: Segment = invitation ? { ...g.segment, base: baseOf(record), intents: [] } : g.segment;
  const file = await buildFile({
    game: g.id,
    from: g.me,
    name: g.names[g.me] ?? "",
    segment,
    record,
    ...(invitation ? { invitation: await bundleReplay(record), box: g.box } : {}),
  });
  update({ record, segment: null, sent: file, committed: segment.next, at: Date.now(), posted: false });
  seat();
  if (g.box) await postAgain();
  return file;
}

/** Post our last file to the mailbox (again); true when it's there. */
export async function postAgain(): Promise<boolean> {
  const g = useMail.getState().game;
  if (!g?.box || !g.sent) return false;
  const ok = await postFile(g.box, g.sent);
  if (useMail.getState().game?.id === g.id) update({ posted: ok });
  return ok;
}

/** The opponent's next file in a game's mailbox, if it has come. */
async function nextFromMailbox(game: MailGame): Promise<MailFile | null> {
  if (!game.box || game.segment || !game.sent) return null;
  const files = await fetchFiles(game.box, game.sent.index);
  return files?.find((f) => f.index === game.sent!.index + 1 && f.from !== game.me) ?? null;
}

/** Look in the open game's mailbox, and open their file if it's there. */
export async function checkMailbox(): Promise<boolean> {
  const g = useMail.getState().game;
  if (!g || useMail.getState().doubt) return false;
  const file = await nextFromMailbox(g);
  // The game may have changed hands while we looked.
  if (!file || useMail.getState().game?.id !== g.id || useMail.getState().game?.segment) return false;
  await receiveFile(JSON.stringify(file));
  return true;
}

/** Mail games on this device whose opponent's file is waiting in their mailbox. */
export async function arrivals(): Promise<Record<string, MailFile>> {
  const out: Record<string, MailFile> = {};
  await Promise.all(
    mailGames().map(async ({ id }) => {
      const g = loadGame(id);
      const file = g && (await nextFromMailbox(g));
      if (file) out[id] = file;
    }),
  );
  return out;
}

/** Join a game from an invite link: its invitation is the mailbox's first file. */
export async function joinFromMailbox(box: Box, name?: string): Promise<boolean> {
  const files = await fetchFiles(box, 0);
  if (!files) {
    useMail.setState({
      error: t("The game's mailbox can't be reached. Ask for the invitation file instead."),
    });
    return false;
  }
  const invitation = files.find((f) => f.index === 1);
  if (!invitation) {
    useMail.setState({ error: t("That game's mailbox is empty: the invitation may have expired.") });
    return false;
  }
  await receiveFile(JSON.stringify(invitation), { name });
  // A game already on this device picks up where it is.
  const g = useMail.getState().game;
  if (g?.id === invitation.game) await checkMailbox();
  return useMail.getState().game?.id === invitation.game;
}

/** Note that this device will be told of their files. */
export function setPush(on: boolean): void {
  update({ push: on });
}

/** Open a file from the opponent: a new game from an invitation, or their next stretch of ours. */
export async function receiveFile(
  text: string,
  opts: { anyway?: boolean; name?: string } = {},
): Promise<void> {
  const file = parseFile(text);
  if (typeof file === "string") return void useMail.setState({ error: file });
  useMail.setState({ error: null });
  if (file.index === 1) return joinFromInvitation(file, opts.name);

  const g = useMail.getState().game?.id === file.game ? useMail.getState().game : loadGame(file.game);
  if (!g)
    return void useMail.setState({ error: t("That file is for a mail game this device doesn't have.") });
  if (file.from === g.me)
    return void useMail.setState({ error: t("That's your own file: send it to your opponent.") });
  if (g.segment)
    return void useMail.setState({
      error: t("It's your move in this game: you haven't sent your file yet."),
    });
  if (file.index !== (g.sent?.index ?? 0) + 1)
    return void useMail.setState({
      error:
        file.index <= (g.sent?.index ?? 0)
          ? t("You've already had that file.")
          : t("A file is missing in between: ask them to send the one after yours."),
    });

  const problems: string[] = [];
  if (!(await signatureOk(file)))
    problems.push(
      file.name
        ? t("This file was changed after {name} made it.", { name: file.name })
        : t("This file was changed after they made it."),
    );
  if (g.theirKey && keyId(g.theirKey) !== keyId(file.key))
    problems.push(
      file.name
        ? t("It was made on a different device from {name} earlier files: someone else may have sent it.", {
            name: file.name,
          })
        : t("It was made on a different device from their earlier files: someone else may have sent it."),
    );
  // Play can't be stitched onto a different game: that's not a doubt, it's the wrong file.
  if (file.base.seq !== lastSeq(g.record) || file.base.hash !== baseOf(g.record).hash)
    return void useMail.setState({
      error: t(
        "That file doesn't start where your last file ended: it belongs to another copy of this game.",
      ),
    });
  if (g.theirCommit && file.reveal !== null && (await commitTo(file.reveal)) !== g.theirCommit)
    problems.push(
      t("Its dice aren't the ones promised in their last file, so the rolls could have been picked."),
    );
  if (g.theirCommit && file.reveal === null)
    problems.push(
      t("It leaves out the dice promised in their last file, so the rolls could have been picked."),
    );
  const mine = g.sent?.commit ?? null;
  if (file.theirs !== mine)
    problems.push(t("Its dice weren't mixed with yours, so the rolls could have been picked."));
  if (!problems.length) {
    const verdict = await replaySegment(g.record, file, await segmentRng(diceKey(g.id, file)));
    if (!verdict.ok) problems.push(verdict.why);
  }
  if (problems.length && !opts.anyway) {
    useMail.setState({ doubt: { file, problems } });
    if (useMail.getState().game?.id !== g.id) await open(g);
    return;
  }

  const record: GameRecord = { ...g.record, events: [...g.record.events, ...file.events] };
  await open({
    ...g,
    names: { ...g.names, [file.from]: file.name },
    record,
    segment: startSegment(record, file.index + 1, g.committed, file.commit),
    theirKey: g.theirKey ?? file.key,
    theirCommit: file.commit,
    at: Date.now(),
  });
}

async function joinFromInvitation(file: MailFile, typed?: string): Promise<void> {
  if (!file.record)
    return void useMail.setState({ error: t("That invitation is damaged (it has no game in it).") });
  const existing = loadGame(file.game);
  if (existing) {
    if (existing.me === file.from)
      return void useMail.setState({ error: t("That's your own invitation: send it to your opponent.") });
    return resumeMailGame(file.game);
  }
  if (!(await signatureOk(file)))
    return void useMail.setState({ error: t("That invitation's signature doesn't match its contents.") });
  const record = await unbundleReplay(file.record);
  // We take the side the invitation left: whoever isn't its sender.
  const me = ["p1", "p2"].find((p) => p !== file.from) ?? "p2";
  const seat = file.from === "p1" ? 1 : 0;
  await open({
    id: file.game,
    me,
    seat,
    names: { [file.from]: file.name, [me]: "" },
    record,
    segment: startSegment(record, 2, null, file.commit),
    sent: null,
    committed: null,
    theirKey: file.key,
    theirCommit: file.commit,
    at: Date.now(),
    box: file.box ?? null,
  });
  // The name typed in the lobby, else the last one used; with neither, they type it on the strip.
  let name = typed?.trim() ?? "";
  try {
    name ||= localStorage.getItem("open-battle:name") ?? "";
  } catch {
    // No storage.
  }
  if (name) setMailName(name);
}

/** Open the doubted file after all (rules enforcement is advisory: the players decide). */
export async function acceptAnyway(): Promise<void> {
  const d = useMail.getState().doubt;
  useMail.setState({ doubt: null });
  if (d) await receiveFile(JSON.stringify(d.file), { anyway: true });
}

export function rejectDoubt(): void {
  useMail.setState({ doubt: null });
}

/** Set our name on our files. */
export function setMailName(name: string): void {
  const g = useMail.getState().game;
  if (!g) return;
  update({ names: { ...g.names, [g.me]: name } });
  // On the table too, when it's our move to make (it goes in our next file).
  if (g.segment) useStore.getState().dispatch({ type: "player/rename", player: g.me, name });
}
