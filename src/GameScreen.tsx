import { SoloBot } from "./bot/SoloBot";
import { VIEWER } from "./viewer/flag";
import { NoteCaption, NotesPanel } from "./replay/NotesPanel";
import { cameraForward, focusOn } from "./render/focus";
import { aliveModels } from "./systems/wh40k/rules";
import { TableWarningsPanel } from "./ui/TableWarnings";
import { TtsNote } from "./tts/TtsNote";
import { BroughtOffer } from "./tts/BroughtOffer";
import { Announcer } from "./ui/Announcer";
import { ClockKeeper } from "./ui/Clocks";
import { CampaignBookDialog, CampaignKeeper } from "./campaign/CampaignUI";
import { lazy, useEffect, Suspense } from "react";
import { CompanionScreen } from "./companion/CompanionScreen";
import { t } from "./i18n";
import { useStore } from "./store";
import { useTalk } from "./talk/talk";
import { AttackPanel } from "./ui/AttackPanel";
import { DiceTray } from "./ui/DiceTray";
import { useHold } from "./ui/hold";
import { useHelp } from "./ui/help";
import { Hud } from "./ui/Hud";
import { TouchLayer } from "./ui/TouchLayer";
import { KeysSheet } from "./ui/Keys";
import { WhatNow } from "./ui/WhatNow";
import { Coach } from "./ui/Coach";
import { MailBar } from "./mail/MailBar";
import { MyTableKeeper, TableArrivals } from "./opentables/OpenTables";
import { PlayPanel } from "./ui/PlayPanel";
import { ScriptPanel } from "./ui/ScriptPanel";
import { ReactionPrompt } from "./ui/ProcedurePanels";
import { ReplayBar } from "./ui/ReplayBar";
import { ReplayTitle, RoundCard } from "./ui/RoundCard";
import { StatsScreen } from "./ui/StatsScreen";
import { BetterMoveHint } from "./review/ReviewPanel";
import { systemModule } from "./systems";
import { PackageCards } from "./ui/Packages";
import { ScorePanel } from "./ui/Missions";
import { PackagePanel } from "./ui/PackagePanel";
import { SandboxNotice } from "./ui/SandboxNotice";
import { removeTerrain, rotateTerrain, TerrainPanel } from "./ui/TerrainPanel";
import { FloatingReactions, TalkPanel } from "./ui/TalkPanel";
import { useTableTalk } from "./talk/talk";
import { BROADCAST, useSpectatorDelay } from "./broadcast/broadcast";
import { useHotseatMark } from "./ui/resumeHotseat";
import { BroadcastBadge } from "./broadcast/BroadcastControls";
import { Moments } from "./broadcast/Moments";
import { Ambience } from "./ui/Ambience";
import { Showcase } from "./ui/Showcase";
import { TopBar } from "./ui/TopBar";
import { ReportBanner } from "./ui/Crash";
import { RankedKeeper } from "./ranked/RankedGame";
import { SharedDiceKeeper } from "./ranked/dice";
import { OnAir, VoiceRoom } from "./voice/VoiceBar";
import { climbUnit, rotateUnit, UnitCard } from "./ui/UnitCard";
import { deleteKey } from "./ui/ttsControls";
import { useTouch } from "./render/touchState";

/** three.js and the 3D table load on their own: the table companion (#37) never draws them. */
export const loadBoard = () => import("./render/Board");
const Board = lazy(() => loadBoard().then((m) => ({ default: m.Board })));
/** An online event's game (#67): its bar loads only at an event's table. */

/**
 * Keyboard: [ ] pick a unit, arrows move it, Enter opens its card; ? shows every control; Esc clears; M toggles the ruler; Q/E rotate; R/F move a unit up or down a floor;
 * Delete removes the selected terrain piece while editing, else a model as a casualty (asking); Home resets the camera.
 */
