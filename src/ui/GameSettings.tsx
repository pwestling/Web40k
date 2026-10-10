import { ClockSettingsRow } from "./Clocks";
import type { GameSettings as Settings } from "../core";
import { t } from "../i18n";
import { systemOf } from "../core/content/turn";
import { useStore } from "../store";
import { useGame } from "./hooks";
import { GamePackagesSettings } from "./Packages";
import { CampaignFold } from "../campaign/CampaignUI";
import { setTtsControls, useTtsControls } from "./ttsControls";

/** Rule options for this game. Set during deployment; shown read-only once the battle starts. */
export function GameSettings() {
  const game = useGame();
  const { dispatch, role, scrub } = useStore();
  // Play by mail stretches over days: a chess clock would count the days between turns.
  const mail = useStore((s) => s.mail !== null);
  const { cover, modelsBlock } = game.settings;
  const los = game.settings.los ?? "true";
  const size = systemOf(game).gameSize;
  const editable = role !== "spectator" && scrub === null;
  // Once the battle has started, changing a rule takes a confirm (and shows in the log).
  const change = (settings: Partial<Settings>) => {
    if (game.turn.round > 0 && !confirm(t("The battle has started. Change this rule for both players?")))
      return;
    dispatch({ type: "settings/set", settings });
  };
  return (
    <details className="settings">
      <summary>{t("Game settings")}</summary>
      <GamePackagesSettings editable={editable} />
      {editable ? (
        <>
          <label>
            {t("Cover")}{" "}
            <select value={cover} onChange={(e) => change({ cover: e.target.value as "hit" | "save" })}>
              <option value="hit">{t("Ballistic Skill 1 worse")}</option>
              <option value="save">{t("+1 to save")}</option>
            </select>
          </label>
          <label>
            {t("Line of sight")}{" "}
            <select
              value={los}
              onChange={(e) => change({ los: e.target.value as "true" | "heights" | "footprint" })}
            >
              <option value="true">{t("True line of sight")}</option>
              <option value="heights">{t("Stand-in heights")}</option>
              <option value="footprint">{t("Footprints, no height")}</option>
            </select>
          </label>
          {los === "footprint" && (
            <p className="muted small">
              {t(
                "Heights don't count. Sight runs from the centre of a model's base to any part of the target's base. Each terrain piece is open, obscuring (gives cover) or blocking; set it in the terrain editor.",
              )}
            </p>
          )}
          {los === "heights" && (
            <p className="muted small">
              {t(
                "Each terrain piece counts as a block of its stand-in height, and models see each other if the line between their tops clears it. Set heights in the terrain editor; X-ray shows them.",
              )}
            </p>
          )}
          <label>
            {t("Models see")}{" "}
            <select
              value={game.settings.visionArc ?? 360}
              // 360 rather than "missing", so the change survives being sent to peers as JSON.
              onChange={(e) => change({ visionArc: Number(e.target.value) })}
            >
              <option value={360}>{t("All around")}</option>
              <option value={180}>{t("In a {degrees}° front arc", { degrees: 180 })}</option>
              <option value={90}>{t("In a {degrees}° front arc", { degrees: 90 })}</option>
            </select>
          </label>
          {/* Systems whose numbers follow the game size (FSD's AD Pool and Capacity). */}
          {size && (
            <label>
              {t("Game size (points)")}{" "}
              <input
                type="number"
                min={1}
                step={5}
                value={game.settings.points ?? size.points}
                onChange={(e) => {
                  const points = Math.floor(Number(e.target.value));
                  if (points > 0) change({ points });
                }}
              />
            </label>
          )}
          {!mail && <ClockSettingsRow value={game.settings.clock} change={(clock) => change({ clock })} />}
          <label className="check">
            <input
              type="checkbox"
              checked={modelsBlock}
              onChange={(e) => change({ modelsBlock: e.target.checked })}
            />
            {t("Other units' models block line of sight")}
          </label>
        </>
      ) : (
        <p className="muted small">
          {los === "heights"
            ? t("Stand-in heights line of sight.")
            : los === "footprint"
              ? t("Footprint line of sight.")
              : t("True line of sight.")}{" "}
          {t("Cover: {cover}.", { cover: cover === "hit" ? t("Ballistic Skill 1 worse") : t("+1 to save") })}{" "}
          {game.settings.visionArc && game.settings.visionArc < 360
            ? `${t("Models see in a {degrees}° front arc.", { degrees: game.settings.visionArc })} `
            : ""}
          {modelsBlock
            ? t("Other units' models block line of sight.")
            : t("Other units' models don't block line of sight.")}
        </p>
      )}
      {editable && game.turn.round > 0 && <UnlockTerrain />}
      {/* Starting a campaign is rare: its fold shows in the panel once one is attached (UX 83). */}
      {!game.campaign && <CampaignFold />}
      <TtsControlsRow />
    </details>
  );
}

/** This device's own choice, not the game's: Tabletop Simulator's mouse and keys (PX TTS reflexes). */
function TtsControlsRow() {
  const on = useTtsControls((s) => s.on);
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setTtsControls(e.target.checked)} />
        {t("TTS controls")}
      </label>
      <p className="muted small">
        {t(
          "Just on this device. Left drag on the table picks units with a box, right drag turns the camera, WASD slides it and holding Tab measures.",
        )}
      </p>
    </>
  );
}

/** Changing the terrain once the battle is on (UX 83: moved here from the panel's top row). */
function UnlockTerrain() {
  const editing = useStore((s) => s.editing);
  return (
    <button
      className={editing ? "on" : ""}
      onClick={() => {
        if (
          !editing &&
          !confirm(t("The battle has started. Unlock the terrain? Every change shows in the log."))
        )
          return;
        useStore.getState().set({ editing: !editing, selectedTerrain: null });
      }}
    >
      {editing ? t("Done editing") : t("Unlock terrain")}
    </button>
  );
}
