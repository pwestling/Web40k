import type { ReplayFile } from "../ui/replayFile";
import type { ReportFile } from "../ui/report";
import { create } from "zustand";
import { t } from "../i18n";
import { sha256 } from "../packages/manifest";
import { rawLink } from "../packages/packPins";
import { isYellowscribe } from "../systems/wh40k/yellowscribe";
import { decrypt, fetchMagnet, isEncrypted, magnetHash, splitKey } from "./torrent";

/**
 * Open a shared file from a link. A player puts a figure pack, table, army,
 * standee or replay anywhere that serves files (GitHub Pages, Codeberg, a
 * Dropbox link, their own site) and passes the link on, or the app's own
 * `?open=<link>` share link. The app fetches it, says what it is, how big and
 * its SHA-256, and opens it only when the player says so. Each link is
 * remembered with the hash it gave, so a file that changed at the same link
 * is pointed out. The project hosts and lists none of these files.
 */

export type SharedKind = "figures" | "table" | "army" | "standee" | "replay";

/** Big enough for a figure pack of a whole army; each model inside still has its own cap. */
const MAX_SHARED_BYTES = 96 * 1024 * 1024;

/** What a file is, from its format line; null if Open Battle can't open it from a link. */
export function sharedKind(data: unknown): SharedKind | null {
  const format = (data as { format?: unknown } | null)?.format;
  switch (format) {
    case "open-battle/figures@1":
      return "figures";
    case "open-battle/table@1":
    case "open-battle/layout@1":
      return "table";
    case "open-battle/army@1":
      return "army";
    case "open-battle/standee@1":
      return "standee";
    case "open-battle/record@1":
      return "replay";
  }
  return isYellowscribe(data) ? "army" : null;
}

export const kindLabel = (kind: SharedKind): string =>
  ({
    figures: t("Figure pack"),
    table: t("Table"),
    army: t("Army"),
    standee: t("Standee"),
    replay: t("Replay"),
  })[kind];

/** A link the player opened before, and the bytes it gave then. */
interface SharedPin {
  hash: string;
  kind: SharedKind;
  name: string;
  at: number;
}

const KEY = "open-battle:shared-links";

function stored(): Record<string, SharedPin> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, SharedPin>) : {};
  } catch {
    return {};
  }
}

export const useSharedPins = create<{ pins: Record<string, SharedPin> }>(() => ({ pins: stored() }));

function pin(url: string, p: SharedPin): void {
  const pins = { ...useSharedPins.getState().pins, [url]: p };
  useSharedPins.setState({ pins });
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(pins));
  } catch {
    // Private mode: remembered until the page closes.
  }
}

/** A file fetched from a link, waiting for the player's yes. */
export interface SharedOffer {
  /** The link it is remembered by (a magnet link by its torrent). */
  url: string;
  /** Where it came from, for the question. */
  shown: string;
  /** It was encrypted, and the link's key opened it. */
  private: boolean;
  kind: SharedKind;
  name: string;
  hash: string;
  bytes: Uint8Array;
  /** "same": the link gives what it gave last time; "changed": other bytes now; "new": never opened. */
  status: "new" | "same" | "changed";
  /** When it changed: the name it had last time. */
  was?: string;
}

function nameOf(kind: SharedKind, data: Record<string, unknown>, url: string): string {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (name) return name.slice(0, 80);
  try {
    const u = new URL(url);
    const file = u.searchParams.get("dn") ?? decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return file.slice(0, 80) || kindLabel(kind);
  } catch {
    return kindLabel(kind);
  }
}

/** Fetch a shared file and read what it is, opening nothing. */
export async function fetchShared(
  url: string,
  fetcher: (url: string) => Promise<Response> = (u) => fetch(u),
  onProgress?: (done: number, peers: number) => void,
): Promise<SharedOffer | { error: string }> {
  const { link: bare, key } = splitKey(url.trim());
  const magnet = bare.startsWith("magnet:");
  const link = magnet ? bare : rawLink(bare);
  let bytes: Uint8Array;
  if (magnet) {
    if (!magnetHash(link)) return { error: t("That magnet link has no torrent in it.") };
    const got = await fetchMagnet(link, MAX_SHARED_BYTES, onProgress);
    if ("error" in got)
      return {
        error:
          got.error === "too-big"
            ? t("That file is too big to open from a link.")
            : got.error === "timeout"
              ? t("Nobody is sharing that file right now, and no seed node has it.")
              : t("That torrent couldn't be fetched."),
      };
    bytes = got;
  } else {
    if (!/^https:\/\/[^\s/]+\//i.test(link)) return { error: t("Use an https:// link to the file.") };
    let res: Response;
    try {
      res = await fetcher(link);
    } catch {
      return { error: t("Couldn't fetch that link (it may not allow other sites to read it).") };
    }
    if (!res.ok) return { error: t("That link answered {status}.", { status: res.status }) };
    if (Number(res.headers.get("content-length")) > MAX_SHARED_BYTES)
      return { error: t("That file is too big to open from a link.") };
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_SHARED_BYTES) return { error: t("That file is too big to open from a link.") };
  }
  const sealed = isEncrypted(bytes);
  if (sealed) {
    if (!key)
      return { error: t("That file is private: open it with the whole share link, which carries its key.") };
    const open = await decrypt(bytes, key);
    if (!open) return { error: t("That key doesn't open this file.") };
    bytes = open;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { error: t("That link isn't an Open Battle file.") };
  }
  const kind = sharedKind(data);
  if (!kind) return { error: t("That link isn't an Open Battle file.") };
  const hash = await sha256(bytes);
  const pinKey = magnet ? `magnet:${magnetHash(link)}` : link;
  const before = useSharedPins.getState().pins[pinKey];
  const status = !before ? "new" : before.hash === hash ? "same" : "changed";
  return {
    url: pinKey,
    shown: magnet ? t("a torrent") : link,
    kind,
    name: nameOf(kind, data as Record<string, unknown>, link),
    hash,
    bytes,
    status,
    private: sealed,
    ...(status === "changed" ? { was: before!.name } : {}),
  };
}

