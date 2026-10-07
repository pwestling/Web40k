import { useState } from "react";
import { undoneSeqs, type GameRecord, type LoggedEvent } from "../core";
import { useStore } from "../store";

export function Lobby() {
  const start = useStore((s) => s.start);
  const [name, setName] = useState("Player");
  const [room, setRoom] = useState(() => new URLSearchParams(location.search).get("room") ?? "");

  const host = () => {
    const roomId = room || crypto.randomUUID().slice(0, 8);
    history.replaceState(null, "", `?room=${roomId}`);
    start({ role: "host", roomId, name });
  };

  return (
    <div className="panel lobby">
      <h1>Open Battle</h1>
      <label>
        Name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Room{" "}
        <input value={room} placeholder="leave blank to create" onChange={(e) => setRoom(e.target.value)} />
      </label>
      <div className="row">
        <button onClick={host}>Host</button>
        <button disabled={!room} onClick={() => start({ role: "client", roomId: room, name })}>
          Join
        </button>
        <button disabled={!room} onClick={() => start({ role: "spectator", roomId: room, name })}>
          Watch
        </button>
        <button onClick={() => start({ role: "host", name })}>Solo</button>
      </div>
    </div>
  );
}

export function Hud() {
  const { game, record, session, roomId, dispatch, view, setView } = useStore();
  const [count, setCount] = useState(2);
  const undone = undoneSeqs(record);
  const nameOf = (id: string) => game.players[id]?.name ?? "Spectator";
  const lastOwn = [...record.events]
    .reverse()
    .find(
      (e) =>
        e.by === session?.selfId &&
        e.event.type !== "undo" &&
        e.event.type !== "player/join" &&
        !undone.has(e.seq),
    );

  return (
    <div className="panel hud">
      {roomId && (
        <p>
          Room <code>{roomId}</code> · share this page's URL to invite
        </p>
      )}
      <button onClick={() => setView(view === "3d" ? "top" : "3d")}>
        {view === "3d" ? "Top-down view" : "3D view"}
      </button>
      <ul className="players">
        {Object.values(game.players).map((p) => (
          <li key={p.id} style={{ color: p.color }}>
            {p.name}
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
        <button onClick={() => dispatch({ type: "dice/roll", count, sides: 6 })}>Roll D6</button>
        <button disabled={!lastOwn} onClick={() => lastOwn && dispatch({ type: "undo", seq: lastOwn.seq })}>
          Undo
        </button>
      </div>
      <ol className="log">
        {record.events
          .slice(-12)
          .reverse()
          .map((e) => (
            <li key={e.seq} className={undone.has(e.seq) ? "undone" : undefined}>
              {`#${e.seq} ${describe(e, nameOf)}`}
            </li>
          ))}
      </ol>
      <button onClick={() => downloadReplay(record)}>Download replay</button>
    </div>
  );
}

function describe({ by, event }: LoggedEvent, nameOf: (id: string) => string): string {
  const who = nameOf(by);
  switch (event.type) {
    case "player/join":
      return `${event.player.name} joined`;
    case "dice/roll":
      return `${who} rolled ${event.roll.results.join(" ")}`;
    case "undo":
      return `${who} undid #${event.seq}`;
    case "unit/add":
      return `${who} deployed ${event.unit.name}`;
    case "unit/move":
    case "model/move":
      return `${who} moved`;
    default:
      return `${who}: ${event.type}`;
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
