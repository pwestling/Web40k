import { t } from "../i18n";
import { setTextSize, TEXT_SIZES, useTextSize } from "./textSize";

/** Text size, for this device (#25). */
export function TextSizePicker() {
  const size = useTextSize((s) => s.size);
  return (
    <div className="row text-size" role="group" aria-label={t("Text size")}>
      <span>{t("Text size")}</span>
      {TEXT_SIZES.map((s) => (
        <button
          key={s.id}
          className={size === s.id ? "on" : ""}
          aria-pressed={size === s.id}
          style={{ fontSize: `${s.scale}em` }}
          onClick={() => setTextSize(s.id)}
        >
          {s.label()}
        </button>
      ))}
    </div>
  );
}
