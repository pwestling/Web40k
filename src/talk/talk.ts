import { useEffect } from "react";
import { create } from "zustand";
import type { SideMessage, TalkItem } from "../net/transport";
import { useStore } from "../store";

/**
 * Table talk: pings, arrows and areas on the table, a small chat and quick
 * reactions. They go peer to peer over the side channel and are never game
 * events, so they stay out of the log, replays and the checksum; spectators
 * see them and can send them too.
 */

/** The quick reactions on offer; anything else from a peer is dropped. */
export const REACTIONS = ["👍", "🎲", "😮", "😬", "😂", "🔥", "💀", "🤝"] as const;

/** How long each kind stays up, in ms (chat stays in the list; this is its float). */
export const LIFETIME: Record<TalkItem["kind"], number> = {
  ping: 8000,
  react: 3000,
  arrow: 45000,
  area: 45000,
  chat: 15000,
};
export const MAX_CHAT = 280;

export type Said = TalkItem & { by: string; name: string; color: string; sentAt: number };

interface TalkState {
  items: Said[];
  /** Chat lines, oldest first (the last 100). */
  chat: Said[];
  /** Chat lines arrived while the chat was closed. */
  unread: number;
  open: boolean;
  tool: "ping" | "arrow" | "area" | null;
}

export const useTalk = create<TalkState>(() => ({ items: [], chat: [], unread: 0, open: false, tool: null }));

const point = (p: unknown): p is { x: number; y: number } =>
  !!p &&
  typeof p === "object" &&
  Number.isFinite((p as { x: unknown }).x) &&
  Number.isFinite((p as { y: unknown }).y) &&
  Math.abs((p as { x: number }).x) < 500 &&
  Math.abs((p as { y: number }).y) < 500;

/** A peer's item, if it is well formed; anything else is dropped. */
export function cleanItem(item: unknown): TalkItem | null {
  if (!item || typeof item !== "object") return null;
  const i = item as Record<string, unknown>;
  if (typeof i.id !== "string" || i.id.length > 40) return null;
  switch (i.kind) {
    case "ping":
      return point(i.at)
        ? { id: i.id, kind: "ping", at: i.at, ...(typeof i.unitId === "string" ? { unitId: i.unitId } : {}) }
        : null;
    case "arrow":
      return point(i.from) && point(i.to) ? { id: i.id, kind: "arrow", from: i.from, to: i.to } : null;
    case "area":
      return point(i.at) && typeof i.radius === "number" && i.radius > 0 && i.radius < 200
        ? { id: i.id, kind: "area", at: i.at, radius: i.radius }
        : null;
    case "chat": {
      const text = typeof i.text === "string" ? i.text.trim().slice(0, MAX_CHAT) : "";
      return text ? { id: i.id, kind: "chat", text } : null;
    }
    case "react":
      return typeof i.emoji === "string" && (REACTIONS as readonly string[]).includes(i.emoji)
        ? { id: i.id, kind: "react", emoji: i.emoji }
        : null;
    default:
      return null;
  }
}

function who(peer: string, claimed?: string): { name: string; color: string } {
  const p = useStore.getState().game.players[peer];
  if (p) return { name: p.name, color: p.color };
  // Each spectator keeps a name and colour of their own, from their peer id.
  const name = claimed?.trim().slice(0, 24);
  const n = hash(peer);
  return {
    name: name ? `${name} (watching)` : `Spectator ${(n % 90) + 10}`,
    color: WATCHER_COLORS[n % WATCHER_COLORS.length]!,
  };
}

const WATCHER_COLORS = ["#a78bfa", "#2dd4bf", "#f472b6", "#a3e635", "#fbbf24", "#94a3b8"];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** This peer's name from the lobby, for when it isn't seated. */
function myName(): string | undefined {
  try {
    return localStorage.getItem("open-battle:name") ?? undefined;
  } catch {
    return undefined;
  }
}

// A peer gets at most this many items per window; the rest are dropped.
const BURST = 12;
const WINDOW_MS = 4000;
const recent = new Map<string, number[]>();

/** Take an item from `by` (a peer, or this one) onto the table. */
export function hear(item: TalkItem, by: string, now = Date.now(), name?: string): void {
  const times = (recent.get(by) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= BURST) return;
  recent.set(by, [...times, now]);
  const said: Said = { ...item, by, ...who(by, name), sentAt: now };
  useTalk.setState((s) => {
    if (s.items.some((x) => x.id === item.id && x.by === by)) return s;
    const chat = item.kind === "chat" ? [...s.chat, said].slice(-100) : s.chat;
    return {
      items: [...prune(s.items, now), said],
      chat,
      unread: item.kind === "chat" && !s.open && by !== selfId() ? s.unread + 1 : s.unread,
    };
  });
}

/** Clear `by`'s arrows and areas. */
export function clearDrawings(by: string): void {
  useTalk.setState((s) => ({
    items: s.items.filter((x) => x.by !== by || (x.kind !== "arrow" && x.kind !== "area")),
  }));
}

const prune = (items: Said[], now: number) => items.filter((x) => now - x.sentAt < LIFETIME[x.kind]);

const selfId = () => useStore.getState().session?.selfId ?? "";
let counter = 0;

type Draft = TalkItem extends infer T ? (T extends TalkItem ? Omit<T, "id"> : never) : never;

/** Say something to the table: shown here and sent to every peer. */
export function say(item: Draft): void {
  const full = { ...item, id: `${Date.now().toString(36)}${(counter++).toString(36)}` } as TalkItem;
  const session = useStore.getState().session;
  const name = myName();
  hear(full, selfId(), Date.now(), name);
  session?.sendSide({ t: "talk", item: full, ...(name ? { name } : {}) });
}

/** Wipe your own drawings, here and for everyone. */
export function clearMine(): void {
  clearDrawings(selfId());
  useStore.getState().session?.sendSide({ t: "talk/clear" });
}

function receive(message: SideMessage, from: string): void {
  if (message.t === "talk/clear") clearDrawings(from);
  else if (message.t === "talk") {
    const item = cleanItem(message.item);
    if (item) hear(item, from, Date.now(), typeof message.name === "string" ? message.name : undefined);
  }
}

/** Listen for table talk while a session runs, and let old items go. */
export function useTableTalk(): void {
  const session = useStore((s) => s.session);
  useEffect(() => {
    if (!session) return;
    session.listenSide(receive, null, "talk");
    const timer = setInterval(() => {
      const now = Date.now();
      useTalk.setState((s) => {
        const items = prune(s.items, now);
        return items.length === s.items.length ? s : { items };
      });
    }, 500);
    return () => {
      session.listenSide(null, null, "talk");
      clearInterval(timer);
      useTalk.setState({ items: [], chat: [], unread: 0, tool: null });
    };
  }, [session]);
}
