import { useEffect } from "react";
import { t } from "../i18n";
import { useHelp } from "./help";
import { TextSizePicker } from "./TextSizePicker";
import { touch } from "./touch";

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
  [t("Delete"), t("Remove the selected terrain piece (while editing)")],
  ["?", t("This sheet")],
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
];

/** The "?" sheet (front door): every control in one place. */
export function KeysSheet() {
  const open = useHelp((s) => s.keys);
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
        <TextSizePicker />
        <p className="muted small">
          {t("The ▶ at the top moves the game on. Everything can be undone from the left panel.")}
        </p>
      </div>
    </div>
  );
}