/** The player said yes: open the file where its kind goes, and remember the link. Returns a line to show. */
export async function openShared(offer: SharedOffer): Promise<string> {
  const line = await openBytes(offer.kind, offer.name, offer.bytes);
  if (line === null) return t("That file couldn't be opened.");
  pin(offer.url, { hash: offer.hash, kind: offer.kind, name: offer.name, at: Date.now() });
  return line;
}

/**
 * Open a file of a kind Open Battle knows, from a link or from this device
 * (the lobby's "Open a file…", UX 83): the line saying where it went, or an
 * error line. Null only for a kind with nothing to open it.
 */
export async function openBytes(kind: SharedKind, name: string, bytes: Uint8Array): Promise<string | null> {
  const text = () => new TextDecoder().decode(bytes);
  const file = (ext: string) => new File([bytes as BlobPart], `${name}${ext}`);
  let line: string | null = null;
  switch (kind) {
    case "figures": {
      const { openPack } = await import("../figures/pack");
      const r = await openPack(text());
      if (typeof r === "string") return r;
      line = t("{name}: {added} new, {already} already here.", {
        name: r.name,
        added: r.added,
        already: r.already,
      });
      break;
    }
    case "table": {
      const { importTableFile } = await import("../tables/actions");
      const r = await importTableFile(file(".table.json"));
      if (typeof r === "string") return r;
      line = t("{name} is in your table library.", { name: r.name });
      break;
    }
    case "army": {
      const { importArmyFile } = await import("../ui/shelfActions");
      const r = await importArmyFile(file(".army.json"));
      if (typeof r === "string") return r;
      line = t("{name} is on your army shelf.", { name: r.name });
      break;
    }
    case "standee": {
      const { useAssets } = await import("../assets/store");
      const { STANDEE_EXTENSION } = await import("../standees/file");
      const asset = await useAssets
        .getState()
        .importFile(file(STANDEE_EXTENSION), `library:${name}`, "miniature");
      if (!asset) return t("That standee couldn't be read.");
      line = t("{name} is in your figure library.", { name });
      break;
    }
    case "replay": {
      const [{ unbundleReplay }, { useStore }] = await Promise.all([
        import("../ui/replayFile"),
        import("../store"),
      ]);
      const data = JSON.parse(text()) as ReplayFile & Partial<ReportFile>;
      useStore.getState().openReplay(await unbundleReplay(data));
      // A problem report opens at the moment it was made (src/ui/report.ts).
      if (data.report && Number.isFinite(data.report.seq)) {
        const { useOpenReport } = await import("../ui/report");
        useOpenReport.setState({ report: data.report });
        useStore.getState().setScrub(data.report.seq);
      }
      line = t("Replay opened.");
      break;
    }
  }
  return line;
}

/** The app link that offers a hosted file or torrent to whoever opens it; a private file's key rides in the #fragment. */
export function shareLink(
  fileUrl: string,
  key?: string,
  here: { origin: string; pathname: string } = location,
): string {
  const link = fileUrl.startsWith("magnet:") ? fileUrl : rawLink(fileUrl);
  return `${here.origin}${here.pathname}?open=${encodeURIComponent(link)}${key ? `#key=${key}` : ""}`;
}

/** A link from the page's `?open=` (a share link) with its #key=, taken off the address so a reload doesn't ask again. */
export const useOpenLink = create<{ link: string | null }>(() => {
  if (typeof location === "undefined") return { link: null };
  const here = new URL(location.href);
  const link = here.searchParams.get("open");
  if (link === null) return { link: null };
  here.searchParams.delete("open");
  const key = here.hash.startsWith("#key=") ? here.hash.slice(1) : "";
  if (key) here.hash = "";
  history.replaceState(history.state, "", here);
  return { link: /^(https:\/\/|magnet:)/.test(link) ? `${link}${key ? `#${key}` : ""}` : null };
});
