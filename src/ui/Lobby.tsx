import { unbundleReplay, type ReplayFile } from "./replayFile";
import { useEffect, useState } from "react";
import { DEFAULT_SYSTEM } from "../core";
import { listSystems } from "../core/content";
import { NET_PARAMS } from "../net/config";
import { BROADCAST } from "../broadcast/broadcast";
import { useLibrary } from "../packages/library";
import { APP_BUILD } from "../version";
import { PackageLibrary, refOf } from "./Packages";
import { loadRoom, loadSavedGame, useStore, type Mode } from "../store";

/** Rejoin once per page load (effects run twice in development). */
let autoJoined = false;

export function Lobby() {
  const { start, openReplay } = useStore();
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState(() => localStorage.getItem("open-battle:name") ?? "");
  const [room, setRoom] = useState(() => params.get("room") ?? "");
  const [sameBrowser, setSameBrowser] = useState(params.get("local") === "1");
  // Players per side when hosting: 1 (1v1) or 2 (a 2v2 team game, core/teams.ts).
  const [teamSize, setTeamSize] = useState(1);
  // Built-in games, then whole games from trusted rules packages (their code runs in the sandbox).
  const library = useLibrary((s) => s.packages);
  useEffect(() => void useLibrary.getState().load(), []);
  const fromPackages = Object.values(library).filter(
    (p) => p.trusted && p.manifest.kind === "system" && p.manifest.systems[0],
  );
  const systems = [
    ...listSystems().map((s) => ({ id: s.id, name: s.name })),
    ...fromPackages
      .filter((p) => !listSystems().some((s) => s.id === p.manifest.systems[0]))
      .map((p) => ({
        id: p.manifest.systems[0]!,
        name: `${p.manifest.name} ${p.manifest.version} (package)`,
      })),
  ];
  const [system, setSystem] = useState(() => {
    const last = localStorage.getItem("open-battle:system");
    return systems.some((s) => s.id === last) ? last! : DEFAULT_SYSTEM;
  });
  const saved = loadSavedGame();
  const mode: Mode = sameBrowser ? "local" : "online";

  const remember = () => {
    localStorage.setItem("open-battle:name", name);
    localStorage.setItem("open-battle:system", system);
  };
  const linkTo = (roomId: string) => {
    const q = new URLSearchParams({ room: roomId });
    if (sameBrowser) q.set("local", "1");
    // Keep relay settings so an invite link connects the same way.
    for (const k of NET_PARAMS) if (params.get(k)) q.set(k, params.get(k)!);
    history.replaceState(null, "", `?${q}`);
  };

  /** A game from a package names that package, so every player gets its code. */
  const namePackage = () => {
    const pkg = fromPackages.find((p) => p.manifest.systems[0] === system);
    if (!pkg) return;
    useStore.getState().dispatch({
      type: "game/packages",
      app: APP_BUILD,
      system: { id: system, builtIn: false },
      packages: [refOf(pkg)],
    });
  };
  const host = () => {
    remember();
    const roomId = room || crypto.randomUUID().slice(0, 8);
    linkTo(roomId);
    start({ role: "host", mode, roomId, name, system });
    namePackage();
    if (teamSize > 1) useStore.getState().dispatch({ type: "settings/set", settings: { teamSize } });
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
  // A tab reloaded in the middle of a game goes straight back into its room.
  useEffect(() => {
    if (autoJoined) return;
    autoJoined = true;
    const roomId = params.get("room");
    const back = roomId ? loadRoom(roomId) : null;
    if (!roomId) return;
    const m: Mode = params.get("local") === "1" ? "local" : "online";
    const who = localStorage.getItem("open-battle:name") ?? "";
    // The streaming view always just watches.
    if (BROADCAST) {
      start({ role: "spectator", mode: m, roomId, name: who || "Stream" });
      return;
    }
    // An invite link goes straight into the room: a free seat is taken, a game in progress offers Rejoin or Watch.
    if (!back?.role) {
      start({ role: "client", mode: m, roomId, name: who });
      return;
    }
    if (back.role === "host") start({ role: "host", mode: m, roomId, name: who, record: back.record });
    else start({ role: back.role, mode: m, roomId, name: who });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReplay = async (file: File) => {
    const data = JSON.parse(await file.text()) as ReplayFile;
    if (data.format !== "open-battle/record@1") return alert("That is not an Open Battle replay file.");
    openReplay(await unbundleReplay(data));
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
      <label>
        Game{" "}
        <select value={system} onChange={(e) => setSystem(e.target.value)}>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <PackageLibrary system={system} onPick={setSystem} />
      <button
        className="primary"
        onClick={() => {
          remember();
          start({ role: "host", mode: "hotseat", name, system });
          namePackage();
        }}
      >
        Play on this screen (hotseat)
      </button>
      <hr />
      <label>
        Room{" "}
        <input value={room} placeholder="blank = new room" onChange={(e) => setRoom(e.target.value.trim())} />
      </label>
      <label>
        Players{" "}
        <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
          <option value={1}>1 vs 1</option>
          <option value={2}>2 vs 2 (teams share CP and VP)</option>
        </select>
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
