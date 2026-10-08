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
import { useCanControl, useStore } from "../store";
import { ArmyImport } from "./ArmyImport";
import { GameSettings } from "./GameSettings";
import { MissionPicker, SecretMissions } from "./Missions";
import { SecretObjectives } from "./SecretObjectives";
import { DeployTray, RoomCard } from "./Room";
import { TemplateTools } from "./TemplateTools";
import { battleOver } from "./StatsScreen";
import { useGame } from "./hooks";
import { useCoach } from "../teach/store";
import { narrow } from "./narrow";

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
    scrub,
    editing,
    xray,
    plates,
    measuring,
    director,
    set,
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
  const collapsed = fold?.started === started ? fold.collapsed : started && narrow();
  const setCollapsed = (c: boolean) => setFold({ started, collapsed: c });
  const [dice, setDice] = useState(false);
  const undone = undoneSeqs(record);
  // Starting the battle (or any later phase change) locks the terrain again.
  const round = liveGame.turn.round;
  useEffect(() => {
    if (round > 0) useStore.getState().set({ editing: false, selectedTerrain: null });
  }, [round, liveGame.turn.phase]);
  // While the dice tray rolls, the log waits for the dice to land.
  const held = useHold((s) => s.held);
  const lesson = useCoach((s) => s.lesson);
  const mail = useStore((s) => s.mail !== null);
  const log = useMemo(
    () => buildLog(record, scrub ?? (held !== null ? held - 1 : Infinity)),
    // liveGame too: a package's rules loading refolds the same record, and the log names its game again.
    [record, scrub, held, liveGame], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  const takeBack = lastOwn ? undoGroup(record, lastOwn.seq, undone, liveGame) : null;
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
      <RoomCard />
      {mode === "hotseat" && (
        <p className="muted">
          {lesson
            ? "Lesson: the computer plays the other side."
            : mail
              ? "Play by mail: you play your side; send your file when you're done."
              : "Hotseat: you control both sides."}
        </p>
      )}
      {role === "spectator" && <p className="muted">Spectating.</p>}
      {role === "spectator" && <BroadcastControls />}
      <div className="row wrap">
        <button onClick={() => setView(view === "top" ? "3d" : "top")}>
          {view === "top" ? "3D view" : "Top-down view"}
        </button>
        <button onClick={resetView} title="Home">
          Reset view
        </button>
        {role !== "spectator" && (
          <button
            className={measuring ? "on" : ""}
            title="Drag between models or points to measure; both players see it (M)"
            onClick={() => set({ measuring: !measuring })}
          >
            Ruler
          </button>
        )}
        {liveGame.ruler && role !== "spectator" && (
          <button title="Clear the ruler (Esc)" onClick={() => dispatch({ type: "ruler/set", ruler: null })}>
            Clear ruler
          </button>
        )}
        <button className={plates ? "on" : ""} onClick={() => set({ plates: !plates })}>
          Unit names
        </button>
        <button className={xray ? "on" : ""} onClick={() => set({ xray: !xray })}>
          X-ray terrain
        </button>
        <button
          className={fastDice ? "on" : ""}
          title="Shorter dice rolls in the tray"
          onClick={useSound.getState().toggleFast}
        >
          Fast dice
        </button>
        <button
          className={director ? "on" : ""}
          title="Camera follows the action: moves, shots and charges"
          onClick={() => set({ director: !director })}
        >
          Follow action
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

      {role === "client" && !amSeated && seated.length >= 2 * (liveGame.settings.teamSize ?? 1) && (
        <RejoinCard seated={seated} />
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
            <summary>Add an army</summary>
            <ArmyImport players={mine} />
          </details>
        ))}
      <SecretObjectives players={mine} />
      <SecretMissions players={mine} />
      {!(mine.length > 0 && round === 0) && <CampaignFold />}

      {role !== "spectator" && (
        <div className="row undo-row">
          <button
            disabled={!takeBack}
            title={takeBack ? `Take back ${takeBack.what ?? "your last action"}` : ""}
            onClick={() =>
              takeBack &&
              dispatch({
                type: "undo",
                seq: takeBack.seq,
                ...(takeBack.also.length ? { also: takeBack.also } : {}),
              })
            }
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
      <TemplateTools />
      <ol className="log">
        {collapseEmpty(log)
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
      <div className="row">
        {/* Stats are for after the battle (and replays), not a player aid mid-game. */}
        {(battleOver(shown) || !session) && (
          <button onClick={() => set({ stats: !(useStore.getState().stats ?? battleOver(shown)) })}>
            Stats
          </button>
        )}
        <button onClick={() => void downloadReplay(record)}>Download replay</button>
        <ReportButton />
      </div>
    </div>
  );
}

/** The record, with the figures, terrain models and rules packages it uses, as a file. */
async function downloadReplay(record: GameRecord) {
  const blob = new Blob([JSON.stringify(await bundleReplay(record))], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `open-battle-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const NUMBERS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"];
export const seatsTaken = (n: number) =>
  n <= 2 ? "Both players are here." : `All ${NUMBERS[n] ?? n} seats are taken.`;

/**
 * Invite links join straight in, as "Player N": until the player names
 * themselves, ask, so the sides read "Ana & Cy" rather than "Ana & Player 3".
 */
function NameCard({ player }: { player: Player }) {
  const { dispatch } = useStore();
  const [stored] = useState(() => localStorage.getItem("open-battle:name") ?? "");
  const [name, setName] = useState("");
  if (stored || !/^Player \d+$/.test(player.name)) return null;
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
      <p className="muted">You're {player.name}. What should the others call you?</p>
      <div className="row">
        <input value={name} placeholder="Your name" autoFocus onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={!name.trim()}>
          Use this name
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
  const free = seated.filter((p) => !net?.peers.includes(p.id) && p.id !== net?.hostId);
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
          <p className="muted">This game is already under way. Rejoining?</p>
          {free.map((p) => (
            <button
              key={p.id}
              className="primary"
              onClick={() => dispatch({ type: "player/claim", player: p.id })}
            >
              Rejoin as {p.name}
            </button>
          ))}
        </>
      ) : (
        <p className="muted">{seatsTaken(seated.length)}</p>
      )}
      <button onClick={watch}>Watch</button>
    </div>
  );
}
