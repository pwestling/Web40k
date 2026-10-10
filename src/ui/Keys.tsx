import { useEffect } from "react";
import { t } from "../i18n";
import { useHelp } from "./help";
import { TextSizePicker } from "./TextSizePicker";
import { touch } from "./touch";
import { setTtsControls, useTtsControls } from "./ttsControls";

/** Each control and what it does; a function so the text is in the chosen language. */
const keys = (): [string, string][] => [
  [t("Click a unit"), t("Select it: its card on the right shows what it can do")],
  ["[ / ]", t("Select your previous or next unit (Shift: the other side's)")],
  [t("Arrow keys"), t('Move the selected unit 1" (Shift: ¼"), up being away from the camera')],
  [t("Enter"), t("Go from the table into the selected unit's card")],
  [t("Tab"), t("Move between buttons; Enter or Space presses one")],
  [t("Drag a unit"), t("Move it; the ruler shows how far against its limit")],
  [t("Alt + drag"), t("Move a unit, stopping at its limit")],
  [t("Shift + drag"), t("Move a regiment block freely, not just straight ahead")],
  ["Q / E", t("Turn the selected unit (or terrain piece while editing)")],
  ["R / F", t("Move the selected unit up or down a floor")],
  ["M", t("Measure: then drag across the table")],
  [t("Alt + click"), t("Ping a spot for everyone")],
  [t("Hold V"), t("Talk, once your mic is on (Voice, bottom left)")],
  [t("Left drag on the table"), t("Turn the camera")],
  [t("Right drag"), t("Slide the camera")],
  [t("Wheel"), t("Zoom")],
  [t("Home"), t("Reset the camera")],
  [t("Esc"), t("Clear: selection, ruler, pen")],
  [
    t("Delete"),
    t("Remove the model under the pointer as a casualty, asking first (editing: the terrain piece)"),
  ],
  ["?", t("This sheet")],
];

/** What a Tabletop Simulator player reaches for, and where it is here (PX TTS reflexes). */
const fromTts = (): [string, string][] => [
  [t("Drag a unit"), t("Moves the whole unit; Shift + drag moves just the one model")],
  ["Q / E", t("Turn, as in Tabletop Simulator")],
  ["M", t("Measure (with TTS controls, hold Tab)")],
  [t("Delete"), t("Remove the model under the pointer as a casualty")],
  [t("Drop a model off the table"), t("Remove it as a casualty (asking first)")],
  [t("Camera"), t("With TTS controls: right drag turns, WASD slides, left drag picks with a box")],
];

/** The same for fingers (#60): a tablet or phone gets these first. */
const gestures = (): [string, string][] => [
  [t("Tap a unit"), t("Select it: its card shows what it can do")],
  [t("Drag a unit"), t("Move it (hold the table for one model at a time)")],
  [t("One finger on the table"), t("Slide the camera")],
  [t("Two fingers"), t("Pinch to zoom, twist to turn the camera")],
  [t("Two fingers on the selected unit"), t("Twist to turn it (a regiment block wheels)")],
  [t("Hold, then drag"), t("Measure")],
  [t("Hold and let go"), t("More: turn, ping, look from here, views")],
  [t("Select several"), t("Draw a box on the table, then drag one unit to move them all")],
  [t("A stylus on the table"), t("Draw a line everyone sees")],
  [t("Flick the unit card right"), t("Put it away (tap a unit to bring it back)")],
];

/** The "?" sheet (front door): every control in one place. */
export function KeysSheet() {
  const open = useHelp((s) => s.keys);
  const tts = useTtsControls((s) => s.on);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && useHelp.setState({ keys: false });
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => useHelp.setState({ keys: false })}>
      <div
        className="panel modal keys-sheet"
        role="dialog"
        aria-label={t("Controls")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>{t("Controls")}</h2>
          <button
            className="quiet"
            title={t("Close (Esc)")}
            onClick={() => useHelp.setState({ keys: false })}
          >
            ✕
          </button>
        </div>
        <table>
          <tbody>
            {(touch() ? [...gestures(), ...keys()] : keys()).map(([k, what]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{t("Coming from Tabletop Simulator?")}</h3>
        <table className="from-tts">
          <tbody>
            {fromTts().map(([k, what]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="check">
          <input type="checkbox" checked={tts} onChange={(e) => setTtsControls(e.target.checked)} />
          {t("TTS controls (just on this device)")}
        </label>
        <TextSizePicker />
        <p className="muted small">
          {t("The ▶ at the top moves the game on. Everything can be undone from the left panel.")}
        </p>
      </div>
    </div>
  );
}
