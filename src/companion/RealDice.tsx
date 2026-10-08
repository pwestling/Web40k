import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { diceWanted, type Intent, type PlayerId } from "../core";
import { t, tn } from "../i18n";
import { useStore } from "../store";

const KEY = "open-battle:own-dice";

/** Whether this device's player rolls their own dice and types them in (#37), remembered on the device. */
export const useOwnDice = create<{ own: boolean; set: (own: boolean) => void }>((set) => ({
  own: (() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  })(),
  set: (own) => {
    try {
      localStorage.setItem(KEY, own ? "1" : "0");
    } catch {
      // Not remembered; it still holds for now.
    }
    set({ own });
  },
}));

/** Only a table companion game offers real dice: on the 3D table the dice roll on screen. */
export function useCompanion(): boolean {
  return useStore((s) => !!s.game.settings.companion);
}

/** On screen or my own dice: the companion's switch for every roll. */
export function OwnDiceSwitch() {
  const { own, set } = useOwnDice();
  return (
    <div className="own-dice row" role="group" aria-label={t("Dice")}>
      <button className={own ? "" : "on"} aria-pressed={!own} onClick={() => set(false)}>
        {t("🎲 Roll on screen")}
      </button>
      <button className={own ? "on" : ""} aria-pressed={own} onClick={() => set(true)}>
        {t("✋ My own dice")}
      </button>
    </div>
  );
}

/**
 * A roll. On the 3D table, or with on-screen dice, it rolls at once. With
 * your own dice it asks for the faces first, re-rolls included, then sends
 * them with the intent.
 */
export function RollButton({
  intent,
  as,
  className,
  title,
  children,
  onRolled,
}: {
  intent: Intent;
  as?: PlayerId;
  className?: string;
  title?: string;
  children: ReactNode;
  onRolled?: () => void;
}) {
  const companion = useCompanion();
  const own = useOwnDice((s) => s.own);
  const [entering, setEntering] = useState(false);
  const roll = () => {
    useStore.getState().dispatch(intent, as);
    onRolled?.();
  };
  if (entering)
    return (
      <DiceEntry
        intent={intent}
        as={as}
        onDone={() => {
          setEntering(false);
          onRolled?.();
        }}
        onCancel={() => setEntering(false)}
        onScreen={() => {
          setEntering(false);
          roll();
        }}
      />
    );
  return (
    <button
      className={className}
      title={title}
      onClick={() => {
        if (!companion || !own) return roll();
        // Nothing to roll after all (a fixed number of attacks): no faces to ask for.
        const { record, game, session } = useStore.getState();
        if (diceWanted(record, intent, as ?? session?.selfId ?? "local", [], game) === null) return roll();
        setEntering(true);
      }}
    >
      {children}
      {companion && own ? " ✋" : ""}
    </button>
  );
}

/** The faces of real dice, typed in one tap per die. */
function DiceEntry({
  intent,
  as,
  onDone,
  onCancel,
  onScreen,
}: {
  intent: Intent;
  as?: PlayerId;
  onDone: () => void;
  onCancel: () => void;
  onScreen: () => void;
}) {
  const record = useStore((s) => s.record);
  const game = useStore((s) => s.game);
  const by = as ?? useStore.getState().session?.selfId ?? "local";
  const [faces, setFaces] = useState<number[]>([]);
  const wanted = diceWanted(record, intent, by, faces, game);
  const send = () => {
    useStore.getState().dispatch({ ...intent, told: faces } as unknown as Intent, as);
    onDone();
  };
  const sides = wanted && wanted !== "bad" ? wanted.sides : null;
  return (
    <div className="dice-entry" role="group" aria-label={t("Your dice")}>
      <p>
        {wanted === "bad" ? (
          <span className="warn">{t("Those don't fit: take the last one off and check it.")}</span>
        ) : wanted === null ? (
          <strong>{t("That's every die.")}</strong>
        ) : faces.length === 0 ? (
          <strong>
            {tn(wanted.count, "Roll {n} D{sides}", "Roll {n} D{sides}", { sides: wanted.sides })}
          </strong>
        ) : (
          <strong>
            {tn(wanted.count, "Roll {n} more D{sides}", "Roll {n} more D{sides}", { sides: wanted.sides })}
          </strong>
        )}{" "}
        {sides !== null && <span className="muted small">{t("Tap each die's face.")}</span>}
      </p>
      {faces.length > 0 && (
        <div className="row wrap told">
          {faces.map((f, i) => (
            <span key={i} className="die told-die">
              {f}
            </span>
          ))}
          <button className="small quiet" onClick={() => setFaces(faces.slice(0, -1))}>
            {t("⌫ Undo")}
          </button>
        </div>
      )}
      {sides !== null && sides <= 12 && (
        <div className="faces">
          {Array.from({ length: sides }, (_, i) => i + 1).map((f) => (
            <button key={f} className="face" onClick={() => setFaces([...faces, f])}>
              {f}
            </button>
          ))}
        </div>
      )}
      {sides !== null && sides > 12 && <BigDie sides={sides} add={(f) => setFaces([...faces, f])} />}
      <div className="row">
        <button className="primary" disabled={wanted !== null} onClick={send}>
          {t("Use these dice")}
        </button>
        {faces.length === 0 && <button onClick={onScreen}>{t("Roll on screen instead")}</button>}
        <button className="quiet" onClick={onCancel}>
          {t("Back")}
        </button>
      </div>
    </div>
  );
}

/** A die with too many faces for buttons (a D20): type it. */
function BigDie({ sides, add }: { sides: number; add: (face: number) => void }) {
  const [value, setValue] = useState("");
  const n = Number(value);
  const ok = Number.isInteger(n) && n >= 1 && n <= sides;
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        add(n);
        setValue("");
      }}
    >
      <input
        inputMode="numeric"
        aria-label={t("Face")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        size={4}
      />
      <button disabled={!ok}>{t("Add")}</button>
    </form>
  );
}
