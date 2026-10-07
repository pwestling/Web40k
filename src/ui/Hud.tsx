import { useState } from "react";
import { undoneSeqs, type GameRecord, type GameState, type LoggedEvent } from "../core";
import { useCanControl, useStore } from "../store";
import { ArmyImport } from "./ArmyImport";
import { useGame } from "./hooks";

/** The left panel: room, players, army import, dice, undo and the game log. */
export function Hud() {
  const {
    record,
    session,
    roomId,
    dispatch,
    view,
    setView,
    mode,
    role,
    game: liveGame,
    scrub,
    editing,
    xray,
    set,
  } = useStore();
  const game = useGame();
  const canControl = useCanControl();
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  const [collapsed, setCollapsed] = useState(false);
  const undone = undoneSeqs(record);
  const nameOf = (id: string) => game.players[id]?.name ?? "Someone";
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
        <button className={xray ? "on" : ""} onClick={() => set({ xray: !xray })}>
          X-ray terrain
        </button>
        {role !== "spectator" && (
          <button
            className={editing ? "on" : ""}
            onClick={() => set({ editing: !editing, selectedTerrain: null })}
          >
            Edit terrain
          </button>
        )}
      </div>

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

      {mine.length > 0 && <ArmyImport players={mine} />}

      {role !== "spectator" && (
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
          <button
            disabled={!lastOwn}
            title={lastOwn ? `Undo #${lastOwn.seq}` : ""}
            onClick={() => lastOwn && dispatch({ type: "undo", seq: lastOwn.seq })}
          >
            Undo
          </button>
        </div>
      )}
      <ol className="log">
        {record.events
          .filter((e) => scrub === null || e.seq <= scrub)
          .slice(-40)
          .reverse()
          .map((e) => (
            <li key={e.seq} className={undone.has(e.seq) ? "undone" : undefined}>
              <span className="seq">#{e.seq}</span> {describe(e, nameOf, game)}
            </li>
          ))}
      </ol>
      <button onClick={() => downloadReplay(record)}>Download replay</button>
    </div>
  );
}

export function describe(
  { by, event }: LoggedEvent,
  nameOf: (id: string) => string,
  game: GameState,
): string {
  const who = nameOf(by);
  const unitName = (id: string) => game.units[id]?.name ?? "a unit";
  switch (event.type) {
    case "player/join":
      return `${event.player.name} joined`;
    case "player/claim":
      return `${nameOf(event.by)} reconnected`;
    case "dice/roll": {
      const { results, label, unitId, sides } = event.roll;
      const total = results.reduce((a, b) => a + b, 0);
      const what = label ? `${unitId ? `${unitName(unitId)} ` : ""}${label}` : `${results.length}D${sides}`;
      return `${who} rolled ${what}: ${results.join(" ")}${results.length > 1 ? ` (= ${total})` : ""}`;
    }
    case "undo":
      return `${who} undid #${event.seq}`;
    case "unit/add":
      return `${who} deployed ${event.unit.name} (${event.models.length})`;
    case "terrain/add":
      return `${who} added ${event.piece.name.toLowerCase()}`;
    case "terrain/update":
      return `${who} changed ${event.piece.name.toLowerCase()}`;
    case "terrain/remove":
      return `${who} removed terrain`;
    case "objective/move":
      return `${who} moved an objective`;
    case "unit/height":
      return `${who} set ${unitName(event.id)} height to ${event.height ?? "default"}"`;
    case "settings/set":
      return `${who} changed table settings`;
    case "unit/attach":
      return `${who} attached ${unitName(event.id)} to ${unitName(event.to)}`;
    case "unit/remove":
      return `${who} removed ${unitName(event.id)}`;
    case "unit/move":
    case "model/move":
    case "models/move":
      return `${who} moved`;
    case "unit/status":
      return `${who} set ${unitName(event.id)} ${event.key} = ${event.value ?? "off"}`;
    case "model/wounds":
      return `${who} set wounds on ${game.models[event.id]?.label ?? "a model"}${event.destroyed ? " (destroyed)" : ""}`;
    case "layout/set":
      return "Table set up";
    case "turn/next":
    case "turn/prev":
      return `${who} ${event.type === "turn/next" ? "advanced" : "went back"} a phase`;
    case "turn/first":
      return `First turn: ${Object.values(game.players).find((p) => p.seat === event.seat)?.name ?? "?"}`;
    case "resource/adjust":
      return `${nameOf(event.player)} ${event.delta > 0 ? "+" : ""}${event.delta} ${event.resource}`;
    case "attack/declare": {
      const s = event.attack.spec;
      return `${unitName(s.attackerUnitId)} attacks ${unitName(s.targetUnitId)} with ${s.weaponName}: ${event.attack.attackCount} attacks`;
    }
    case "attack/roll": {
      const a = event.attack;
      switch (a.stage) {
        case "wound":
          return `Hits: ${a.hits}${a.critHits ? ` (${a.critHits} critical)` : ""}`;
        case "save":
          return `Wounds: ${a.wounds}${a.unsavable ? ` (${a.unsavable} skip saves)` : ""}`;
        case "damage":
          return `Unsaved: ${a.unsaved}`;
        default: {
          const lost = (a.damage ?? []).reduce((n, d) => n + d.lost, 0);
          const dead = (a.damage ?? []).filter((d) => d.destroyed).length;
          return `Damage: ${lost} wounds lost, ${dead} models destroyed`;
        }
      }
    }
    case "attack/clear":
      return "Attack finished";
    default:
      return `${who}: ${(event as { type: string }).type}`;
  }
}

function downloadReplay(record: GameRecord) {
  const blob = new Blob([JSON.stringify(record)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `open-battle-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
