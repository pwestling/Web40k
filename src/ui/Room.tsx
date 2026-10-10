import { displayName, playerName } from "../i18n/names";
import { useEffect, useMemo, useState } from "react";
import { untakenSeat } from "./Branch";
import type { Player } from "../core";
import { formatList, t, tn } from "../i18n";
import { serverHost, useHostPowers, useJoining, useStore } from "../store";
import { deployChecks } from "./deployment";
import { useTransfers } from "../packages/share";
import { RulesLine } from "./Packages";
import { NetCheck } from "./NetCheck";
import { NET_PARAMS } from "../net/config";
import { openSeats, PostTable } from "../opentables/OpenTables";
import { tableGone, useOpenTables } from "../opentables/board";

/** How long a guest looks for the host before we offer help (UX 169). */
const STUCK_MS = 8000;
/** A table joined from Open tables whose host doesn't answer by then has gone. */
const GONE_MS = 15_000;

/** A guest still looking for the host after a while: maybe an old link, maybe the network. */
function StillLooking() {
  const [stuck, setStuck] = useState(false);
  const roomId = useStore((s) => s.roomId);
  const fromBoard = useOpenTables((s) => s.joined?.join === roomId);
  useEffect(() => {
    const timer = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!fromBoard) return;
    // Joined from Open tables and nobody's there: back to the board, which says so (PX).
    const timer = setTimeout(() => {
      tableGone();
      const q = new URLSearchParams({ tables: "gone" });
      const here = new URLSearchParams(location.search);
      for (const k of NET_PARAMS) if (here.get(k)) q.set(k, here.get(k)!);
      window.location.assign(`${location.pathname}?${q}`);
    }, GONE_MS);
    return () => clearTimeout(timer);
  }, [fromBoard]);
  if (!stuck) return null;
  return (
    <div className="still-looking">
      <p>
        {t(
          "Still looking. The host may have closed their page, or the link is from an old game. If the host is there, your connection may be the problem:",
        )}
      </p>
      <NetCheck auto />
    </div>
  );
}

/** Whether an online room still has a seat nobody has taken (the invite matters then). */
export function useRoomWaiting(): boolean {
  const { roomId, mode, net, session, game, record } = useStore();
  if (!roomId || mode === "hotseat") return false;
  const peers = net?.peers ?? [];
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  return (
    seated.length < 2 ||
    seated.some((p) => !peers.includes(p.id) && p.id !== session?.selfId && untakenSeat(record, p.id))
  );
}

export const copyInvite = () => void navigator.clipboard?.writeText(location.href);

/**
 * The room: a big invite button while a seat is empty (then it moves to "⋯ Game"), and who is here: each player (connected,
 * you, or reconnecting), who is host, and how many are watching.
 */
