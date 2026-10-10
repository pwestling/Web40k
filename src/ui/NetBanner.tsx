import { rankedOver } from "../core/ranked";
import { saveJson } from "./files";
import { displayName, playerName } from "../i18n/names";
import { useMemo, useState } from "react";
import type { NetStatus } from "../net/session";
import { PROTOCOL } from "../protocol";
import { APP_BUILD } from "../version";
import type { GameRecord } from "../core";
import { formatList, t } from "../i18n";
import { screenSeat, useJoining, useStore } from "../store";
import { untakenSeat } from "./Branch";
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
  // Someone still joining (or rejoining) would only read about their own empty seat.
  const joining = useJoining();
  const desyncSeq = net?.desync?.seq ?? null;
  const since = useMemo(() => {
    if (desyncSeq === null) return null;
    // The newest log line up to the mismatch, or the phase header when it was a phase change.
    const items = buildLog(record, desyncSeq).filter((l) => l.text);
    return items.at(-1)?.text ?? null;
  }, [desyncSeq, record]);
  if (!net || mode === "hotseat" || (joining && !net.desync)) return null;
  // A watcher whose game has ended: the host going is the table packing up (PX).
  if (net.migrating && net.role === "spectator" && rankedOver(useStore.getState().game)) return null;
  if (net.migrating)
    return <div className="net-banner">{t("Host disconnected: waiting for it, or for a new host…")}</div>;
  if (net.desync) {
    const host = net.hostId ? (playerName(players[net.hostId]) ?? null) : null;
    return (
      <div className="net-banner desync" role="alert">
        {host === null
          ? since
            ? t("Your table doesn't match the host's (since \"{since}\").", { since })
            : t("Your table doesn't match the host's.")
          : since
            ? t("Your table doesn't match {name}'s (since \"{since}\").", { name: host, since })
            : t("Your table doesn't match {name}'s.", { name: host })}{" "}
        <button className="primary" onClick={() => session?.resync()}>
          {t("Resync from host")}
        </button>
        {net.desync.count >= 2 && (
          <button onClick={() => downloadReport(record, net.desync!)}>{t("Report a problem")}</button>
        )}
      </div>
    );
  }
  if (net.otherBuilds.length && buildsKey(net) !== dismissed) return <OtherBuilds net={net} />;
  const gone = Object.values(players).filter(
    (p) => p.seat !== undefined && p.id !== selfId && !net.peers.includes(p.id) && !screenSeat(p.id),
  );
  // A review room watches a finished game: its players aren't expected back (UX 233).
  if (!gone.length || useStore.getState().review) return null;
  // A branch's seats nobody has taken yet are waiting for a guest, not reconnecting (UX 136).
  const open = gone.filter((p) => untakenSeat(record, p.id));
  if (open.length)
    return (
      <div className="net-banner">
        {t("Waiting for someone to take {names} ·", {
          names: formatList(open.map((p) => displayName(p.name))),
        })}{" "}
        <button onClick={() => void navigator.clipboard?.writeText(location.href)}>
          {t("Copy invite link")}
        </button>
      </div>
    );
  return (
    <div className="net-banner">
      {t("{names} reconnecting…", { names: formatList(gone.map((p) => displayName(p.name))) })}
    </div>
  );
}

/** The replay and both checksums, for whoever fixes the bug. */
function downloadReport(
  record: GameRecord,
  desync: { seq: number; host: number; mine: number; count: number },
) {
  const report = { kind: "open-battle/desync-report", desync, userAgent: navigator.userAgent, record };
  saveJson(`open-battle-desync-${desync.seq}.json`, report);
}

/** The other builds banner the player closed, so it stays closed until someone else turns up. */
let dismissed = "";
const buildsKey = (net: NetStatus) => net.otherBuilds.map((b) => `${b.peer}:${b.build}`).join(",");

/**
 * Another player runs a different build (docs/compatibility.md): a different
 * protocol can't keep the same table; a different build of the same protocol
 * usually can, but its rules may differ.
 */
function OtherBuilds({ net }: { net: NetStatus }) {
  const players = useStore((s) => s.game.players);
  const [, rerender] = useState(0);
  if (buildsKey(net) === dismissed) return null;
  const name = (peer: string) => playerName(players[peer]) ?? t("Someone");
  const broken = net.otherBuilds.filter((b) => b.protocol !== PROTOCOL);
  const first = (broken[0] ?? net.otherBuilds[0])!;
  return (
    <div
      className={broken.length ? "net-banner desync" : "net-banner"}
      role={broken.length ? "alert" : undefined}
    >
      {broken.length
        ? t(
            "{name} runs a version of Open Battle that can't play with yours ({theirs}; you have {mine}). Both of you should reload.",
            {
              name: name(first.peer),
              theirs: first.build,
              mine: APP_BUILD,
            },
          )
        : t(
            "{name} runs another version of Open Battle ({theirs}; you have {mine}). Rules may differ: reload to match.",
            {
              name: name(first.peer),
              theirs: first.build,
              mine: APP_BUILD,
            },
          )}{" "}
      <button
        onClick={() => {
          dismissed = buildsKey(net);
          rerender((n) => n + 1);
        }}
      >
        {t("Got it")}
      </button>
    </div>
  );
}
