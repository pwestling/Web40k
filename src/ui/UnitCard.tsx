import { CampaignUnitLine } from "../campaign/CampaignUI";
import { focusSoon } from "./focusSoon";
import { UnitWarnings } from "./TableWarnings";
import { playerShape } from "./sides";
import { CodeActions } from "./CodeActions";
import { useCharged } from "../render/charges";
import {
  levelsAt,
  maxWounds,
  modelHeight,
  phaseName,
  settleZ,
  stepLevel,
  type Model,
  type Unit,
  type WeaponProfile,
  type Intent,
} from "../core";
import {
  aliveModels,
  blockedMoves,
  carriers,
  engagedWith,
  clampFraction,
  mainWeapon,
  moveAllowance,
  unitDistance,
  unitMoved,
} from "../systems/wh40k/rules";
import { useCanControl, useStore } from "../store";
import { systemModule } from "../systems";
import { RegimentPanel } from "./RegimentPanel";
import { SystemUnitCard } from "./SystemPanels";
import { currentSlot, systemOf } from "../core/content/turn";
import { AttachSelect, CoreAbilities } from "./CoreAbilities";
import { FigurePicker } from "./FigurePicker";
import { AbilityLine, OncePerBattle } from "./AutoAbilities";
import { replayRoll, useGame, useRareStars } from "./hooks";
import { opposed } from "../core/teams";
import { RollButton } from "../companion/RealDice";
import { t } from "../i18n";

const STATS = ["M", "T", "SV", "W", "LD", "OC", "INV"];
export const flags = (): [string, string][] => [
  ["moved", t("Moved")],
  ["fellBack", t("Fell back")],
  ["shot", t("Shot")],
  ["charged", t("Charged")],
  ["fought", t("Fought")],
  ["battleShocked", t("Battle-shocked")],
];

/** Turn a unit 15° around its centre (Q / E with the unit selected). */
export function rotateUnit(unitId: string, dir: 1 | -1) {
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  const alive = aliveModels(game, unit);
  if (!unit || !alive.length) return;
  const pivot = {
    x: alive.reduce((a, m) => a + m.position.x, 0) / alive.length,
    y: alive.reduce((a, m) => a + m.position.y, 0) / alive.length,
  };
  dispatch(
    { type: "unit/move", id: unitId, pivot, turn: (dir * Math.PI) / 12, delta: { x: 0, y: 0 } },
    unit.owner,
  );
}

/** Move a unit's models up or down one floor where they stand (R / F). */
export function climbUnit(unitId: string, dir: 1 | -1) {
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  const alive = aliveModels(game, unit);
  if (!unit || !alive.length) return;
  const moves = alive.map((m) => ({
    id: m.id,
    to: m.position,
    z: stepLevel(game.terrain, m.position, m.z ?? 0, dir),
  }));
  if (moves.some((mv, i) => mv.z !== (alive[i]!.z ?? 0)))
    dispatch({ type: "models/move", moves }, unit.owner);
}

/** Look from a model's eyes: at the attack's target, else the nearest enemy, else straight ahead. */
export function eyeView(unitId: string) {
  const { game, draft, set } = useStore.getState();
  const unit = game.units[unitId];
  const m = aliveModels(game, unit)[0];
  if (!unit || !m) return;
  const centre = (u: Unit) => {
    const ms = aliveModels(game, u);
    return {
      x: ms.reduce((a, x) => a + x.position.x, 0) / ms.length,
      y: ms.reduce((a, x) => a + x.position.y, 0) / ms.length,
      z: ms.reduce((a, x) => a + (x.z ?? 0) + modelHeight(x) / 2, 0) / ms.length,
    };
  };
  const target = draft?.targetId ? game.units[draft.targetId] : undefined;
  const enemies = Object.values(game.units).filter(
    (u) => opposed(game, u.owner, unit.owner) && aliveModels(game, u).length,
  );
  const nearest = enemies.sort(
    (a, b) => unitDistance([m], aliveModels(game, a)) - unitDistance([m], aliveModels(game, b)),
  )[0];
  const look = target ?? nearest;
  const at = look
    ? centre(look)
    : { x: m.position.x + Math.sin(m.facing) * 10, y: m.position.y + Math.cos(m.facing) * 10, z: m.z ?? 0 };
  set({ view: "eye", eye: { modelId: m.id, at } });
}

