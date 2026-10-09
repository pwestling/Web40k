import { displayName } from "../../i18n/names";
import { t } from "../../i18n";
import { useGame } from "../../ui/hooks";
import { fightOrder, fightOutOfOrder } from "./fight";

/**
 * The Fight phase order for a unit's card or fight panel (advice only):
 * whose pick it is, which units may fight now, and a warning when this unit
 * would fight out of order.
 */
export function FightOrderNote({ unitId }: { unitId: string }) {
  const game = useGame();
  const order = fightOrder(game);
  if (!order?.picker) return null;
  const why = fightOutOfOrder(game, unitId);
  const player = displayName(game.players[order.picker]?.name ?? "");
  const units = order.eligible.map((id) => game.units[id]?.name ?? id).join(", ");
  return (
    <p className="small fight-order">
      <span className="muted">
        {order.step === "fightsFirst"
          ? t("Fights First: {player}'s pick ({units}).", { player, units })
          : t("Fight order: {player}'s pick ({units}).", { player, units })}
      </span>
      {why && (
        <span className="warn">
          {" "}
          {why === "fightsFirst"
            ? t("Out of order: units that charged or have Fights First fight first.")
            : t("Out of order: it's {player}'s pick.", { player })}
        </span>
      )}
    </p>
  );
}
