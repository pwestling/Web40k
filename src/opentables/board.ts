import { create } from "zustand";
import { netConfig } from "../net/config";
import { useStore } from "../store";
import type { DeclinedResult, SignedResult } from "../ranked/verify";
import { HEARTBEAT_MS, isUp, type SeenPost, type TablePost } from "./post";

/**
 * Open tables (#50): which board this site uses, this browser's own post,
 * and what this browser has hidden or blocked. Nothing is ever posted except
 * by `postTable`, which only a player's own click calls.
 */

export interface BoardStatus {
  /** Relays (or the site's board) reached, of how many. */
  reached: number;
  of: number;
  /** The first answer has come back. */
  loaded: boolean;
}

export interface BoardBackend {
  /** This browser's key on the board. */
  key: string;
  publish(post: TablePost): Promise<void>;
  withdraw(post: TablePost): Promise<void>;
  report(post: SeenPost, why: string): Promise<void>;
  /** Read the board until the returned function is called. */
  watch(onPosts: (posts: SeenPost[]) => void, onStatus: (status: BoardStatus) => void): () => void;
  /** The page is closing: a last word that doesn't wait for an answer. */
  leaving?(post: TablePost): void;
  /** Ranked results (#65): pass one on, signed by both players. */
  publishResult(result: SignedResult | DeclinedResult): Promise<void>;
  /** Read results (unchecked: src/ranked checks each) until the returned function is called. */
  watchResults(onResults: (raw: unknown[]) => void): () => void;
}

/** Whether this site has Open tables at all. */
export const boardOn = () => netConfig().openTables;

let backend: Promise<BoardBackend | null> | null = null;

export function board(): Promise<BoardBackend | null> {
  return (backend ??= (async () => {
    const config = netConfig();
    if (!config.openTables) return null;
    if (config.board) {
      const { httpBoard } = await import("./http");
      return httpBoard(config.board, browserKey(), (id) => tokenFor(id));
    }
    const [{ nostrBoard }, { defaultRelayUrls }] = await Promise.all([
      import("./nostr"),
      import("@trystero-p2p/nostr"),
    ]);
    return nostrBoard({ relays: (config.nostr.length ? config.nostr : defaultRelayUrls).slice(0, 6) });
  })());
}

const random = (n: number) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private window: it lasts until the page closes.
  }
}

/** A key per browser for a self-hosted board, so blocking someone hides all their posts. */
function browserKey(): string {
  const k = load<string>("open-battle:board-browser", "");
  if (/^[a-f0-9]{32}$/.test(k)) return k;
  const made = random(16);
  save("open-battle:board-browser", made);
  return made;
}

/** Tokens of posts this page put up, kept after `mine` clears so a take-down still proves it (UX 380). */
const tokens = new Map<string, string>();

/** The token that lets this browser change its post on a self-hosted board. */
function tokenFor(id: string): string {
  const mine = useOpenTables.getState().mine;
  return mine?.post.id === id ? mine.token : (tokens.get(id) ?? random(16));
}

interface MyTable {
  post: TablePost;
  token: string;
  /** Up, being put up, or not taken by the board. */
  state: "posting" | "up" | "failed";
  /** Why the board didn't take it: too many tables from this network. */
  why?: "busy";
}

interface OpenTablesState {
  mine: MyTable | null;
  /** Posts hidden here, as "key:id". */
  hidden: string[];
  /** Names and keys blocked here: their posts don't show. */
  blockedNames: string[];
  blockedKeys: string[];
  reported: string[];
  /** The board's "Host a table and post it": the post form opens with the room. */
  asked: boolean;
  /** The room this browser's table was listed for: whoever sits down there came from Open tables. */
  listed: string | null;
  /** The table this browser joined from the board, to come back if its host has gone. */
  joined: SeenPost | null;
  /** A table joined from the board had gone, or a game watched from Live now ended: the board says so. */
  gone: false | "table" | "game";
  /** The room of a watched game whose host left (UX 441): its card stays off this board. */
  ended: string | null;
}

export const useOpenTables = create<OpenTablesState>(() => ({
  mine: load<MyTable | null>("open-battle:my-table", null),
  hidden: load<string[]>("open-battle:tables-hidden", []),
  blockedNames: load<string[]>("open-battle:tables-blocked-names", []),
  blockedKeys: load<string[]>("open-battle:tables-blocked-keys", []),
  reported: load<string[]>("open-battle:tables-reported", []),
  asked: false,
  listed: null,
  joined: null,
  gone: false,
  ended: null,
}));

useOpenTables.subscribe((s, prev) => {
  if (s.mine !== prev.mine) save("open-battle:my-table", s.mine);
  if (s.hidden !== prev.hidden) save("open-battle:tables-hidden", s.hidden.slice(-500));
  if (s.blockedNames !== prev.blockedNames) save("open-battle:tables-blocked-names", s.blockedNames);
  if (s.blockedKeys !== prev.blockedKeys) save("open-battle:tables-blocked-keys", s.blockedKeys);
  if (s.reported !== prev.reported) save("open-battle:tables-reported", s.reported.slice(-500));
});

