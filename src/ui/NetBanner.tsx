import { useMemo } from "react";
import type { GameRecord } from "../core";
import { useStore } from "../store";
import { buildLog } from "./gameLog";

/**
 * Says when the connection is in trouble: a seated player has dropped (and
 * may be reloading), the host has gone and the room is picking a new one,
 * or this table no longer matches the host's (the state checksums differ).
 */
export function NetBanner() {
  const net = useStore((s) => s.net);
  const mode = useStore((s) => s.mode);
  const players = useStore((s) => s.game.players);
  const record = useStore((s) => s.record);
  const session = useStore((s) => s.session);
  const selfId = session?.selfId;
  const desyncSeq = net?.desync?.seq ?? null;
  const since = useMemo(() => {
    if (desyncSeq === null) return null;
    const line = buildLog(record).find((l) => l.kind === "line" && l.seq === desyncSeq);
    return line?.kind === "line" ? line.text : null;
  }, [desyncSeq, record]);
  if (!net || mode === "hotseat") return null;
  if (net.migrating)
    return <div className="net-banner">Host disconnected: waiting for it, or for a new host…</div>;
  if (net.desync) {
    const host = net.hostId ? (players[net.hostId]?.name ?? "the host") : "the host";
    return (
      <div className="net-banner desync" role="alert">
        Your table doesn't match {host === "the host" ? "the host's" : `${host}'s`}
        {since ? ` (since "${since}")` : ""}.{" "}
        <button className="primary" onClick={() => session?.resync()}>
          Resync from host
        </button>
        {net.desync.count >= 2 && (
          <button onClick={() => downloadReport(record, net.desync!)}>Report a problem</button>
        )}
      </div>
    );
  }
  const gone = Object.values(players).filter(
    (p) => p.seat !== undefined && p.id !== selfId && !net.peers.includes(p.id),
  );
  if (!gone.length) return null;
  return <div className="net-banner">{gone.map((p) => p.name).join(" and ")} reconnecting…</div>;
}

/** The replay and both checksums, for whoever fixes the bug. */
function downloadReport(
  record: GameRecord,
  desync: { seq: number; host: number; mine: number; count: number },
) {
  const report = { kind: "open-battle/desync-report", desync, userAgent: navigator.userAgent, record };
  const blob = new Blob([JSON.stringify(report)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `open-battle-desync-${desync.seq}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
