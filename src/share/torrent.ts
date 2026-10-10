import { create } from "zustand";
import { netConfig } from "../net/config";
import { sha256 } from "../packages/manifest";

/**
 * Shared files as torrents between browsers (WebTorrent, over WebRTC like
 * games are). Sharing a file seeds it from this tab and hands a copy to the
 * seed nodes the site knows (server/seeder.mjs), which serve it as the
 * torrent's web seed, so the link keeps working after the sharer leaves.
 * Opening a magnet link fetches it from whoever has it, and this tab seeds it
 * on while it stays open.
 *
 * A file can be shared privately: it is encrypted (AES-GCM) before it leaves
 * the device, and the key travels only in the link's #fragment, which
 * browsers never send to a server. Seed nodes and trackers see opaque bytes.
 */

/** The start of an encrypted file: "OBX1", then the 12-byte IV, then the AES-GCM ciphertext. */
const MAGIC = [0x4f, 0x42, 0x58, 0x31];

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const isEncrypted = (bytes: Uint8Array) => MAGIC.every((b, i) => bytes[i] === b);

/** Encrypt a file with a new key; the key comes back base64url, for a link's #fragment. */
export async function encrypt(bytes: Uint8Array): Promise<{ payload: Uint8Array; key: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes as BufferSource),
  );
  const payload = new Uint8Array(MAGIC.length + iv.length + sealed.length);
  payload.set(MAGIC);
  payload.set(iv, MAGIC.length);
  payload.set(sealed, MAGIC.length + iv.length);
  return { payload, key: b64url(raw) };
}

/** Decrypt a private file with the key from its link; null if the key is wrong or the file damaged. */
export async function decrypt(payload: Uint8Array, key: string): Promise<Uint8Array | null> {
  if (!isEncrypted(payload)) return null;
  try {
    const k = await crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["decrypt"]);
    const iv = payload.slice(MAGIC.length, MAGIC.length + 12);
    const sealed = payload.subarray(MAGIC.length + 12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, sealed as BufferSource));
  } catch {
    return null;
  }
}

/** A link and the key in its #key= fragment, apart. */
export function splitKey(link: string): { link: string; key?: string } {
  const at = link.indexOf("#key=");
  if (at < 0) return { link };
  const key = link.slice(at + 5);
  return /^[A-Za-z0-9_-]{43}$/.test(key) ? { link: link.slice(0, at), key } : { link: link.slice(0, at) };
}

/** The torrent's info hash in a magnet link, which names it for pins. */
export function magnetHash(magnet: string): string | null {
  return /xt=urn:btih:([0-9a-fA-F]{40})/.exec(magnet)?.[1]?.toLowerCase() ?? null;
}

// --- WebTorrent, loaded only when a file is shared or opened by torrent ---

interface WtFile {
  name: string;
  length: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface WtTorrent {
  infoHash: string;
  magnetURI: string;
  length: number;
  numPeers: number;
  progress: number;
  files: WtFile[];
  done: boolean;
  on(event: "done" | "wire" | "download" | "metadata", cb: () => void): void;
  on(event: "error", cb: (err: Error | string) => void): void;
  destroy(): void;
}
interface WtClient {
  torrents: WtTorrent[];
  seed(
    file: File,
    opts: { announce: string[]; urlList?: string[]; name?: string },
    cb: (t: WtTorrent) => void,
  ): void;
  add(magnet: string, opts: { announce: string[] }, cb?: (t: WtTorrent) => void): WtTorrent;
  get(id: string): Promise<WtTorrent | null>;
  on(event: "error", cb: (err: Error | string) => void): void;
}

let client: Promise<WtClient> | null = null;

function wt(): Promise<WtClient> {
  client ??= (async () => {
    const { default: WebTorrent } = (await import("webtorrent/dist/webtorrent.min.js")) as {
      default: new (opts: object) => WtClient;
    };
    const turn = netConfig().turn;
    const c = new WebTorrent({
      tracker: {
        rtcConfig: {
          iceServers: [
            { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] },
            ...turn,
          ],
        },
      },
    });
    c.on("error", () => {
      // A torrent's own error reaches its caller; the client's are about trackers and carry on.
    });
    return c;
  })();
  return client;
}

/** What this tab is seeding, for the line under the share panel. */
export const useSeeding = create<{ files: number; peers: number }>(() => ({ files: 0, peers: 0 }));

function watch(torrent: WtTorrent): void {
  const tally = () =>
    void wt().then((c) =>
      useSeeding.setState({
        files: c.torrents.length,
        peers: c.torrents.reduce((n, t) => n + t.numPeers, 0),
      }),
    );
  torrent.on("wire", tally);
  tally();
}

/** A shared file: the magnet link, and the key when it's private. */
interface Shared {
  magnet: string;
  key?: string;
  /** Seed nodes that took a copy. */
  kept: number;
}

