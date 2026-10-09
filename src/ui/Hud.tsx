import { saveJson } from "./files";
import { characterName, levelName, useSolo } from "../bot/solo";
import { displayName } from "../i18n/names";
import { VIEWER } from "../viewer/flag";
import { ReportButton } from "./SavedNote";
import { CampaignFold } from "../campaign/CampaignUI";
import { TablePicker } from "../tables/TableLibrary";
import { useSound } from "./sound";
import { useHold } from "./hold";
import { bundleReplay } from "./replayFile";
import { useEffect, useMemo, useState } from "react";
import { undoneSeqs, type GameRecord, type Player } from "../core";
import { buildLog, collapseEmpty, undoGroup } from "./gameLog";
import { BroadcastControls } from "../broadcast/BroadcastControls";
import { t } from "../i18n";
import { loadRoom, useCanControl, useStore } from "../store";
import { ArmyImport } from "./ArmyImport";
import { GameSettings } from "./GameSettings";
import { MissionPicker, SecretMissions } from "./Missions";
import { SecretObjectives } from "./SecretObjectives";
import { DeployTray, RoomCard } from "./Room";
import { TemplateTools } from "./TemplateTools";
import { battleOver } from "./StatsScreen";
import { reviewThisGame } from "../replay/review";
import { useGame } from "./hooks";
import { useCoach } from "../teach/store";
import { narrow } from "./narrow";
import { touch } from "./touch";
import { startReview, useReviewRun } from "../review/run";
import { reviewable } from "../review/ReviewPanel";
import { BROADCAST } from "../broadcast/broadcast";