/** The selected unit's datasheet, state and actions. */
/**
 * Pull an over-long move back along each model's path until no model has
 * moved further than the limit this phase. Advisory: only on request.
 */
function snapToLimit(unitId: string, limit: number) {
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  if (!unit) return;
  const models = aliveModels(game, unit);
  const at = (id: string, k: number) => {
    const m = game.models[id]!;
    const from = m.phaseStart ?? m.position;
    const p = { x: from.x + (m.position.x - from.x) * k, y: from.y + (m.position.y - from.y) * k };
    return { ...p, z: settleZ(game.terrain, p, m.phaseStartZ ?? 0) };
  };
  const ids = models.map((m) => m.id);
  const k = clampFraction(game, ids, at, limit);
  dispatch(
    {
      type: "models/move",
      moves: ids.map((id) => {
        const { z, ...to } = at(id, k);
        return { id, to, z };
      }),
      snap: limit,
    },
    unit.owner,
  );
}

export function UnitCard() {
  const game = useGame();
  const { selected, select, dispatch, setDraft, scrub, losFrom, ranges, rangeWeapon, set } = useStore();
  const canControl = useCanControl();
  const unit = selected ? game.units[selected] : undefined;
  const stars = useRareStars(selected);
  const charged = useCharged(selected ?? "");
  if (!unit) return null;
  // Systems without panels of their own get the card built from their data.
  if (!systemModule(game.system).dedicatedUi)
    return (
      <SystemUnitCard unit={unit}>
        <CampaignUnitLine unitId={unit.id} />
        {systemOf(game).reserves && <CoreAbilities unit={unit} />}
        <CodeActions unit={unit} />
        <RegimentPanel unit={unit} />
      </SystemUnitCard>
    );
  const owner = game.players[unit.owner];
  const mine = canControl(unit.owner) && scrub === null;
  const alive = aliveModels(game, unit);
  const all = unit.modelIds.flatMap((id) => game.models[id] ?? []);
  const status = unit.status ?? {};
  const as = unit.owner;
  const allowed = moveAllowance(game, unit);
  // "Moved 0.0" of 8" this phase" in the Shooting phase reads as "it didn't move" (dogfood): only where moving happens.
  const slot = currentSlot(game);
  const movingNow = !slot || slot.kind === "alternate" || /move|charge/i.test(slot.id);
  const moved = unitMoved(alive);
  const engaged = engagedWith(game, unit);
  const phase = phaseName(game);
  // Floor buttons only show when the unit stands where there is a floor to climb to.
  const onFloors = alive.some((m) => (m.z ?? 0) > 0 || levelsAt(game.terrain, m.position).length > 1);
  const elevation = Math.max(0, ...alive.map((m) => m.z ?? 0));
  const blocked = game.turn.round > 0 ? blockedMoves(game, unit) : [];
  const height = alive[0] ? modelHeight(alive[0]) : 0;

  // One stat line per distinct profile.
  const profiles = new Map<string, Model>();
  for (const m of all) if (m.profile && !profiles.has(m.profile.name)) profiles.set(m.profile.name, m);
  const weapons = Object.values(unit.sheet?.weapons ?? {});
  // At a real table (#37), the board's measuring and moving tools go: the players have the table.
  const companion = !!game.settings.companion;
  const roll = (label: string, count: number): Intent => ({
    type: "dice/roll",
    count,
    sides: 6,
    label,
    unitId: unit.id,
  });
  const flag = (key: string, value: boolean) =>
    dispatch({ type: "unit/status", id: unit.id, key, value: value || null }, as);

  return (
    <div className="panel unitcard" tabIndex={-1} aria-label={t("Selected unit")}>
      <div className="row spread">
        <h2 style={{ color: owner?.color }}>
          <span className="side-shape" aria-hidden="true">
            {playerShape(game, unit.owner)}
          </span>{" "}
          {unit.name}
          {stars.map((m) => (
            <button
              key={m.seq}
              className="rare-star"
              title={t("{title}, round {round}: {line}. Click to replay it.", {
                title: m.title,
                round: m.round,
                line: m.line.split(" · ")[0],
              })}
              aria-label={t("Replay: {title}, round {round}", { title: m.title, round: m.round })}
              onClick={() => replayRoll(m.seq)}
            >
              ★
            </button>
          ))}
        </h2>
        <button onClick={() => select(null)}>✕</button>
      </div>
      <p className="muted">
        {t("{player} · {alive}/{all} models", {
          player: owner?.name ?? "",
          alive: alive.length,
          all: all.length,
        })}
        {unit.sheet?.points ? <> · {t("{points} pts", { points: unit.sheet.points })}</> : ""}
      </p>
      <CampaignUnitLine unitId={unit.id} />
      {/* The unit's actions come first, so they're the first Tab stops in the card (UX 182). */}
      {mine && (
        <div className="row wrap">
          {(["ranged", "melee"] as const).map((kind) => {
            const weaponId = mainWeapon(game, unit, kind);
            return (
              weaponId && (
                <button
                  key={kind}
                  className={phase === (kind === "ranged" ? "Shooting" : "Fight") ? "primary" : ""}
                  onClick={() => {
                    setDraft({ attackerId: unit.id, kind, weaponId, picking: true });
                    focusSoon(".panel.attack select.attack-target");
                  }}
                >
                  {kind === "ranged" ? t("Shoot") : t("Fight")}
                </button>
              )
            );
          })}
          <RollButton className={phase === "Movement" ? "primary" : ""} intent={roll("advance", 1)} as={as}>
            {t("Advance (D6)")}
          </RollButton>
          <RollButton className={phase === "Charge" ? "primary" : ""} intent={roll("charge", 2)} as={as}>
            {t("Charge (2D6)")}
          </RollButton>
          <RollButton intent={roll("battleshock", 2)} as={as}>
            {t("Battle-shock test")}
          </RollButton>
          {onFloors && !companion && (
            <>
              <button title={t("Up a floor (R)")} onClick={() => climbUnit(unit.id, 1)}>
                ▲ {t("Floor")}
              </button>
              <button title={t("Down a floor (F)")} onClick={() => climbUnit(unit.id, -1)}>
                ▼ {t("Floor")}
              </button>
            </>
          )}
          {!companion && (
            <>
              <button title={t("Rotate left (Q)")} onClick={() => rotateUnit(unit.id, -1)}>
                ⟲
              </button>
              <button title={t("Rotate right (E)")} onClick={() => rotateUnit(unit.id, 1)}>
                ⟳
              </button>
            </>
          )}
          {status.advance !== undefined && (
            <button
              onClick={() => dispatch({ type: "unit/status", id: unit.id, key: "advance", value: null }, as)}
            >
              {t("Clear advance")}
            </button>
          )}
        </div>
      )}
      <div className="chips">
        {flags().map(([key, label]) => (
          <button
            key={key}
            className={`chip ${status[key] ? "on" : ""}`}
            disabled={!mine}
            onClick={() => flag(key, !status[key])}
          >
            {label}
          </button>
        ))}
        {typeof status.advance === "number" && (
          <span className="chip on">{t('Advanced +{n}"', { n: status.advance })}</span>
        )}
        {typeof status.charge === "number" && (
          <span className="chip on">{t('Charge roll {n}"', { n: status.charge })}</span>
        )}
        {charged !== null && (
          <span className="chip on charged">
            {t('Charged {distance}"', { distance: charged.toFixed(1) })}
          </span>
        )}
      </div>
      <CoreAbilities unit={unit} />
      <OncePerBattle unit={unit} mine={mine} />
      <CodeActions unit={unit} />
      {!companion && (
        <p className="muted">
          {(game.turn.round > 0 || !!status.scouting) && allowed !== null && (movingNow || moved > 0.05) && (
            <span className={moved > allowed + 0.05 ? "warn" : ""}>
              {t('Moved {moved}" of {allowed}" this phase.', { moved: moved.toFixed(1), allowed })}{" "}
            </span>
          )}
          {mine &&
            (game.turn.round > 0 || !!status.scouting) &&
            allowed !== null &&
            moved > allowed + 0.05 && (
              <button className="small" onClick={() => snapToLimit(unit.id, allowed)}>
                {t('Snap back to {allowed}"', { allowed })}
              </button>
            )}
          {blocked.length > 0 && (
            <span className="warn">
              {t("Moved through {terrain}.", {
                terrain: blocked.map((p) => p.name.toLowerCase()).join(", "),
              })}{" "}
            </span>
          )}
          {engaged.length > 0 && (
            <span className="warn">
              {t("Engaged with {units}.", { units: engaged.map((id) => game.units[id]?.name).join(", ") })}
            </span>
          )}
        </p>
      )}
      {/* Coherency, moves, Deep Strike: the table checks (src/ui/warnings.ts). */}
      <UnitWarnings unitId={unit.id} skip={["moveDistance"]} />

      {!companion && (
        <div className="row wrap">
          <button
            className={losFrom === unit.id ? "on" : ""}
            onClick={() => set({ losFrom: losFrom === unit.id ? null : unit.id })}
          >
            {t("Line of sight")}
          </button>
          <button onClick={() => eyeView(unit.id)}>{t("Model's eye view")}</button>
          <button
            className={ranges === unit.id ? "on" : ""}
            title={t("Move (blue) and longest weapon range (yellow) around each model")}
            onClick={() => set({ ranges: ranges === unit.id ? null : unit.id, rangeWeapon: null })}
          >
            {t("Ranges")}
          </button>
          {ranges === unit.id && (
            <select value={rangeWeapon ?? ""} onChange={(e) => set({ rangeWeapon: e.target.value || null })}>
              <option value="">{t("Longest range")}</option>
              {weapons
                .filter((w) => w.kind === "ranged")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.chars.RANGE}
                  </option>
                ))}
            </select>
          )}
          {elevation > 0 && (
            <span className="muted">{t('On a floor {height}" up', { height: elevation.toFixed(1) })}</span>
          )}
        </div>
      )}

      {profiles.size > 0 && (
        <table className="stats">
          <thead>
            <tr>
              <th />
              {STATS.map((s) => (
                // i18n-ignore: characteristic abbreviations, as on the datasheet
                <th key={s}>{s === "INV" ? "Inv" : s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...profiles.values()].map((m) => (
              <tr key={m.profile!.name}>
                <td>{m.profile!.name}</td>
                {STATS.map((s) => (
                  <td key={s}>{m.profile!.chars[s] ?? "–"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(["ranged", "melee"] as const).map((kind) => {
        const list = weapons.filter((w) => w.kind === kind);
        if (!list.length) return null;
        return (
          <table key={kind} className="weapons">
            <thead>
              <tr>
                <th>{kind === "ranged" ? t("Ranged") : t("Melee")}</th>
                <th>#</th>
                {/* i18n-ignore: characteristic abbreviations, as on the datasheet */}
                <th>Rng</th>
                <th>A</th>
                {/* i18n-ignore */}
                <th>{kind === "ranged" ? "BS" : "WS"}</th>
                <th>S</th>
                {/* i18n-ignore */}
                <th>AP</th>
                <th>D</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <WeaponRow
                  key={w.id}
                  weapon={w}
                  count={carriers(game, unit, w.id).length}
                  canUse={mine}
                  onUse={() => setDraft({ attackerId: unit.id, kind, weaponId: w.id, picking: true })}
                />
              ))}
            </tbody>
          </table>
        );
      })}

      {unit.sheet && unit.sheet.abilities.length > 0 && (
        <details>
          <summary>{t("Abilities ({n})", { n: unit.sheet.abilities.length })}</summary>
          {unit.sheet.abilities.map((a) => (
            <AbilityLine key={a.name} unit={unit} ability={a} mine={mine} />
          ))}
        </details>
      )}
      {unit.sheet && unit.sheet.keywords.length > 0 && (
        <p className="muted small">{unit.sheet.keywords.join(", ")}</p>
      )}

      {!companion && <FigurePicker unit={unit} models={all} editable={mine} />}

      <details open={companion}>
        <summary>{t("Models and wounds")}</summary>
        <ul className="models">
          {all.map((m) => (
            <ModelRow key={m.id} model={m} unit={unit} editable={canControl(unit.owner) && scrub === null} />
          ))}
        </ul>
        {mine && !companion && (
          <label className="row small">
            {t("Model height for line of sight")}{" "}
            <input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={Number(height.toFixed(1))}
              onChange={(e) => {
                const h = Number(e.target.value);
                if (h > 0) dispatch({ type: "unit/height", id: unit.id, height: h }, as);
              }}
            />
            "
          </label>
        )}
        {mine && <AttachSelect unit={unit} />}
        {mine && (
          <button
            className="danger"
            onClick={() =>
              confirm(t("Remove {unit} from the game?", { unit: unit.name })) &&
              dispatch({ type: "unit/remove", id: unit.id }, as)
            }
          >
            {t("Remove unit")}
          </button>
        )}
      </details>
    </div>
  );
}

function WeaponRow({
  weapon,
  count,
  canUse,
  onUse,
}: {
  weapon: WeaponProfile;
  count: number;
  canUse: boolean;
  onUse: () => void;
}) {
  const c = weapon.chars;
  return (
    <>
      <tr className={count ? "" : "muted"}>
        <td>{weapon.name}</td>
        <td>{count}</td>
        <td>{weapon.kind === "melee" ? t("Melee") : c.RANGE}</td>
        <td>{c.A}</td>
        <td>{weapon.kind === "melee" ? c.WS : c.BS}</td>
        <td>{c.S}</td>
        <td>{c.AP}</td>
        <td>{c.D}</td>
        <td>
          {canUse && count > 0 && (
            <button
              className="small"
              onClick={() => {
                onUse();
                focusSoon(".panel.attack select.attack-target");
              }}
            >
              {weapon.kind === "ranged" ? t("Shoot") : t("Fight")}
            </button>
          )}
        </td>
      </tr>
      {weapon.keywords.length > 0 && (
        <tr className="kw">
          <td colSpan={9}>{weapon.keywords.join(", ")}</td>
        </tr>
      )}
    </>
  );
}

function ModelRow({ model, unit, editable }: { model: Model; unit: Unit; editable: boolean }) {
  const dispatch = useStore((s) => s.dispatch);
  const max = maxWounds(model);
  const lost = model.woundsLost ?? 0;
  const set = (woundsLost: number, destroyed: boolean) =>
    dispatch({ type: "model/wounds", id: model.id, woundsLost, destroyed }, unit.owner);
  return (
    <li className={model.destroyed ? "dead" : ""}>
      <span>{model.label}</span>
      <span>{t("{left}/{max} W", { left: max - lost, max })}</span>
      {editable && (
        <span className="row">
          <button className="small" disabled={lost >= max} onClick={() => set(lost + 1, lost + 1 >= max)}>
            −
          </button>
          <button className="small" disabled={lost <= 0} onClick={() => set(lost - 1, false)}>
            +
          </button>
          <button className="small" onClick={() => set(model.destroyed ? 0 : lost, !model.destroyed)}>
            {model.destroyed ? t("Revive") : t("Slay")}
          </button>
        </span>
      )}
    </li>
  );
}
