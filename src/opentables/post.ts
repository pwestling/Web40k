import { systemTitle } from "../ui/systemLabels";
import { isPlayerKey, type PlayerKey } from "../core/ranked";
import { readInviteHash } from "../mail/mailbox";

/**
 * Open tables (#50): a public board of games looking for players. A post
 * says what the table is and how to join it; nothing else about the player
 * (no account, only the name they typed). Posts come from strangers, so
 * everything read off the board goes through `readPost` first.
 */

export type TableKind = "live" | "mail";

/** The kinds of game a host can say theirs is: badges on the card, and a filter. */
export const TABLE_TAGS = ["new", "relaxed", "competitive", "narrative"] as const;
export type TableTag = (typeof TABLE_TAGS)[number];

export interface TablePost {
  /** Random, chosen by the poster; one post per table. */
  id: string;
  /** The poster's display name. */
  name: string;
  /** The game system's id, and its name as the poster's app shows it. */
  system: string;
  game: string;
  /** Points or game size, as the poster put it ("1000 pts", "Incursion"). */
  size: string;
  /** When the game starts (epoch ms), or null for now. */
  start: number | null;
  /** The language spoken at the table (a language code). */
  lang: string;
  kind: TableKind;
  voice: boolean;
  /** Seats still open. */
  seats: number;
  note: string;
  /** What kind of game it is, from a fixed list, to filter on (PX). */
  tags?: TableTag[];
  /** A live game's room code, or a mail game's invite code. */
  join: string;
  /** Watchers welcome: once the seats fill it stays up under Live now (#64). */
  watch?: boolean;
  /** A game under way that can be watched: its round, score and how many watch (#64). */
  live?: LiveInfo;
  /** A ranked game (#65): both players sign the result, and it counts on the ladder. */
  ranked?: boolean;
  /** The poster's player key and its signature on `postProof(id)`, so their rating can show. */
  player?: PlayerKey;
  proof?: string;
  /** An online event's game (#67): its top tables show on Live now as such. */
  event?: { id: string; name: string; round: number; table: number };
  /** When the post goes away on its own (epoch ms). */
  expires: number;
}

/** A game in progress on the board's Live now (#64). */
export interface LiveInfo {
  round: number;
  /** The game's last round, or 0 when it has none. */
  rounds: number;
  /** "12–9", as the host's scoreboard has it. */
  score: string;
  watching: number;
  /** Who plays, a line per side: "Ana", "Ben & Cy" (UX 444). */
  sides?: string[];
  /** When the battle began (epoch ms), for "started 3 min ago". */
  since?: number;
  /** The computer plays both sides (the exhibition table). */
  computer?: boolean;
  /** A ranked game's player keys, by side, so watchers see the ratings (#65). */
  keys?: PlayerKey[];
}

/** What a poster signs with their player key, so nobody else can show their rating on a post. */
export const postProof = (id: string) => `open-battle-post:${id}`;

/** A post as read off the board. */
export interface SeenPost extends TablePost {
  /** Who posted it: a key per browser, not an account. */
  key: string;
  /** When this copy was published (epoch ms); a live table republishes while its host is there. */
  at: number;
}

/**
 * A live table's host republishes this often; a post not refreshed for
 * ALIVE_MS has gone. Short, so a closed page's table leaves the board within
 * minutes even when its last word never arrived (PX: ghost tables).
 */
export const HEARTBEAT_MS = 30_000;
export const ALIVE_MS = 3 * 60_000;
/** A game on Live now whose host stopped refreshing it this long ago has gone (UX 441). */
const LIVE_ALIVE_MS = 90_000;
/** The longest a post stays up. */
export const LIVE_HOURS = [1, 2, 3, 4] as const;
export const MAIL_TTL_MS = 2 * 24 * 3600_000;
const MAX_LIVE_MS = 4 * 3600_000 + 60_000;

export const LIMITS = { name: 32, game: 64, size: 40, note: 140, score: 40 };

const ROOM = /^[A-Za-z0-9_-]{4,64}$/;
const MAIL = /^[A-Za-z0-9_-]{10,800}$/;

/** Control characters and the ones that flip text direction (a name could disguise itself). */
// eslint-disable-next-line no-control-regex
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]", "g");

/** Text from a stranger: a plain line, no control characters, cut to length. */
function line(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  return v.replace(UNSAFE, " ").trim().slice(0, max);
}

/**
 * The game's name on a post: a poster whose rules package hadn't loaded yet
 * sent its stand-in name ("rift-lanterns (its rules package isn't loaded)"; PX
 * ranked 6), so that reads as the game's own title where this app knows it.
 */
