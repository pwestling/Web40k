import { useState } from "react";
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
        <button onClick={() => start({ role: "host", name })}>Solo</button>
      </div>
    </div>
  );
}

export function Hud() {
  const { game, roomId, dispatch, view, setView } = useStore();
  const [count, setCount] = useState(2);

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
      </div>
      <ol className="log">
        {game.log
          .slice(-12)
          .reverse()
          .map((entry) => (
            <li key={entry.seq}>
              {entry.kind === "info"
                ? entry.text
                : `${game.players[entry.roll.by]?.name ?? "?"}: ${entry.roll.results.join(" ")}`}
            </li>
          ))}
      </ol>
    </div>
  );
}
