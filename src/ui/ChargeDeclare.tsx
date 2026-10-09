import { useState } from "react";
import { unitGap, type Intent, type Unit } from "../core";
import { actionTargets, unitActions } from "../core/content/play";
import { formatList, t } from "../i18n";
import { RollButton } from "../companion/RealDice";
import { useGame } from "./hooks";
import { chargeNeeded } from "../systems/wh40k/charge";

/**
 * "Charge (2D6)" (UX 396): which unit(s) first, each enemy with its distance
 * and whether it can be charged (and why not, from the rules), then the roll,
 * then whether it made it: "Charge fails: needed 12" or "Charge made: move up
 * to 10" into Wrecker Squad". A failed charge moves nothing.
 */
export function ChargeDeclare({ unit, primary, as }: { unit: Unit; primary: boolean; as: string }) {
  const game = useGame();
  const [picking, setPicking] = useState<string[] | null>(null);
  const roll = typeof unit.status?.charge === "number" ? unit.status.charge : null;
  // The units the roll was declared against, kept on the unit by the roll itself (so every peer sees them).
  const declared = Object.keys(unit.status ?? {})
    .filter((k) => k.startsWith("chargeAt.") && unit.status![k])
    .map((k) => k.slice("chargeAt.".length));
  const intent = (targets: string[]): Intent => ({
    type: "dice/roll",
    count: 2,
    sides: 6,
    label: "charge",
    unitId: unit.id,
    targets,
  });
  const names = (ids: string[]) => formatList(ids.map((id) => game.units[id]?.name ?? "?"));
  const needed = (ids: string[]) => chargeNeeded(game, unit.id, ids);

  if (picking) {
    const targets = actionTargets(game, unit.id, "charge");
    // The unit's own reasons (engaged, advanced, fell back), from the rules; advisory, so it can still roll.
    const own = unitActions(game, unit.id).find((o) => o.def.id === "charge");
    return (
      <div className="charge-declare">
        <strong className="small">{t("Charge which unit(s)?")}</strong>
        {own && !own.ok && own.why && own.why !== "Not allowed now" && (
          <p className="warn small">{own.why}</p>
        )}
        {/* Nothing in reach: one line, the list folded under it (UX 412). */}
        {(() => {
          const list = targets.map((x) => {
            const other = game.units[x.unitId];
            if (!other) return null;
            const gap = unitGap(game, unit, other);
            const on = picking.includes(x.unitId);
            return x.ok ? (
              <button
                key={x.unitId}
                className={on ? "small on" : "small"}
                aria-pressed={on}
                onClick={() =>
                  setPicking(on ? picking.filter((id) => id !== x.unitId) : [...picking, x.unitId])
                }
              >
                {other.name} <span className="muted small">{`${gap.toFixed(1)}"`}</span>
              </button>
            ) : (
              <span key={x.unitId} className="muted small">
                {other.name} {`${gap.toFixed(1)}"`}
                {x.why ? `: ${x.why}` : ""}
              </span>
            );
          });
          if (targets.some((x) => x.ok)) return list;
          const gaps = targets.flatMap((x) => {
            const other = game.units[x.unitId];
            return other ? [unitGap(game, unit, other)] : [];
          });
          if (!gaps.length)
            return <p className="warn small">{t("No enemy unit can be charged from here.")}</p>;
          return (
            <details className="charge-out-of-reach">
              <summary className="warn small">
                {t('Nearest enemy {distance}" away: no charge possible', {
                  distance: Math.min(...gaps).toFixed(1),
                })}
              </summary>
              {list}
            </details>
          );
        })()}
        <div className="row">
          {picking.length > 0 && (
            <RollButton
              className="primary"
              intent={intent(picking)}
              as={as}
              onRolled={() => setPicking(null)}
            >
              {t("Roll charge (2D6): {n} needed", { n: needed(picking) })}
            </RollButton>
          )}
          <button className="small" onClick={() => setPicking(null)}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    );
  }
  // The outcome of the charge this unit declared, once its roll is in.
  const landed = declared.length && roll !== null ? roll >= needed(declared) : null;
  const outcome =
    landed === null
      ? null
      : landed
        ? t('Charge made: move up to {n}" into {units}', { n: roll!, units: names(declared) })
        : t("Charge fails: needed {n}", { n: needed(declared) });
  return (
    <>
      <button
        className={primary ? "primary" : ""}
        onClick={() => {
          const ok = actionTargets(game, unit.id, "charge").filter((x) => x.ok);
          // The nearest enemy that can be charged, ticked to start with.
          setPicking(ok[0] ? [ok[0].unitId] : []);
        }}
      >
        {t("Charge (2D6)")}
      </button>
      {outcome && (
        <span className={landed ? "charge-outcome small" : "charge-outcome small warn"}>{outcome}</span>
      )}
    </>
  );
}
