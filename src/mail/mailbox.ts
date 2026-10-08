import { netConfig } from "../net/config";
import { newSeed } from "./dice";
import { parseFile, type MailFile } from "./file";

/**
 * A game's mailbox on a self-hosted server (server/mailbox.mjs): turns are
 * posted there as the same signed files, and the other player's app picks
 * them up. The id is a long random string only the two players have (it
 * travels in the signed invitation); the files are the fallback whenever the
 * mailbox can't be reached.
 */
export interface Box {
  url: string;
  id: string;
}

/** A new mailbox for a game, when this site has a mailbox server. */
export function newBox(): Box | null {
  const url = netConfig().mailbox;
  return url ? { url: url.replace(/\/+$/, ""), id: newSeed().slice(0, 32) } : null;
}

const boxUrl = (box: Box, rest = "") => `${box.url}/box/${encodeURIComponent(box.id)}${rest}`;

/** Post a file; true when the mailbox has it. */
export async function postFile(box: Box, file: MailFile): Promise<boolean> {
  try {
    const res = await fetch(boxUrl(box), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(file),
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The files after number `after`, oldest first; null when the mailbox can't be reached. */
export async function fetchFiles(box: Box, after: number): Promise<MailFile[] | null> {
  try {
    const res = await fetch(boxUrl(box, `?after=${after}`), {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { files?: unknown[] };
    return (body.files ?? [])
      .map((f) => parseFile(JSON.stringify(f)))
      .filter((f): f is MailFile => typeof f !== "string");
  } catch {
    return null;
  }
}

/** A link that joins the game from its mailbox: the box rides in the hash, so no server sees it in a log. */
export function inviteLink(box: Box): string {
  const code = btoa(JSON.stringify(box)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}${location.pathname}#mail=${code}`;
}

export function readInviteHash(hash = typeof location === "undefined" ? "" : location.hash): Box | null {
  const m = /^#mail=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const box = JSON.parse(atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as Partial<Box>;
    return typeof box.url === "string" && /^https?:\/\//.test(box.url) && typeof box.id === "string"
      ? { url: box.url, id: box.id }
      : null;
  } catch {
    return null;
  }
}

/** The mailbox's web push key, when its host set one up. */
export async function pushKey(box: Box): Promise<string | null> {
  try {
    const res = await fetch(`${box.url}/vapid`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return ((await res.json()) as { publicKey?: string | null }).publicKey ?? null;
  } catch {
    return null;
  }
}

export const pushSupported = () =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

/**
 * Ask to be told when the other player's file arrives. The push carries
 * nothing: it wakes mail-sw.js, which says "Your move", and the app fetches
 * the file from the mailbox. Returns why it didn't work, or null.
 */
export async function subscribePush(box: Box, player: string): Promise<string | null> {
  if (!pushSupported()) return "This browser can't take notifications from a web page.";
  const key = await pushKey(box);
  if (!key) return "This mailbox doesn't send notifications.";
  if ((await Notification.requestPermission()) !== "granted")
    return "Notifications are blocked for this site.";
  try {
    const reg = await navigator.serviceWorker.register("./mail-sw.js");
    await navigator.serviceWorker.ready;
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw }));
    const res = await fetch(boxUrl(box, "/push"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player, subscription: sub.toJSON() }),
    });
    return res.ok ? null : "The mailbox didn't take the subscription.";
  } catch {
    return "Notifications couldn't be set up in this browser.";
  }
}
