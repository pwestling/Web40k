import { schnorr } from "@noble/secp256k1";
import { ALIVE_MS, readPost, type SeenPost, type TablePost } from "./post";
import type { BoardBackend, BoardStatus } from "./board";

/**
 * The board on Nostr relays, the same public relays players already meet
 * through. A post is a signed, replaceable app-data event (kind 30078) tagged
 * for Open Battle, with a NIP-40 expiration so relays drop it on their own.
 * Taking a post down replaces it with an empty one and asks relays to delete
 * it (NIP-09). Reports are NIP-56 events; three from different keys hide a
 * post for everyone.
 */

const KIND = 30078;
const TAG = "open-battle-table";
const D = "open-battle/table/";
/** Reports from this many keys hide a post. */
export const REPORTS_TO_HIDE = 3;
const RETRY_MS = [5_000, 15_000, 60_000];

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const seconds = (ms: number) => Math.floor(ms / 1000);

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

const serial = (e: Omit<NostrEvent, "id" | "sig">) =>
  JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);

export async function signEvent(
  secret: Uint8Array,
  kind: number,
  tags: string[][],
  content: string,
  created_at = seconds(Date.now()),
): Promise<NostrEvent> {
  const body = { pubkey: hex(schnorr.getPublicKey(secret)), created_at, kind, tags, content };
  const id = await sha256(serial(body));
  return { ...body, id: hex(id), sig: hex(await schnorr.signAsync(id, secret)) };
}

/** Relays check signatures, but a relay could lie: check them again. */
export async function verifyEvent(e: NostrEvent): Promise<boolean> {
  try {
    if (!/^[a-f0-9]{64}$/.test(e.pubkey) || !/^[a-f0-9]{128}$/.test(e.sig)) return false;
    const id = await sha256(serial(e));
    return hex(id) === e.id && (await schnorr.verifyAsync(unhex(e.sig), id, unhex(e.pubkey)));
  } catch {
    return false;
  }
}

