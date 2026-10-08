import { ScriptPanel } from "../ui/ScriptPanel";
import { useEffect, useRef, useState, Suspense } from "react";
import { sideName, sidePlayers, sides, type GameState, type Unit } from "../core";
import { t, tn } from "../i18n";
import { useCanControl, useStore } from "../store";
import { aliveModels } from "../systems/wh40k/rules";
import { systemModule } from "../systems";
import { ArmyImport } from "../ui/ArmyImport";
import { CampaignFold } from "../campaign/CampaignUI";
import { AttackPanel } from "../ui/AttackPanel";
import { GameSettings } from "../ui/GameSettings";
import { GameLog, NameCard, UndoButton, downloadReplay } from "../ui/Hud";
import { useGame } from "../ui/hooks";
import { MissionPicker, ScorePanel, SecretMissions, missionOf } from "../ui/Missions";
import { PlayPanel } from "../ui/PlayPanel";
import { RoomCard } from "../ui/Room";
import { ReportButton } from "../ui/SavedNote";
import { SecretObjectives } from "../ui/SecretObjectives";
import { playerShape } from "../ui/sides";
import { battleOver } from "../ui/StatsScreen";
import { ReactionPrompt } from "../ui/ProcedurePanels";
import { TopBar } from "../ui/TopBar";
import { flags, UnitCard } from "../ui/UnitCard";
import { OwnDiceSwitch, RollButton } from "./RealDice";

type Tab = "units" | "mission" | "log" | "game";

/**
 * The table companion (#37): for a game played with real models on a real
 * table. No board: the armies as unit cards (wounds, statuses, attacks), the
 * turn, CP and VP, the mission and the log, laid out for a phone.
 */
