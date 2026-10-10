import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { fingerprint } from "../packages/manifest";
import { fetchShared, kindLabel, openShared, shareLink, useOpenLink, type SharedOffer } from "./links";

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? t("{n} KB", { n: Math.max(1, Math.round(bytes / 1024)) })
    : t("{n} MB", { n: (bytes / 1024 / 1024).toFixed(1) });

/**
 * Open a file someone shared by link, or make a share link for a file you
 * put online yourself. A `?open=` share link lands here and asks at once.
 */
export function OpenLink() {
  const landed = useOpenLink((s) => s.link);
  const [url, setUrl] = useState("");
  const [hosted, setHosted] = useState("");
  const [offer, setOffer] = useState<SharedOffer | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const look = async (link: string) => {
    setBusy(true);
    setNote("");
    try {
      const r = await fetchShared(link);
      if ("error" in r) setNote(r.error);
      else setOffer(r);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!landed) return;
    useOpenLink.setState({ link: null });
    void fetchShared(landed).then((r) => ("error" in r ? setNote(r.error) : setOffer(r)));
  }, [landed]);

  const made = /^https:\/\/\S+$/.test(hosted.trim()) ? shareLink(hosted.trim()) : "";

  return (
    <details className="fold open-link" open={!!note || undefined}>
      <summary>{t("Open or share a file by link")}</summary>
      <p className="muted small">
        {t(
          "Figure packs, tables, armies, standees and replays can live anywhere that serves files: GitHub Pages, Codeberg, a cloud drive or your own site. Open Battle hosts none of them.",
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
          type="url"
          // i18n-ignore: a URL scheme
          placeholder="https://"
          aria-label={t("Link to an Open Battle file")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" disabled={busy || !url.trim()}>
          {busy ? t("Fetching…") : t("Open")}
        </button>
      </form>
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
          {t("From {url}", { url: offer.url })} · {size(offer.bytes.byteLength)}
          <br />
          {/* i18n-ignore */}
          SHA-256 <code>{offer.hash}</code>
        </p>
        {offer.status === "changed" && (
          <p className="warn">
            {t("This link held a different file when you last opened it ({was}).", { was: offer.was ?? "" })}
          </p>
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
