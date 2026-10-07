import { useState } from "react";
import type { GameRecord } from "../core";
import { NET_PARAMS } from "../net/config";
import { loadSavedGame, useStore, type Mode } from "../store";

export function Lobby() {
  const { start, openReplay } = useStore();
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState(() => localStorage.getItem("open-battle:name") ?? "");
  const [room, setRoom] = useState(() => params.get("room") ?? "");
  const [sameBrowser, setSameBrowser] = useState(params.get("local") === "1");
  const saved = loadSavedGame();
  const mode: Mode = sameBrowser ? "local" : "online";

  const remember = () => localStorage.setItem("open-battle:name", name);
  const linkTo = (roomId: string) => {
    const q = new URLSearchParams({ room: roomId });
    if (sameBrowser) q.set("local", "1");
    // Keep relay settings so an invite link connects the same way.
    for (const k of NET_PARAMS) if (params.get(k)) q.set(k, params.get(k)!);
    history.replaceState(null, "", `?${q}`);
  };

  const host = () => {
    remember();
    const roomId = room || crypto.randomUUID().slice(0, 8);
    linkTo(roomId);
    start({ role: "host", mode, roomId, name });
  };
  const join = (role: "client" | "spectator") => {
    remember();
    linkTo(room);
    start({ role, mode, roomId: room, name });
  };
  const resume = () => {
    if (!saved) return;
    if (saved.roomId) linkTo(saved.roomId);
    start({ role: "host", mode: saved.mode, roomId: saved.roomId ?? undefined, name, record: saved.record });
  };
  const loadReplay = async (file: File) => {
    const record = JSON.parse(await file.text()) as GameRecord;
    if (record.format !== "open-battle/record@1") return alert("That is not an Open Battle replay file.");
    openReplay(record);
  };

  return (
    <div className="panel lobby">
      <h1>Open Battle</h1>
      <p className="muted">A peer-to-peer tabletop for miniatures wargames. Bring your own army list.</p>
      <label>
        Your name{" "}
        <input
          value={name}
          placeholder="Player 1 or 2, by seat"
          autoFocus={!name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button className="primary" onClick={() => start({ role: "host", mode: "hotseat", name })}>
        Play on this screen (hotseat)
      </button>
      <hr />
      <label>
        Room{" "}
        <input value={room} placeholder="blank = new room" onChange={(e) => setRoom(e.target.value.trim())} />
      </label>
      <div className="row">
        <button onClick={host}>Host online</button>
        <button disabled={!room} onClick={() => join("client")}>
          Join
        </button>
        <button disabled={!room} onClick={() => join("spectator")}>
          Watch
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={sameBrowser} onChange={(e) => setSameBrowser(e.target.checked)} />
        Same browser (play between two tabs, no network)
      </label>
      <hr />
      {saved && (
        <button onClick={resume}>
          Resume last game ({saved.mode}, {saved.record.events.length} events,{" "}
          {new Date(saved.savedAt).toLocaleString()})
        </button>
      )}
      <label className="file">
        Open a replay file
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => e.target.files?.[0] && loadReplay(e.target.files[0])}
        />
      </label>
    </div>
  );
}
