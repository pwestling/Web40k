import { create } from "zustand";
import { t } from "../i18n";
import { useStore } from "../store";

/** What the library had to say about a TTS table opened as a game, and that table's id in the table library. */
export const useTtsNote = create<{ note: string; table: string }>(() => ({ note: "", table: "" }));

/**
 * The library's note about a TTS table (models that couldn't be read, things
 * off the table), on the game it opened (UX 478): the library closes so the
 * table can be touched, and the note stays until the player closes it.
 */
export function TtsNote() {
  const { note, table } = useTtsNote();
  const here = useStore((s) => !!table && s.game.tableSource?.key === `table:${table}`);
  if (!note || !here) return null;
  return (
    <div className="tts-note small" role="status">
      <span>{note}</span>
      <button
        className="quiet small"
        aria-label={t("Close")}
        onClick={() => useTtsNote.setState({ note: "" })}
      >
        ✕
      </button>
    </div>
  );
}
