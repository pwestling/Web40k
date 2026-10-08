import { useEffect, useRef, useState } from "react";
import type { DiceSet, PlayerId } from "../core";
import { useStore } from "../store";
import { t } from "../i18n";
import { diceLook, finishes, PRESETS } from "./diceSets";
import { makeDie, showFace } from "./DiceTray";
import { click, rattle } from "./sound";

const CUSTOM = "custom";
const COLOUR = "colour";

/**
 * Pick your dice (PX-5b), beside the army: a preset, or your own body and pip
 * colours and a finish. Each pick rolls three of them, so you feel the choice.
 */
export function DicePicker({ player }: { player: PlayerId }) {
  const p = useStore((s) => s.game.players[player]);
  const dispatch = useStore((s) => s.dispatch);
  // On one screen, say whose dice these are (UX 159).
  const hotseat = useStore((s) => s.mode === "hotseat");
  const [custom, setCustom] = useState(false);
  const tray = useRef<HTMLDivElement>(null);
  // Dragging a colour picker sends a stream of colours: settle on one before it goes in the log.
  const [draft, setDraft] = useState<DiceSet | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Three dice of the current set waiting in the tray, before any pick.
  const first = useRef(p ? diceLook(p, p.color) : null);
  useEffect(() => {
    if (first.current) lay(tray.current, first.current, false);
  }, []);
  if (!p) return null;
  const preset = p.dice ? PRESETS.findIndex((x) => sameSet(x.dice, p.dice!)) : -1;
  const value = custom || (p.dice && preset < 0) ? CUSTOM : p.dice ? String(preset) : COLOUR;

  const pick = (dice: DiceSet | null) => {
    dispatch({ type: "player/dice", player, dice }, player);
    tryOut(diceLook(dice ? { color: p.color, dice } : p, p.color));
  };
  const tryOut = (look: DiceSet) => {
    rattle();
    lay(tray.current, look, true);
  };
  const set = draft ?? p.dice ?? { body: p.color, pip: "#10141a", finish: "solid" as const };
  const pickSoon = (dice: DiceSet) => {
    setDraft(dice);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDraft(null);
      pick(dice);
    }, 400);
  };

  return (
    <div className="dice-picker">
      <label>
        {hotseat ? t("{name}'s dice", { name: p.name }) : t("Your dice")}{" "}
        <select
          aria-label={t("Dice")}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setCustom(v === CUSTOM);
            if (v === COLOUR) pick(null);
            else if (v === CUSTOM) pick(set);
            else pick(PRESETS[Number(v)]!.dice);
          }}
        >
          <option value={COLOUR}>{t("Player colour")}</option>
          {PRESETS.map((x, i) => (
            <option key={i} value={i}>
              {x.name()}
            </option>
          ))}
          <option value={CUSTOM}>{t("Custom…")}</option>
        </select>
      </label>
      {value === CUSTOM && (
        <div className="custom">
          <label>
            {t("Body")}{" "}
            <input
              type="color"
              value={set.body}
              onChange={(e) => pickSoon({ ...set, body: e.target.value })}
            />
          </label>
          <label>
            {t("Pips")}{" "}
            <input type="color" value={set.pip} onChange={(e) => pickSoon({ ...set, pip: e.target.value })} />
          </label>
          <select
            aria-label={t("Finish")}
            value={set.finish}
            onChange={(e) => pick({ ...set, finish: e.target.value as DiceSet["finish"] })}
          >
            {finishes().map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div
        ref={tray}
        className="dice-try"
        title={t("Roll them again")}
        onClick={() => tryOut(diceLook(p, p.color))}
      />
    </div>
  );
}

/** Three dice in the try-out tray: rolled in with clicks, or just sitting there. */
function lay(box: HTMLDivElement | null, look: DiceSet, roll: boolean): void {
  if (!box) return;
  box.innerHTML = "";
  [0, 1, 2].forEach((i) => {
    const el = makeDie(look, 30);
    el.style.left = `${14 + i * 44 + (roll ? Math.random() * 10 : 5)}px`;
    if (roll) {
      el.style.animationDelay = `${i * 60}ms`;
      el.classList.add("rolling");
      setTimeout(() => click(0.6, 1 + i * 0.1, 0), 520 + i * 60);
    }
    showFace(el, roll ? 1 + Math.floor(Math.random() * 6) : [6, 3, 5][i]!, 6);
    box.append(el);
  });
}

const sameSet = (a: DiceSet, b: DiceSet) =>
  a.body.toLowerCase() === b.body.toLowerCase() &&
  a.pip.toLowerCase() === b.pip.toLowerCase() &&
  a.finish === b.finish;
