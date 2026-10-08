import { unbundleReplay, type ReplayFile } from "./replayFile";
import { useOpenReport, type ReportFile } from "./report";
import { useEffect, useState } from "react";
import { DEFAULT_SYSTEM } from "../core";
import { listSystems } from "../core/content";
import { NET_PARAMS } from "../net/config";
import { BROADCAST } from "../broadcast/broadcast";
import { useLibrary } from "../packages/library";
import { APP_BUILD } from "../version";
import { ArmyGuide } from "./ArmyGuide";
import { NetCheck } from "./NetCheck";
import { startDemo } from "./demo";
import { TextSizePicker } from "./TextSizePicker";
import { BUILT_IN_LESSONS, lessonPackages, lessonSystem } from "../teach/builtin";
import { startLesson } from "../teach/store";
import { MailLobby } from "../mail/MailLobby";
import { openLibrary } from "../figures/open";
import { PackageLibrary, refOf } from "./Packages";
import { FRONT, systemLabel } from "./systemLabels";
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
  const [guide, setGuide] = useState(false);
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
    // A review room's link: watch the replay together (src/replay/review.ts).
    if (params.get("review") === "1") {
      start({ role: "spectator", mode: m, roomId, name: who, review: true });
      return;
    }
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
    // A problem report opens at the moment it was made (src/ui/report.ts).
    const report = (data as Partial<ReportFile>).report;
    if (report && Number.isFinite(report.seq)) {
      useOpenReport.setState({ report });
      useStore.getState().setScrub(report.seq);
    }
  };

  const demos = listSystems().filter((s) => FRONT[s.id]);
  // The built-in lessons, then any lesson packages loaded on this device (data only: nothing to trust).
  const lessons = lessonPackages([
    ...BUILT_IN_LESSONS,
    ...Object.values(library)
      .filter((p) => p.manifest.kind === "lesson")
      .map((p) => p.source),
  ])
    .flatMap((p) => p.lessons)
    .filter(
      (l, i, all) => lessonSystem(l) && all.findIndex((x) => x.id === l.id && x.system === l.system) === i,
    );

  return (
    <div className="panel lobby">
      <h1>Open Battle</h1>
      <p className="pitch">
        Tabletop battles on a 3D table in your browser. Bring your army; the rules keep count.
      </p>

      <TextSizePicker />

      <h2>Learn to play</h2>
      <p className="muted small">
        A guided first game: you play blue, the computer plays red, and a coach says what to do next.
      </p>
      <div className="demos">
        {lessons.map((l) => (
          <button key={`${l.system}/${l.id}`} className="demo" onClick={() => startLesson(l)}>
            <strong>
              {systemLabel(lessonSystem(l), "")}: {l.title}
            </strong>
            <span className="muted small">{l.summary}</span>
          </button>
        ))}
      </div>

      <h2>Try it now</h2>
      <p className="muted small">Two sample armies, set up and ready. You play both sides on this screen.</p>
      <div className="demos">
        {demos.map((g) => (
          <button key={g.id} className="demo" onClick={() => startDemo(g.id)}>
            <strong>{FRONT[g.id]!.title}</strong>
            <span className="muted small">{FRONT[g.id]!.blurb}</span>
          </button>
        ))}
      </div>

      <h2>Play with friends</h2>
      <label>
        Your name{" "}
        <input value={name} placeholder="Player 1 or 2, by seat" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Game{" "}
        <select value={system} onChange={(e) => setSystem(e.target.value)}>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {systemLabel(s.id, s.name)}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" onClick={host}>
        Host a game
      </button>
      <p className="muted small">You get a link to send; whoever opens it joins your table.</p>
      <label>
        Room{" "}
        <input
          value={room}
          placeholder="a room code to join"
          onChange={(e) => setRoom(e.target.value.trim())}
        />
      </label>
      <div className="row">
        <button disabled={!room} onClick={() => join("client")}>
          Join
        </button>
        <button disabled={!room} onClick={() => join("spectator")}>
          Watch
        </button>
      </div>
      <NetCheck />
      <details className="fold">
        <summary>More ways to play</summary>
        <label>
          Players{" "}
          <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
            <option value={1}>1 vs 1</option>
            <option value={2}>2 vs 2 (teams share CP and VP)</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={sameBrowser} onChange={(e) => setSameBrowser(e.target.checked)} />
          Same browser (play between two tabs, no network)
        </label>
        <button
          onClick={() => {
            remember();
            start({ role: "host", mode: "hotseat", name, system });
            namePackage();
          }}
        >
          Set up a game on this screen (hotseat)
        </button>
        <PackageLibrary system={system} onPick={setSystem} />
      </details>
      <MailLobby
        name={name}
        system={system}
        onStarted={() => {
          remember();
          namePackage();
        }}
      />

      <hr />
      <button className="link" onClick={() => setGuide(true)}>
        Bring your army: lists, figures and rules packages
      </button>
      <button className="link" onClick={() => openLibrary()}>
        Figure library: your models, packs and storage
      </button>
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
      {guide && <ArmyGuide system={system} onClose={() => setGuide(false)} />}
    </div>
  );
}
