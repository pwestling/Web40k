import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { t } from "../i18n";
import { focusOn } from "../render/focus";
import { useCanControl, useStore } from "../store";
import { aliveModels } from "../systems/wh40k/rules";
import { useGame } from "./hooks";
import { playerShape } from "./sides";
import { checkName, overrideKey, placement, tableWarnings, type TableWarning } from "./warnings";

/** This screen's view of the panel: open or not, and what was dismissed here. */
const usePanel = create<{ open: boolean; dismissed: Record<string, true> }>(() => ({
  open: false,
  dismissed: {},
}));

/** Open the panel (the module workshop's test table). */
export const openWarnings = () => usePanel.setState({ open: true });

/** The table's warnings, less the ones dismissed on this screen. */
export function useWarnings(): TableWarning[] {
  const game = useGame();
  const dismissed = usePanel((s) => s.dismissed);
  const all = useMemo(() => tableWarnings(game), [game]);
  return all.filter((w) => !dismissed[w.key]);
}

/** The top bar's "⚠ 2": hidden while the table is clean. */
export function WarningsButton() {
  const warnings = useWarnings();
  const open = usePanel((s) => s.open);
  if (!warnings.length && !open) return null;
  const serious = warnings.filter((w) => w.severity === "warning").length;
  return (
    <button
      className={`warnings-button${serious ? " has" : ""}${open ? " on" : ""}`}
      title={t("Table warnings: rules the table may be breaking")}
      aria-expanded={open}
      onClick={() => usePanel.setState({ open: !open })}
    >
      ⚠ {warnings.length}
    </button>
  );
}

/** One warning, with its buttons: shared by the panel and the unit card. */
function WarningRow({ w, onShow }: { w: TableWarning; onShow?: (w: TableWarning) => void }) {
  const game = useGame();
  const { dispatch, scrub, role } = useStore();
  const canControl = useCanControl();
  const unit = w.unitId ? game.units[w.unitId] : undefined;
  const yours = !!unit && canControl(unit.owner) && scrub === null && role !== "spectator";
  const text = (
    <>
      {onShow && unit && (
        <span style={{ color: game.players[unit.owner]?.color }}>
          {playerShape(game, unit.owner)} {unit.name}:{" "}
        </span>
      )}
      {w.message}
    </>
  );
  return (
    <li className={w.severity}>
      {onShow ? (
        <button className="link" title={t("Show this unit")} onClick={() => onShow(w)}>
          {text}
        </button>
      ) : (
        <span>{text}</span>
      )}
      <span className="muted small"> {checkName(game, w.checkId)}</span>
      <span className="row">
        {yours && unit && (
          <button
            className="small"
            title={t("Clear this for everyone until the unit moves again (the log notes it)")}
            onClick={() =>
              dispatch(
                {
                  type: "unit/status",
                  id: unit.id,
                  key: overrideKey(w.checkId),
                  value: placement(game, unit),
                },
                unit.owner,
              )
            }
          >
            {t("It's fine (tell everyone)")}
          </button>
        )}
        <button
          className="quiet small"
          title={t("Hide it on this screen")}
          onClick={() => usePanel.setState((s) => ({ dismissed: { ...s.dismissed, [w.key]: true } }))}
        >
          {t("Hide")}
        </button>
      </span>
    </li>
  );
}

/** The selected unit's own warnings, on its card; `skip` what the card already says (its move line, UX 176). */
export function UnitWarnings({ unitId, skip = [] }: { unitId: string; skip?: string[] }) {
  const warnings = useWarnings().filter((w) => w.unitId === unitId && !skip.includes(w.checkId));
  if (!warnings.length) return null;
  return (
    <ul className="table-warnings unit-warnings" aria-label={t("Warnings for this unit")}>
      {warnings.map((w) => (
        <WarningRow key={w.key} w={w} />
      ))}
    </ul>
  );
}

/**
 * Table warnings (roadmap #26): what the game system's checks find on the
 * table now. Advisory, like every rule here: click one to see its unit,
 * dismiss it on this screen, or override it for everyone until the unit
 * moves again (the log says who did).
 */
export function TableWarningsPanel() {
  const game = useGame();
  const warnings = useWarnings();
  const open = usePanel((s) => s.open);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selected !== null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") usePanel.setState({ open: false });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const show = (w: TableWarning) => {
    const unit = w.unitId ? game.units[w.unitId] : undefined;
    if (!unit) return;
    // The panel stays open beside the unit's card (UX 177).
    select(unit.id);
    const models = aliveModels(game, unit);
    if (models.length)
      focusOn(
        models.reduce((a, m) => a + m.position.x, 0) / models.length,
        models.reduce((a, m) => a + m.position.y, 0) / models.length,
      );
  };
  return (
    <section
      className={`panel table-warnings${selected ? " beside-card" : ""}`}
      aria-label={t("Table warnings")}
    >
      <div className="row spread">
        <h3>{t("Table warnings")}</h3>
        <button className="quiet" aria-label={t("Close")} onClick={() => usePanel.setState({ open: false })}>
          ✕
        </button>
      </div>
      {warnings.length === 0 ? (
        <p className="muted small">{t("Nothing to flag on the table right now.")}</p>
      ) : (
        <ul>
          {warnings.map((w) => (
            <WarningRow key={w.key} w={w} onShow={show} />
          ))}
        </ul>
      )}
      <p className="muted small">{t("Advisory: the rules never block a move. Players decide.")}</p>
    </section>
  );
}
