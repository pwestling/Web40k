import type { ReplayFile } from "./replayFile";
import { useOpenReport, type ReportFile } from "./report";
import { lazy, Suspense, useEffect, useState } from "react";
import { DEFAULT_SYSTEM } from "../core";
import { listSystems } from "../core/content";
import { NET_PARAMS } from "../net/config";
import { boardOn, useOpenTables } from "../opentables/board";
import { BROADCAST } from "../broadcast/broadcast";
import { useLibrary } from "../packages/library";
import { APP_BUILD } from "../version";
import { ArmyGuide } from "./ArmyGuide";
import { NetCheck } from "./NetCheck";
import { startDemo } from "./demo";
import { installRiftLanterns, playRiftAtTable, playRiftLanterns, RIFT_LANTERNS } from "../games/riftLanterns";
import { startSolo } from "../bot/startSolo";
import { characterName, levelName, savedLevel } from "../bot/solo";
import type { Level } from "../bot/player";
import { TextSizePicker } from "./TextSizePicker";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { WhatsNew } from "./WhatsNew";
import { formatDate, t, tn, gameText } from "../i18n";
import { BUILT_IN_LESSONS, lessonPackages, lessonSystem } from "../teach/builtin";
import { openLibrary } from "../figures/open";
import { openWorkshop } from "../workshop/open";
import { InstallLink, OfflineForFriends, OfflineNote, UpdateToast } from "../sw/UpdateToast";
import { PackageLibrary, refOf } from "./Packages";
import { FRONT, systemLabel } from "./systemLabels";
import { loadRoom, loadSavedGame, useStore, type Mode } from "../store";

