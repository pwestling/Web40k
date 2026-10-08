import { lengthText } from "./distance";
import { lookupRules, unitView } from "../core/content/runtime";
import { systemOf } from "../core/content/turn";
import { inchesPerUnit } from "../core/content/runtime";
import type { GameState, Unit } from "../core";
import { useCanControl, useStore } from "../store";
import { aliveModels, unitDistance } from "../systems/wh40k/rules";
import { useGame } from "./hooks";
import { opposed } from "../core/teams";
import { formatNumber, t } from "../i18n";

/** Rule ids the unit's imported abilities bound to, with their parameters. */
function boundRules(game: GameState, unit: Unit) {
  const system = systemOf(game);
  const view = unitView(game, system, unit);
  return lookupRules(system, [...view.rules, ...(view.models[0]?.rules ?? [])]);
}

/**
 * One line of buttons for the core abilities the engine knows from the
 * imported roster: reserves for deep strike, the scout move before the
 * battle, and which abilities apply on their own.
 */
export function CoreAbilities({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch } = useStore();
  const canControl = useCanControl();
  const mine = canControl(unit.owner);
  const rules = boundRules(game, unit);
  const has = (id: string) => rules.find((r) => r.def.id === id);
  const status = unit.status ?? {};
  const deploying = game.turn.round === 0;
  // Systems where any unit may wait in reserve (FSD) arrive as an activation, this far from enemies.
  const system = systemOf(game);
  const anyReserve = system.reserves;
  const away = anyReserve ? anyReserve.distance * inchesPerUnit(system) : 9;
  const awayText = lengthText(system, away);
  const scouts = has("scouts");
  const scoutInches = Number(scouts?.param.x ?? 6);
  const enemies = Object.values(game.units).filter((u) => opposed(game, u.owner, unit.owner));
  const nearest = status.arrived
    ? unitDistance(
        aliveModels(game, unit),
        enemies.flatMap((u) => aliveModels(game, u)),
      )
    : Infinity;
  const automatic = [
    ...new Set(
      rules
        .filter((r) => r.def.effects.some((e) => e.when.event !== "action.declared"))
        .map((r) => r.def.name),
    ),
  ];
  if (!has("deepStrike") && !anyReserve && !scouts && !automatic.length) return null;
  return (
    <div className="core-abilities small">
      {(has("deepStrike") || anyReserve) && mine && deploying && !status.reserves && (
        <button
          className="small"
          onClick={() => dispatch({ type: "unit/reserve", id: unit.id, reserve: true }, unit.owner)}
        >
          {anyReserve ? t("Set up in reserve") : t("Deep Strike: set up in reserves")}
        </button>
      )}
      {status.reserves && (
        <span>
          {t("In reserves.")}{" "}
          {mine && !deploying && anyReserve && !status.acting && (
            <span className="muted">{t("Deploy it as an activation to bring it on.")}</span>
          )}
          {mine && !deploying && (!anyReserve || status.acting) && (
            <button
              className="small"
              title={t("Then drag the unit onto the table, more than {distance} from every enemy model", {
                distance: awayText,
              })}
              onClick={() => dispatch({ type: "unit/reserve", id: unit.id, reserve: false }, unit.owner)}
            >
              {t("Arrive")}
            </button>
          )}
        </span>
      )}
      {status.arrived && (
        <span className={nearest <= away ? "warn" : "muted"}>
          {nearest <= away
            ? t("Arrived from reserves: within {distance} of an enemy ({actual}).", {
                distance: awayText,
                actual: anyReserve
                  ? lengthText(system, nearest)
                  : `${formatNumber(nearest, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}"`,
              })
            : t("Arrived from reserves: set up more than {distance} from enemies.", { distance: awayText })}
        </span>
      )}
      {scouts && mine && deploying && !status.scouting && (
        <button
          className="small"
          title={t("Measured from where the unit stands now")}
          onClick={() =>
            dispatch(
              { type: "unit/specialMove", id: unit.id, inches: scoutInches, flag: "scouting" },
              unit.owner,
            )
          }
        >
          {t('Scout move ({inches}")', { inches: scoutInches })}
        </button>
      )}
      {automatic.length > 0 && (
        <span className="muted">{t("Automatic: {abilities}", { abilities: automatic.join(", ") })}</span>
      )}
    </div>
  );
}

/** Unit names listed by a Leader ability ("can be attached to the following units: ..."). */
function leaderOf(unit: Unit): string[] {
  const text = unit.sheet?.abilities.find((a) => /^leader\b/i.test(a.name))?.text ?? "";
  const list = text.split(/following units?:/i)[1];
  if (!list) return [];
  return list
    .split(/[■•\n,]/)
    .map((s) => s.replace(/\*/g, "").trim())
    .filter((s) => s && s.length < 60 && !/^this model/i.test(s));
}

/** Attach a leader to a unit, suggesting the units its Leader ability names. */
export function AttachSelect({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch } = useStore();
  const names = leaderOf(unit).map((n) => n.toLowerCase());
  const fits = (u: Unit) => names.some((n) => u.name.toLowerCase().startsWith(n));
  const own = Object.values(game.units)
    .filter((u) => u.owner === unit.owner && u.id !== unit.id)
    .sort((a, b) => Number(fits(b)) - Number(fits(a)));
  return (
    <select
      value=""
      onChange={(e) =>
        e.target.value && dispatch({ type: "unit/attach", id: unit.id, to: e.target.value }, unit.owner)
      }
    >
      <option value="">{names.length ? t("Lead a unit (Leader)…") : t("Attach to unit (leaders)…")}</option>
      {own.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {names.length ? (fits(u) ? ` ★ ${t("can lead")}` : "") : ""}
        </option>
      ))}
    </select>
  );
}