function onKey(e: KeyboardEvent) {
  const target = e.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  )
    return;
  const s = useStore.getState();
  const key = e.key.toLowerCase();
  if (e.key === "?") {
    useHelp.setState((h) => ({ keys: !h.keys }));
    return;
  }
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
    if (useTouch.getState().picked.length) useTouch.setState({ picked: [] });
    return;
  }
  // Keyboard play (#25): [ and ] step through your units (with Shift, the other side's).
  if (e.code === "BracketLeft" || e.code === "BracketRight") {
    stepUnit(e.code === "BracketRight" ? 1 : -1, e.shiftKey);
    e.preventDefault();
    return;
  }
  // Enter goes from the table into the selected unit's card.
  if (key === "enter" && s.selected && (target === document.body || target instanceof HTMLCanvasElement)) {
    // The card itself: Tab then walks through its buttons, and a screen reader reads its name.
    document.querySelector<HTMLElement>(".panel.unitcard")?.focus();
    e.preventDefault();
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
  // As in Tabletop Simulator: the model under the pointer (or the selected unit's last) goes, after asking.
  if (key === "delete" || key === "backspace") {
    if (deleteKey()) e.preventDefault();
    return;
  }
  const unit = s.selected ? s.game.units[s.selected] : undefined;
  if (!unit || (s.mode !== "hotseat" && unit.owner !== s.session?.selfId)) return;
  if (key.startsWith("arrow") && !(target instanceof HTMLButtonElement && e.altKey)) {
    nudgeUnit(unit.id, key, e.shiftKey ? 0.25 : 1);
    e.preventDefault();
    return;
  }
  if (key === "q") rotateUnit(unit.id, -1);
  if (key === "e") rotateUnit(unit.id, 1);
  if (key === "r") climbUnit(unit.id, 1);
  if (key === "f") climbUnit(unit.id, -1);
}