/** Hand a copy to the seed nodes; the ones that kept it are the torrent's web seeds. */
async function keep(payload: Uint8Array, seeders: string[], put = fetch): Promise<string[]> {
  const hash = await sha256(payload);
  const urls = seeders.map((s) => `${s.replace(/\/+$/, "")}/blob/${hash}`);
  const kept = await Promise.all(
    urls.map((url) =>
      put(url, { method: "PUT", body: payload as BodyInit })
        .then((r) => r.ok)
        .catch(() => false),
    ),
  );
  return urls.filter((_, i) => kept[i]);
}

/** Share a file from this tab, privately (encrypted) or not. */
export async function shareFile(
  bytes: Uint8Array,
  name: string,
  opts: { encrypt?: boolean } = {},
): Promise<Shared> {
  const { trackers, seeders } = netConfig();
  const sealed = opts.encrypt ? await encrypt(bytes) : null;
  const payload = sealed?.payload ?? bytes;
  // A private file's name would say what it is: it goes by its hash instead.
  const fileName = sealed ? `${(await sha256(payload)).slice(0, 16)}.obx` : name;
  const urlList = await keep(payload, seeders);
  const c = await wt();
  const torrent = await new Promise<WtTorrent>((done, fail) => {
    try {
      c.seed(
        new File([payload as BlobPart], fileName),
        { announce: trackers, name: fileName, ...(urlList.length ? { urlList } : {}) },
        done,
      );
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
  watch(torrent);
  return { magnet: torrent.magnetURI, ...(sealed ? { key: sealed.key } : {}), kept: urlList.length };
}

/** The seed-node copies a magnet names (ws=), each named by its SHA-256. */
function webSeeds(magnet: string): { url: string; sha: string }[] {
  const q = new URLSearchParams(magnet.replace(/^magnet:\?/, ""));
  return q.getAll("ws").flatMap((url) => {
    const sha = /\/blob\/([0-9a-f]{64})$/.exec(url)?.[1];
    return sha && /^https?:\/\//.test(url) ? [{ url, sha }] : [];
  });
}

/** A seed node's copy, checked against its hash; null if no node has it. */
async function fromSeedNode(magnet: string, maxBytes: number): Promise<Uint8Array | null> {
  for (const { url, sha } of webSeeds(magnet)) {
    try {
      const res = await fetch(url);
      if (!res.ok || Number(res.headers.get("content-length")) > maxBytes) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength <= maxBytes && (await sha256(bytes)) === sha) return bytes;
    } catch {
      // The next node, or the swarm.
    }
  }
  return null;
}

/**
 * Fetch a magnet link's file from the players who have it, or from a seed
 * node's copy when the swarm is slow or empty (a seed node can't hand out a
 * torrent's metadata, so a magnet alone can't start from it). This tab seeds
 * the file on afterwards either way.
 */
export async function fetchMagnet(
  magnet: string,
  maxBytes: number,
  onProgress?: (done: number, peers: number) => void,
  waitMs = 120_000,
  seedNodeAfterMs = 3000,
): Promise<Uint8Array | { error: "too-big" | "timeout" | "failed" }> {
  const { trackers } = netConfig();
  const c = await wt();
  const hash = magnetHash(magnet);
  const torrent = (hash && (await c.get(hash))) || c.add(magnet, { announce: trackers });
  watch(torrent);
  return new Promise((done) => {
    let settled = false;
    const settle = (r: Uint8Array | { error: "too-big" | "timeout" | "failed" }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(nodeTimer);
      done(r);
    };
    const timer = setTimeout(() => settle({ error: "timeout" }), waitMs);
    const nodeTimer = setTimeout(() => {
      void fromSeedNode(magnet, maxBytes).then((bytes) => {
        if (!bytes || settled || torrent.done) return;
        settle(bytes);
        // Swap the stalled download for a seed of the same bytes: the same file and name make the same torrent.
        torrent.destroy();
        const name = new URLSearchParams(magnet.replace(/^magnet:\?/, "")).get("dn") ?? "shared";
        c.seed(
          new File([bytes as BlobPart], name),
          { announce: trackers, name, urlList: webSeeds(magnet).map((w) => w.url) },
          watch,
        );
      });
    }, seedNodeAfterMs);
    const finish = async () => {
      const file = torrent.files[0];
      if (!file) return settle({ error: "failed" });
      settle(new Uint8Array(await file.arrayBuffer()));
    };
    torrent.on("error", () => settle({ error: "failed" }));
    torrent.on("metadata", () => {
      if (torrent.length > maxBytes) {
        torrent.destroy();
        settle({ error: "too-big" });
      }
    });
    torrent.on("download", () => onProgress?.(torrent.progress, torrent.numPeers));
    if (torrent.done) void finish();
    else torrent.on("done", () => void finish());
  });
}
