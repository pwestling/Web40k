import { useEffect, useMemo, useState } from "react";
import { undoneSeqs, type GameRecord } from "../core";
import { buildLog } from "./gameLog";
import { useCanControl, useStore } from "../store";
import { ArmyImport } from "./ArmyImport";
import { GameSettings } from "./GameSettings";

/** The left panel: room, players, army import, dice, undo and the game log. */
export function Hud() {
  const {
    record,
    session,
    roomId,
    dispatch,
    view,
    setView,
    resetView,
    mode,
    role,
    game: liveGame,
    scrub,
    editing,
    xray,
    plates,
    set,
  } = useStore();
  const canControl = useCanControl();
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  const [collapsed, setCollapsed] = useState(false);
  const [dice, setDice] = useState(false);
  const undone = undoneSeqs(record);
  // Starting the battle (or any later phase change) locks the terrain again.
  const round = liveGame.turn.round;
  useEffect(() => {
    if (round > 0) useStore.getState().set({ editing: false, selectedTerrain: null });
  }, [round, liveGame.turn.phase]);
  const log = useMemo(() => buildLog(record, scrub ?? Infinity), [record, scrub]);
  const selfId = session?.selfId;
  const seated = Object.values(liveGame.players).filter((p) => p.seat !== undefined);
  const mine = seated.filter((p) => canControl(p.id));
  const lastOwn = [...record.events]
    .reverse()
    .find(
      (e) =>
        (mode === "hotseat" || e.by === selfId) &&
        e.event.type !== "undo" &&
        e.event.type !== "player/join" &&
        e.event.type !== "layout/set" &&
        !undone.has(e.seq),
    );
  const amSeated = mode === "hotseat" || seated.some((p) => p.id === selfId);

  if (collapsed)
    return (
      <div className="panel hud collapsed">
        <button onClick={() => setCollapsed(false)}>☰ Menu</button>
      </div>
    );

  return (
    <div className="panel hud">
      <div className="row spread">
        <strong>Open Battle</strong>
        <button onClick={() => setCollapsed(true)}>Hide</button>
      </div>
      {roomId && (
        <p className="muted">
          Room <code>{roomId}</code>
          {mode === "local" ? " (this browser)" : ""} ·{" "}
          <button className="link" onClick={() => void navigator.clipboard?.writeText(location.href)}>
            copy invite link
          </button>
        </p>
      )}
      {mode === "hotseat" && <p className="muted">Hotseat: you control both sides.</p>}
      {role === "spectator" && <p className="muted">Spectating.</p>}
      <div className="row wrap">
        <button onClick={() => setView(view === "top" ? "3d" : "top")}>
          {view === "top" ? "3D view" : "Top-down view"}
        </button>
        <button onClick={resetView} title="Home">
          Reset view
        </button>
        <button className={plates ? "on" : ""} onClick={() => set({ plates: !plates })}>
          Unit names
        </button>
        <button className={xray ? "on" : ""} onClick={() => set({ xray: !xray })}>
          X-ray terrain
        </button>
        {role !== "spectator" && (
          <button
            className={editing ? "on" : ""}
            onClick={() => {
              // Terrain is locked once the battle starts; changing it then takes a confirm.
              if (
                !editing &&
                liveGame.turn.round > 0 &&
                !confirm("The battle has started. Unlock the terrain? Every change shows in the log.")
              )
                return;
              set({ editing: !editing, selectedTerrain: null });
            }}
          >
            {editing ? "Done editing" : liveGame.turn.round > 0 ? "Unlock terrain" : "Edit terrain"}
          </button>
        )}
      </div>
      <GameSettings />

      {role === "client" && !amSeated && seated.length >= 2 && (
        <div className="claim">
          <p className="muted">Both seats are taken. Rejoining? Take back your seat:</p>
          {seated.map((p) => (
            <button key={p.id} onClick={() => dispatch({ type: "player/claim", player: p.id })}>
              Play as {p.name}
            </button>
          ))}
        </div>
      )}
      {role === "host" && seated.length < 2 && mode !== "hotseat" && (
        <p className="muted">Waiting for an opponent to join…</p>
      )}

      {/* During the battle, setup tools and the dice tray fold away to keep the panel slim. */}
      {mine.length > 0 &&
        (round === 0 ? (
          <ArmyImport players={mine} />
        ) : (
          <details className="fold">
            <summary>Add an army</summary>
            <ArmyImport players={mine} />
          </details>
        ))}

      {role !== "spectator" && (
        <div className="row">
          <button
            disabled={!lastOwn}
            title={lastOwn ? "Take back your last action" : ""}
            onClick={() => lastOwn && dispatch({ type: "undo", seq: lastOwn.seq })}
          >
            Undo
          </button>
          <button className={dice ? "on" : ""} onClick={() => setDice(!dice)}>
            Dice
          </button>
        </div>
      )}
      {role !== "spectator" && dice && (
        <div className="row">
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <span>D</span>
          <select value={sides} onChange={(e) => setSides(Number(e.target.value))}>
            {[3, 6, 8, 10, 12, 20].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button onClick={() => dispatch({ type: "dice/roll", count, sides })}>Roll</button>
        </div>
      )}
      <ol className="log">
        {log
          .slice(-60)
          .reverse()
          .map((item) =>
            item.kind === "header" ? (
              <li key={`h${item.key}`} className="phase">
                {item.text}
              </li>
            ) : (
              <li key={item.key} className={item.undone ? "undone" : undefined}>
                {item.text}
              </li>
            ),
          )}
      </ol>
      <button onClick={() => downloadReplay(record)}>Download replay</button>
    </div>
  );
}

function downloadReplay(record: GameRecord) {
  const blob = new Blob([JSON.stringify(record)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `open-battle-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
