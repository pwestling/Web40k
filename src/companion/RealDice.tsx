import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { diceWanted, type GameState, type Intent, type PlayerId } from "../core";
import { useHoldToShake } from "./Shake";
import { t, tn } from "../i18n";
import { useStore } from "../store";

const KEY = "open-battle:own-dice";
const SHAKE = "open-battle:shake-dice";

const stored = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const keep = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Not remembered; it still holds for now.
  }
};

/**
 * How this device's player rolls (#37, UX 501), remembered on the device:
 * the game rolls at a click (both off), you hold to shake and let go
 * (`shake`), or you roll real dice and type them in (`own`).
 */
const useOwnDice = create<{
  own: boolean;
  shake: boolean;
  set: (own: boolean) => void;
  setShake: (shake: boolean) => void;
}>((set) => ({
  own: stored(KEY),
  shake: !stored(KEY) && stored(SHAKE),
  set: (own) => {
    keep(KEY, own);
    if (own) keep(SHAKE, false);
    set(own ? { own, shake: false } : { own });
  },
  setShake: (shake) => {
    keep(SHAKE, shake);
    if (shake) keep(KEY, false);
    set(shake ? { shake, own: false } : { shake });
  },
}));

/** Real dice can't be checked over the internet, so ranked and event games roll on screen (UX 501). */
function realDiceAllowed(game: GameState): boolean {
  return !game.ranked && !game.settings.event;
}

/** Real dice in this game: chosen on this device, and allowed here. */
export function useRealDice(): boolean {
  const own = useOwnDice((s) => s.own);
  const allowed = useStore((s) => realDiceAllowed(s.game));
  return own && allowed;
}

/** "Dice" in the 🔊 menu (UX 501): the game rolls, you hold to shake, or you roll real dice. */
export function DiceChoice() {
  const { own, shake, set, setShake } = useOwnDice();
  const allowed = useStore((s) => realDiceAllowed(s.game));
  const pick = (mode: "game" | "shake" | "real") => {
    if (mode === "real") set(true);
    else if (mode === "shake") setShake(true);
    else {
      set(false);
      setShake(false);
    }
  };
  const mode = own ? "real" : shake ? "shake" : "game";
  return (
    <fieldset className="dice-choice">
      <legend>{t("Dice")}</legend>
      <label className="check">
        <input type="radio" name="dice-choice" checked={mode === "game"} onChange={() => pick("game")} />{" "}
        {t("The game rolls at a click")}
      </label>
      <label className="check">
        <input type="radio" name="dice-choice" checked={mode === "shake"} onChange={() => pick("shake")} />{" "}
        {t("Roll the dice myself: hold to shake, let go to roll")}
      </label>
      <label className="check">
        <input type="radio" name="dice-choice" checked={mode === "real"} onChange={() => pick("real")} />{" "}
        {t("I roll real dice and type them in")}
      </label>
      {mode === "shake" && (
        <p className="muted small">{t("The game still rolls the dice; you choose when.")}</p>
      )}
      {mode === "real" && !allowed && (
        <p className="muted small">
          {t(
            "This game rolls on screen: nobody can check a real roll over the internet in a ranked or event game.",
          )}
        </p>
      )}
    </fieldset>
  );
}

