import { maxWounds, type Model, type Unit, type WeaponProfile } from "../core";
import {
  aliveModels,
  carriers,
  engagedWith,
  incoherentModels,
  moveAllowance,
  unitMoved,
} from "../systems/wh40k/rules";
import { useCanControl, useStore } from "../store";
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

/** The selected unit's datasheet, state and actions. */
export function UnitCard() {
  const game = useGame();
  const { selected, select, dispatch, setDraft, scrub } = useStore();
  const canControl = useCanControl();
  const unit = selected ? game.units[selected] : undefined;
  if (!unit) return null;
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
        {incoherent > 0 && <span className="warn">{incoherent} model(s) out of coherency. </span>}
        {engaged.length > 0 && (
          <span className="warn">Engaged with {engaged.map((id) => game.units[id]?.name).join(", ")}.</span>
        )}
      </p>

      {mine && (
        <div className="row wrap">
          <button onClick={() => roll("advance", 1)}>Advance (D6)</button>
          <button onClick={() => roll("charge", 2)}>Charge (2D6)</button>
          <button onClick={() => roll("battleshock", 2)}>Battle-shock test</button>
          {status.advance !== undefined && (
            <button
              onClick={() => dispatch({ type: "unit/status", id: unit.id, key: "advance", value: null }, as)}
            >
              Clear advance
            </button>
          )}
        </div>
      )}

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

      <details>
        <summary>Models and wounds</summary>
        <ul className="models">
          {all.map((m) => (
            <ModelRow key={m.id} model={m} unit={unit} editable={canControl(unit.owner) && scrub === null} />
          ))}
        </ul>
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