export function RoomCard() {
  const { roomId, mode, net, session, game, record, review } = useStore();
  const server = useStore(serverHost);
  const chair = useHostPowers();
  const [copied, setCopied] = useState(false);
  const joining = useJoining();
  const posted = useOpenTables((s) => s.mine?.post.join === roomId);
  const peerMissing = useTransfers((s) => s.peerMissing);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!roomId || mode === "hotseat") return null;
  const selfId = session?.selfId;
  const seated = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!);
  // The site's host server hosts a served room: it is in the room but neither plays nor watches.
  const peers = (net?.peers ?? []).filter((id) => id !== server);
  const untaken = (p: Player) => !peers.includes(p.id) && p.id !== selfId && untakenSeat(record, p.id);
  const waiting = seated.length < 2 || seated.some(untaken);
  // Still receiving the game's rules packages (and not playing without them by choice).
  const fetching = (id: string) =>
    peers.includes(id) && (peerMissing[id]?.length ?? 0) > 0 && !game.players[id]?.rulesMismatch;
  const joiners = peers.filter((id) => !seated.some((p) => p.id === id) && fetching(id)).length;
  const watchers = peers.filter((id) => !seated.some((p) => p.id === id)).length;
  // A spectator's own screen isn't among its peers: count it too (UX 146).
  const watching = watchers - joiners + (net?.role === "spectator" ? 1 : 0);
  const reconnecting = (p: Player) => p.id !== selfId && !peers.includes(p.id) && !untaken(p);
  const state = (p: Player) =>
    p.id === selfId
      ? t("you")
      : peers.includes(p.id)
        ? t("connected")
        : untaken(p)
          ? t("waiting for someone to take this seat")
          : t("reconnecting…");
  return (
    <div className="room">
      <div className="row spread">
        <span className="muted">
          {t("Room")} <code>{roomId}</code>
          {mode === "local" ? ` ${t("(this browser)")}` : ""}
          {server ? ` · ${t("hosted by this site's server")}` : ""}
        </span>
        {(waiting || copied) && (
          <button
            className={waiting && !joining && !copied ? "primary" : copied ? "on" : ""}
            onClick={() => {
              copyInvite();
              setCopied(true);
            }}
          >
            {copied ? t("Copied ✓") : t("Copy invite link")}
          </button>
        )}
      </div>
      <RulesLine />
      {/* Open tables (#50): the host may put a waiting table on the public board. */}
      {mode === "online" && chair && !review && game.turn.round === 0 && (waiting || posted) && (
        <PostTable kind="live" join={roomId} seats={openSeats(game, record)} />
      )}
      {/* A review room replays a finished game: its players are the record's, not people here (UX 258). */}
      {review ? (
        <p className="muted small">
          {t("A replay, watched together. {names} played it.", {
            names: formatList(seated.map((p) => displayName(p.name))),
          })}
        </p>
      ) : (
        <ul className="people">
          {seated.map((p) => (
            <li key={p.id}>
              <span className="dot" style={{ background: p.color }} />
              <strong>{displayName(p.name)}</strong>{" "}
              <span className={reconnecting(p) ? "warn" : "muted"}>
                {state(p)}
                {net?.hostId === p.id ? ` · ${t("host")}` : ""}
                {game.turn.round === 0 && p.ready ? ` · ${t("ready")}` : ""}
                {fetching(p.id) ? ` · ${t("getting rules…")}` : ""}
              </span>
              {p.rulesMismatch && (
                <span
                  className="warn"
                  title={t("Playing without {rules}: their table may disagree", {
                    rules:
                      (game.packages?.packages ?? [])
                        .filter((r) => p.rulesMismatch!.includes(r.hash))
                        .map((r) => `${r.name} ${r.version}`)
                        .join(", ") || t("some of the game's rules"),
                  })}
                >
                  {" "}
                  {t("⚠ different rules")}
                </span>
              )}
            </li>
          ))}
          {joining ? (
            <li className="muted">
              {net?.hostId
                ? playerName(game.players[net.hostId])
                  ? t("Joining {name}'s game…", { name: game.players[net.hostId]!.name })
                  : t("Joining the host's game…")
                : t("Looking for the game's host…")}{" "}
              <button className="link" onClick={() => (location.href = location.pathname)}>
                {t("Back to the lobby")}
              </button>
              {!net?.hostId && <StillLooking />}
            </li>
          ) : (
            waiting && <li className="muted">{t("Waiting for an opponent to join…")}</li>
          )}
          {joiners > 0 && (
            <li className="muted">
              {tn(
                joiners,
                "Someone joining is getting the rules…",
                "{n} people joining are getting the rules…",
              )}
            </li>
          )}
          {watching > 0 && (
            <li className="muted">
              {net?.role === "spectator"
                ? tn(watching, "{n} watching (you included)", "{n} watching (you included)")
                : tn(watching, "{n} watching", "{n} watching")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * During deployment: each of the player's units still sitting where it
 * arrived, or standing outside the zone, with a click to pick it up; and
 * the player's Ready toggle.
 */
export function DeployTray({ players }: { players: Player[] }) {
  const { record, game, select, dispatch, mode } = useStore();
  const lists = useMemo(
    () => players.map((p) => ({ player: p, checks: deployChecks(record, game, p.id) })),
    [players, record, game],
  );
  if (game.turn.round !== 0) return null;
  return (
    <>
      {lists.map(({ player, checks }) => {
        if (!checks.length) return null;
        const todo = checks.filter((c) => c.untouched || c.outside);
        const reserves = checks.filter((c) => c.reserve).length;
        return (
          <div key={player.id} className="deploy-tray">
            <div className="row spread">
              <strong>
                {mode === "hotseat"
                  ? todo.length
                    ? tn(todo.length, "{name}: {n} to place", "{name}: {n} to place", {
                        name: displayName(player.name),
                      })
                    : t("{name}: All placed", { name: displayName(player.name) })
                  : todo.length
                    ? tn(todo.length, "{n} to place", "{n} to place")
                    : t("All placed")}
              </strong>
              <label title={t("Tell the other player you've finished deploying")}>
                <input
                  type="checkbox"
                  checked={!!player.ready}
                  onChange={(e) =>
                    dispatch({ type: "player/ready", player: player.id, ready: e.target.checked }, player.id)
                  }
                />{" "}
                {t("Ready")}
              </label>
            </div>
            {todo.length > 0 && (
              <ul className="tray">
                {todo.map((c) => (
                  <li key={c.unit.id}>
                    <button className="link" onClick={() => select(c.unit.id)}>
                      {c.unit.name}
                    </button>{" "}
                    <span className={c.outside ? "warn" : "muted"}>
                      {c.outside ? t("outside your zone") : t("not placed yet")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {reserves > 0 && (
              <p className="muted small">{tn(reserves, "{n} unit in reserve", "{n} units in reserve")}</p>
            )}
          </div>
        );
      })}
    </>
  );
}
