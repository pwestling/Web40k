import { useState } from "react";
import { branchRecord } from "../core";
import { NET_PARAMS } from "../net/config";
import { useStore, type Mode } from "../store";

/**
 * "What if": start a new game from a point in this one's history (core/branch.ts),
 * on this screen or hosted for someone to join. The parent game is left as it was.
 */
export function branchGame(seq: number, mode: Mode): void {
  const { record, start } = useStore.getState();
  const branched = branchRecord(record, seq);
  const name = localStorage.getItem("open-battle:name") ?? "";
  if (mode === "hotseat") {
    history.replaceState(null, "", location.pathname + location.search.replace(/([?&])room=[^&]*&?/, "$1"));
    start({ role: "host", mode, name, record: branched });
    return;
  }
  const roomId = crypto.randomUUID().slice(0, 8);
  const params = new URLSearchParams(location.search);
  const q = new URLSearchParams({ room: roomId });
  for (const k of NET_PARAMS) if (params.get(k)) q.set(k, params.get(k)!);
  history.replaceState(null, "", `?${q}`);
  start({ role: "host", mode, roomId, name, record: branched });
}

/** The replay bar's "What if…": pick hotseat or an invite, then branch at `seq`. */
export function BranchButton({ seq }: { seq: number }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="branch-button">
      <button title="Start a new game from this point" onClick={() => setOpen(!open)}>
        What if…
      </button>
      {open && (
        <div className="panel branch-menu" role="menu">
          <strong>Play on from here</strong>
          <span className="muted small">A new game from this moment. This one stays as it is.</span>
          <button role="menuitem" className="primary" onClick={() => branchGame(seq, "hotseat")}>
            On this screen
          </button>
          <button role="menuitem" onClick={() => branchGame(seq, "online")}>
            Invite someone
          </button>
        </div>
      )}
    </span>
  );
}