function gameOf(game: string | null, system: string | null): string | null {
  if (!game || !system) return game;
  const bare = game.replace(/\s*\(its rules package isn't loaded\)\s*$/, "");
  if (bare !== system) return bare;
  const title = systemTitle(system);
  return title && !/rules package isn't loaded/.test(title) ? title : bare;
}

/** A post read off the board, checked; null when it isn't one or is past its time. */
export function readPost(raw: unknown, now = Date.now()): TablePost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && /^[a-f0-9]{8,32}$/.test(r.id) ? r.id : null;
  const name = line(r.name, LIMITS.name);
  const system = typeof r.system === "string" && /^[\w.:@/-]{1,64}$/.test(r.system) ? r.system : null;
  const game = gameOf(line(r.game, LIMITS.game), system);
  const kind = r.kind === "live" || r.kind === "mail" ? r.kind : null;
  const join = typeof r.join === "string" ? r.join : "";
  if (!id || !name || !system || !game || !kind) return null;
  if (kind === "live" ? !ROOM.test(join) : !MAIL.test(join) || !readInviteHash(`#mail=${join}`)) return null;
  const expires = typeof r.expires === "number" && Number.isFinite(r.expires) ? r.expires : 0;
  if (expires <= now || expires > now + (kind === "live" ? MAX_LIVE_MS : MAIL_TTL_MS + 60_000)) return null;
  const seats = typeof r.seats === "number" && Number.isInteger(r.seats) ? r.seats : 0;
  const watch = kind === "live" && r.watch === true;
  const live = watch ? readLive(r.live) : null;
  // A full table is on the board only as a game to watch (#64).
  if (seats < (live ? 0 : 1) || seats > 7) return null;
  const start = typeof r.start === "number" && Number.isFinite(r.start) ? r.start : null;
  const lang = typeof r.lang === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(r.lang) ? r.lang : "und";
  return {
    id,
    name,
    system,
    game,
    size: line(r.size, LIMITS.size) ?? "",
    start,
    lang,
    kind,
    voice: r.voice === true,
    seats,
    note: line(r.note, LIMITS.note) ?? "",
    ...(Array.isArray(r.tags)
      ? { tags: TABLE_TAGS.filter((tag) => (r.tags as unknown[]).includes(tag)) }
      : {}),
    join,
    expires,
    ...(watch ? { watch } : {}),
    ...(live ? { live } : {}),
    ...(kind === "live" && r.ranked === true ? { ranked: true } : {}),
    ...(isPlayerKey(r.player) && typeof r.proof === "string" && /^[A-Za-z0-9+/=]{40,200}$/.test(r.proof)
      ? { player: r.player, proof: r.proof }
      : {}),
    ...(live && readEvent(r.event) ? { event: readEvent(r.event)! } : {}),
  };
}

/** A post's event line (#67), checked like the rest. */
function readEvent(v: unknown): TablePost["event"] | null {
  const e = v as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return null;
  const id = typeof e.id === "string" && /^[a-z0-9]{8,40}$/.test(e.id) ? e.id : null;
  const name = line(e.name, 60);
  const ok = (x: unknown, max: number) => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= max;
  return id && name && ok(e.round, 20) && ok(e.table, 500)
    ? { id, name, round: e.round as number, table: e.table as number }
    : null;
}

/** A post's game-in-progress line, checked like the rest. */
function readLive(v: unknown): LiveInfo | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const int = (x: unknown, max: number) =>
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max ? x : null;
  const round = int(r.round, 99);
  const rounds = int(r.rounds, 99);
  const watching = int(r.watching, 9999);
  const score = line(r.score, LIMITS.score);
  if (round === null || rounds === null || watching === null || score === null) return null;
  const sides = Array.isArray(r.sides)
    ? r.sides
        .slice(0, 4)
        .map((x) => line(x, LIMITS.name * 2))
        .filter((x): x is string => !!x)
    : [];
  const since =
    typeof r.since === "number" && Number.isFinite(r.since) && r.since > 0 && r.since <= Date.now() + 60_000
      ? r.since
      : null;
  return {
    round,
    rounds,
    score,
    watching,
    ...(sides.length >= 2 ? { sides } : {}),
    ...(since !== null ? { since } : {}),
    ...(r.computer === true ? { computer: true } : {}),
    ...(Array.isArray(r.keys) && r.keys.length === 2 && r.keys.every(isPlayerKey)
      ? { keys: r.keys as PlayerKey[] }
      : {}),
  };
}

/** A post that is a game to watch, not seats to fill. */
export const isLiveGame = (p: TablePost): boolean => !!p.live && p.seats === 0;

/** Whether a post read earlier is still up. */
export function isUp(p: SeenPost, now = Date.now()): boolean {
  return p.expires > now && (p.kind === "mail" || now - p.at < (isLiveGame(p) ? LIVE_ALIVE_MS : ALIVE_MS));
}

/** The badges a post shows: the ones its host ticked, and the same ones said in its note. */
export function tagsOf(p: TablePost): TableTag[] {
  const said: Record<TableTag, RegExp> = {
    new: /\bnew (players?|to the game)\b|\bbeginners?\b|\bnewbies?\b/i,
    relaxed: /\b(relaxed|casual|chill|friendly)\b/i,
    competitive: /\b(competitive|tournament|practice|tight)\b/i,
    narrative: /\b(narrative|story|campaign)\b/i,
  };
  return TABLE_TAGS.filter((tag) => p.tags?.includes(tag) || said[tag].test(p.note));
}

export function newPostId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
