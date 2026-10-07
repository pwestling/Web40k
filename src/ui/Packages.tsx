import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_SYSTEM, type GamePackages, type PackageRef, type PlayerId } from "../core";
import { listSystems } from "../core/content";
import { fingerprint, formatBytes } from "../packages/manifest";
import { MAX_PEER_BYTES, packagesFor, useLibrary, type StoredPackage } from "../packages/library";
import { requestPackage, transferPercent, usePackageSharing, useTransfers } from "../packages/share";
import { useCanControl, useStore } from "../store";
import { APP_BUILD } from "../version";
import { describePackageChange } from "./gameLog";
import { useGame } from "./hooks";

/** The short fingerprint, monospace, with the full hash in a tooltip. */
function Fp({ hash }: { hash: string }) {
  return (
    <code className="fp" title={hash}>
      {fingerprint(hash)}
    </code>
  );
}

function label(p: { name: string; version: string; author?: string }) {
  return `${p.name} ${p.version}${p.author ? ` · by ${p.author}` : ""}`;
}

export function refOf(p: StoredPackage): PackageRef {
  const ref: PackageRef = {
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    hash: p.hash,
    bytes: p.bytes,
  };
  if (p.manifest.author) ref.author = p.manifest.author;
  return ref;
}

/** Read a picked file into the library; resolves with the stored package (still untrusted if new). */
async function loadFile(file: File, expect?: string): Promise<StoredPackage | string> {
  const added = await useLibrary.getState().add(await file.arrayBuffer(), { own: true, expect });
  return added.ok ? added.pkg : added.error;
}

/** "Load package…": a file picker that adds to the library and asks for consent before first use. */
function LoadButton({
  text = "Load package…",
  expect,
  onError,
  className,
}: {
  text?: string;
  expect?: string;
  onError?: (e: string) => void;
  className?: string;
}) {
  const [asking, setAsking] = useState<StoredPackage | null>(null);
  return (
    <>
      <label className={`file button ${className ?? ""}`}>
        {text}
        <input
          type="file"
          accept=".js,.mjs,.obpkg,text/javascript"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const got = await loadFile(file, expect);
            if (typeof got === "string") {
              if (onError) onError(got);
              else alert(got);
            } else if (!got.trusted) setAsking(got);
          }}
        />
      </label>
      {asking && <ConsentSheet pkg={asking} onClose={() => setAsking(null)} forget />}
    </>
  );
}

/**
 * Before a package's code may run on this device: what it is, what it adds
 * (from its manifest) and where it runs. Once per hash.
 */
