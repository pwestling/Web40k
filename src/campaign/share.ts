import { useEffect } from "react";
import { create } from "zustand";
import type { SideMessage } from "../net/transport";
import { useStore } from "../store";
import { campaignHash, readCampaign } from "./book";
import { useCampaigns } from "./store";

/** Characters per message, as for packages. */
const PART_CHARS = 48 * 1024;
/** A campaign book is a few games and notes; anything far bigger isn't one. */
const MAX_CHARS = 4 * 1024 * 1024;
const STALL_MS = 15000;

type Getting =
  { state: "asking" | "receiving"; at: number; from?: string; parts?: number } | { state: "failed" };

/** Books this device asked the room for, by hash. */
export const useCampaignTransfers = create<Record<string, Getting>>(() => ({}));

const incoming = new Map<string, string[]>();

/** Ask the room for the game's copy of a campaign book; it replaces this device's copy once its hash checks out. */
export function requestCampaign(hash: string): void {
  const session = useStore.getState().session;
  if (!session) return;
  const t = useCampaignTransfers.getState()[hash];
  if (t && t.state !== "failed" && Date.now() - t.at < STALL_MS) return;
  incoming.delete(hash);
  useCampaignTransfers.setState({ [hash]: { state: "asking", at: Date.now() } });
  session.sendSide({ t: "campaign/want", hash });
}

/** Answer the room's requests for books this device holds, and take in the ones it asked for. */
export function useCampaignSharing() {
  const session = useStore((s) => s.session);
  useEffect(() => {
    if (!session) return;
    session.listenSide((message, from) => receive(message, from), null, "campaign");
    return () => session.listenSide(null, null, "campaign");
  }, [session]);
}

function receive(message: SideMessage, from: string) {
  const session = useStore.getState().session;
  if (!session) return;
  if (message.t === "campaign/want") {
    const { books, hashes } = useCampaigns.getState();
    const id = Object.keys(hashes).find((k) => hashes[k] === message.hash);
    const book = id ? books[id] : undefined;
    if (!book) return;
    const text = JSON.stringify(book);
    const parts = Math.max(1, Math.ceil(text.length / PART_CHARS));
    for (let part = 0; part < parts; part++)
      session.sendSide(
        {
          t: "campaign/part",
          hash: message.hash,
          part,
          parts,
          data: text.slice(part * PART_CHARS, (part + 1) * PART_CHARS),
        },
        from,
      );
    return;
  }
  if (message.t !== "campaign/part") return;
  const { hash, part, parts, data } = message;
  const t = useCampaignTransfers.getState()[hash];
  if (!t || t.state === "failed") return;
  if (!Number.isInteger(parts) || parts < 1 || parts * PART_CHARS > MAX_CHARS) return;
  if (t.state === "receiving" && (t.from !== from || t.parts !== parts)) return;
  if (!Number.isInteger(part) || part < 0 || part >= parts || typeof data !== "string") return;
  let got = incoming.get(hash);
  if (!got) incoming.set(hash, (got = new Array<string>(parts)));
  if (got[part] !== undefined) return;
  got[part] = data;
  useCampaignTransfers.setState({ [hash]: { state: "receiving", at: Date.now(), from, parts } });
  if (got.filter((x) => x !== undefined).length < parts) return;
  incoming.delete(hash);
  let book = null;
  try {
    book = readCampaign(JSON.parse(got.join("")));
  } catch {
    // Not a book: failed below.
  }
  if (!book || campaignHash(book) !== hash) {
    useCampaignTransfers.setState({ [hash]: { state: "failed" } });
    return;
  }
  useCampaigns.getState().put(book);
  useCampaignTransfers.setState((s) => {
    const { [hash]: _done, ...rest } = s;
    return rest;
  });
}
