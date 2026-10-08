import { useEffect } from "react";
import { useHelp } from "./help";
import { TextSizePicker } from "./TextSizePicker";

const KEYS: [string, string][] = [
  ["Click a unit", "Select it: its card on the right shows what it can do"],
  ["[ / ]", "Select your previous or next unit (Shift: the other side's)"],
  ["Arrow keys", 'Move the selected unit 1" (Shift: ¼"), up being away from the camera'],
  ["Enter", "Go from the table into the selected unit's card"],
  ["Tab", "Move between buttons; Enter or Space presses one"],
  ["Drag a unit", "Move it; the ruler shows how far against its limit"],
  ["Alt + drag", "Move a unit, stopping at its limit"],
  ["Shift + drag", "Move a regiment block freely, not just straight ahead"],
  ["Q / E", "Turn the selected unit (or terrain piece while editing)"],
  ["R / F", "Move the selected unit up or down a floor"],
  ["M", "Measure: then drag across the table"],
  ["Alt + click", "Ping a spot for everyone"],
  ["Hold V", "Talk, once your mic is on (Voice, bottom left)"],
  ["Left drag on the table", "Turn the camera"],
  ["Right drag", "Slide the camera"],
  ["Wheel", "Zoom"],
  ["Home", "Reset the camera"],
  ["Esc", "Clear: selection, ruler, pen"],
  ["Delete", "Remove the selected terrain piece (while editing)"],
  ["?", "This sheet"],
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
        aria-label="Controls"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>Controls</h2>
          <button className="quiet" title="Close (Esc)" onClick={() => useHelp.setState({ keys: false })}>
            ✕
          </button>
        </div>
        <table>
          <tbody>
            {KEYS.map(([k, what]) => (
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
          The ▶ at the top moves the game on. Everything can be undone from the left panel.
        </p>
      </div>
    </div>
  );
}