export function ConsentSheet({
  pkg,
  onClose,
  forget,
}: {
  pkg: StoredPackage;
  onClose: () => void;
  /** Cancel removes it again (it was only just loaded). */
  forget?: boolean;
}) {
  // On the page itself: the lobby panel is transformed, which would trap a fixed sheet inside it.
  return createPortal(
    <div className="modal-backdrop">
      <div className="panel modal consent" role="dialog" aria-label="Load a rules package">
        <h3>
          {label(pkg.manifest)} · <Fp hash={pkg.hash} />
        </h3>
        {pkg.manifest.adds && <p>Adds: {pkg.manifest.adds}</p>}
        <p className="muted">
          This rules package contains code. It runs in a sandbox: it can read the game and suggest results,
          but it can't reach the internet, your files or this page.
        </p>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              useLibrary.getState().trust(pkg.hash, true);
              onClose();
            }}
          >
            Load it
          </button>
          <button
            onClick={() => {
              if (forget) useLibrary.getState().remove(pkg.hash);
              onClose();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The lobby's "Rules packages": built-in rules, then this device's packages for the chosen game. */
export function PackageLibrary({ system }: { system: string }) {
  const packages = useLibrary((s) => s.packages);
  const [all, setAll] = useState(false);
  useEffect(() => void useLibrary.getState().load(), []);
  const builtIn = listSystems().filter((s) => all || s.id === system);
  const shown = all ? packagesFor(packages, undefined) : packagesFor(packages, system);
  const hidden = Object.keys(packages).length - shown.length;
  return (
    <details className="packages">
      <summary>Rules packages</summary>
      <div className="row spread">
        <LoadButton />
        {(hidden > 0 || all) && (
          <button className="link" onClick={() => setAll(!all)}>
            {all ? "Only this game's" : `Show all (${hidden} more)`}
          </button>
        )}
      </div>
      <ul className="package-list">
        {builtIn.map((s) => (
          <li key={s.id}>
            {s.name} <span className="muted small">built in · app {APP_BUILD}</span>
          </li>
        ))}
        {shown.map((p) => (
          <PackageRow key={p.hash} pkg={p} />
        ))}
      </ul>
    </details>
  );
}

function PackageRow({ pkg }: { pkg: StoredPackage }) {
  const [details, setDetails] = useState(false);
  const [asking, setAsking] = useState(false);
  const lib = useLibrary.getState();
  return (
    <li>
      <div className="row spread">
        <span>
          {label(pkg.manifest)}
          {pkg.own ? " (yours)" : ""} <Fp hash={pkg.hash} />{" "}
          {pkg.trusted ? (
            <span className="muted small">trusted</span>
          ) : (
            <button className="link" onClick={() => setAsking(true)}>
              Trust…
            </button>
          )}
        </span>
        <details className="menu">
          <summary aria-label={`More for ${pkg.manifest.name}`}>⋯</summary>
          <div className="menu-items">
            <button onClick={() => setDetails(!details)}>Details</button>
            {pkg.trusted && <button onClick={() => lib.trust(pkg.hash, false)}>Stop trusting</button>}
            <button
              onClick={() =>
                confirm(`Remove ${pkg.manifest.name} ${pkg.manifest.version}?`) && lib.remove(pkg.hash)
              }
            >
              Remove
            </button>
          </div>
        </details>
      </div>
      {details && (
        <div className="muted small package-details">
          <div>
            SHA-256 <code>{pkg.hash}</code>{" "}
            <button className="link" onClick={() => void navigator.clipboard?.writeText(pkg.hash)}>
              Copy
            </button>
          </div>
          <div>
            {pkg.manifest.kind === "system" ? "Game system" : "Extension"} for{" "}
            {pkg.manifest.systems.join(", ") || "any game"} · API {pkg.manifest.api} ·{" "}
            {formatBytes(pkg.bytes)}
          </div>
          {pkg.manifest.adds && <div>Adds: {pkg.manifest.adds}</div>}
          {pkg.manifest.changelog && <div>Changes: {pkg.manifest.changelog}</div>}
        </div>
      )}
      {asking && <ConsentSheet pkg={pkg} onClose={() => setAsking(false)} />}
    </li>
  );
}

/**
 * Game settings: which rules packages this game uses, from the library. Before
 * the battle the host just ticks them; after it starts, a change is proposed
 * to the other players (§5), or applied at once in hotseat.
 */
export function GamePackagesSettings({ editable }: { editable: boolean }) {
  const game = useGame();
  const { dispatch, role, mode } = useStore();
  const packages = useLibrary((s) => s.packages);
  const [all, setAll] = useState(false);
  useEffect(() => void useLibrary.getState().load(), []);
  const using = game.packages?.packages ?? [];
  const [draft, setDraft] = useState<PackageRef[] | null>(null);
  const chosen = draft ?? using;
  const started = game.turn.round > 0;
  const canChoose = editable && (role === "host" || mode === "hotseat");
  const options = packagesFor(packages, all ? undefined : game.system);
  const names = listSystems().find((s) => s.id === game.system)?.name ?? game.system;
  const apply = (next: PackageRef[], agreed?: PlayerId[]) => {
    const event: GamePackages = {
      app: APP_BUILD,
      system: { id: game.system ?? DEFAULT_SYSTEM, builtIn: true },
      packages: next,
    };
    if (agreed) event.agreed = agreed;
    dispatch({ type: "game/packages", ...event });
  };
  const toggle = (p: StoredPackage, on: boolean) => {
    // One version of a package per game.
    const rest = chosen.filter((r) => r.id !== p.manifest.id);
    const next = on ? [...rest, refOf(p)] : rest;
    if (!started) apply(next);
    else setDraft(next);
  };
  const changed = draft !== null && describePackageChange(using, draft);
  if (!canChoose)
    return (
      <p className="muted small">
        Rules: {names} (built in)
        {using.length ? `, ${using.map((p) => `${p.name} ${p.version}`).join(", ")}` : ""}.
      </p>
    );
  return (
    <div className="game-packages">
      <strong className="small">Rules packages</strong>
      <label className="check muted">
        <input type="checkbox" checked disabled /> {names} (built in, always on)
      </label>
      {options.map((p) => (
        <label key={p.hash} className="check">
          <input
            type="checkbox"
            disabled={!!game.packageProposal}
            checked={chosen.some((r) => r.hash === p.hash)}
            onChange={(e) => toggle(p, e.target.checked)}
          />{" "}
          {label(p.manifest)} <Fp hash={p.hash} />
        </label>
      ))}
      {using
        .filter((r) => !options.some((p) => p.hash === r.hash))
        .map((r) => (
          <label key={r.hash} className="check">
            <input type="checkbox" checked disabled /> {label(r)} <Fp hash={r.hash} />
          </label>
        ))}
      <div className="row">
        <LoadButton />
        {!all && Object.keys(packages).length > options.length && (
          <button className="link" onClick={() => setAll(true)}>
            Show all
          </button>
        )}
      </div>
      {started && changed && (
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              if (mode === "hotseat") {
                const seated = Object.values(game.players)
                  .filter((p) => p.seat !== undefined)
                  .map((p) => p.id);
                apply(draft!, seated);
              } else dispatch({ type: "packages/propose", packages: draft! });
              setDraft(null);
            }}
          >
            {mode === "hotseat" ? "Change the rules" : "Ask to change the rules"}
          </button>
          <button onClick={() => setDraft(null)}>Cancel</button>
          <span className="muted small">{changed}</span>
        </div>
      )}
    </div>
  );
}

