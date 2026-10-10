import { describe, expect, it } from "vitest";
import { sha256 } from "../packages/manifest";
import { useTables } from "../tables/library";
import { fetchShared, openShared, shareLink, sharedKind, useSharedPins } from "./links";

// Shared files by link. Every name below is invented.

const LINK = "https://files.example/tables/ridge.table.json";
const table = (name: string) =>
  JSON.stringify({
    format: "open-battle/table@1",
    id: "ridge",
    name,
    savedAt: 1,
    layout: { terrain: [] },
    table: { width: 44, depth: 30 },
  });

/** A fetch that serves whatever `served` holds now. */
function server(served: { text: string; status?: number }) {
  return async () => new Response(served.text, { status: served.status ?? 200 }) as unknown as Response;
}

describe("shared files by link", () => {
  it("knows every Open Battle file it can open, and nothing else", () => {
    expect(sharedKind({ format: "open-battle/figures@1" })).toBe("figures");
    expect(sharedKind({ format: "open-battle/table@1" })).toBe("table");
    expect(sharedKind({ format: "open-battle/layout@1" })).toBe("table");
    expect(sharedKind({ format: "open-battle/army@1" })).toBe("army");
    expect(sharedKind({ format: "open-battle/standee@1" })).toBe("standee");
    expect(sharedKind({ format: "open-battle/record@1" })).toBe("replay");
    expect(sharedKind({ format: "something-else" })).toBeNull();
    expect(sharedKind(null)).toBeNull();
  });

  it("says what a link holds, its size and hash, without opening it", async () => {
    const text = table("Ridge line");
    const offer = await fetchShared(LINK, server({ text }));
    if ("error" in offer) throw new Error(offer.error);
    expect(offer).toMatchObject({ kind: "table", name: "Ridge line", status: "new", url: LINK });
    expect(offer.hash).toBe(await sha256(new TextEncoder().encode(text)));
    expect(Object.values(useTables.getState().tables ?? {}).some((t) => t.name === "Ridge line")).toBe(false);
  });

  it("turns away links it can't use", async () => {
    expect(await fetchShared("http://files.example/a.json", server({ text: "{}" }))).toHaveProperty("error");
    expect(await fetchShared(LINK, server({ text: "nope", status: 404 }))).toHaveProperty("error");
    expect(await fetchShared(LINK, server({ text: "not json" }))).toHaveProperty("error");
    expect(await fetchShared(LINK, server({ text: '{"format":"x"}' }))).toHaveProperty("error");
  });

  it("opens a table into the library, then points out when the link's file changes", async () => {
    const served = { text: table("Ridge line") };
    const offer = await fetchShared(LINK, server(served));
    if ("error" in offer) throw new Error(offer.error);
    expect(await openShared(offer)).toContain("Ridge line");
    expect(useSharedPins.getState().pins[LINK]?.hash).toBe(offer.hash);
    expect(await fetchShared(LINK, server(served))).toMatchObject({ status: "same" });
    served.text = table("Ridge line, moved");
    expect(await fetchShared(LINK, server(served))).toMatchObject({ status: "changed", was: "Ridge line" });
  });

  it("makes a share link that carries the file's raw address", () => {
    const here = { origin: "https://play.example", pathname: "/app/" };
    expect(shareLink("https://github.com/someone/files/blob/main/ridge.table.json", undefined, here)).toBe(
      "https://play.example/app/?open=" +
        encodeURIComponent("https://raw.githubusercontent.com/someone/files/main/ridge.table.json"),
    );
  });
});

describe("private shared files", () => {
  it("encrypts with a key that only opens its own file", async () => {
    const { encrypt, decrypt, isEncrypted } = await import("./torrent");
    const plain = new TextEncoder().encode(table("Hidden ridge"));
    const a = await encrypt(plain);
    const b = await encrypt(plain);
    expect(isEncrypted(a.payload)).toBe(true);
    expect(new TextDecoder().decode(a.payload)).not.toContain("Hidden ridge");
    expect(await decrypt(a.payload, a.key)).toEqual(plain);
    expect(await decrypt(a.payload, b.key)).toBeNull();
  });

  it("opens a private file only with the key from the link's fragment", async () => {
    const { encrypt } = await import("./torrent");
    const { payload, key } = await encrypt(new TextEncoder().encode(table("Hidden ridge")));
    const serve = async () => new Response(payload as BodyInit) as unknown as Response;
    const link = "https://files.example/blob/abc";
    expect(await fetchShared(link, serve)).toEqual({ error: expect.stringContaining("private") });
    const offer = await fetchShared(`${link}#key=${key}`, serve);
    expect(offer).toMatchObject({ kind: "table", name: "Hidden ridge", private: true, url: link });
  });

  it("puts a private file's key in the share link's fragment, never its query", async () => {
    const here = { origin: "https://play.example", pathname: "/" };
    const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=x.obx";
    const link = shareLink(magnet, "k".repeat(43), here);
    expect(new URL(link).hash).toBe(`#key=${"k".repeat(43)}`);
    expect(new URL(link).searchParams.get("open")).toBe(magnet);
    const { magnetHash, splitKey } = await import("./torrent");
    expect(magnetHash(magnet)).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(splitKey(`${magnet}#key=${"k".repeat(43)}`)).toEqual({ link: magnet, key: "k".repeat(43) });
  });
});
