import { useState } from "react";
import { branchRecord, sha256Hex, stateAt, type GameRecord } from "../core";
import { currentSlot } from "../core/content/turn";
import { buildLog } from "./gameLog";
import { NET_PARAMS } from "../net/config";
import { t, gameText } from "../i18n";
import { useStore, type Mode } from "../store";

/**
 * "What if": start a new game from a point in this one's history (core/branch.ts),
 * on this screen or hosted for someone to join. The parent game is left as it was.
 */
export function branchGame(seq: number, mode: Mode): void {
  const { record, start, session, mode: was, roomId: wasRoom } = useStore.getState();
  keepOriginal({ record, mode: session ? was : null, roomId: wasRoom, savedAt: Date.now() });
  const branched = branchRecord(record, seq, "", momentAt(record, seq));
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
      <button title={t("Start a new game from this point")} onClick={() => setOpen(!open)}>
        {t("What if…")}
      </button>
      {open && (
        <div className="panel branch-menu" role="menu">
          <strong>{t("Play on from here")}</strong>
          <span className="muted small">{t("A new game from this moment. This one stays as it is.")}</span>
          <button role="menuitem" className="primary" onClick={() => branchGame(seq, "hotseat")}>
            {t("On this screen")}
          </button>
          <button role="menuitem" onClick={() => branchGame(seq, "online")}>
            {t("Invite someone")}
          </button>
        </div>
      )}
    </span>
  );
}

/** "round 1, Shooting, just after Line Troopers shot Ashen Thralls": the point a branch starts from (UX 137). */
function momentAt(record: GameRecord, seq: number): string {
  const state = stateAt(record, seq);
  const phase = currentSlot(state)?.name;
  const last = [...buildLog(record, seq)].reverse().find((l) => l.kind === "line" && !l.undone && l.text);
  const when = state.turn.round
    ? phase
      ? t("round {round}, {phase}", { round: state.turn.round, phase: gameText(phase) })
      : t("round {round}", { round: state.turn.round })
    : t("deployment");
  return last ? t("{when}, just after {what}", { when, what: last.text }) : when;
}

/**
 * The game a branch came from, kept so it isn't lost (UX 135): starting the
 * branch replaces this browser's saved game, so the original goes here and
 * "Back to the original" opens it again.
 */
interface Original {
  record: GameRecord;
  /** How it was being played, or null for a replay. */
  mode: Mode | null;
  roomId: string | null;
  savedAt: number;
}
const ORIGINAL_KEY = "open-battle:branch-original";

function keepOriginal(o: Original) {
  try {
    localStorage.setItem(ORIGINAL_KEY, JSON.stringify(o));
  } catch {
    // Too big for storage: the parent is still in the replay file or the room.
  }
}

function loadOriginal(): Original | null {
  try {
    const raw = localStorage.getItem(ORIGINAL_KEY);
    return raw ? (JSON.parse(raw) as Original) : null;
  } catch {
    return null;
  }
}

/** In a branch: go back to the game it came from, as it was being played (or as a replay). */
export function BackToOriginal() {
  const record = useStore((s) => s.record);
  const first = record.events[0]?.event;
  const original = first?.type === "game/branch" ? loadOriginal() : null;
  if (!original || first?.type !== "game/branch") return null;
  if (sha256Hex(JSON.stringify(original.record)) !== first.branch.parentHash) return null;
  const back = () => {
    const { start, openReplay } = useStore.getState();
    const name = localStorage.getItem("open-battle:name") ?? "";
    if (!original.mode) openReplay(original.record);
    else
      start({
        role: "host",
        mode: original.mode,
        roomId: original.roomId ?? undefined,
        name,
        record: original.record,
      });
  };
  return (
    <button title={t("Open the game this one branched from")} onClick={back}>
      {t("Back to the original")}
    </button>
  );
}

/** A seat a branch started with that nobody has taken yet: the parent's player, not someone reconnecting (UX 136). */
export function untakenSeat(record: GameRecord, player: string): boolean {
  return record.events[0]?.event.type === "game/branch" && !!record.initial.players[player];
}
