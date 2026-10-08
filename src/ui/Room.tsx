import { useEffect, useMemo, useState } from "react";
import { untakenSeat } from "./Branch";
import type { Player } from "../core";
import { useJoining, useStore } from "../store";
import { deployChecks } from "./deployment";
import { useTransfers } from "../packages/share";
import { RulesLine } from "./Packages";
import { NetCheck } from "./NetCheck";

/** How long a guest looks for the host before we offer help (UX 169). */
const STUCK_MS = 8000;

/** A guest still looking for the host after a while: maybe an old link, maybe the network. */
function StillLooking() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(t);
  }, []);
  if (!stuck) return null;
  return (
    <div className="still-looking">
      <p>
        Still looking. The host may have closed their page, or the link is from an old game. If the host is
        there, your connection may be the problem:
      </p>
      <NetCheck auto />
    </div>
  );
}

/**
 * The room: a big invite button, and who is here: each player (connected,
 * you, or reconnecting), who is host, and how many are watching.
 */
export function RoomCard() {
  const { roomId, mode, net, session, game, record } = useStore();
  const [copied, setCopied] = useState(false);
  const joining = useJoining();
  const peerMissing = useTransfers((s) => s.peerMissing);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  if (!roomId || mode === "hotseat") return null;
  const selfId = session?.selfId;
  const seated = Object.values(game.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!);
  const peers = net?.peers ?? [];
  const untaken = (p: Player) => !peers.includes(p.id) && p.id !== selfId && untakenSeat(record, p.id);
  const waiting = seated.length < 2 || seated.some(untaken);
  // Still receiving the game's rules packages (and not playing without them by choice).
  const fetching = (id: string) =>
    peers.includes(id) && (peerMissing[id]?.length ?? 0) > 0 && !game.players[id]?.rulesMismatch;
  const joiners = peers.filter((id) => !seated.some((p) => p.id === id) && fetching(id)).length;
  const watchers = peers.filter((id) => !seated.some((p) => p.id === id)).length;
  // A spectator's own screen isn't among its peers: count it too (UX 146).
  const watching = watchers - joiners + (net?.role === "spectator" ? 1 : 0);
  const state = (p: Player) =>
    p.id === selfId
      ? "you"
      : peers.includes(p.id)
        ? "connected"
        : untaken(p)
          ? "waiting for someone to take this seat"
          : "reconnecting…";
  return (
    <div className="room">
      <div className="row spread">
        <span className="muted">
          Room <code>{roomId}</code>
          {mode === "local" ? " (this browser)" : ""}
        </span>
        <button
          className={waiting && !joining && !copied ? "primary" : copied ? "on" : ""}
          onClick={() => {
            void navigator.clipboard?.writeText(location.href);
            setCopied(true);
          }}
        >
          {copied ? "Copied ✓" : "Copy invite link"}
        </button>
      </div>
      <RulesLine />
      <ul className="people">
        {seated.map((p) => (
          <li key={p.id}>
            <span className="dot" style={{ background: p.color }} />
            <strong>{p.name}</strong>{" "}
            <span className={state(p) === "reconnecting…" ? "warn" : "muted"}>
              {state(p)}
              {net?.hostId === p.id ? " · host" : ""}
              {game.turn.round === 0 && p.ready ? " · ready" : ""}
              {fetching(p.id) ? " · getting rules…" : ""}
            </span>
            {p.rulesMismatch && (
              <span
                className="warn"
                title={`Playing without ${
                  (game.packages?.packages ?? [])
                    .filter((r) => p.rulesMismatch!.includes(r.hash))
                    .map((r) => `${r.name} ${r.version}`)
                    .join(", ") || "some of the game's rules"
                }: their table may disagree`}
              >
                {" "}
                ⚠ different rules
              </span>
            )}
          </li>
        ))}
        {joining ? (
          <li className="muted">
            {net?.hostId
              ? `Joining ${game.players[net.hostId]?.name || "the host"}'s game…`
              : "Looking for the game's host…"}{" "}
            <button className="link" onClick={() => (location.href = location.pathname)}>
              Back to the lobby
            </button>
            {!net?.hostId && <StillLooking />}
          </li>
        ) : (
          waiting && <li className="muted">Waiting for an opponent to join…</li>
        )}
        {joiners > 0 && (
          <li className="muted">
            {joiners === 1 ? "Someone joining is" : `${joiners} people joining are`} getting the rules…
          </li>
        )}
        {watching > 0 && (
          <li className="muted">
            {watching} watching{net?.role === "spectator" ? " (you included)" : ""}
          </li>
        )}
      </ul>
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
                {mode === "hotseat" ? `${player.name}: ` : ""}
                {todo.length ? `${todo.length} to place` : "All placed"}
              </strong>
              <label title="Tell the other player you've finished deploying">
                <input
                  type="checkbox"
                  checked={!!player.ready}
                  onChange={(e) =>
                    dispatch({ type: "player/ready", player: player.id, ready: e.target.checked }, player.id)
                  }
                />{" "}
                Ready
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
                      {c.outside ? "outside your zone" : "not placed yet"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {reserves > 0 && (
              <p className="muted small">
                {reserves} unit{reserves === 1 ? "" : "s"} in reserve
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