export function CompanionScreen() {
  const game = useGame();
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const attacking = useStore(
    (s) => s.game.attack !== null || !!s.game.procedure || (s.draft !== null && s.scrub === null),
  );
  const reacting = !!game.pending;
  const SystemPanel = systemModule(game.system).panel;
  const before = game.turn.round === 0;
  const [tab, setTab] = useState<Tab>("units");
  const unit = selected ? game.units[selected] : undefined;
  const mode = useStore((s) => s.mode);
  const selfId = useStore((s) => s.session?.selfId);
  // When the go passes (Done on the last ask), back to all units, the next side's on top (PX).
  const seat = game.turn.activeSeat;
  const wasSeat = useRef(seat);
  useEffect(() => {
    if (seat === wasSeat.current) return;
    wasSeat.current = seat;
    if (useStore.getState().selected) select(null);
  }, [seat, select]);

  return (
    <div className="companion">
      <TopBar />
      <main className="companion-main">
        <Invite />
        {mode !== "hotseat" && selfId && game.players[selfId] && <NameCard player={game.players[selfId]!} />}
        {reacting && <ReactionPrompt />}
        {/* A game's own questions (a rule asking a player, a result to act on at the table). */}
        <ScriptPanel />
        {attacking ? (
          <AttackPanel />
        ) : unit ? (
          <>
            <button className="back" onClick={() => select(null)}>
              {t("← All units")}
            </button>
            <UnitCard />
          </>
        ) : (
          <>
            <PlayPanel />
            {SystemPanel && (
              <Suspense fallback={null}>
                <SystemPanel />
              </Suspense>
            )}
            {tab === "units" && <Units game={game} before={before} />}
            {tab === "mission" && <MissionTab before={before} />}
            {tab === "log" && <GameLog />}
            {tab === "game" && <GameTab />}
          </>
        )}
      </main>
      <nav className="companion-tabs" role="tablist">
        {(
          [
            ["units", t("Units")],
            ["mission", t("Mission")],
            ["log", t("Log")],
            ["game", t("Game")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id && !unit && !attacking}
            className={tab === id ? "on" : ""}
            onClick={() => {
              select(null);
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
        <OwnDiceSwitch />
      </nav>
    </div>
  );
}

/** Until the other phones join (UX 270): the invite link, to copy or share. */
function Invite() {
  const game = useGame();
  const { mode, roomId, role } = useStore();
  const [copied, setCopied] = useState(false);
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined).length;
  if (mode === "hotseat" || !roomId || role === "spectator" || seated >= 2 * (game.settings.teamSize ?? 1))
    return null;
  const link = location.href;
  const share = typeof navigator.share === "function";
  return (
    <div className="panel invite" role="status">
      <strong>{t("Waiting for the other player")}</strong>
      <p className="small">{t("Send them this link to open on their phone:")}</p>
      <code className="invite-link">{link}</code>
      <div className="row wrap">
        <button
          className="primary"
          onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
        >
          {copied ? t("Copied ✓") : t("Copy invite link")}
        </button>
        {share && (
          <button onClick={() => void navigator.share({ title: "Open Battle", url: link }).catch(() => {})}>
            {t("Share…")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Each side's units as tiles: tap one for its card. Before the battle, where to add an army. */
function Units({ game, before }: { game: GameState; before: boolean }) {
  const canControl = useCanControl();
  const select = useStore((s) => s.select);
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  const mine = seated.filter((p) => canControl(p.id));
  const mode = useStore((s) => s.mode);
  const going = (seat: number) => game.turn.round > 0 && game.turn.activeSeat === seat && !battleOver(game);
  // The side whose go it is comes first, ready to hand the phone across (PX).
  const order = [...sides(game)].sort((a, b) => Number(going(b)) - Number(going(a)));
  return (
    <div className="companion-units">
      {order.map((seat) => {
        const players = sidePlayers(game, seat);
        const units = Object.values(game.units).filter((u) => players.some((p) => p.id === u.owner));
        const color = players[0]?.color;
        return (
          <section key={seat} className={going(seat) ? "going" : undefined}>
            <h2 style={{ color }}>
              <span className="side-shape" aria-hidden="true">
                {playerShape(game, players[0]?.id)}
              </span>{" "}
              {sideName(game, seat)}
              {/* Whose go it is, on the list itself (UX 363). */}
              {going(seat) && (
                <span className="go-now">
                  {/* One phone between two: name the side; your own phone: "Your go" (UX 366, PX). */}
                  {mode !== "hotseat" && players.some((p) => canControl(p.id))
                    ? t("Your go")
                    : t("{side}'s go", { side: sideName(game, seat) })}
                </span>
              )}
            </h2>
            {!units.length && <p className="muted small">{t("No army yet.")}</p>}
            <div className="tiles">
              {units.map((u) => (
                <UnitTile key={u.id} game={game} unit={u} open={() => select(u.id)} />
              ))}
            </div>
          </section>
        );
      })}
      {mine.length > 0 &&
        (before || !Object.values(game.units).some((u) => mine.some((p) => p.id === u.owner)) ? (
          <ArmyImport players={mine} />
        ) : (
          <details className="fold">
            <summary>{t("Add an army")}</summary>
            <ArmyImport players={mine} />
          </details>
        ))}
    </div>
  );
}

function UnitTile({ game, unit, open }: { game: GameState; unit: Unit; open: () => void }) {
  const alive = aliveModels(game, unit);
  const all = unit.modelIds.length;
  const status = unit.status ?? {};
  const hurt = alive.find((m) => (m.woundsLost ?? 0) > 0);
  const on = flags().filter(([key]) => status[key]);
  const dead = alive.length === 0;
  return (
    <button className={`tile${dead ? " dead" : ""}`} onClick={open}>
      <strong>{unit.name}</strong>
      <span className="muted small">
        {dead ? t("Destroyed") : t("{alive}/{all} models", { alive: alive.length, all })}
        {hurt ? (
          <>
            {" "}
            ·{" "}
            {tn(hurt.woundsLost ?? 0, "{n} wound on {model}", "{n} wounds on {model}", { model: hurt.label })}
          </>
        ) : null}
        {status.reserves ? <> · {t("in reserve")}</> : null}
        {/* Alternating activations: who has had their go this round. */}
        {status.activated && !dead ? <> · {t("had its go")}</> : null}
      </span>
      {on.length > 0 && (
        <span className="chips">
          {on.map(([key, label]) => (
            <span key={key} className="chip on">
              {label}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function MissionTab({ before }: { before: boolean }) {
  const game = useGame();
  const canControl = useCanControl();
  const mission = missionOf(game);
  const seated = Object.values(game.players).filter((p) => p.seat !== undefined);
  const mine = seated.filter((p) => canControl(p.id));
  return (
    <div className="companion-mission">
      {mission ? (
        <>
          <h2>{mission.name}</h2>
          <p className="muted">{mission.summary}</p>
          <ul className="small">
            {mission.scoring.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{t("No mission chosen.")}</p>
      )}
      {before && mine.length > 0 && <MissionPicker />}
      <ScorePanel inline />
      <SecretMissions players={mine} />
      <SecretObjectives players={mine} />
    </div>
  );
}

/** The room, names, settings, dice, undo and the replay. */
function GameTab() {
  const game = useGame();
  const { session, mode, record, role, set } = useStore();
  const selfId = session?.selfId;
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  return (
    <div className="companion-game">
      <RoomCard />
      {mode !== "hotseat" && selfId && game.players[selfId] && <NameCard player={game.players[selfId]!} />}
      {role !== "spectator" && (
        <div className="row wrap">
          <UndoButton />
        </div>
      )}
      {role !== "spectator" && (
        <div className="row">
          <input
            type="number"
            aria-label={t("Number of dice")}
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <span>{t("D")}</span>
          <select aria-label={t("Sides")} value={sides} onChange={(e) => setSides(Number(e.target.value))}>
            {[3, 6, 8, 10, 12, 20].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <RollButton intent={{ type: "dice/roll", count, sides }}>{t("Roll")}</RollButton>
        </div>
      )}
      <CampaignFold />
      <GameSettings />
      <div className="row wrap">
        {battleOver(game) && (
          <button onClick={() => set({ stats: !(useStore.getState().stats ?? true) })}>{t("Stats")}</button>
        )}
        <button onClick={() => void downloadReplay(record)}>{t("Download replay")}</button>
        <ReportButton />
      </div>
    </div>
  );
}