/** This browser's board key, kept so it can take its own posts down after a reload. */
function boardSecret(store: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): Uint8Array {
  const kept = store?.getItem("open-battle:table-key");
  if (kept && /^[a-f0-9]{64}$/.test(kept)) return unhex(kept);
  const { secretKey } = schnorr.keygen();
  store?.setItem("open-battle:table-key", hex(secretKey));
  return secretKey;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

type Socket = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

interface NostrOptions {
  relays: string[];
  secret?: Uint8Array;
  socket?: (url: string) => Socket;
}

export function nostrBoard(options: NostrOptions): BoardBackend {
  const relays = options.relays;
  const secret = options.secret ?? boardSecret();
  const me = hex(schnorr.getPublicKey(secret));
  const open = options.socket ?? ((url: string) => new WebSocket(url) as unknown as Socket);

  /** Send one event to every relay; resolves once one of them takes it. */
  const send = (event: NostrEvent) =>
    new Promise<void>((resolve, reject) => {
      let left = relays.length;
      let done = false;
      const sockets: Socket[] = [];
      const finish = (ok: boolean) => {
        if (done) return;
        if (!ok && --left > 0) return;
        done = true;
        clearTimeout(timer);
        // The rest get a moment to take it too.
        setTimeout(() => sockets.forEach((s) => s.close()), ok ? 1500 : 0);
        if (ok) resolve();
        else reject(new Error("no relay took the post"));
      };
      const timer = setTimeout(() => ((left = 1), finish(false)), 8000);
      if (!relays.length) return finish(false);
      for (const url of relays) {
        let s: Socket;
        try {
          s = open(url);
        } catch {
          finish(false);
          continue;
        }
        sockets.push(s);
        let answered = false;
        s.onopen = () => s.send(JSON.stringify(["EVENT", event]));
        s.onmessage = (m) => {
          const msg = parse(m.data);
          if (msg?.[0] !== "OK" || msg[1] !== event.id || answered) return;
          answered = true;
          finish(msg[2] === true);
        };
        s.onerror = s.onclose = () => {
          if (answered) return;
          answered = true;
          finish(false);
        };
      }
    });

  const address = (key: string, id: string) => `${KIND}:${key}:${D}${id}`;
  const expiry = (post: TablePost) =>
    seconds(post.kind === "live" ? Math.min(post.expires, Date.now() + ALIVE_MS) : post.expires);

  // Each change of a post is newer than the last, even within a second, so relays and readers keep it.
  let last = 0;
  const stamp = () => (last = Math.max(seconds(Date.now()), last + 1));

  return {
    key: me,
    async publish(post) {
      const tags = [
        ["d", D + post.id],
        ["t", TAG],
        ["expiration", String(expiry(post))],
        ["alt", "An Open Battle table looking for players"],
      ];
      await send(await signEvent(secret, KIND, tags, JSON.stringify(post), stamp()));
    },
    async withdraw(post) {
      const gone = signEvent(
        secret,
        KIND,
        [
          ["d", D + post.id],
          ["t", TAG],
          ["expiration", String(seconds(Date.now() + 10 * 60_000))],
        ],
        JSON.stringify({ gone: true }),
        stamp(),
      );
      const del = signEvent(secret, 5, [["a", address(me, post.id)]], "");
      await Promise.allSettled([send(await gone), send(await del)]);
    },
    async report(post, why) {
      const tags = [
        ["a", address(post.key, post.id), why],
        ["p", post.key, why],
        ["t", TAG],
      ];
      await send(await signEvent(secret, 1984, tags, ""));
    },
    watch(onPosts, onStatus) {
      const posts = new Map<string, SeenPost>();
      const reports = new Map<string, Set<string>>();
      const status: BoardStatus = { reached: 0, of: relays.length, loaded: false };
      const sockets = new Map<string, Socket>();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let stopped = false;
      let queued = false;
      const emit = () => {
        if (queued || stopped) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (stopped) return;
          onPosts(
            [...posts.values()].filter(
              (p) => (reports.get(address(p.key, p.id))?.size ?? 0) < REPORTS_TO_HIDE || p.key === me,
            ),
          );
          onStatus({ ...status });
        });
      };
      const take = async (e: NostrEvent) => {
        if (!e || typeof e !== "object" || !(await verifyEvent(e))) return;
        if (e.kind === 1984) {
          const a = e.tags.find((x) => x[0] === "a")?.[1];
          if (!a) return;
          const set = reports.get(a) ?? new Set();
          set.add(e.pubkey);
          reports.set(a, set);
          return emit();
        }
        if (e.kind !== KIND) return;
        const d = e.tags.find((x) => x[0] === "d")?.[1] ?? "";
        if (!d.startsWith(D)) return;
        const id = d.slice(D.length);
        const k = `${e.pubkey}:${id}`;
        const at = e.created_at * 1000;
        const was = posts.get(k);
        if (was && was.at >= at) return;
        const post = readPost(json(e.content));
        if (!post || post.id !== id) {
          // Taken down (or no longer readable): gone.
          if (was) posts.delete(k);
          return emit();
        }
        posts.set(k, { ...post, key: e.pubkey, at });
        emit();
      };
      const since = seconds(Date.now()) - 3 * 24 * 3600;
      const connect = (url: string, tries = 0): void => {
        if (stopped) return;
        let s: Socket;
        try {
          s = open(url);
        } catch {
          return;
        }
        sockets.set(url, s);
        let wasOpen = false;
        s.onopen = () => {
          wasOpen = true;
          status.reached++;
          emit();
          s.send(
            JSON.stringify([
              "REQ",
              "tables",
              { kinds: [KIND], "#t": [TAG], since, limit: 300 },
              { kinds: [1984], "#t": [TAG], since, limit: 500 },
            ]),
          );
        };
        s.onmessage = (m) => {
          const msg = parse(m.data);
          if (msg?.[0] === "EVENT" && msg[1] === "tables") void take(msg[2] as NostrEvent);
          else if (msg?.[0] === "EOSE" && !status.loaded) {
            status.loaded = true;
            emit();
          }
        };
        let closed = false;
        s.onerror = s.onclose = () => {
          if (closed) return;
          closed = true;
          if (wasOpen) status.reached--;
          if (sockets.get(url) === s) sockets.delete(url);
          s.close();
          emit();
          if (stopped) return;
          const timer = setTimeout(
            () => {
              timers.delete(timer);
              connect(url, wasOpen ? 0 : tries + 1);
            },
            RETRY_MS[Math.min(tries, RETRY_MS.length - 1)],
          );
          timers.add(timer);
        };
      };
      relays.forEach((u) => connect(u));
      // Posts run out while the board is open: look again every minute.
      const tick = setInterval(emit, 60_000);
      emit();
      return () => {
        stopped = true;
        clearInterval(tick);
        timers.forEach(clearTimeout);
        for (const s of sockets.values()) {
          s.onclose = s.onerror = null;
          s.close();
        }
      };
    },
  };
}

function json(text: unknown): unknown {
  try {
    return JSON.parse(String(text)) as unknown;
  } catch {
    return null;
  }
}

function parse(data: unknown): unknown[] | null {
  const v = json(data);
  return Array.isArray(v) ? v : null;
}