const postKey = (p: SeenPost) => `${p.key}:${p.id}`;

/** The posts this browser shows: none hidden, blocked or reported here, none run out. */
export function shownPosts(posts: SeenPost[], s = useOpenTables.getState(), now = Date.now()): SeenPost[] {
  const names = new Set(s.blockedNames.map((n) => n.toLowerCase()));
  const off = new Set([...s.hidden, ...s.reported]);
  return posts.filter(
    (p) =>
      // A live table its host stopped refreshing has gone, whatever the relay still holds (PX: ghost tables).
      isUp(p, now) &&
      p.join !== s.ended &&
      !off.has(postKey(p)) &&
      !s.blockedKeys.includes(p.key) &&
      !names.has(p.name.toLowerCase()),
  );
}

export function hidePost(p: SeenPost): void {
  useOpenTables.setState((s) => ({ hidden: [...s.hidden, postKey(p)] }));
}

/** Block whoever posted this: by their key, as names repeat ("Player 1"; UX 382). */
export function blockPoster(p: SeenPost): void {
  useOpenTables.setState((s) => ({ blockedKeys: [...new Set([...s.blockedKeys, p.key])] }));
}

/** The host of a table joined from the board never answered: hide it, and say so on the board. */
export function tableGone(): void {
  const p = useOpenTables.getState().joined;
  if (!p) return;
  hidePost(p);
  useOpenTables.setState({ joined: null, gone: "table" });
}

export function unblockAll(): void {
  useOpenTables.setState({ blockedNames: [], blockedKeys: [], hidden: [] });
}

export async function reportPost(p: SeenPost, why: string): Promise<void> {
  useOpenTables.setState((s) => ({ reported: [...s.reported, postKey(p)] }));
  await (await board())?.report(p, why).catch(() => {});
}

let heartbeat: ReturnType<typeof setInterval> | null = null;

function beat(post: TablePost): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  // A live table stays up while its host is here; without them it runs out (ALIVE_MS).
  if (post.kind === "live")
    heartbeat = setInterval(() => {
      const mine = useOpenTables.getState().mine;
      // Run out, or the host has left its room (back to the lobby): down it comes.
      const away = useStore.getState().roomId !== post.join;
      if (mine?.post.id !== post.id || mine.post.expires <= Date.now() || away) return void takeDown();
      void board().then((b) => b?.publish(mine.post).catch(() => {}));
    }, HEARTBEAT_MS);
}

/** Put a table on the board: only ever called from the player's own click. */
export async function postTable(post: TablePost): Promise<boolean> {
  const b = await board();
  if (!b) return false;
  const token = random(16);
  tokens.set(post.id, token);
  useOpenTables.setState({ mine: { post, token, state: "posting" }, listed: post.join });
  try {
    await b.publish(post);
    if (useOpenTables.getState().mine?.post.id !== post.id) return false;
    useOpenTables.setState({ mine: { post, token, state: "up" } });
    beat(post);
    return true;
  } catch (e) {
    const busy = (e as { status?: number }).status === 429;
    if (useOpenTables.getState().mine?.post.id === post.id)
      useOpenTables.setState({ mine: { post, token, state: "failed", ...(busy ? { why: "busy" } : {}) } });
    return false;
  }
}

/** Change this browser's post (seats taken), keeping it up. */
export async function updateTable(change: Partial<TablePost>): Promise<void> {
  const mine = useOpenTables.getState().mine;
  if (!mine || mine.state !== "up") return;
  const post = { ...mine.post, ...change };
  useOpenTables.setState({ mine: { ...mine, post } });
  await (await board())?.publish(post).catch(() => {});
}

/** Take this browser's post down: its seats are taken, the game was left, or the player said so. */
export async function takeDown(): Promise<void> {
  const mine = useOpenTables.getState().mine;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (!mine) return;
  useOpenTables.setState({ mine: null });
  if (mine.state === "failed") return;
  await (await board())?.withdraw(mine.post).catch(() => {});
}

/**
 * Back on a live table after a reload: the post (taken down as the page
 * closed) goes back up, as the player left it.
 */
export async function resumeTable(): Promise<void> {
  const mine = useOpenTables.getState().mine;
  if (!mine || mine.state !== "up" || heartbeat) return;
  if (mine.post.expires <= Date.now()) return void useOpenTables.setState({ mine: null });
  const b = await board();
  await b?.publish(mine.post).catch(() => {});
  beat(mine.post);
}

/** The page is closing: a live post goes down (it would run out on its own a little later). */
export function pageClosing(): void {
  const mine = useOpenTables.getState().mine;
  if (!mine || mine.state !== "up" || mine.post.kind !== "live") return;
  void board().then((b) => {
    if (!b) return;
    if (b.leaving) b.leaving(mine.post);
    else void b.withdraw(mine.post).catch(() => {});
  });
}