/** Play by mail loads after the front door; it sits below the fold. */
const MailLobby = lazy(() => import("../mail/MailLobby").then((m) => ({ default: m.MailLobby })));
/** Rift Lanterns' rules page (#47), with its print and play, on demand. */
const RulesPage = lazy(() => import("../printplay/RulesPage"));
/** Open tables (#50): the public board of games, read only when opened. */
const OpenTablesBoard = lazy(() =>
  import("../opentables/OpenTables").then((m) => ({ default: m.OpenTablesBoard })),
);

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
  const [rules, setRules] = useState(params.get("rules") === "rift-lanterns");
  const [tables, setTables] = useState(() => {
    // Back from a table whose host had gone: the board says so.
    if (params.get("tables") === "gone") useOpenTables.setState({ gone: true });
    return params.get("tables") === "1" || params.get("tables") === "gone";
  });
  // Play the computer (#45): the game whose card asks "How hard?" (UX 350).
  const [asking, setAsking] = useState<string | null>(null);
  // Built-in games, then whole games from trusted rules packages (their code runs in the sandbox).
  const library = useLibrary((s) => s.packages);
  useEffect(() => {
    void useLibrary.getState().load();
    // Our own game goes in the library after the front door is up, so it's in the game list (#42).
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 500));
    idle(() => void installRiftLanterns());
  }, []);
  const fromPackages = Object.values(library).filter(
    (p) => p.trusted && p.manifest.kind === "system" && p.manifest.systems[0],
  );
  const systems = [
    ...listSystems().map((s) => ({ id: s.id, name: s.name })),
    ...fromPackages
      .filter((p) => !listSystems().some((s) => s.id === p.manifest.systems[0]))
      .map((p) => ({
        id: p.manifest.systems[0]!,
        name: t("{name} {version}", { name: p.manifest.name, version: p.manifest.version }),
      })),
  ];
  const [system, setSystem] = useState(() => {
    const last = localStorage.getItem("open-battle:system");
    return systems.some((s) => s.id === last) ? last! : DEFAULT_SYSTEM;
  });
  const saved = loadSavedGame();
  const mode: Mode = sameBrowser ? "local" : "online";

  const remember = (as = name) => {
    localStorage.setItem("open-battle:name", as);
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
  const host = (companion = false) => {
    remember();
    const roomId = room || crypto.randomUUID().slice(0, 8);
    linkTo(roomId);
    start({ role: "host", mode, roomId, name, system });
    namePackage();
    if (teamSize > 1) useStore.getState().dispatch({ type: "settings/set", settings: { teamSize } });
    if (companion) useStore.getState().dispatch({ type: "settings/set", settings: { companion: true } });
  };
  /** Real models on a real table (#37): this screen keeps the cards, dice and score. */
  const companionHere = () => {
    remember();
    start({ role: "host", mode: "hotseat", name, system });
    namePackage();
    useStore.getState().dispatch({ type: "settings/set", settings: { companion: true } });
  };
  const join = (role: "client" | "spectator", roomId = room, as = name) => {
    remember(as);
    linkTo(roomId);
    start({ role, mode, roomId, name: as });
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
    if (data.format !== "open-battle/record@1") return alert(t("That is not an Open Battle replay file."));
    openReplay(await (await import("./replayFile")).unbundleReplay(data));
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
  // One card per game, with its lessons and its demo (UX 284); lesson packages for other games get cards too.
  const games = [
    ...demos.map((g) => ({
      id: g.id,
      title: FRONT[g.id]!.title,
      blurb: FRONT[g.id]!.blurb,
      demo: true,
      lessons: lessons.filter((l) => lessonSystem(l) === g.id),
    })),
    ...[...new Set(lessons.map((l) => lessonSystem(l)!))]
      .filter((id) => !FRONT[id])
      .map((id) => ({
        id,
        title: systemLabel(id, ""),
        blurb: "",
        demo: false,
        lessons: lessons.filter((l) => lessonSystem(l) === id),
      })),
  ];

  return (
    <div className="panel lobby">
      <div className="lobby-head">
        {/* i18n-ignore */}
        <h1>Open Battle</h1>
        {/* Settings out of the way, but in sight (UX 285). */}
        <div className="lobby-settings">
          <TextSizePicker />
          <LanguagePicker />
        </div>
      </div>
      <p className="pitch">
        {t("Tabletop battles on a 3D table in your browser. Bring your army; the rules keep count.")}
      </p>
      <WhatsNew />
      <UpdateToast />
      <OfflineNote />
      {/* Two columns on a wide screen (UX 288): getting started, then playing with people. */}
      <div className="lobby-cols">
        <div className="lobby-col">
          <button className="own-army" onClick={() => setGuide(true)}>
            <strong>{t("Play your own army: import a list")}</strong>
            <span className="muted small">
              {t("From New Recruit or BattleScribe, with your own figures if you have them.")}
            </span>
          </button>
          {/* Our own game (#42): original, free to share, and nothing to import. */}
          <div className="demo ours">
            {/* i18n-ignore */}
            <strong>Rift Lanterns</strong>
            <span className="muted small">
              {t(
                "Our own skirmish game, free to share (CC BY). Four warbands fight over lanterns fallen into a rift. Nothing to import.",
              )}
            </span>
            <div className="row wrap">
              <button className="primary small play-now" onClick={() => void playRiftLanterns()}>
                {t("Play now (both sides)")}
              </button>
              <button className="small solo" onClick={() => setAsking(RIFT_LANTERNS)}>
                {t("Play the computer")}
              </button>
              <button
                className="small"
                title={t(
                  "Printed or real models on your table: this phone keeps the cards, rolls and scores",
                )}
                onClick={() => void playRiftAtTable()}
              >
                {t("At a real table")}
              </button>
              <button className="small" onClick={() => setRules(true)}>
                {t("Rules, print and play")}
              </button>
            </div>
            {rules && (
              <Suspense fallback={null}>
                <RulesPage
                  onClose={() => setRules(false)}
                  play={[
                    { label: t("Play now (both sides)"), primary: true, run: () => void playRiftLanterns() },
                    { label: t("Play the computer"), run: () => setAsking(RIFT_LANTERNS) },
                    { label: t("At a real table"), run: () => void playRiftAtTable() },
                  ]}
                />
              </Suspense>
            )}
            {asking === RIFT_LANTERNS && <HowHard system={RIFT_LANTERNS} onCancel={() => setAsking(null)} />}
          </div>
          <h2>{t("Pick a game")}</h2>
          <p className="muted small">
            {t(
              "Learn: a guided first game against the computer, with a coach. Try: two sample armies set up, and you play both sides.",
            )}
          </p>
          <p className="muted small">
            {t(
              "These are built-in sample rules. For your own game system, load its rules package under More ways to play.",
            )}
          </p>
          <div className="demos">
            {games.map((g) => (
              <div key={g.id} className="demo">
                <strong>{g.title}</strong>
                <span className="muted small">{g.blurb}</span>
                <div className="row wrap">
                  {g.lessons.map((l, i) => (
                    <button
                      key={l.id}
                      className={i === 0 ? "primary small learn" : "small learn"}
                      title={gameText(l.summary)}
                      onClick={() => void import("../teach/store").then((m) => m.startLesson(l))}
                    >
                      {i === 0 ? t("Learn (guided)") : gameText(l.title)}
                    </button>
                  ))}
                  {g.demo && (
                    <button className="small try" onClick={() => startDemo(g.id)}>
                      {t("Try (both sides)")}
                    </button>
                  )}
                  {g.demo && (
                    <button className="small solo" onClick={() => setAsking(g.id)}>
                      {t("Play the computer")}
                    </button>
                  )}
                </div>
                {asking === g.id && <HowHard system={g.id} onCancel={() => setAsking(null)} />}
              </div>
            ))}
          </div>
        </div>
        <div className="lobby-col">
          <h2>{t("Play with friends")}</h2>
          <OfflineForFriends />
          {boardOn() && (
            <>
              <button className="open-tables-button" onClick={() => setTables(true)}>
                <strong>{t("Open tables: find an opponent")}</strong>
                <span className="muted small">
                  {t("Games other players have put up. Join one, or post your own.")}
                </span>
              </button>
              {tables && (
                <Suspense fallback={null}>
                  <OpenTablesBoard
                    onClose={() => setTables(false)}
                    onJoin={(code, as) => {
                      setRoom(code);
                      if (as) setName(as);
                      join("client", code, as || name);
                    }}
                    onHost={() => {
                      setTables(false);
                      useOpenTables.setState({ asked: true });
                      host();
                    }}
                  />
                </Suspense>
              )}
            </>
          )}
          <label>
            {t("Your name")}{" "}
            <input
              value={name}
              placeholder={t("Player 1 or 2, by seat")}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {t("Game")}{" "}
            <select value={system} onChange={(e) => setSystem(e.target.value)}>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {systemLabel(s.id, s.name)}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => host()}>
            {t("Host a game")}
          </button>
          <p className="muted small">{t("You get a link to send; whoever opens it joins your table.")}</p>
          <label>
            {t("Room")}{" "}
            <input
              value={room}
              placeholder={t("a room code or invite link")}
              onChange={(e) => setRoom(roomFrom(e.target.value))}
            />
          </label>
          {!room && <p className="muted small">{t("Paste a room code or invite link to join.")}</p>}
          <div className="row">
            <button disabled={!room} onClick={() => join("client")}>
              {t("Join")}
            </button>
            <button disabled={!room} onClick={() => join("spectator")}>
              {t("Watch")}
            </button>
          </div>
          <NetCheck />
          <h2>{t("At a real table")}</h2>
          <p className="muted small">
            {t(
              "Playing with your own models? Open Battle keeps the unit cards, wounds, CP, VP and mission, and works out each attack. Roll on screen or roll your own dice and type them in.",
            )}
          </p>
          <div className="row wrap">
            <button onClick={companionHere}>{t("One phone for both of us")}</button>
            <button
              onClick={() => host(true)}
              title={t("You get a link to send; the other player opens it on their phone")}
            >
              {t("A phone each")}
            </button>
          </div>
          <details className="fold">
            <summary>{t("More ways to play")}</summary>
            <label>
              {t("Players")}{" "}
              <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
                <option value={1}>{t("1 vs 1")}</option>
                <option value={2}>{t("2 vs 2 (teams share CP and VP)")}</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={sameBrowser}
                onChange={(e) => setSameBrowser(e.target.checked)}
              />
              {t("Same browser (play between two tabs, no network)")}
            </label>
            <button
              onClick={() => {
                remember();
                start({ role: "host", mode: "hotseat", name, system });
                namePackage();
              }}
            >
              {t("Set up a game on this screen (hotseat)")}
            </button>
            <PackageLibrary system={system} onPick={setSystem} />
          </details>
          <Suspense fallback={null}>
            <MailLobby
              name={name}
              system={system}
              onStarted={() => {
                remember();
                namePackage();
              }}
            />
          </Suspense>
          <InstallLink />
          <hr />
          <button className="link" onClick={() => openLibrary()}>
            {t("Figure library: your models, packs and storage")}
          </button>
          <button className="link" onClick={openWorkshop}>
            {t("Module workshop: write your own game system")}
          </button>
          {saved && (
            <button onClick={resume}>
              {tn(
                saved.record.events.length,
                "Resume last game ({mode}, {n} event, {date})",
                "Resume last game ({mode}, {n} events, {date})",
                {
                  mode:
                    { online: t("online"), local: t("local"), hotseat: t("hotseat") }[saved.mode] ??
                    saved.mode,
                  date: formatDate(new Date(saved.savedAt), {
                    year: "numeric",
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "numeric",
                    second: "numeric",
                  }),
                },
              )}
            </button>
          )}
          <label className="file">
            {t("Open a replay file")}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => e.target.files?.[0] && loadReplay(e.target.files[0])}
            />
          </label>
        </div>
      </div>
      <footer className="lobby-foot muted small">
        <span>{t("No account: games run between your browsers.")}</span>
        <span>
          {/* i18n-ignore */}
          Open Battle {APP_BUILD.split("+")[0]} ·{" "}
          <a href="https://github.com/pwestling/Web40k" target="_blank" rel="noreferrer">
            {t("Source code")}
          </a>
        </span>
      </footer>
      {guide && <ArmyGuide system={system} onClose={() => setGuide(false)} />}
    </div>
  );
}

