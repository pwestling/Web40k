import { setTextSize, TEXT_SIZES, useTextSize } from "./textSize";

/** Text size, for this device (#25). */
export function TextSizePicker() {
  const size = useTextSize((s) => s.size);
  return (
    <div className="row text-size" role="group" aria-label="Text size">
      <span>Text size</span>
      {TEXT_SIZES.map((t) => (
        <button
          key={t.id}
          className={size === t.id ? "on" : ""}
          aria-pressed={size === t.id}
          style={{ fontSize: `${t.scale}em` }}
          onClick={() => setTextSize(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
