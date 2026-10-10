import { create } from "zustand";
import { t } from "../i18n";
import { useStore } from "../store";

/** What the library had to say about a TTS table opened as a game, and the tag its armies were deployed with. */
export const useTtsNote = create<{ note: string; tag: string }>(() => ({ note: "", tag: "" }));

/**
 * The library's note about a TTS table (models that couldn't be read, things
 * off the table), on the game it opened (UX 478): the library closes so the
 * table can be touched, and the note stays until the player closes it.
 */
export function TtsNote() {
  const { note, tag } = useTtsNote();
  const here = useStore((s) => !!tag && Object.keys(s.game.units).some((id) => id.includes(`-${tag}-`)));
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