/** The room card's "Rules: Old World · Old World Factions 1.2 ✓". */
export function RulesLine() {
  const game = useGame();
  const packages = useLibrary((s) => s.packages);
  const name = listSystems().find((s) => s.id === game.system)?.name ?? game.system;
  const using = game.packages?.packages ?? [];
  return (
    <span className="muted small rules-line">
      Rules: {name}
      {using.map((p) => {
        const have = !!packages[p.hash];
        return (
          <span key={p.hash} title={have ? `${label(p)} · ${fingerprint(p.hash)}` : "Not on this device"}>
            {" · "}
            {p.name} {p.version} {have ? "✓" : <span className="warn">⚠</span>}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Everything about packages that needs the player mid-game: the missing or
 * different-version card on joining (§3), consent for code that arrived, the
 * mid-game change card (§5), and the note on a replay (§4). Also answers
 * other peers' requests for packages, and (as host) applies a change once
 * every seated player has accepted it.
 */
export function PackageCards() {
  usePackageSharing();
  useEffect(() => void useLibrary.getState().load(), []);
  const game = useStore((s) => s.game);
  const role = useStore((s) => s.role);
  const session = useStore((s) => s.session);
  const net = useStore((s) => s.net);
  const loaded = useLibrary((s) => s.loaded);
  const isReplay = !session && role === "spectator";
  const isHost = net?.role === "host" || (!net && role === "host");
  useApplyAgreed(isHost);
  if (!loaded) return null;
  return (
    <>
      {game.packages && <MismatchCard game={game.packages} replay={isReplay} />}
      {game.packageProposal && !isReplay && <ProposalCard />}
    </>
  );
}

function useApplyAgreed(isHost: boolean) {
  const proposal = useStore((s) => s.game.packageProposal);
  const players = useStore((s) => s.game.players);
  const system = useStore((s) => s.game.system);
  const dispatch = useStore((s) => s.dispatch);
  useEffect(() => {
    if (!isHost || !proposal) return;
    const seated = Object.values(players)
      .filter((p) => p.seat !== undefined)
      .map((p) => p.id);
    if (!seated.every((id) => proposal.accepted.includes(id))) return;
    dispatch({
      type: "game/packages",
      app: APP_BUILD,
      system: { id: system ?? DEFAULT_SYSTEM, builtIn: true },
      packages: proposal.packages,
      agreed: seated,
    });
  }, [isHost, proposal, players, system, dispatch]);
}

function MismatchCard({ game, replay }: { game: GamePackages; replay: boolean }) {
  const library = useLibrary((s) => s.packages);
  const transfers = useTransfers((s) => s.byHash);
  const { role, mode, roomId, net, start, session, game: state } = useStore();
  // Hashes this player chose to go without ("Join with mine anyway", "Watch without it").
  const [without, setWithout] = useState<Record<string, true>>({});
  const [trustSender, setTrustSender] = useState(true);
  const [consent, setConsent] = useState<StoredPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostName = net?.hostId ? (state.players[net.hostId]?.name ?? "the host") : "the host";
  const missing = game.packages.filter((p) => !library[p.hash] && !without[p.hash]);
  const fresh = game.packages.filter((p) => library[p.hash] && !library[p.hash]!.trusted && !without[p.hash]);
  const canGet = !replay && !!net?.hostId && net.hostId !== session?.selfId;
  const checked = game.packages.filter((p) => transfers[p.hash]?.state === "checked");
  const anyChecked = checked.length > 0 && !missing.length && !fresh.length;
  // A little "Checked ✓" before the card closes.
  const [shownDone, setShownDone] = useState(false);
  useEffect(() => {
    if (!anyChecked) return;
    const t = setTimeout(() => setShownDone(true), 1500);
    return () => clearTimeout(t);
  }, [anyChecked]);
  if (!missing.length && !fresh.length && (!anyChecked || shownDone)) return null;
  const watch = () => {
    if (role === "spectator" || replay)
      setWithout((w) => ({ ...w, ...Object.fromEntries(missing.map((p) => [p.hash, true] as const)) }));
    else
      start({
        role: "spectator",
        mode,
        roomId: roomId ?? undefined,
        name: localStorage.getItem("open-battle:name") ?? "",
      });
  };
  const get = (p: PackageRef) => {
    setError(null);
    requestPackage(p.hash, { trust: trustSender });
  };
  return (
    <div className="round-card package-card" role="alertdialog" aria-label="Rules packages">
      {replay ? (
        <strong>This replay used rules that aren't on this device</strong>
      ) : missing.some((p) => !otherVersion(library, p)) ? (
        <strong>This game uses rules you don't have</strong>
      ) : missing.length ? (
        <strong>You have a different version of a package this game uses</strong>
      ) : fresh.length ? (
        <strong>New rules packages arrived</strong>
      ) : (
        <strong>Rules packages ready</strong>
      )}
      {missing.map((p) => {
        const mine = otherVersion(library, p);
        const t = transfers[p.hash];
        const tooBig = p.bytes > MAX_PEER_BYTES;
        return (
          <div key={p.hash} className="package-need">
            {mine ? (
              <>
                <div>
                  Game: {p.name} {p.version} <Fp hash={p.hash} />
                </div>
                <div>
                  Yours: {mine.manifest.name} {mine.manifest.version} <Fp hash={mine.hash} />
                </div>
              </>
            ) : (
              <div>
                {label(p)} · <Fp hash={p.hash} /> · {formatBytes(p.bytes)}
              </div>
            )}
            {t?.state === "asking" || t?.state === "receiving" ? (
              <div className="progress" aria-label="Receiving">
                <span>
                  Receiving from {hostName}… {transferPercent(t)}%
                </span>
                <span className="bar" style={{ width: `${transferPercent(t)}%` }} />
              </div>
            ) : (
              <div className="row wrap">
                {t?.state === "failed" && (
                  <span className="warn">That didn't match what the game expects.</span>
                )}
                {canGet && !tooBig && (
                  <button className="primary" onClick={() => get(p)}>
                    {t?.state === "failed"
                      ? "Try again"
                      : mine
                        ? "Use the game's version"
                        : `Get it from ${hostName}`}
                  </button>
                )}
                {canGet && tooBig && (
                  <span className="muted">Too big to send ({formatBytes(p.bytes)}): load it from a file</span>
                )}
                <LoadButton
                  text="Load from file…"
                  expect={p.hash}
                  className={!canGet || tooBig ? "primary" : ""}
                  onError={setError}
                />
                {mine && role !== "spectator" && !replay && (
                  <button onClick={() => setWithout((w) => ({ ...w, [p.hash]: true }))}>
                    Join with mine anyway
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <span className="warn">{error}</span>}
      {canGet && missing.length > 0 && (
        <label className="check small">
          <input type="checkbox" checked={trustSender} onChange={(e) => setTrustSender(e.target.checked)} />{" "}
          Trust packages {hostName} sends for this game
        </label>
      )}
      {fresh.map((p) => (
        <div key={p.hash} className="row wrap">
          <span>
            {label(p)} <Fp hash={p.hash} /> needs your OK to run.
          </span>
          <button className="primary" onClick={() => setConsent(library[p.hash]!)}>
            Review…
          </button>
        </div>
      ))}
      {checked.map((p) => (
        <span key={p.hash} className="muted small">
          {p.name} {p.version}: Checked ✓ <Fp hash={p.hash} />
        </span>
      ))}
      {missing.length > 0 && (
        <div className="row">
          {replay ? (
            <button onClick={watch}>Watch without it</button>
          ) : (
            <button onClick={watch}>{role === "spectator" ? "Watch without it" : "Watch instead"}</button>
          )}
        </div>
      )}
      {replay && missing.length > 0 && (
        <span className="muted small">
          Without it, moves, dice and results still play; rule hints that need the package are off.
        </span>
      )}
      {consent && <ConsentSheet pkg={consent} onClose={() => setConsent(null)} />}
    </div>
  );
}

function otherVersion(library: Record<string, StoredPackage>, p: PackageRef): StoredPackage | undefined {
  return Object.values(library)
    .filter((l) => l.manifest.id === p.id && l.hash !== p.hash)
    .sort((a, b) => b.addedAt - a.addedAt)[0];
}

/** §5: "Player 1 wants to change the rules for this game", with Accept and Decline. */
function ProposalCard() {
  const game = useGame();
  const { dispatch, scrub } = useStore();
  const canControl = useCanControl();
  const library = useLibrary((s) => s.packages);
  const proposal = game.packageProposal!;
  const by = game.players[proposal.by]?.name ?? "A player";
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  const mineToAnswer = seated.filter(
    (p) =>
      canControl(p.id) &&
      p.id !== proposal.by &&
      !proposal.accepted.includes(p.id) &&
      !proposal.declined.includes(p.id),
  );
  const waiting = seated.filter(
    (p) => !proposal.accepted.includes(p.id) && !proposal.declined.includes(p.id),
  );
  const declined = seated.filter((p) => proposal.declined.includes(p.id));
  const change = useMemo(
    () => describePackageChange(game.packages?.packages ?? [], proposal.packages),
    [game.packages, proposal.packages],
  );
  const changelog = proposal.packages
    .map((r) => library[r.hash]?.manifest.changelog)
    .filter(Boolean)
    .join(" ");
  if (scrub !== null) return null;
  if (mineToAnswer.length)
    return (
      <div className="round-card package-card" role="alertdialog" aria-label="Rules change">
        <strong>{by} wants to change the rules for this game</strong>
        <span>{change || "Same packages"}</span>
        {changelog && <span className="muted small">{changelog}</span>}
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              // Fetch what we'll need now, so the change applies without a wait.
              for (const r of proposal.packages) requestPackage(r.hash);
              for (const p of mineToAnswer) dispatch({ type: "packages/accept" }, p.id);
            }}
          >
            Accept
          </button>
          <button onClick={() => mineToAnswer.forEach((p) => dispatch({ type: "packages/decline" }, p.id))}>
            Decline
          </button>
        </div>
      </div>
    );
  if (!canControl(proposal.by)) return null;
  return (
    <div className="round-card package-card" role="status">
      <strong>Rules change: {change || "same packages"}</strong>
      {declined.length > 0 ? (
        <span className="warn">{declined.map((p) => p.name).join(" and ")} declined.</span>
      ) : (
        <span className="muted">Waiting for {waiting.map((p) => p.name).join(" and ") || "the host"}</span>
      )}
      <div className="row">
        <button onClick={() => dispatch({ type: "packages/withdraw" }, proposal.by)}>
          {declined.length ? "OK" : "Withdraw"}
        </button>
      </div>
    </div>
  );
}
