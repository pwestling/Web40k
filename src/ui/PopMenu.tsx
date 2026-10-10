import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a small menu of less used controls (UX 83, declutter):
 * closes on Esc, a click anywhere else, or a click on one of its buttons
 * (a checkbox or a field inside keeps it open). `side` says which edge of
 * the button the menu lines up with.
 */
export function PopMenu({
  label,
  title,
  className = "",
  side = "left",
  children,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  side?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("keydown", key);
    addEventListener("pointerdown", away, { capture: true });
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("pointerdown", away, { capture: true });
    };
  }, [open]);
  return (
    <div className={`overflow pop-menu ${className}`} ref={box}>
      <button aria-expanded={open} aria-haspopup="menu" title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div
          className={`menu ${side === "left" ? "menu-left" : ""}`}
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
