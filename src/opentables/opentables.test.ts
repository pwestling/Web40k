import { describe, expect, it } from "vitest";
import { nostrBoard, signEvent, verifyEvent, REPORTS_TO_HIDE } from "./nostr";
import { shownPosts } from "./board";
import { ALIVE_MS, isUp, readPost, tagsOf, type SeenPost, type TablePost } from "./post";

const hour = 3600_000;
const post = (over: Partial<TablePost> = {}): TablePost => ({
  id: "a1b2c3d4e5f60718",
  name: "Porter",
  system: "forty-k-11",
  game: "Warhammer 40,000",
  size: "1000 pts",
  start: null,
  lang: "en",
  kind: "live",
  voice: true,
  seats: 1,
  note: "Friendly, new players welcome",
  join: "abcd1234",
  expires: Date.now() + 2 * hour,
  ...over,
});

interface Ev {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
  sig: string;
}

/** A Nostr relay in memory: stores events, replaces app data by its d tag, honours deletions. */
function fakeRelay() {
  let events: Ev[] = [];
  const subs = new Set<{ send: (m: unknown[]) => void; filters: { kinds: number[] }[] }>();
  const tag = (e: Ev, k: string) => e.tags.find((x) => x[0] === k)?.[1];
  const matches = (e: Ev, f: { kinds: number[]; "#t"?: string[] }) =>
    f.kinds.includes(e.kind) && (!f["#t"] || f["#t"].includes(tag(e, "t") ?? ""));
  const socket = () => {
    const s = {
      readyState: 0,
      onopen: null as ((e: unknown) => void) | null,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onclose: null as ((e: unknown) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      sub: null as null | { send: (m: unknown[]) => void; filters: { kinds: number[] }[] },
      send(text: string) {
        const msg = JSON.parse(text) as unknown[];
        const reply = (m: unknown[]) => setTimeout(() => s.onmessage?.({ data: JSON.stringify(m) }));
        if (msg[0] === "EVENT") {
          const e = msg[1] as Ev;
          if (e.kind === 5) {
            const a = tag(e, "a");
            events = events.filter((x) => `${x.kind}:${x.pubkey}:${tag(x, "d")}` !== a);
          } else {
            if (e.kind >= 30000)
              events = events.filter(
                (x) => !(x.kind === e.kind && x.pubkey === e.pubkey && tag(x, "d") === tag(e, "d")),
              );
            events.push(e);
            for (const sub of subs)
              if (sub.filters.some((f) => matches(e, f))) sub.send(["EVENT", "tables", e]);
          }
          reply(["OK", e.id, true, ""]);
        } else if (msg[0] === "REQ") {
          const filters = msg.slice(2) as { kinds: number[] }[];
          s.sub = { send: reply, filters };
          subs.add(s.sub);
          for (const e of events) if (filters.some((f) => matches(e, f))) reply(["EVENT", msg[1], e]);
          reply(["EOSE", msg[1]]);
        }
      },
      close() {
        s.readyState = 3;
        if (s.sub) subs.delete(s.sub);
      },
    };
    setTimeout(() => {
      s.readyState = 1;
      s.onopen?.({});
    });
    return s;
  };
  return { socket, events: () => events };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("Open tables (#50)", () => {
  it("reads only well-formed posts, cut to size", () => {
    expect(readPost(post())).toMatchObject({ name: "Porter", seats: 1 });
    expect(readPost({ ...post(), name: "x".repeat(200) })!.name).toHaveLength(32);
    expect(readPost({ ...post(), name: "Bad‮Name" })!.name).toBe("Bad Name");
    expect(readPost({ ...post(), join: "../../evil" })).toBeNull();
    expect(readPost({ ...post(), expires: Date.now() - 1 })).toBeNull();
    expect(readPost({ ...post(), expires: Date.now() + 30 * hour })).toBeNull();
    expect(readPost({ ...post(), seats: 0 })).toBeNull();
    expect(readPost({ ...post(), kind: "mail", join: "not-an-invite" })).toBeNull();
    const seen: SeenPost = { ...post(), key: "k", at: Date.now() - ALIVE_MS - 1 };
    expect(isUp(seen)).toBe(false);
  });

  it("signs and checks board events", async () => {
    const secret = new Uint8Array(32).fill(7);
    const e = await signEvent(secret, 30078, [["t", "x"]], "hello");
    expect(await verifyEvent(e)).toBe(true);
    expect(await verifyEvent({ ...e, content: "changed" })).toBe(false);
  });

  it("posts a table, shows it to others, and takes it down", async () => {
    const relay = fakeRelay();
    const host = nostrBoard({
      relays: ["wss://a"],
      secret: new Uint8Array(32).fill(1),
      socket: relay.socket,
    });
    const guest = nostrBoard({
      relays: ["wss://a"],
      secret: new Uint8Array(32).fill(2),
      socket: relay.socket,
    });
    let seen: SeenPost[] = [];
    let loaded = false;
    const stop = guest.watch(
      (p) => (seen = p),
      (s) => (loaded = s.loaded),
    );
    await settle();
    expect(loaded).toBe(true);
    expect(seen).toEqual([]);

    await host.publish(post());
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: "Porter", key: host.key });

    // A seat taken: the same post, changed in place.
    await host.publish(post({ seats: 2, size: "2000 pts" }));
    await settle();
    expect(seen.map((p) => p.size)).toEqual(["2000 pts"]);

    await host.withdraw(post());
    await settle();
    expect(seen).toEqual([]);
    stop();
  });

  it("hides a post reported by three different players", async () => {
    const relay = fakeRelay();
    const host = nostrBoard({
      relays: ["wss://a"],
      secret: new Uint8Array(32).fill(1),
      socket: relay.socket,
    });
    await host.publish(post());
    const reader = nostrBoard({
      relays: ["wss://a"],
      secret: new Uint8Array(32).fill(9),
      socket: relay.socket,
    });
    let seen: SeenPost[] = [];
    const stop = reader.watch(
      (p) => (seen = p),
      () => {},
    );
    await settle();
    expect(seen).toHaveLength(1);
    for (let i = 0; i < REPORTS_TO_HIDE; i++) {
      const b = nostrBoard({
        relays: ["wss://a"],
        secret: new Uint8Array(32).fill(20 + i),
        socket: relay.socket,
      });
      await b.report(seen[0] ?? (await settle(), seen[0])!, "spam");
      await settle();
      expect(seen).toHaveLength(i + 1 < REPORTS_TO_HIDE ? 1 : 0);
    }
    stop();
  });

  it("reads the kind of game from ticks and the note", () => {
    expect(tagsOf({ ...post(), note: "Casual game, beginners welcome" })).toEqual(["new", "relaxed"]);
    expect(tagsOf({ ...post(), note: "", tags: ["competitive"] })).toEqual(["competitive"]);
    expect(readPost({ ...post(), tags: ["narrative", "<script>"] })?.tags).toEqual(["narrative"]);
  });

  it("keeps hidden, blocked and reported posts off this browser's list", () => {
    const a: SeenPost = { ...post(), key: "k1", at: Date.now() };
    const b: SeenPost = { ...post({ id: "ffffffffffffffff", name: "Spammer" }), key: "k2", at: Date.now() };
    const s = {
      mine: null,
      asked: false,
      hidden: [],
      blockedNames: [],
      blockedKeys: [],
      reported: [],
      listed: null,
      joined: null,
      gone: false,
    };
    expect(shownPosts([a, b], s)).toHaveLength(2);
    expect(shownPosts([a, b], { ...s, blockedNames: ["spammer"] })).toEqual([a]);
    // Blocking goes by key: names like "Player 1" repeat (UX 382).
    expect(shownPosts([a, b], { ...s, blockedKeys: ["k2"] })).toEqual([a]);
    expect(shownPosts([a, b], { ...s, hidden: ["k1:a1b2c3d4e5f60718"] })).toEqual([b]);
  });
});