/** A room code, or the room in a pasted invite link (UX 289). */
function roomFrom(text: string): string {
  const v = text.trim();
  try {
    return new URL(v).searchParams.get("room") ?? v;
  } catch {
    return v;
  }
}

/**
 * "How hard?" (UX 350): asked in the card once Play the computer is pressed,
 * Easy picked the first time and the last choice after that.
 */
function HowHard({ system, onCancel }: { system: string; onCancel: () => void }) {
  const last = savedLevel();
  const levels: { level: Level; line: string }[] = [
    { level: "random", line: t("plays loosely; good for a first game") },
    { level: "steady", line: t("plays to win") },
    { level: "sharp", line: t("thinks harder about every move") },
  ];
  return (
    <div className="how-hard" role="group" aria-label={t("How hard?")}>
      <strong className="small">{t("How hard?")}</strong>
      {levels.map((l) => (
        <button
          key={l.level}
          className={l.level === last ? "primary small" : "small"}
          autoFocus={l.level === last}
          onClick={() => startSolo(system, l.level)}
        >
          {levelName(l.level)} <span className="muted small">{characterName(l.level)}</span>{" "}
          <span className="muted small">{l.line}</span>
        </button>
      ))}
      <button className="quiet small" title={t("Not now")} onClick={onCancel}>
        ✕
      </button>
    </div>
  );
}
