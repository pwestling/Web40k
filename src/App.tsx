import { useEffect } from "react";
import { Board } from "./render/Board";
import { useStore } from "./store";
import { useTalk } from "./talk/talk";
import { AttackPanel } from "./ui/AttackPanel";
import { DiceTray } from "./ui/DiceTray";
import { useHold } from "./ui/hold";
import { Hud } from "./ui/Hud";
import { Lobby } from "./ui/Lobby";
import { PlayPanel } from "./ui/PlayPanel";
import { ScriptPanel } from "./ui/ScriptPanel";
import { ReactionPrompt } from "./ui/SystemPanels";
import { ReplayBar } from "./ui/ReplayBar";
import { ReplayTitle, RoundCard } from "./ui/RoundCard";
import { StatsScreen } from "./ui/StatsScreen";
import { systemModule } from "./systems";
import { PackageCards } from "./ui/Packages";
import { ScorePanel } from "./ui/Missions";
import { PackagePanel } from "./ui/PackagePanel";
import { SandboxNotice } from "./ui/SandboxNotice";
import { removeTerrain, rotateTerrain, TerrainPanel } from "./ui/TerrainPanel";
import { FloatingReactions, TalkPanel } from "./ui/TalkPanel";
import { useTableTalk } from "./talk/talk";
import { BROADCAST, useSpectatorDelay } from "./broadcast/broadcast";
import { BroadcastBadge } from "./broadcast/BroadcastControls";
import { Moments } from "./broadcast/Moments";
import { Ambience } from "./ui/Ambience";
import { TopBar } from "./ui/TopBar";
import { climbUnit, rotateUnit, UnitCard } from "./ui/UnitCard";

/**
 * Keyboard: Esc clears; M toggles the ruler; Q/E rotate; R/F move a unit up or down a floor;
 * Delete removes the selected terrain piece while editing; Home resets the camera.
 */
function onKey(e: KeyboardEvent) {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)
    return;
  const s = useStore.getState();
  const key = e.key.toLowerCase();
  if (key === "home") {
    s.resetView();
    return;
  }
  if (key === "escape") {
    if (useTalk.getState().tool) {
      useTalk.setState({ tool: null });
      return;
    }
    if (s.view === "eye") s.setView("3d");
    if (s.measuring) s.set({ measuring: false });
    else if (s.game.ruler && s.role !== "spectator") s.dispatch({ type: "ruler/set", ruler: null });
    s.setDraft(null);
    s.select(null);
    s.set({ selectedTerrain: null, losFrom: null });
    return;
  }
  if (s.role === "spectator" || s.scrub !== null) return;
  if (key === "m") {
    s.set({ measuring: !s.measuring });
    return;
  }
  if (s.editing && s.selectedTerrain) {
    if (key === "q") rotateTerrain(s.selectedTerrain, -15);
    if (key === "e") rotateTerrain(s.selectedTerrain, 15);
    if (key === "delete" || key === "backspace") removeTerrain(s.selectedTerrain);
    return;
  }
  const unit = s.selected ? s.game.units[s.selected] : undefined;
  if (!unit || (s.mode !== "hotseat" && unit.owner !== s.session?.selfId)) return;
  if (key === "q") rotateUnit(unit.id, -1);
  if (key === "e") rotateUnit(unit.id, 1);
  if (key === "r") climbUnit(unit.id, 1);
  if (key === "f") climbUnit(unit.id, -1);
}

/** The clean streaming view (`?view=broadcast`): the board, score bar, caption, dice and reactions. */
function BroadcastView() {
  useTableTalk();
  return (
    <>
      <TopBar />
      <ReplayBar />
      <RoundCard />
      <DiceTray />
      <FloatingReactions />
      <BroadcastBadge />
      <Moments />
      <Ambience />
      <StatsScreen />
    </>
  );
}

export function App() {
  useSpectatorDelay();
  const started = useStore((s) => s.session !== null || s.role === "spectator");
  const editing = useStore((s) => s.editing);
  const holding = useHold((s) => s.held !== null);
  const SystemPanel = systemModule(useStore((s) => s.game.system)).panel;
  // The attack flow takes the unit card's place on the right, keeping the table clear.
  const attacking = useStore(
    (s) => s.game.attack !== null || !!s.game.procedure || (s.draft !== null && s.scrub === null),
  );
  const reacting = useStore((s) => !!s.game.pending);
  const view = useStore((s) => s.view);
  const losFrom = useStore((s) => s.losFrom);
  const footprints = useStore(
    (s) => s.game.settings.los === "footprint" && (s.xray || s.editing) && s.session !== null,
  );
  const showSight = useStore((s) => s.losFrom !== null || !!s.draft?.targetId);
  const setView = useStore((s) => s.setView);
  useEffect(() => {
    document.body.classList.toggle("broadcast", BROADCAST);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <Board />
      {started && BROADCAST ? (
        <BroadcastView />
      ) : started ? (
        <>
          <TopBar />
          <Hud />
          {/* Before the right-hand panels, so CSS can shorten them while it's open. */}
          {!editing && <ScriptPanel />}
          {!editing && <PlayPanel />}
          {!editing && SystemPanel && <SystemPanel />}
          {!editing && <PackagePanel />}
          {!editing && <ScorePanel />}
          {/* While the dice tray rolls, the panels show the table before the roll: no clicking ahead. */}
          <div className={holding ? "panels holding" : "panels"} style={{ display: "contents" }}>
            {editing ? <TerrainPanel /> : attacking ? <AttackPanel /> : <UnitCard />}
          </div>
          <ReplayBar />
          <RoundCard />
          <ReplayTitle />
          <DiceTray />
          {!editing && <TalkPanel />}
          <Moments />
          <Ambience />
          <StatsScreen />
          <PackageCards />
          <SandboxNotice />
          {reacting && <ReactionPrompt />}
          {showSight && (
            <div className="legend">
              <span className="full">Fully visible</span>
              <span className="partial">Partly visible or in cover</span>
              <span className="none">Hidden</span>
              {losFrom && <span className="muted">Hover an enemy unit for its sight lines</span>}
            </div>
          )}
          {footprints && (
            <div className="legend terrain-legend">
              <span className="open">Open</span>
              <span className="obscuring">Obscuring: cover</span>
              <span className="blocking">Blocking: no sight</span>
            </div>
          )}
          {view === "eye" && (
            <button className="eye-exit primary" onClick={() => setView("3d")}>
              Leave model's eye view (Esc)
            </button>
          )}
        </>
      ) : (
        <Lobby />
      )}
    </>
  );
}