/** The left panel: room, players, army import, dice, undo and the game log. */
export function Hud() {
  const {
    record,
    session,
    dispatch,
    view,
    setView,
    resetView,
    mode,
    role,
    game: liveGame,
    editing,
    xray,
    plates,
    measuring,
    director,
    set,
    review,
  } = useStore();
  const canControl = useCanControl();
  // The table on screen (a replay's scrub point), which decides whether stats are showing.
  const shown = useGame();
  const fastDice = useSound((s) => s.fast);
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  // On a phone the menu folds away once the battle starts, so the table shows (UX 17).
  const started = liveGame.turn.round > 0;
  const [fold, setFold] = useState<{ started: boolean; collapsed: boolean } | null>(null);
  // A tablet too (#60): its fingers need the table more than the menu.
  const collapsed = fold?.started === started ? fold.collapsed : started && (narrow() || touch());
  const setCollapsed = (c: boolean) => setFold({ started, collapsed: c });
  const [dice, setDice] = useState(false);
  // Starting the battle (or any later phase change) locks the terrain again.
  const round = liveGame.turn.round;
  useEffect(() => {
    if (round > 0) useStore.getState().set({ editing: false, selectedTerrain: null });
  }, [round, liveGame.turn.phase]);
  const lesson = useCoach((s) => s.lesson);
  // Solo against the computer (#45), in this game.
  const solo = useSolo((s) => (s.session && s.session === session ? s.level : null));
  const mail = useStore((s) => s.mail !== null);
  const selfId = session?.selfId;
  const seated = Object.values(liveGame.players).filter((p) => p.seat !== undefined);
  const mine = seated.filter((p) => canControl(p.id));
  const amSeated = mode === "hotseat" || seated.some((p) => p.id === selfId);

  // At Battle over in a live game the review starts by itself, folded menu or not (UX 424, 432).
  // Not on an exhibition table (#64): nobody there to read it, and the next game is coming.
  const exhibition = useStore((s) => s.exhibition);
  const autoReview =
    battleOver(shown) && !!session && !BROADCAST && !VIEWER && !exhibition && reviewable(shown);
  useEffect(() => {
    if (autoReview) startReview(useStore.getState().record);
  }, [autoReview]);

  if (collapsed)
    return (
      <div className="panel hud collapsed">
        <button onClick={() => setCollapsed(false)}>
          {t("☰ Menu")}
          <ReviewReadyDot over={battleOver(shown)} />
        </button>
      </div>
    );

  return (
    <div className="panel hud">
      <div className="row spread">
        {/* i18n-ignore */}
        <strong>Open Battle</strong>
        <button onClick={() => setCollapsed(true)}>{t("Hide")}</button>
      </div>
      <RoomCard />
      {mode === "hotseat" && (
        <p className="muted">
          {lesson
            ? t("Lesson: the computer plays the other side.")
            : solo
              ? t("You play the near side; {name} plays the far side ({level}).", {
                  name: characterName(solo),
                  level: levelName(solo),
                })
              : mail
                ? t("Play by mail: you play your side; send your file when you're done.")
                : t("Hotseat: you control both sides.")}
        </p>
      )}
      {role === "spectator" && !review && <p className="muted">{t("Spectating.")}</p>}
      {/* Commentary and the stream view are for live games, not a replay watched together (UX 258). */}
      {role === "spectator" && !review && !VIEWER && <BroadcastControls />}
      <div className="row wrap">
        <button onClick={() => setView(view === "top" ? "3d" : "top")}>
          {view === "top" ? t("3D view") : t("Top-down view")}
        </button>
        <button onClick={resetView} title={t("Home")}>
          {t("Reset view")}
        </button>
        {role !== "spectator" && (
          <button
            className={measuring ? "on" : ""}
            title={t("Drag between models or points to measure; both players see it (M)")}
            onClick={() => set({ measuring: !measuring })}
          >
            {t("Ruler")}
          </button>
        )}
        {liveGame.ruler && role !== "spectator" && (
          <button
            title={t("Clear the ruler (Esc)")}
            onClick={() => dispatch({ type: "ruler/set", ruler: null })}
          >
            {t("Clear ruler")}
          </button>
        )}
        <button className={plates ? "on" : ""} onClick={() => set({ plates: !plates })}>
          {t("Unit names")}
        </button>
        <button className={xray ? "on" : ""} onClick={() => set({ xray: !xray })}>
          {t("X-ray terrain")}
        </button>
        <button
          className={fastDice ? "on" : ""}
          title={t("Shorter dice rolls in the tray")}
          onClick={useSound.getState().toggleFast}
        >
          {t("Fast dice")}
        </button>
        <button
          className={director ? "on" : ""}
          title={t("Camera follows the action: moves, shots and charges")}
          onClick={() => set({ director: !director })}
        >
          {t("Follow action")}
        </button>
        {role !== "spectator" && (
          <button
            className={editing ? "on" : ""}
            onClick={() => {
              // Terrain is locked once the battle starts; changing it then takes a confirm.
              if (
                !editing &&
                liveGame.turn.round > 0 &&
                !confirm(t("The battle has started. Unlock the terrain? Every change shows in the log."))
              )
                return;
              set({ editing: !editing, selectedTerrain: null });
            }}
          >
            {editing ? t("Done editing") : liveGame.turn.round > 0 ? t("Unlock terrain") : t("Edit terrain")}
          </button>
        )}
      </div>
      <GameSettings />

      {role === "client" && !amSeated && seated.length >= 2 * (liveGame.settings.teamSize ?? 1) ? (
        <RejoinCard seated={seated} />
      ) : (
        role === "client" && !amSeated && round === 0 && <EarlyNameCard />
      )}

      {/* During the battle, setup tools and the dice tray fold away to keep the panel slim. */}
      {mine.length > 0 &&
        (round === 0 ? (
          <>
            {mode !== "hotseat" && selfId && liveGame.players[selfId] && (
              <NameCard player={liveGame.players[selfId]!} />
            )}
            <TablePicker />
            <MissionPicker />
            {/* Near the top before the battle, where a host sets the game up (UX 203). */}
            <CampaignFold />
            <ArmyImport players={mine} />
            <DeployTray players={mine} />
          </>
        ) : (
          <details className="fold">
            <summary>{t("Add an army")}</summary>
            <ArmyImport players={mine} />
          </details>
        ))}
      <SecretObjectives players={mine} />
      <SecretMissions players={mine} />
      {!(mine.length > 0 && round === 0) && <CampaignFold />}

      {role !== "spectator" && (
        <div className="row undo-row">
          <UndoButton />
          <button className={dice ? "on" : ""} onClick={() => setDice(!dice)}>
            {t("Dice")}
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
          <span>{t("D")}</span>
          <select value={sides} onChange={(e) => setSides(Number(e.target.value))}>
            {[3, 6, 8, 10, 12, 20].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button onClick={() => dispatch({ type: "dice/roll", count, sides })}>{t("Roll")}</button>
        </div>
      )}
      <TemplateTools />
      <GameLog />
      <div className="row wrap hud-foot">
        {/* Stats are for after the battle (and replays), not a player aid mid-game. */}
        {(battleOver(shown) || !session) && <StatsButton over={battleOver(shown)} />}
        <button onClick={() => void downloadReplay(record)}>{t("Download replay")}</button>
        {/* Notes go on a replay: the game just played becomes one (UX 231). */}
        {session && battleOver(shown) && (
          <button title={t("Open this game as a replay to add notes and marks")} onClick={reviewThisGame}>
            {t("Replay with notes")}
          </button>
        )}
        <ReportButton />
      </div>
    </div>
  );
}

/** Take back this player's last action (or, hotseat, the last one), with what goes with it. */
export function UndoButton() {
  const { record, session, mode, dispatch, game } = useStore();
  const undone = undoneSeqs(record);
  const selfId = session?.selfId;
  const lastOwn = [...record.events].reverse().find(
    (e) =>
      (mode === "hotseat" || e.by === selfId) &&
      e.event.type !== "undo" &&
      e.event.type !== "player/join" &&
      e.event.type !== "layout/set" &&
      // Choosing the table companion isn't a move to take back.
      !(e.event.type === "settings/set" && e.event.settings.companion !== undefined) &&
      !undone.has(e.seq),
  );
  const takeBack = lastOwn ? undoGroup(record, lastOwn.seq, undone, game) : null;
  return (
    <button
      disabled={!takeBack}
      title={
        takeBack
          ? takeBack.what
            ? t("Take back {what}", { what: takeBack.what })
            : t("Take back your last action")
          : ""
      }
      onClick={() =>
        takeBack &&
        dispatch({
          type: "undo",
          seq: takeBack.seq,
          ...(takeBack.also.length ? { also: takeBack.also } : {}),
        })
      }
    >
      {t("Undo")}
    </button>
  );
}

/** The game log, newest first: what happened, in words. */
export function GameLog() {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const liveGame = useStore((s) => s.game);
  // While the dice tray rolls, the log waits for the dice to land.
  const held = useHold((s) => s.held);
  // A lesson's table is set up for the learner: those placements aren't play, so the log starts after them (UX 187).
  const setupEnd = useCoach((s) => (s.lesson && !s.free ? (s.progress.began[0] ?? null) : null));
  const log = useMemo(
    () => buildLog(record, scrub ?? (held !== null ? held - 1 : Infinity)),
    // liveGame too: a package's rules loading refolds the same record, and the log names its game again.
    [record, scrub, held, liveGame], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <ol className="log">
      {collapseEmpty(setupEnd === null ? log : log.filter((i) => i.kind === "header" || i.seq > setupEnd))
        .slice(-60)
        .reverse()
        .map((item) =>
          item.kind === "header" ? (
            <li key={`h${item.key}`} className={item.rules ? "phase rules" : "phase"}>
              {item.text}
            </li>
          ) : (
            <li key={item.key} className={item.undone ? "undone" : undefined}>
              {item.text}
              {item.detail?.length ? (
                <ul className="detail">
                  {item.detail.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ),
        )}
    </ol>
  );
}

/** The record, with the figures, terrain models and rules packages it uses, as a file. */
export async function downloadReplay(record: GameRecord) {
  saveJson(
    `open-battle-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`,
    await bundleReplay(record),
  );
}

const numberWord = (n: number): string | undefined =>
  [t("three"), t("four"), t("five"), t("six"), t("seven"), t("eight")][n - 3];
const seatsTaken = (n: number) =>
  n <= 2
    ? t("Both players are here.")
    : t("All {count} seats are taken.", { count: numberWord(n) ?? String(n) });

/** A name typed while connecting survives the swap to NameCard once seated. */
let nameDraft = "";

/**
 * Invite links join straight in, as "Player N": until the player names
 * themselves, ask, so the sides read "Ana & Cy" rather than "Ana & Player 3".
 */
export function NameCard({ player }: { player: Player }) {
  const { dispatch } = useStore();
  const [stored] = useState(() => localStorage.getItem("open-battle:name") ?? "");
  const [name, setName] = useState(() => nameDraft);
  const unnamed = /^Player \d+$/.test(player.name);
  // A name this device already gave (the lobby, Open tables) is used, not asked again (PX).
  useEffect(() => {
    if (stored && unnamed) dispatch({ type: "player/rename", player: player.id, name: stored });
  }, [stored, unnamed, dispatch, player.id]);
  if (stored || !unnamed) return null;
  const save = () => {
    const n = name.trim();
    if (!n) return;
    localStorage.setItem("open-battle:name", n);
    dispatch({ type: "player/rename", player: player.id, name: n });
  };
  return (
    <form
      className="claim name-card"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="muted">
        {t("You're {name}. What should the others call you?", { name: displayName(player.name) })}
      </p>
      <div className="row">
        <input
          value={name}
          placeholder={t("Your name")}
          autoFocus
          onChange={(e) => setName((nameDraft = e.target.value))}
        />
        <button className="primary" disabled={!name.trim()}>
          {t("Use this name")}
        </button>
      </div>
    </form>
  );
}

/**
 * While a joining player waits for a seat (rules packages, a slow connection), the name is asked
 * at once (UX 403): it's kept on this device, and NameCard uses it the moment they sit down.
 */
function EarlyNameCard() {
  const [stored, setStored] = useState(() => localStorage.getItem("open-battle:name") ?? "");
  const [name, setName] = useState(() => nameDraft);
  if (stored)
    return <p className="muted claim">{t("Connecting to the table as {name}…", { name: stored })}</p>;
  return (
    <form
      className="claim name-card"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        localStorage.setItem("open-battle:name", n);
        setStored(n);
      }}
    >
      <p className="muted">{t("Connecting to the table… What should the others call you?")}</p>
      <div className="row">
        <input
          value={name}
          placeholder={t("Your name")}
          aria-label={t("Your name")}
          autoFocus
          onChange={(e) => setName((nameDraft = e.target.value))}
        />
        <button className="primary" disabled={!name.trim()}>
          {t("Use this name")}
        </button>
      </div>
    </form>
  );
}

/**
 * A player back from a closed tab finds both seats taken: offer the seat whose
 * player has gone (never one whose player is still connected), or watching.
 */
function RejoinCard({ seated }: { seated: Player[] }) {
  const { net, dispatch, start, mode, roomId } = useStore();
  // This device's own seat is offered even while its old, closed tab still looks connected (UX 216).
  const own = roomId ? loadRoom(roomId)?.playerId : undefined;
  const free = seated.filter((p) => p.id === own || (!net?.peers.includes(p.id) && p.id !== net?.hostId));
  const watch = () =>
    start({
      role: "spectator",
      mode,
      roomId: roomId ?? undefined,
      name: localStorage.getItem("open-battle:name") ?? "",
    });
  return (
    <div className="claim">
      {free.length ? (
        <>
          <p className="muted">{t("This game is already under way. Rejoining?")}</p>
          {free.map((p) => (
            <button
              key={p.id}
              className="primary"
              onClick={() => dispatch({ type: "player/claim", player: p.id })}
            >
              {t("Rejoin as {name}", { name: p.name })}
            </button>
          ))}
        </>
      ) : (
        <p className="muted">{seatsTaken(seated.length)}</p>
      )}
      <button onClick={watch}>{t("Watch")}</button>
    </div>
  );
}

/** Stats, with a dot once the game review is ready (UX 424). */
function StatsButton({ over }: { over: boolean }) {
  const set = useStore((s) => s.set);
  return (
    <button onClick={() => set({ stats: !(useStore.getState().stats ?? over) })}>
      {t("Stats")}
      <ReviewReadyDot over={over} />
    </button>
  );
}

/** A green dot while this game's review is ready and the stats sheet is closed. */
function ReviewReadyDot({ over }: { over: boolean }) {
  const open = useStore((s) => s.stats ?? over);
  const record = useStore((s) => s.record);
  const run = useReviewRun();
  if (run.status !== "done" || run.of?.initial !== record.initial || open) return null;
  return <span className="ready-dot" title={t("Review ready")} aria-label={t("Review ready")} />;
}
