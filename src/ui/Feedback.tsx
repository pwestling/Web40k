import { useState } from "react";
import { useStore } from "../store";
import { APP_BUILD } from "../version";
import { download, stamp } from "./report";

const QUESTIONS = [
  { id: "enjoyed", label: "What was fun?" },
  { id: "confusing", label: "What was confusing or slow?" },
  { id: "broken", label: "Anything broken?" },
] as const;

/**
 * After the battle, an optional few questions (playtest kit, roadmap #21).
 * The answers become a file on this device and go nowhere else: the player
 * passes it on if they want to.
 */
export function FeedbackCard() {
  const players = useStore((s) => s.role !== "spectator");
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  if (!players) return null;
  if (!open)
    return (
      <button className="link feedback-open" onClick={() => setOpen(true)}>
        How was it? Leave feedback (optional, saved as a file)
      </button>
    );
  const save = () => {
    const { game, record, mode } = useStore.getState();
    download(`open-battle-feedback-${stamp()}.json`, {
      format: "open-battle/feedback@1",
      at: new Date().toISOString(),
      build: APP_BUILD,
      system: game.system ?? null,
      mode,
      rounds: game.turn.round,
      events: record.events.length,
      rating,
      answers,
    });
    setSaved(true);
  };
  return (
    <section className="feedback">
      <h4>How was it?</h4>
      <div className="row" role="radiogroup" aria-label="Overall, out of 5">
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
        <span className="muted small">out of 5</span>
      </div>
      {QUESTIONS.map((q) => (
        <label key={q.id}>
          {q.label}
          <textarea
            rows={2}
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
          />
        </label>
      ))}
      <div className="row">
        <button className="primary" onClick={save}>
          {saved ? "Saved ✓" : "Save as a file"}
        </button>
        <span className="muted small">Stays on this device until you send it to someone.</span>
      </div>
    </section>
  );
}