/** Select the next or previous unit on the table: yours, or (`others`) everyone else's; the camera follows. */
function stepUnit(dir: 1 | -1, others: boolean) {
  const s = useStore.getState();
  const game = s.game;
  const self = s.session?.selfId;
  // Hotseat: yours are the side whose turn it is.
  const yours = (owner: string) =>
    s.mode === "hotseat" ? game.players[owner]?.seat === game.turn.activeSeat : owner === self;
  const units = Object.values(game.units)
    .filter((u) => !u.status?.reserves && aliveModels(game, u).length > 0)
    .filter((u) => s.role === "spectator" || yours(u.owner) !== others)
    .sort(
      (a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  if (!units.length) return;
  const at = units.findIndex((u) => u.id === s.selected);
  const next = units[(at + dir + units.length) % units.length] ?? units[0]!;
  s.select(next.id);
  // So Enter goes into this unit's card, not to whatever button was last pressed.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const models = aliveModels(game, next);
  focusOn(
    models.reduce((a, m) => a + m.position.x, 0) / models.length,
    models.reduce((a, m) => a + m.position.y, 0) / models.length,
  );
}

/** Arrow keys: slide the selected unit a step across the table, up the screen being away from the camera. */
function nudgeUnit(unitId: string, key: string, step: number) {
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  const alive = aliveModels(game, unit);
  if (!unit || !alive.length) return;
  const f = cameraForward;
  const right = { x: -f.y, y: f.x };
  const [ax, ay] =
    key === "arrowup"
      ? [f.x, f.y]
      : key === "arrowdown"
        ? [-f.x, -f.y]
        : key === "arrowright"
          ? [right.x, right.y]
          : [-right.x, -right.y];
  const pivot = {
    x: alive.reduce((a, m) => a + m.position.x, 0) / alive.length,
    y: alive.reduce((a, m) => a + m.position.y, 0) / alive.length,
  };
  dispatch(
    {
      type: "unit/move",
      id: unitId,
      pivot,
      turn: 0,
      delta: { x: ax * step, y: ay * step },
      how: "drag",
      distance: step,
    },
    unit.owner,
  );
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
      <Showcase />
      <StatsScreen />
      <VoiceRoom />
      <OnAir />
      {/* A package game's rules, so a watcher's table folds as the players' does. */}
      <PackageCards />
      <SandboxNotice />
    </>
  );
}

/** Everything on screen once a game is open, loaded after the front door (with three.js). */
export function GameScreen({ started }: { started: boolean }) {
  useSpectatorDelay();
  useHotseatMark();
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
  const companion = useStore((s) => !!s.game.settings.companion);
  // Real models on a real table (#37): no board, the phone screen instead.
  if (started && companion && !BROADCAST)
    return (
      <>
        <CompanionScreen />
        <ReportBanner />
        <TableWarningsPanel />
        <DiceTray />
        <VoiceRoom />
        <StatsScreen />
        <PackageCards />
        <SandboxNotice />
        <CampaignKeeper />
        <ClockKeeper />
        <CampaignBookDialog />
        <Announcer />
      </>
    );
  // The table is the front door's backdrop too; the panels come with a game.
  return (
    <>
      <Suspense fallback={null}>
        <Board />
      </Suspense>
      {started && BROADCAST ? (
        <BroadcastView />
      ) : started ? (
        <>
          <TopBar />
          <Hud />
          {/* Before the right-hand panels, so CSS can shorten them while it's open. */}
          {!editing && <ScriptPanel />}
          {!editing && <PlayPanel />}
          {!editing && SystemPanel && (
            <Suspense fallback={null}>
              <SystemPanel />
            </Suspense>
          )}
          {!editing && <PackagePanel />}
          {!editing && <ScorePanel />}
          {/* While the dice tray rolls, the panels show the table before the roll: no clicking ahead. */}
          <div className={holding ? "panels holding" : "panels"} style={{ display: "contents" }}>
            {editing ? <TerrainPanel /> : attacking ? <AttackPanel /> : <UnitCard />}
          </div>
          <ReplayBar />
          <ReportBanner />
          <TableWarningsPanel />
          <TtsNote />
          <BroughtOffer />
          <RoundCard />
          <ReplayTitle />
          {!editing && <NotesPanel />}
          <NoteCaption />
          <DiceTray />
          {/* A replay page has no one to ping or react to (UX 344, PX share 7). */}
          {!editing && !VIEWER && <TalkPanel />}
          {!editing && !VIEWER && <TouchLayer />}
          <VoiceRoom />
          <Moments />
          <Ambience />
          <Showcase />
          <StatsScreen />
          <PackageCards />
          <SandboxNotice />
          {!editing && <BetterMoveHint />}
          {!editing && <WhatNow />}
          {!editing && <Coach />}
          {!editing && <SoloBot />}
          {!editing && <MailBar />}
          <MyTableKeeper />
          <TableArrivals />
          <RankedKeeper />
          <SharedDiceKeeper />
          <KeysSheet />
          <CampaignKeeper />
          <ClockKeeper />
          <CampaignBookDialog />
          <Announcer />
          {reacting && <ReactionPrompt />}
          {showSight && (
            <div className="legend">
              <span className="full">{t("Fully visible")}</span>
              <span className="partial">{t("Partly visible or in cover")}</span>
              <span className="none">{t("Hidden")}</span>
              {losFrom && <span className="muted">{t("Hover an enemy unit for its sight lines")}</span>}
            </div>
          )}
          {footprints && (
            <div className="legend terrain-legend">
              <span className="open">{t("Open")}</span>
              <span className="obscuring">{t("Obscuring: cover")}</span>
              <span className="blocking">{t("Blocking: no sight")}</span>
            </div>
          )}
          {view === "eye" && (
            <button className="eye-exit primary" onClick={() => setView("3d")}>
              {t("Leave model's eye view (Esc)")}
            </button>
          )}
        </>
      ) : null}
    </>
  );
}
