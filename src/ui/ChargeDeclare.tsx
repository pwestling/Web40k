import { useState } from "react";
import { create } from "zustand";
import { unitGap, type Intent, type Unit } from "../core";
import { actionTargets, unitActions } from "../core/content/play";
import { formatList, t } from "../i18n";
import { RollButton } from "../companion/RealDice";
import { useStore } from "../store";
import { useGame } from "./hooks";

/** Each unit's declared charge: its targets, and the record's length when the roll was made. */
const useChargeDeclare = create<Record<string, { targets: string[]; seq: number }>>(() => ({}));

/** Inches the charge roll must reach: into Engagement Range (1") of every target. */
const ENGAGEMENT = 1;

/**
 * "Charge (2D6)" (UX 396): which unit(s) first, each enemy with its distance
 * and whether it can be charged (and why not, from the rules), then the roll,
 * then whether it made it: "Charge fails: needed 12" or "Charge made: move up
 * to 10" into Wrecker Squad". A failed charge moves nothing.
 */
export function ChargeDeclare({ unit, primary, as }: { unit: Unit; primary: boolean; as: string }) {
  const game = useGame();
  const [picking, setPicking] = useState<string[] | null>(null);
  const declared = useChargeDeclare((s) => s[unit.id]);
  const seq = useStore((s) => s.game.seq);
  const roll = typeof unit.status?.charge === "number" ? unit.status.charge : null;
  const intent: Intent = { type: "dice/roll", count: 2, sides: 6, label: "charge", unitId: unit.id };
  const names = (ids: string[]) => formatList(ids.map((id) => game.units[id]?.name ?? "?"));
  const needed = (ids: string[]) =>
    Math.max(
      0,
      ...ids.map((id) => {
        const other = game.units[id];
        return other ? Math.ceil(Math.max(0, unitGap(game, unit, other) - ENGAGEMENT)) : 0;
      }),
    );

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
        {targets.map((x) => {
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
        })}
        {!targets.some((x) => x.ok) && (
          <p className="warn small">{t("No enemy unit can be charged from here.")}</p>
        )}
        <div className="row">
          {picking.length > 0 && (
            <RollButton
              className="primary"
              intent={intent}
              as={as}
              onRolled={() => {
                useChargeDeclare.setState({ [unit.id]: { targets: picking, seq: seq + 1 } });
                setPicking(null);
              }}
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
  const landed = declared && roll !== null && declared.seq <= seq ? roll >= needed(declared.targets) : null;
  const outcome =
    landed === null || !declared
      ? null
      : landed
        ? t('Charge made: move up to {n}" into {units}', { n: roll!, units: names(declared.targets) })
        : t("Charge fails: needed {n}", { n: needed(declared.targets) });
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
