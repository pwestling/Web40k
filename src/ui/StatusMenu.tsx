import { useRef } from "react";
import { t } from "../i18n";

interface StatusItem {
  key: string;
  label: string;
  on: boolean;
  /** What clearing it is called, when "Clear …" won't do ("Undo activation"). */
  clear?: string;
  /** Asked before it's taken off (Undo activation): a slip shouldn't undo a unit's go. */
  confirm?: string;
}

/**
 * A unit's statuses, changed on purpose (UX 399): the chips only show them,
 * and this ⋯ menu beside them sets or clears one, each change in the log.
 */
export function StatusMenu({
  items,
  unitName,
  onChange,
}: {
  items: StatusItem[];
  unitName: string;
  onChange: (key: string, on: boolean) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  if (!items.length) return null;
  return (
    <details className="menu status-menu" ref={menu}>
      <summary aria-label={t("Change {unit}'s status", { unit: unitName })} title={t("Change a status")}>
        ⋯
      </summary>
      <div className="menu-items">
        {items.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              if (s.on && s.confirm && !confirm(s.confirm)) return;
              onChange(s.key, !s.on);
              menu.current?.removeAttribute("open");
            }}
          >
            {s.on
              ? (s.clear ?? t("Clear {status}", { status: s.label }))
              : t("Mark {status}", { status: s.label })}
          </button>
        ))}
      </div>
    </details>
  );
}
