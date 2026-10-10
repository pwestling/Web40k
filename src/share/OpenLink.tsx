import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t, tn } from "../i18n";
import { fingerprint } from "../packages/manifest";
import {
  fetchShared,
  kindLabel,
  openShared,
  sharedKind,
  shareLink,
  useOpenLink,
  type SharedOffer,
} from "./links";
import { useSeeding } from "./torrent";

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? t("{n} KB", { n: Math.max(1, Math.round(bytes / 1024)) })
    : t("{n} MB", { n: (bytes / 1024 / 1024).toFixed(1) });

/**
 * Open a file someone shared by link or torrent, or share one: seeded from
 * this tab and kept by the site's seed nodes, or put online by the player.
 * A `?open=` share link lands here and asks at once.
 */
export function OpenLink() {
  const landed = useOpenLink((s) => s.link);
  const seeding = useSeeding();
  const [url, setUrl] = useState("");
  const [hosted, setHosted] = useState("");
  const [secret, setSecret] = useState(false);
  const [shared, setShared] = useState<{ link: string; line: string } | null>(null);
  const [offer, setOffer] = useState<SharedOffer | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const progress = (done: number, peers: number) =>
    setNote(t("Fetching from {n} players and seeds: {pct}%", { n: peers, pct: Math.round(done * 100) }));
  const look = async (link: string) => {
    setBusy(true);
    setNote(link.startsWith("magnet:") ? t("Looking for the file…") : "");
    try {
      const r = await fetchShared(link, undefined, progress);
      if ("error" in r) setNote(r.error);
      else {
        setNote("");
        setOffer(r);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!landed) return;
    useOpenLink.setState({ link: null });
    void fetchShared(landed, undefined, progress).then((r) => {
      setNote("error" in r ? r.error : "");
      if (!("error" in r)) setOffer(r);
    });
  }, [landed]);

  const share = async (file: File) => {
    setBusy(true);
    setShared(null);
    setNote("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let data: unknown = null;
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        // Not JSON: not an Open Battle file.
      }
      if (!sharedKind(data))
        return setNote(
          t("Share a file saved from Open Battle: a figure pack, table, army, standee or replay."),
        );
      const { shareFile } = await import("./torrent");
      const s = await shareFile(bytes, file.name, { encrypt: secret });
      setShared({
        link: shareLink(s.magnet, s.key),
        line: s.kept
          ? tn(
              s.kept,
              "A seed node keeps a copy, so the link works after you close this tab.",
              "{n} seed nodes keep a copy, so the link works after you close this tab.",
            )
          : t(
              "No seed node keeps a copy here: the link works while this tab, or someone who opened it, stays open.",
            ),
      });
    } catch {
      setNote(t("That file couldn't be shared."));
    } finally {
      setBusy(false);
    }
  };

  const made = /^https:\/\/\S+$/.test(hosted.trim()) ? shareLink(hosted.trim()) : "";

  return (
    <details className="fold open-link" open={!!note || !!shared || undefined}>
      <summary>{t("Open or share a file by link")}</summary>
      <p className="muted small">
        {t(
          "Figure packs, tables, armies, standees and replays travel between players' browsers, and can live anywhere that serves files. Open Battle hosts and lists none of them.",
        )}
      </p>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void look(url.trim());
        }}
      >
        <input
          type="text"
          // i18n-ignore: a URL scheme
          placeholder="https:// or magnet:"
          aria-label={t("Link to an Open Battle file")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" disabled={busy || !url.trim()}>
          {busy ? t("Fetching…") : t("Open")}
        </button>
      </form>
      <div className="row wrap">
        <label className="file button small">
          {t("Share a file from this device")}
          <input
            type="file"
            accept=".json,.standee,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void share(f);
              e.target.value = "";
            }}
          />
        </label>
        <label className="small">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />{" "}
          {t("Private: encrypt it, with the key only in the link")}
        </label>
      </div>
      {shared && (
        <p className="small">
          <code className="share-link">{shared.link}</code>{" "}
          <button className="small" onClick={() => void navigator.clipboard?.writeText(shared.link)}>
            {t("Copy")}
          </button>
          <br />
          <span className="muted">{shared.line}</span>
        </p>
      )}
      <label className="small">
        {t("Put a file online yourself? Paste its link to get a share link:")}
        <input
          type="url"
          // i18n-ignore: a URL scheme
          placeholder="https://"
          aria-label={t("Where your file is")}
          value={hosted}
          onChange={(e) => setHosted(e.target.value)}
        />
      </label>
      {made && (
        <p className="small">
          <code className="share-link">{made}</code>{" "}
          <button className="small" onClick={() => void navigator.clipboard?.writeText(made)}>
            {t("Copy")}
          </button>
        </p>
      )}
      {note && <p className="muted small">{note}</p>}
      {seeding.files > 0 && (
        <p className="muted small">
          {tn(seeding.files, "This tab is sharing {n} file", "This tab is sharing {n} files")}
          {seeding.peers > 0 && ` · ${tn(seeding.peers, "{n} player connected", "{n} players connected")}`}
        </p>
      )}
      {offer && (
        <SharedConsent
          offer={offer}
          onYes={() => {
            setOffer(null);
            setUrl("");
            setBusy(true);
            void openShared(offer)
              .then(setNote)
              .finally(() => setBusy(false));
          }}
          onNo={() => setOffer(null)}
        />
      )}
    </details>
  );
}

function SharedConsent({ offer, onYes, onNo }: { offer: SharedOffer; onYes: () => void; onNo: () => void }) {
  return createPortal(
    <div className="modal-backdrop">
      <div className="panel modal consent" role="dialog" aria-label={t("Open a shared file")}>
        <h3>
          {kindLabel(offer.kind)}: {offer.name} ·{" "}
          <code className="fp" title={offer.hash}>
            {fingerprint(offer.hash)}
          </code>
        </h3>
        <p className="muted small">
          {t("From {url}", { url: offer.shown })} · {size(offer.bytes.byteLength)}
          <br />
          {/* i18n-ignore */}
          SHA-256 <code>{offer.hash}</code>
        </p>
        {offer.status === "changed" && (
          <p className="warn">
            {t("This link held a different file when you last opened it ({was}).", { was: offer.was ?? "" })}
          </p>
        )}
        {offer.private && (
          <p className="small">{t("It was shared privately: only people with this link can open it.")}</p>
        )}
        {offer.status === "same" && <p className="small">{t("You opened this same file before.")}</p>}
        <p className="muted small">
          {offer.kind === "replay"
            ? t(
                "Rules packages inside a replay stay off until you say yes to them, as with packages from a player.",
              )
            : t("It is data only: nothing in it runs.")}
        </p>
        <div className="row">
          <button className="primary" onClick={onYes}>
            {t("Open it")}
          </button>
          <button onClick={onNo}>{t("Cancel")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