/** On screen or my own dice: the companion's switch for every roll, one small toggle (UX 274). */
export function OwnDiceSwitch() {
  const { own, set } = useOwnDice();
  return (
    <button
      className={`own-dice${own ? " on" : ""}`}
      aria-pressed={own}
      title={own ? t("You roll your own dice and tap in the faces") : t("Dice roll on screen")}
      onClick={() => set(!own)}
    >
      {own ? t("✋ My dice") : t("🎲 Screen dice")}
    </button>
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
  const own = useRealDice();
  const shake = useOwnDice((s) => s.shake);
  const [entering, setEntering] = useState(false);
  const roll = () => {
    useStore.getState().dispatch(intent, as);
    onRolled?.();
  };
  const hold = useHoldToShake(shake && !own, intent, as, roll);
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
  if (!own)
    return (
      <>
        <button
          className={className}
          title={shake ? (title ? `${title}. ` : "") + t("Hold to shake, let go to roll") : title}
          {...hold.handlers}
        >
          {children}
        </button>
        {hold.tray}
      </>
    );
  return (
    <button
      className={className}
      title={title}
      onClick={() => {
        // Nothing to roll after all (a fixed number of attacks): no faces to ask for.
        const { record, game, session } = useStore.getState();
        if (diceWanted(record, intent, as ?? session?.selfId ?? "local", [], game) === null) return roll();
        setEntering(true);
      }}
    >
      {children} ✋
    </button>
  );
}

/**
 * The faces of real dice, a batch at a time (re-rolls come as a later batch).
 * Each face has a count (UX 272): tap a face once per die, or set "nine 4s"
 * with its − and + or by typing the number. A batch goes in once its counts
 * add up to the dice rolled.
 */
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
  /** Faces of the batches already in, in order. */
  const [done, setDone] = useState<number[]>([]);
  /** This batch: how many dice show each face. */
  const [counts, setCounts] = useState<Record<number, number>>({});
  const wanted = diceWanted(record, intent, by, done, game);
  const batch = wanted && wanted !== "bad" ? wanted : null;
  const sides = batch?.sides ?? null;
  const have = Object.values(counts).reduce((a, b) => a + b, 0);
  const setCount = (face: number, n: number) => {
    if (!batch) return;
    // A count past the dice rolled stands, and says so: at a table that is usually a miscount (UX 281).
    const next = { ...counts, [face]: Math.max(0, n) };
    const total = Object.values(next).reduce((a, b) => a + b, 0);
    if (total !== batch.count) return setCounts(next);
    // The batch is complete: its faces go in (highest first) and the next batch, if any, is asked for.
    const faces = Object.entries(next)
      .flatMap(([f, k]) => Array.from({ length: k }, () => Number(f)))
      .sort((a, b) => b - a);
    setDone([...done, ...faces]);
    setCounts({});
  };
  const send = () => {
    useStore.getState().dispatch({ ...intent, told: done } as unknown as Intent, as);
    onDone();
  };
  return (
    <div className="dice-entry" role="group" aria-label={t("Your dice")}>
      <p>
        {wanted === "bad" ? (
          <span className="warn">{t("Those don't fit: start this roll again.")}</span>
        ) : wanted === null ? (
          <strong>{t("That's every die.")}</strong>
        ) : done.length === 0 ? (
          <strong>
            {tn(wanted.count, "Roll {n} D{sides}", "Roll {n} D{sides}", { sides: wanted.sides })}
          </strong>
        ) : (
          <strong>
            {tn(wanted.count, "Roll {n} more D{sides}", "Roll {n} more D{sides}", { sides: wanted.sides })}
          </strong>
        )}{" "}
        {batch && have > batch.count ? (
          <span className="warn">
            {t("{have} of {all}, {n} too many", { have, all: batch.count, n: have - batch.count })}
          </span>
        ) : batch ? (
          <span className="muted small">
            {t("{have} of {all}: how many show each face?", { have, all: batch.count })}
          </span>
        ) : null}
      </p>
      {done.length > 0 && (
        <div className="row wrap told">
          {done.map((f, i) => (
            <span key={i} className="die told-die">
              {f}
            </span>
          ))}
        </div>
      )}
      {sides !== null && sides <= 12 && (
        <div className="faces">
          {Array.from({ length: sides }, (_, i) => i + 1).map((f) => (
            <div key={f} className="face-count">
              <button
                className="face"
                aria-label={t("One more {face}", { face: f })}
                onClick={() => setCount(f, (counts[f] ?? 0) + 1)}
              >
                {f}
              </button>
              <div className="row">
                <button
                  className="small"
                  aria-label={t("One fewer {face}", { face: f })}
                  disabled={!counts[f]}
                  onClick={() => setCount(f, (counts[f] ?? 0) - 1)}
                >
                  −
                </button>
                <input
                  inputMode="numeric"
                  aria-label={t("Dice showing {face}", { face: f })}
                  value={counts[f] ?? 0}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setCount(f, Number(e.target.value.replace(/\D/g, "")) || 0)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {sides !== null && sides > 12 && (
        <BigDie sides={sides} add={(f) => setCount(f, (counts[f] ?? 0) + 1)} />
      )}
      <div className="row wrap">
        <button className="primary" disabled={wanted !== null} onClick={send}>
          {t("Use these dice")}
        </button>
        {(done.length > 0 || have > 0) && (
          <button
            onClick={() => {
              setDone([]);
              setCounts({});
            }}
          >
            {t("Start again")}
          </button>
        )}
        {done.length === 0 && have === 0 && <button onClick={onScreen}>{t("Roll on screen instead")}</button>}
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
