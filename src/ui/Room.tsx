import { useEffect, useMemo, useState } from "react";
import type { Player } from "../core";
import { useStore } from "../store";
import { deployChecks } from "./deployment";
import { RulesLine } from "./Packages";

/**
 * The room: a big invite button, and who is here: each player (connected,
 * you, or reconnecting), who is host, and how many are watching.
 */
export function RoomCard() {
  const { roomId, mode, net, session, game } = useStore();
  const [copied, setCopied] = useState(false);
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
  const watching = peers.filter((id) => !seated.some((p) => p.id === id)).length;
  const waiting = seated.length < 2;
  const state = (p: Player) =>
    p.id === selfId ? "you" : peers.includes(p.id) ? "connected" : "reconnecting…";
  return (
    <div className="room">
      <div className="row spread">
        <span className="muted">
          Room <code>{roomId}</code>
          {mode === "local" ? " (this browser)" : ""}
        </span>
        <button
          className={waiting && !copied ? "primary" : copied ? "on" : ""}
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
            </span>
          </li>
        ))}
        {waiting && <li className="muted">Waiting for an opponent to join…</li>}
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
