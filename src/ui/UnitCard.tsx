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
} from "../core";
import {
  aliveModels,
  blockedMoves,
  carriers,
  engagedWith,
  incoherentModels,
  clampFraction,
  mainWeapon,
  moveAllowance,
  unitDistance,
  unitMoved,
} from "../systems/wh40k/rules";
import { useCanControl, useStore } from "../store";
import { systemModule } from "../systems";
import { SystemUnitCard } from "./SystemPanels";
import { FigurePicker } from "./FigurePicker";
import { useGame } from "./hooks";

const STATS = ["M", "T", "SV", "W", "LD", "OC", "INV"];
const FLAGS: [string, string][] = [
  ["moved", "Moved"],
  ["fellBack", "Fell back"],
  ["shot", "Shot"],
  ["charged", "Charged"],
  ["fought", "Fought"],
  ["battleShocked", "Battle-shocked"],
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
    (u) => u.owner !== unit.owner && aliveModels(game, u).length,
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
export function snapToLimit(unitId: string, limit: number) {
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  if (!unit) return;
  const models = aliveModels(game, unit);
  const at = (id: string, k: number) => {
    const m = game.models[id]!;
    const from = m.phaseStart ?? m.position;
    return { x: from.x + (m.position.x - from.x) * k, y: from.y + (m.position.y - from.y) * k };
  };
  const ids = models.map((m) => m.id);
  const k = clampFraction(game, ids, at, limit);
  dispatch(
    {
      type: "models/move",
      moves: ids.map((id) => {
        const to = at(id, k);
        return { id, to, z: settleZ(game.terrain, to, game.models[id]!.phaseStartZ ?? 0) };
      }),
    },
    unit.owner,
  );
}

export function UnitCard() {
  const game = useGame();
  const { selected, select, dispatch, setDraft, scrub, losFrom, ranges, set } = useStore();
  const canControl = useCanControl();
  const unit = selected ? game.units[selected] : undefined;
  if (!unit) return null;
  // Systems without panels of their own get the card built from their data.
  if (!systemModule(game.system).dedicatedUi) return <SystemUnitCard unit={unit} />;
  const owner = game.players[unit.owner];
  const mine = canControl(unit.owner) && scrub === null;
  const alive = aliveModels(game, unit);
  const all = unit.modelIds.flatMap((id) => game.models[id] ?? []);
  const status = unit.status ?? {};
  const as = unit.owner;
  const allowed = moveAllowance(game, unit);
  const moved = unitMoved(alive);
  const incoherent = incoherentModels(alive).size;
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
  const roll = (label: string, count: number) =>
    dispatch({ type: "dice/roll", count, sides: 6, label, unitId: unit.id }, as);
  const flag = (key: string, value: boolean) =>
    dispatch({ type: "unit/status", id: unit.id, key, value: value || null }, as);

  return (
    <div className="panel unitcard">
      <div className="row spread">
        <h2 style={{ color: owner?.color }}>{unit.name}</h2>
        <button onClick={() => select(null)}>✕</button>
      </div>
      <p className="muted">
        {owner?.name} · {alive.length}/{all.length} models
        {unit.sheet?.points ? ` · ${unit.sheet.points} pts` : ""}
      </p>
      <div className="chips">
        {FLAGS.map(([key, label]) => (
          <button
            key={key}
            className={`chip ${status[key] ? "on" : ""}`}
            disabled={!mine}
            onClick={() => flag(key, !status[key])}
          >
            {label}
          </button>
        ))}
        {typeof status.advance === "number" && <span className="chip on">Advanced +{status.advance}"</span>}
        {typeof status.charge === "number" && <span className="chip on">Charge roll {status.charge}"</span>}
      </div>
      <p className="muted">
        {game.turn.round > 0 && allowed !== null && (
          <span className={moved > allowed + 0.05 ? "warn" : ""}>
            Moved {moved.toFixed(1)}" of {allowed}" this phase.{" "}
          </span>
        )}
        {mine && game.turn.round > 0 && allowed !== null && moved > allowed + 0.05 && (
          <button className="small" onClick={() => snapToLimit(unit.id, allowed)}>
            Snap back to {allowed}"
          </button>
        )}
        {incoherent > 0 && <span className="warn">{incoherent} model(s) out of coherency. </span>}
        {blocked.length > 0 && (
          <span className="warn">Moved through {blocked.map((p) => p.name.toLowerCase()).join(", ")}. </span>
        )}
        {engaged.length > 0 && (
          <span className="warn">Engaged with {engaged.map((id) => game.units[id]?.name).join(", ")}.</span>
        )}
      </p>

      {mine && (
        <div className="row wrap">
          {(["ranged", "melee"] as const).map((kind) => {
            const weaponId = mainWeapon(game, unit, kind);
            return (
              weaponId && (
                <button
                  key={kind}
                  className={phase === (kind === "ranged" ? "Shooting" : "Fight") ? "primary" : ""}
                  onClick={() => setDraft({ attackerId: unit.id, kind, weaponId, picking: true })}
                >
                  {kind === "ranged" ? "Shoot" : "Fight"}
                </button>
              )
            );
          })}
          <button className={phase === "Movement" ? "primary" : ""} onClick={() => roll("advance", 1)}>
            Advance (D6)
          </button>
          <button className={phase === "Charge" ? "primary" : ""} onClick={() => roll("charge", 2)}>
            Charge (2D6)
          </button>
          <button onClick={() => roll("battleshock", 2)}>Battle-shock test</button>
          {onFloors && (
            <>
              <button title="Up a floor (R)" onClick={() => climbUnit(unit.id, 1)}>
                ▲ Floor
              </button>
              <button title="Down a floor (F)" onClick={() => climbUnit(unit.id, -1)}>
                ▼ Floor
              </button>
            </>
          )}
          <button title="Rotate left (Q)" onClick={() => rotateUnit(unit.id, -1)}>
            ⟲
          </button>
          <button title="Rotate right (E)" onClick={() => rotateUnit(unit.id, 1)}>
            ⟳
          </button>
          {status.advance !== undefined && (
            <button
              onClick={() => dispatch({ type: "unit/status", id: unit.id, key: "advance", value: null }, as)}
            >
              Clear advance
            </button>
          )}
        </div>
      )}

      <div className="row wrap">
        <button
          className={losFrom === unit.id ? "on" : ""}
          onClick={() => set({ losFrom: losFrom === unit.id ? null : unit.id })}
        >
          Line of sight
        </button>
        <button onClick={() => eyeView(unit.id)}>Model's eye view</button>
        <button
          className={ranges === unit.id ? "on" : ""}
          title="Move (blue) and longest weapon range (yellow) around each model"
          onClick={() => set({ ranges: ranges === unit.id ? null : unit.id })}
        >
          Ranges
        </button>
        {elevation > 0 && <span className="muted">On a floor {elevation.toFixed(1)}" up</span>}
      </div>

      {profiles.size > 0 && (
        <table className="stats">
          <thead>
            <tr>
              <th />
              {STATS.map((s) => (
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
                <th>{kind === "ranged" ? "Ranged" : "Melee"}</th>
                <th>#</th>
                <th>Rng</th>
                <th>A</th>
                <th>{kind === "ranged" ? "BS" : "WS"}</th>
                <th>S</th>
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
          <summary>Abilities ({unit.sheet.abilities.length})</summary>
          {unit.sheet.abilities.map((a) => (
            <p key={a.name}>
              <strong>{a.name}.</strong> {a.text}
            </p>
          ))}
        </details>
      )}
      {unit.sheet && unit.sheet.keywords.length > 0 && (
        <p className="muted small">{unit.sheet.keywords.join(", ")}</p>
      )}

      <FigurePicker unit={unit} models={all} editable={mine} />

      <details>
        <summary>Models and wounds</summary>
        <ul className="models">
          {all.map((m) => (
            <ModelRow key={m.id} model={m} unit={unit} editable={canControl(unit.owner) && scrub === null} />
          ))}
        </ul>
        {mine && (
          <label className="row small">
            Model height for line of sight{" "}
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
        {mine && (
          <select
            value=""
            onChange={(e) =>
              e.target.value && dispatch({ type: "unit/attach", id: unit.id, to: e.target.value }, as)
            }
          >
            <option value="">Attach to unit (leaders)…</option>
            {Object.values(game.units)
              .filter((u) => u.owner === unit.owner && u.id !== unit.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        {mine && (
          <button
            className="danger"
            onClick={() =>
              confirm(`Remove ${unit.name} from the game?`) &&
              dispatch({ type: "unit/remove", id: unit.id }, as)
            }
          >
            Remove unit
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
        <td>{weapon.kind === "melee" ? "Melee" : c.RANGE}</td>
        <td>{c.A}</td>
        <td>{weapon.kind === "melee" ? c.WS : c.BS}</td>
        <td>{c.S}</td>
        <td>{c.AP}</td>
        <td>{c.D}</td>
        <td>
          {canUse && count > 0 && (
            <button className="small" onClick={onUse}>
              {weapon.kind === "ranged" ? "Shoot" : "Fight"}
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
      <span>
        {max - lost}/{max} W
      </span>
      {editable && (
        <span className="row">
          <button className="small" disabled={lost >= max} onClick={() => set(lost + 1, lost + 1 >= max)}>
            −
          </button>
          <button className="small" disabled={lost <= 0} onClick={() => set(lost - 1, false)}>
            +
          </button>
          <button className="small" onClick={() => set(model.destroyed ? 0 : lost, !model.destroyed)}>
            {model.destroyed ? "Revive" : "Slay"}
          </button>
        </span>
      )}
    </li>
  );
}
