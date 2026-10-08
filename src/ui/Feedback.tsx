import { useState } from "react";
import { t } from "../i18n";
import { useStore } from "../store";
import { APP_BUILD } from "../version";
import { stamp } from "./report";
import { saveJson } from "./files";
import { SavedNote } from "./SavedNote";
import { DEFAULT_SYSTEM } from "../core";

const questions = () =>
  [
    { id: "enjoyed", label: t("What was fun?") },
    { id: "confusing", label: t("What was confusing or slow?") },
    { id: "broken", label: t("Anything broken?") },
  ] as const;

/**
 * After the battle, an optional few questions (playtest kit, roadmap #21).
 * The 1–5 row sits right under the result (UX 172); picking a number opens
 * the questions. The answers become a file on this device and go nowhere
 * else: the player passes it on if they want to.
 */
export function FeedbackCard() {
  const players = useStore((s) => s.role !== "spectator");
  const [rating, setRating] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  if (!players) return null;
  const save = () => {
    const { game, record, mode } = useStore.getState();
    const file = saveJson(`open-battle-feedback-${stamp()}.json`, {
      format: "open-battle/feedback@1",
      at: new Date().toISOString(),
      build: APP_BUILD,
      system: game.system ?? DEFAULT_SYSTEM,
      mode,
      rounds: game.turn.round,
      events: record.events.length,
      rating,
      answers,
    });
    setSaved(file);
  };
  return (
    <section className="feedback">
      <h4>
        {t("How was it?")}{" "}
        <span className="muted small">{t("Optional, saved as a file on this device")}</span>
      </h4>
      <div className="row" role="radiogroup" aria-label={t("Overall, out of 5")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={rating === n ? "on" : ""}
            aria-pressed={rating === n}
            onClick={() => setRating(n)}
          >
            {n}
          </button>
        ))}
        <span className="muted small">{t("out of 5")}</span>
      </div>
      {rating !== null &&
        questions().map((q) => (
          <label key={q.id}>
            {q.label}
            <textarea
              rows={2}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            />
          </label>
        ))}
      {rating !== null && (
        <div className="row">
          <button className="primary" onClick={save}>
            {saved ? t("Saved ✓") : t("Save as a file")}
          </button>
        </div>
      )}
      {/* i18n-ignore: a kind, not text */}
      {saved && <SavedNote file={saved} kind="feedback" />}
    </section>
  );
}
