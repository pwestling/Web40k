import { useStore } from "../store";

/**
 * Says when the connection is in trouble: a seated player has dropped (and
 * may be reloading), or the host has gone and the room is picking a new one.
 */
export function NetBanner() {
  const net = useStore((s) => s.net);
  const mode = useStore((s) => s.mode);
  const players = useStore((s) => s.game.players);
  const selfId = useStore((s) => s.session?.selfId);
  if (!net || mode === "hotseat") return null;
  if (net.migrating)
    return <div className="net-banner">Host disconnected: waiting for it, or for a new host…</div>;
  const gone = Object.values(players).filter(
    (p) => p.seat !== undefined && p.id !== selfId && !net.peers.includes(p.id),
  );
  if (!gone.length) return null;
  return <div className="net-banner">{gone.map((p) => p.name).join(" and ")} reconnecting…</div>;
}
