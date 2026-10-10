import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_SYSTEM, type ArmyPack } from "../core";
import { systemOf } from "../core/content/turn";
import { turnOnRules } from "../campaign/RulesLine";
import { applyPack, packMismatches } from "../packages/faction";
import type { FactionPack } from "../packages/factionFormat";
import { systemMatches, useLibrary } from "../packages/library";
import { fingerprint } from "../packages/manifest";
import {
  acceptPack,
  declinePack,
  fetchPack,
  packRef,
  pinnedFor,
  unpin,
  usePins,
  type PackOffer,
} from "../packages/packPins";
import { playerName } from "../i18n/names";
import { useStore } from "../store";
import type { ImportedRoster } from "../systems/wh40k/roster";
import { refOf } from "./Packages";
import { t, tn } from "../i18n";

/**
 * Faction packs by URL (#76), on the army import: the packs this device
 * pinned for the game, applied to the army by name; "Load a pack from a
 * link" with the consent sheet; and the packs an army was made with that
 * aren't here. The app hosts and lists no packs: links are the player's.
 */
export function FactionPacks({
  roster,
  setRoster,
}: {
  roster: ImportedRoster;
  setRoster: (r: ImportedRoster) => void;
}) {
  const game = useStore((s) => s.game);
  const systemId = game.system ?? DEFAULT_SYSTEM;
  const system = systemOf(game);
  usePins((s) => s.pins);
  const library = useLibrary((s) => s.packages);
  useEffect(() => void useLibrary.getState().load(), []);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<PackOffer | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pinned = pinnedFor(systemId);
  const onArmy = roster.army?.packs ?? [];
  // Packs the army was made with that this device doesn't have pinned (an army file from a friend).
  const elsewhere = onArmy.filter((p) => !pinned.some((x) => x.pin.hash === p.hash));

  const apply = (o: { pack: FactionPack; ref: ArmyPack }) => {
    const done = applyPack(roster, o.pack, o.ref, system);
    if (done.count) setRoster(done.roster);
    setNote(
      done.count
        ? tn(
            done.count,
            "{pack}: {n} rule in this army now plays itself.",
            "{pack}: {n} rules in this army now play themselves.",
            {
              pack: o.ref.name,
            },
          )
        : t("{pack}: nothing in this army has a name it knows.", { pack: o.ref.name }),
    );
  };
  const load = async (link: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const got = await fetchPack(link);
    setBusy(false);
    if ("error" in got) return setError(got.error);
    if (!got.manifest.systems.some((s) => systemMatches(s, systemId)))
      setError(t("That pack is for {systems}, not this game.", { systems: got.manifest.systems.join(", ") }));
    else if (got.ask) setOffer(got);
    else apply({ pack: got.pack, ref: packRef(acceptPack(got), got.pkg.bytes) });
  };

  return (
    <details className="auto-abilities faction-packs" open={pinned.length > 0 || elsewhere.length > 0}>
      <summary>
        {pinned.length ? tn(pinned.length, "Faction pack ({n})", "Faction packs ({n})") : t("Faction packs")}
      </summary>
      <p className="muted small">
        {t(
          "A faction pack plays rules by their names: abilities, detachment rules, enhancements and stratagems. Paste the link to one you trust; the app keeps that link pinned to the exact file you said yes to.",
        )}
      </p>
      {pinned.length > 0 && (
        <ul className="auto-list">
          {pinned.map(({ pin, pkg, read }) => {
            const on = onArmy.some((p) => p.hash === pin.hash);
            return (
              <li key={pin.url} className="row spread">
                <span>
                  <strong>
                    {pin.name} {pin.version}
                  </strong>{" "}
                  <code className="fp" title={pin.hash}>
                    {fingerprint(pin.hash)}
                  </code>{" "}
                  <span className="muted small" title={pin.url}>
                    {new URL(pin.url).host}
                  </span>
                </span>
                <span className="row">
                  {on ? (
                    <span className="small">✓ {t("on this army")}</span>
                  ) : (
                    <button
                      className="small"
                      onClick={() => apply({ pack: read.pack, ref: packRef(pin, pkg.bytes) })}
                    >
                      {t("Apply")}
                    </button>
                  )}
                  <button className="small" onClick={() => void load(pin.url)} disabled={busy}>
                    {t("Check the link")}
                  </button>
                  <button
                    className="quiet small"
                    onClick={() => confirm(t("Stop using {pack}?", { pack: pin.name })) && unpin(pin.url)}
                  >
                    {t("Forget")}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {elsewhere.map((p) => (
        <p key={p.hash} className="small">
          {t("This army was made with {pack} {version} ({fp}).", {
            pack: p.name,
            version: p.version,
            fp: fingerprint(p.hash),
          })}{" "}
          {library[p.hash]?.trusted
            ? t("Its rules came with the army.")
            : t("Its rules came with the army; load the pack to play its code or update it.")}{" "}
          {p.url && (
            <button className="small" disabled={busy} onClick={() => void load(p.url!)}>
              {t("Load it from its link")}
            </button>
          )}
        </p>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void load(url.trim());
        }}
      >
        <input
          type="url"
          value={url}
          aria-label={t("Faction pack link")}
          // i18n-ignore: a URL scheme
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="small" type="submit" disabled={busy || !url.trim()}>
          {busy ? t("Fetching…") : t("Load a pack from a link")}
        </button>
      </form>
      {error && (
        <p className="warn small" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {offer && (
        <PackConsent
          offer={offer}
          matches={
            applyPack(
              roster,
              offer.pack,
              {
                id: offer.manifest.id,
                name: offer.manifest.name,
                version: offer.manifest.version,
                hash: offer.pkg.hash,
                bytes: offer.pkg.bytes,
              },
              system,
            ).count
          }
          onYes={() => {
            const pin = acceptPack(offer);
            setOffer(null);
            setUrl("");
            apply({ pack: offer.pack, ref: packRef(pin, offer.pkg.bytes) });
          }}
          onNo={() => {
            declinePack(offer);
            setOffer(null);
          }}
        />
      )}
    </details>
  );
}

/** What a pack holds, in a line each. */
function contents(pack: FactionPack): string[] {
  const out: string[] = [];
  if (pack.faction) out.push(t("For: {faction}", { faction: pack.faction }));
  const rules = (pack.rules?.length ?? 0) + (pack.abilities?.length ?? 0);
  if (rules) out.push(tn(rules, "{n} army rule or unit ability", "{n} army rules and unit abilities"));
  for (const d of pack.detachments ?? [])
    out.push(
      t("Detachment {name}: {rules}, {enhancements}, {stratagems}", {
        name: d.name,
        rules: tn(d.rules?.length ?? 0, "{n} rule", "{n} rules"),
        enhancements: tn(d.enhancements?.length ?? 0, "{n} enhancement", "{n} enhancements"),
        stratagems: tn(d.stratagems?.length ?? 0, "{n} stratagem", "{n} stratagems"),
      }),
    );
  if (pack.stratagems?.length)
    out.push(
      tn(pack.stratagems.length, "{n} stratagem for any detachment", "{n} stratagems for any detachment"),
    );
  return out;
}

/** Before a pack is used: what it is, its hash, where it came from, what it adds, and whether code runs. */
function PackConsent({
  offer,
  matches,
  onYes,
  onNo,
}: {
  offer: PackOffer;
  matches: number;
  onYes: () => void;
  onNo: () => void;
}) {
  const m = offer.manifest;
  return createPortal(
    <div className="modal-backdrop">
      <div className="panel modal consent" role="dialog" aria-label={t("Load a faction pack")}>
        <h3>
          {m.name} {m.version}
          {m.author ? ` · ${t("by {author}", { author: m.author })}` : ""} ·{" "}
          <code className="fp" title={offer.pkg.hash}>
            {fingerprint(offer.pkg.hash)}
          </code>
        </h3>
        <p className="muted small">
          {t("From {url}", { url: offer.url })}
          <br />
          {/* i18n-ignore */}
          SHA-256 <code>{offer.pkg.hash}</code>
        </p>
        {offer.status === "changed" && (
          <p className="warn">
            {t(
              "This link held a different file when you pinned it ({was}). Check what changed before you load it.",
              { was: fingerprint(offer.was ?? "") },
            )}
          </p>
        )}
        {m.adds && <p>{t("Adds: {what}", { what: m.adds })}</p>}
        <ul className="small">
          {contents(offer.pack).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="small">
          {tn(
            matches,
            "{n} rule in this army has a name it knows.",
            "{n} rules in this army have names it knows.",
          )}
        </p>
        <p className="muted small">
          {offer.code
            ? t(
                "It has code. In a game, that code runs in a sandbox: it can read the game and suggest results, but it can't reach the internet, your files or this page.",
              )
            : t("It is data only: nothing in it runs.")}
        </p>
        <div className="row">
          <button className="primary" onClick={onYes}>
            {t("Load it")}
          </button>
          <button onClick={onNo}>{t("Cancel")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Once an army is deployed: the packs it was made with whose code must run
 * join the game's rules packages, so every player runs the same bytes (and
 * gets the usual check and consent). The host turns them on; another player
 * asks the table.
 */
export function packsToGame(packs: ArmyPack[] | undefined): void {
  const lib = useLibrary.getState().packages;
  const have = (packs ?? []).flatMap((p) => (p.code && lib[p.hash]?.trusted ? [lib[p.hash]!] : []));
  const { game, role, mode, dispatch } = useStore.getState();
  const on = game.packages?.packages ?? [];
  if (!have.length || have.every((p) => on.some((r) => r.hash === p.hash))) return;
  if (role === "host" || mode === "hotseat") turnOnRules(game, have);
  else
    dispatch({
      type: "packages/propose",
      packages: [...on.filter((r) => !have.some((p) => p.manifest.id === r.id)), ...have.map(refOf)],
    });
}

/** "Bo's army was made with other bytes of Cinder Court": compare before playing, as with packages. */
export function PackChecks() {
  const armies = useStore((s) => s.game.armies);
  const players = useStore((s) => s.game.players);
  const pins = usePins((s) => s.pins);
  // Pinned packs apply to an army as it's read, so their bytes should be at hand by then.
  useEffect(() => void useLibrary.getState().load(), []);
  const off = packMismatches(
    armies ?? {},
    Object.values(pins).map((p) => ({ id: p.id, hash: p.hash })),
  );
  if (!off.length) return null;
  return (
    <>
      {off.map((m) => (
        <p key={`${m.player}/${m.pack.hash}`} className="warn small" role="alert">
          ⚠{" "}
          {t(
            "{player}'s army was made with {pack} {version} ({fp}), not {other}. Compare your packs before you play.",
            {
              player: playerName(players[m.player]) ?? m.player,
              pack: m.pack.name,
              version: m.pack.version,
              fp: fingerprint(m.pack.hash),
              other: fingerprint(m.other),
            },
          )}
        </p>
      ))}
    </>
  );
}
