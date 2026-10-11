import { useEffect } from "react";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { mainWeapon } from "../systems/wh40k/rules";
import { phaseName } from "../core/content/turn";
import { realDiceOn } from "../companion/RealDice";
import { pointerModel, useTtsControls } from "./ttsControls";
import { useChargeAsk } from "./tableVerbs";
import { eyeView } from "./UnitCard";

/**
 * Keys on the table (UX 84 §5, §8).
 *
 * Hold to peek, let go to come back: X sees through terrain, N shows every
 * unit's name, L looks from the eyes of the unit under the pointer (or the
 * one picked). The View ▾ toggles stay for a lasting setting.
 *
 * Verbs for the unit you picked, each in its own phase: S shoots, A advances,
 * C charges and F fights (F moves it down a floor otherwise, and S picks up
 * the stratagem hand). Each opens what its button on the unit card does. With TTS controls on, WASD is the camera's,
 * so A and S stay the camera's too.
 */

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable]");

/** The peek held now, and what it put back on letting go. */
let held: { key: string; undo: () => void } | null = null;

function peek(key: string): (() => void) | null {
  const s = useStore.getState();
  if (key === "x") {
    if (s.xray) return null;
    s.set({ xray: true });
    return () => useStore.getState().set({ xray: false });
  }
  if (key === "n") {
    if (s.plates) return null;
    s.set({ plates: true });
    return () => useStore.getState().set({ plates: false });
  }
  if (key === "l") {
    const model = pointerModel.id ? s.game.models[pointerModel.id] : undefined;
    const unitId = model?.unitId ?? s.hoverUnit ?? s.selected;
    if (!unitId || s.view === "eye") return null;
    const view = s.view;
    eyeView(unitId);
    return () => {
      const now = useStore.getState();
      if (now.view === "eye") now.setView(view);
    };
  }
  return null;
}

/** A verb key for the picked unit: true when it did something. */
function verb(key: string): boolean {
  const s = useStore.getState();
  const unit = s.selected ? s.game.units[s.selected] : undefined;
  if (!unit || s.role === "spectator" || s.scrub !== null || s.game.turn.round === 0) return false;
  if (s.mode !== "hotseat" && unit.owner !== s.session?.selfId) return false;
  if (!systemModule(s.game.system).dedicatedUi) return false;
  const tts = useTtsControls.getState().on;
  const phase = phaseName(s.game);
  if (key === "s" && !tts && phase === "Shooting" && mainWeapon(s.game, unit, "ranged")) {
    s.setDraft({ attackerId: unit.id, kind: "ranged", picking: true, all: true });
    return true;
  }
  if (key === "a" && !tts && phase === "Movement" && !realDiceOn()) {
    s.dispatch({ type: "dice/roll", count: 1, sides: 6, label: "advance", unitId: unit.id }, unit.owner);
    return true;
  }
  if (key === "c" && phase === "Charge") {
    useChargeAsk.setState({ ask: { unitId: unit.id, targets: [] } });
    return true;
  }
  if (key === "f" && phase === "Fight" && mainWeapon(s.game, unit, "melee")) {
    s.setDraft({ attackerId: unit.id, kind: "melee", picking: true });
    return true;
  }
  return false;
}

export function useTableKeys(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (e.repeat) {
        if (held?.key === key) e.preventDefault();
        return;
      }
      if (!held && (key === "x" || key === "n" || key === "l")) {
        const undo = peek(key);
        if (undo) {
          held = { key, undo };
          e.preventDefault();
        }
        return;
      }
      // Before the other keys on the table (F's floor, the hand's S) hear it.
      if (verb(key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (held?.key !== e.key.toLowerCase()) return;
      held.undo();
      held = null;
    };
    // Let go anywhere else (the window loses focus): back as it was.
    const blur = () => {
      held?.undo();
      held = null;
    };
    addEventListener("keydown", down, { capture: true });
    addEventListener("keyup", up, { capture: true });
    addEventListener("blur", blur);
    return () => {
      removeEventListener("keydown", down, { capture: true });
      removeEventListener("keyup", up, { capture: true });
      removeEventListener("blur", blur);
      blur();
    };
  }, []);
}
