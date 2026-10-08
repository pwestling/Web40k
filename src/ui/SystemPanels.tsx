import { UnitWarnings } from "./TableWarnings";
import { playerShape } from "./sides";
import { useMemo, useState, type ReactNode } from "react";
import {
  actionTargets,
  cantPlace,
  currentSlot,
  findProcedure,
  inchesPerUnit,
  placeablePool,
  placedKey,
  placeWindow,
  previewRun,
  procedureEnv,
  procedureRoles,
  readCharacteristics,
  seatName,
  systemOf,
  unitActions,
  unitView,
  weaponSlots,
  type ActionOption,
  type CharacteristicDef,
  type GameSystem,
  type StepPlan,
  type StepRecord,
} from "../core/content";
import { modelHeight, type Ability, type GameState, type Unit } from "../core";
import { inArc } from "../core/regiment";
import { lossText } from "./gameLog";
import { useCanControl, useStore, type AttackDraft } from "../store";
import { aliveModels, unitMoved } from "../systems/wh40k/rules";
import { useGame } from "./hooks";
import { eyeView, rotateUnit } from "./UnitCard";
import { useCharged } from "../render/charges";
import { computerPlays } from "../teach/store";
import { formatList, formatNumber, t, tn } from "../i18n";

/**
 * Panels for any game system, built from its data: a unit card with the
 * system's characteristics and statuses, the actions the unit can take now,
 * a setup panel for actions that run a procedure (an attack), the procedure
 * as it is rolled, and the reaction prompt. Systems with panels of their own
 * (40k) keep those.
 */

/** A column header: the system's short label, a short id ("Cmd", "AP"), else the display name. */
const header = (c: { id: string; name: string; short?: string }) =>
  c.short ?? (/^[A-Z][A-Za-z]{0,3}$/.test(c.id) ? c.id : c.name);

const unitName = (sys: GameSystem) =>
  typeof sys.units === "object" ? sys.units.name : sys.units === "cm" ? "cm" : '"';
const fmt = (n: number, sys: GameSystem) => {
  const u = unitName(sys);
  const num = formatNumber(Number(n.toFixed(1)), { maximumFractionDigits: 1 });
  return `${num}${u === '"' ? u : ` ${u}`}`;
};

/** "uses a 4 and a 6": the dice-pool faces an action pays with. */
const usesFaces = (faces: (string | number)[]) =>
  t("uses {faces}", { faces: formatList(faces.map((f) => t("a {face}", { face: String(f) }))) });

/** The characteristic as the roster wrote it, under the system's id or one of its aliases. */
function rosterText(c: CharacteristicDef, chars: Record<string, string> | undefined): string | undefined {
  if (!chars) return undefined;
  const names = [c.id, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
  return Object.entries(chars).find(([k]) => names.includes(k.toLowerCase()))?.[1];
}

/**
 * A characteristic for the card: "–" for none (not the stand-in number a
 * missing save or ward reads as), and the roster's own text when it isn't a
 * number ("S", "S+1", "-").
 */
function shown(c: CharacteristicDef, value: unknown, chars: Record<string, string> | undefined): string {
  const text = rosterText(c, chars)?.trim();
  if (text !== undefined && !/^[+-]?\d+(\.\d+)?\s*(\+|"|”|''|cm|mm)?$/i.test(text))
    return !text || /^[-–—]$|^n\/?a$/i.test(text) ? "–" : text;
  if (value === null || value === undefined) return "–";
  // A default standing in for a value the roster never gave: none, not a number.
  // So is a 0 the roster never gave (Conquest's Barrage or Cleave on a unit without them, UX 110).
  if (text === undefined && (c.type === "target" || c.of === "weapon" || value === 0) && value === c.default)
    return "–";
  return String(value);
}

/** Imported abilities, under the headings the importer gave them (or one list). */
function AbilityList({ abilities }: { abilities: Ability[] }) {
  if (!abilities.length) return null;
  const groups = new Map<string, Ability[]>();
  for (const a of abilities) {
    const g = a.group ?? t("Abilities");
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  return (
    <>
      {[...groups].map(([group, list]) => (
        <details key={group} className="abilities">
          <summary>
            {group} ({list.length})
          </summary>
          {list.map((a) => (
            <p key={a.name} className="small">
              <strong>{a.name}.</strong> {a.text}
            </p>
          ))}
        </details>
      ))}
    </>
  );
}

export function SystemUnitCard({ unit, children }: { unit: Unit; children?: ReactNode }) {
  const game = useGame();
  const { select, dispatch, scrub, losFrom, set } = useStore();
  const canControl = useCanControl();
  const system = systemOf(game);
  const view = unitView(game, system, unit);
  const mine = canControl(unit.owner) && scrub === null;
  const owner = game.players[unit.owner];
  const all = unit.modelIds.flatMap((id) => game.models[id] ?? []);
  const alive = aliveModels(game, unit);
  const scale = inchesPerUnit(system);
  const allowance = typeof unit.status?.allowance === "number" ? unit.status.allowance : null;
  const moved = unitMoved(alive);
  const statuses = (system.statuses ?? []).filter((s) => view.statuses.includes(s.id));
  const flags = view.flags.filter(
    (f) =>
      !statuses.some((s) => s.id === f) &&
      !/^(acting|actionsTaken|actionBudget|allowance|reacting|arrived|box\d+|used\.|ok\.)/.test(f),
  );
  const chars = system.characteristics.filter((c) => c.of === "model" && c.type !== "text");
  const texts = system.characteristics.filter((c) => c.of === "model" && c.type === "text");
  const weaponChars = system.characteristics.filter((c) => c.of === "weapon");
  const weapons = Object.values(unit.sheet?.weapons ?? {});
  const first = alive[0] ?? all[0];
  const raw = readCharacteristics(system, "model", first?.profile?.chars);
  // A charge that struck home this round stays on the card with its distance (PX-3c).
  const charged = useCharged(unit.id);
  const chargedText =
    charged !== null ? t("Charged {distance}", { distance: fmt(charged / scale, system) }) : null;

  return (
    <div className="panel unitcard" tabIndex={-1} aria-label={t("Selected unit")}>
      <div className="row spread">
        <h2 style={{ color: owner?.color }}>
          <span className="side-shape" aria-hidden="true">
            {playerShape(game, unit.owner)}
          </span>{" "}
          {unit.name}
        </h2>
        <button onClick={() => select(null)}>✕</button>
      </div>
      <p className="muted">
        {owner?.name} · {tn(all.length, "{alive}/{n} model", "{alive}/{n} bases", { alive: alive.length })}
        {unit.sheet?.points ? " · " + t("{points} pts", { points: unit.sheet.points }) : ""}
      </p>
      {mine && game.turn.round > 0 && <SystemActions unit={unit} />}
      {children}
      {(statuses.length > 0 || flags.length > 0 || chargedText) && (
        <div className="chips">
          {statuses.map((s) => (
            <button
              key={s.id}
              className="chip on"
              disabled={!mine}
              title={t("Click to clear")}
              onClick={() =>
                dispatch({ type: "unit/status", id: unit.id, key: s.id, value: null }, unit.owner)
              }
            >
              {s.id === "charged" && chargedText ? chargedText : s.name}
            </button>
          ))}
          {flags.map((f) =>
            // A spell on the unit (rank-and-flank magic): by its name, and a player can end it by hand.
            f.startsWith("spell:") ? (
              <button
                key={f}
                className="chip on"
                disabled={!mine}
                title={t("Click to end this spell")}
                onClick={() =>
                  dispatch({ type: "unit/status", id: unit.id, key: f, value: null }, unit.owner)
                }
              >
                {f.slice(6)}
              </button>
            ) : (
              <span key={f} className="chip on">
                {f === "reserves" ? t("In reserve") : f === "charged" && chargedText ? chargedText : f}
              </span>
            ),
          )}
          {chargedText && !statuses.some((s) => s.id === "charged") && !flags.includes("charged") && (
            <span className="chip on charged">{chargedText}</span>
          )}
        </div>
      )}
      {allowance !== null && (
        <p className={moved > allowance + 0.05 ? "warn" : "muted"}>
          {t("Moved {distance} of {allowance} this round.", {
            distance: fmt(moved / scale, system),
            allowance: fmt(allowance / scale, system),
          })}
        </p>
      )}
      <UnitWarnings unitId={unit.id} skip={allowance !== null ? ["moveDistance", "wheelDistance"] : []} />

      <div className="row wrap">
        <button
          className={losFrom === unit.id ? "on" : ""}
          onClick={() => set({ losFrom: losFrom === unit.id ? null : unit.id })}
        >
          {t("Line of sight")}
        </button>
        <button onClick={() => eyeView(unit.id)}>{t("Model's eye view")}</button>
        {mine && (
          <>
            <button title={t("Rotate left (Q)")} onClick={() => rotateUnit(unit.id, -1)}>
              ⟲
            </button>
            <button title={t("Rotate right (E)")} onClick={() => rotateUnit(unit.id, 1)}>
              ⟳
            </button>
          </>
        )}
      </div>

      <table className="stats">
        <thead>
          <tr>
            {chars.map((c) => (
              <th key={c.id} title={c.name}>
                {header(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {chars.map((c) => {
              const v = view[c.id];
              const changed = v !== raw[c.id];
              return (
                <td
                  key={c.id}
                  className={changed ? "warn" : ""}
                  title={changed ? t("{value} on the card", { value: String(raw[c.id]) }) : undefined}
                >
                  {changed ? String(v ?? "–") : shown(c, v, first?.profile?.chars)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      {texts.map((c) =>
        view[c.id] ? (
          <p key={c.id} className="small">
            <strong>{c.name}:</strong> {String(view[c.id])}
          </p>
        ) : null,
      )}

      {weapons.length > 0 && (
        <table className="weapons">
          <thead>
            <tr>
              <th>{t("Weapon")}</th>
              {weaponChars.map((c) => (
                <th key={c.id} title={c.name}>
                  {header(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weapons.map((w) => {
              const v = readCharacteristics(system, "weapon", w.chars);
              return (
                <tr key={w.id}>
                  <td>
                    {w.name}
                    {w.keywords.length > 0 && <div className="muted small">{w.keywords.join(", ")}</div>}
                    <SlotDice unit={unit} weaponId={w.id} mine={mine} />
                  </td>
                  {weaponChars.map((c) => (
                    <td key={c.id}>{shown(c, v[c.id], w.chars)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <AbilityList abilities={unit.sheet?.abilities ?? []} />
      {unit.sheet && unit.sheet.keywords.length > 0 && (
        <p className="muted small">{unit.sheet.keywords.join(", ")}</p>
      )}

      <details>
        <summary>{t("Bases")}</summary>
        <ul className="models">
          {all.map((m) => (
            <li key={m.id} className={m.destroyed ? "dead" : ""}>
              <span>{m.label}</span>
              <span>
                {m.destroyed
                  ? t("removed")
                  : t('{height}" tall', {
                      height: formatNumber(modelHeight(m), {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }),
                    })}
              </span>
              {mine && (
                <button
                  className="small"
                  onClick={() =>
                    dispatch(
                      {
                        type: "model/wounds",
                        id: m.id,
                        woundsLost: m.destroyed ? 0 : 1,
                        destroyed: !m.destroyed,
                      },
                      unit.owner,
                    )
                  }
                >
                  {m.destroyed ? t("Return") : t("Remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * The actions this unit can take now, as buttons. Dice-pool costs name the
 * die they use; a player can pick a die in the pool first to pay with it.
 * Reasons an action can't be taken: one shared line, the rest in tooltips.
 */
function SystemActions({ unit }: { unit: Unit }) {
  const game = useGame();
  const { dispatch, setDraft } = useStore();
  const [commanding, setCommanding] = useState<{ action: string; picked: string[] } | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [hover, setHover] = useState<number[]>([]);
  const chosen = pick !== null ? [pick] : undefined;
  const options = unitActions(game, unit.id, chosen ? { dice: chosen } : {});
  const status = unit.status ?? {};
  const acting = !!status.acting;
  const reacting = !!status.reacting;
  // Reactions only show while one can be made. In activation games, Activate stands alone
  // until the unit is activated, then only the actions it can take with it.
  const activations = options.some((o) => o.def.activates !== undefined);
  const shown = options.filter(
    (o) =>
      (!o.def.reactTo || o.ok) &&
      (!activations || (acting ? o.def.activates === undefined : o.def.activates !== undefined)),
  );
  const take = (o: ActionOption, extra: { with?: string[] } = {}) => {
    if (o.def.procedure) {
      setDraft({ attackerId: unit.id, kind: "ranged", action: o.def.id, picking: true });
      return;
    }
    dispatch(
      {
        type: "action/take",
        unitId: unit.id,
        action: o.def.id,
        ...extra,
        ...(chosen ? { dice: chosen } : {}),
      },
      unit.owner,
    );
    setPick(null);
  };
  const click = (o: ActionOption) => {
    if (o.commands && o.commands.count > 0 && o.commands.candidates.length > 0)
      setCommanding({ action: o.def.id, picked: [] });
    else take(o);
  };
  const commandOption = commanding && options.find((o) => o.def.id === commanding.action);
  const pending = game.pending;
  const why = (o: ActionOption) =>
    o.why === "Waiting on a reaction" && pending
      ? t("Waiting for {name} to react", { name: seatName(game, pending.seat) })
      : o.why;
  // The generic "Not allowed now" (a failed condition) says nothing as a line; it stays in the tooltip.
  const blocked = shown.filter((o) => !o.ok && o.why && o.why !== "Not allowed now");
  const counts = new Map<string, number>();
  for (const o of blocked) counts.set(why(o)!, (counts.get(why(o)!) ?? 0) + 1);
  const shared = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const paidWith = (o: ActionOption) => o.payment.flatMap((p) => p.indices ?? []);

  return (
    <div className="actions">
      {acting && (
        <p className="muted small">
          {reacting
            ? t("Reacting: {used} of {budget} actions used.", {
                used: Number(status.actionsTaken ?? 0),
                budget: Number(status.actionBudget ?? 0),
              })
            : t("Activated: {used} of {budget} actions used.", {
                used: Number(status.actionsTaken ?? 0),
                budget: Number(status.actionBudget ?? 0),
              })}
        </p>
      )}
      {shown.some((o) => o.payment.some((p) => p.indices)) && (
        <PoolPicker owner={unit.owner} pick={pick} hover={hover} onPick={setPick} />
      )}
      <div className="row wrap">
        {shown.map((o) => (
          <button
            key={o.def.id}
            className={o.ok ? "primary" : ""}
            disabled={!o.ok}
            title={why(o) ?? (o.cost ? t("Costs {cost}", { cost: o.cost }) : undefined)}
            onMouseEnter={() => setHover(paidWith(o))}
            onMouseLeave={() => setHover([])}
            onClick={() => click(o)}
          >
            {o.def.name}
            {o.move !== undefined ? ` ${o.move}` : ""}
            {o.def.activates !== undefined && typeof o.def.activates === "number" && !o.def.reactTo
              ? " (" + tn(o.def.activates, "{n} action", "{n} actions") + ")"
              : ""}
            {o.faces?.length ? (
              <span className="cost"> · {usesFaces(o.faces)}</span>
            ) : o.cost ? (
              <span className="cost"> · {o.cost}</span>
            ) : null}
          </button>
        ))}
      </div>
      {shared && (
        <p className="muted small">
          {shared[0]}
          {counts.size > 1 ? `. ${t("Hover a greyed-out action for its reason.")}` : ""}
        </p>
      )}
      {commandOption?.commands && commanding && (
        <div className="command">
          <p className="small">
            {tn(
              commandOption.commands.count,
              "Also activate up to {n} unit:",
              "Also activate up to {n} units:",
            )}
          </p>
          {commandOption.commands.candidates.map((id) => (
            <label key={id} className="check">
              <input
                type="checkbox"
                checked={commanding.picked.includes(id)}
                disabled={
                  !commanding.picked.includes(id) && commanding.picked.length >= commandOption.commands!.count
                }
                onChange={(e) =>
                  setCommanding({
                    ...commanding,
                    picked: e.target.checked
                      ? [...commanding.picked, id]
                      : commanding.picked.filter((x) => x !== id),
                  })
                }
              />{" "}
              {game.units[id]?.name}
            </label>
          ))}
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                take(commandOption, { with: commanding.picked });
                setCommanding(null);
              }}
            >
              {commandOption.def.name}
              {commanding.picked.length ? " " + t("with {n}", { n: commanding.picked.length }) : ""}
            </button>
            <button onClick={() => setCommanding(null)}>{t("Cancel")}</button>
          </div>
        </div>
      )}
      {reacting && (
        <button onClick={() => dispatch({ type: "reaction/pass" }, unit.owner)}>
          {t("Finish reaction")}
        </button>
      )}
    </div>
  );
}

/**
 * Dice placed ahead of time on a weapon's AD slots (FSD), and while placing
 * is open, the owner's Ready dice that would fit: click one to place it.
 */
function SlotDice({ unit, weaponId, mine }: { unit: Unit; weaponId: string; mine: boolean }) {
  const game = useGame();
  const { dispatch } = useStore();
  const system = systemOf(game);
  const pool = placeablePool(system);
  if (!pool) return null;
  const at = weaponSlots(game, unit.id, weaponId);
  if (!at?.slots.length) return null;
  const placed = game.placed?.[unit.owner]?.[placedKey(unit.id, weaponId)] ?? [];
  const open = mine && placeWindow(game, unit.owner);
  const faces = game.pools?.[unit.owner]?.[pool] ?? [];
  // One button per face that fits, not per die.
  const fits = open
    ? [...new Set(faces)]
        .sort((a, b) => a - b)
        .flatMap((f) => {
          const i = faces.indexOf(f);
          return cantPlace(game, unit.owner, unit.id, weaponId, i) ? [] : [{ f, i }];
        })
    : [];
  if (!placed.length && !fits.length && !at.off) return null;
  return (
    <div className="slot-dice small">
      {at.off && <span className="muted">{at.off}. </span>}
      {placed.length > 0 && (
        <span title="Placed on its AD slots: spent when it fires">
          On card:{" "}
          {placed.map((f, k) => (
            <span key={k} className="die placed">
              {f}
            </span>
          ))}
        </span>
      )}
      {fits.length > 0 && (
        <span className="actions">
          {" "}
          Place:{" "}
          {fits.map(({ f, i }) => (
            <button
              key={f}
              className="die"
              title={`Put a ${f} from your Ready dice on this card`}
              onClick={() =>
                dispatch({ type: "dice/place", unitId: unit.id, weapon: weaponId, index: i }, unit.owner)
              }
            >
              {f}
            </button>
          ))}
        </span>
      )}
      {mine && placed.length > 0 && currentSlot(game)?.placeDice && (
        <button
          className="small link"
          onClick={() => dispatch({ type: "dice/discard", unitId: unit.id, weapon: weaponId }, unit.owner)}
        >
          Discard
        </button>
      )}
    </div>
  );
}

/** The owner's dice pool as buttons: pick one to pay with it; `hover` highlights the dice a button would use. */
function PoolPicker({
  owner,
  pick,
  hover,
  onPick,
}: {
  owner: string;
  pick: number | null;
  hover: number[];
  onPick: (i: number | null) => void;
}) {
  const game = useGame();
  const pool = (systemOf(game).resources ?? []).find((r) => r.kind === "dicePool");
  const faces = pool ? (game.pools?.[owner]?.[pool.id] ?? []) : [];
  if (!pool || !faces.length) return null;
  return (
    <div className="row wrap small">
      <span className="muted">{pool.name}:</span>
      {faces.map((f, i) => (
        <button
          key={i}
          className={`die ${pick === i ? "on" : ""} ${hover.includes(i) ? "hover" : ""}`}
          title={
            pick === i
              ? t("Paying with this die; click again for the lowest that fits")
              : t("Pay with this die")
          }
          onClick={() => onPick(pick === i ? null : i)}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

/** Why a target can't be hit, or a range note, from the weapon's range and the step plans. */
function rangeNote(
  system: GameSystem,
  weapon: { chars: Record<string, string> } | undefined,
  distance: number,
  impossible: boolean,
): string | null {
  const v = weapon ? readCharacteristics(system, "weapon", weapon.chars) : {};
  const range = typeof v.range === "number" ? v.range : null;
  const min = typeof v.minRange === "number" ? v.minRange : 0;
  if (min && distance < min) return t("inside minimum range");
  if (range && distance > range) return impossible ? t("out of range") : t("long range");
  return impossible ? t("can't hit") : null;
}

/**
 * Whether a preview has a dice step that can't succeed and that hurts the
 * one rolling it. An impossible save (passes on failures) or morale test
 * (failures add to the input) is good for the attacker, not a reason it
 * "can't hit".
 */
const cannotSucceed = (preview: { plans: Record<string, StepPlan> } | null) =>
  !!preview &&
  Object.values(preview.plans).some(
    (p) =>
      p.kind === "test" &&
      !p.skip &&
      p.target === null &&
      p.passOn !== "failures" &&
      p.passOn !== "inputPlusFailures",
  );

/** "Rear charge: every Resolve test fails", or without the cause when the attacker isn't behind. */
function everyTestFails(
  stepId: string,
  target: Unit | undefined,
  attacker: Unit | undefined,
  game: GameState,
) {
  const step = label(stepId);
  const behind = target && attacker && inArc(game, target, attacker) === "rear";
  return behind
    ? t("Rear charge: every {step} test fails", { step })
    : t("Every {step} test fails", { step });
}

/** Choose the weapon and target for a procedure action such as Fire, with the numbers it will use. */
export function ActionSetup({ draft }: { draft: AttackDraft & { action: string } }) {
  const game = useGame();
  const { setDraft, dispatch } = useStore();
  const [pick, setPick] = useState<number | null>(null);
  const unit = game.units[draft.attackerId];
  const system = systemOf(game);
  const def = system.actions.find((a) => a.id === draft.action);
  const dice = pick !== null ? { dice: [pick] } : {};
  const weapons = Object.values(unit?.sheet?.weapons ?? {});
  const options = useMemo(
    () =>
      unit
        ? weapons.map((w) => ({
            w,
            o: unitActions(game, unit.id, { weapon: w.id, ...dice }).find((o) => o.def.id === draft.action),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, unit?.id, draft.action, pick],
  );
  // Procedures without a weapon (Conquest's Clash and Volley) skip the weapon picker.
  const armed = !!def?.procedure && (findProcedure(system, def.procedure).params ?? []).includes("weapon");
  const weaponId = armed
    ? (draft.weaponId ?? options.find((x) => x.o?.ok)?.w.id ?? weapons[0]?.id)
    : undefined;
  const targets = unit && def ? actionTargets(game, unit.id, def.id) : [];
  const scale = inchesPerUnit(system);
  const chosen = options.find((x) => x.w.id === weaponId);
  const ready = (armed ? chosen?.o : unit) && draft.targetId;
  const option = ready
    ? unitActions(game, unit!.id, { weapon: weaponId, targetId: draft.targetId, ...dice }).find(
        (o) => o.def.id === draft.action,
      )
    : undefined;
  if (!unit || !def?.procedure) return null;
  const preview = ready
    ? safePreview(
        game,
        def.procedure,
        procedureRoles(system, def.procedure, unit.id, { weapon: weaponId, targetId: draft.targetId }),
      )
    : null;
  const weapon = weaponId ? unit.sheet?.weapons[weaponId] : undefined;
  // Each target's range note, from a preview of the roll against it.
  const notes = Object.fromEntries(
    targets.map((tg) => {
      const p =
        weaponId || !armed
          ? safePreview(
              game,
              def.procedure!,
              procedureRoles(system, def.procedure!, unit.id, { weapon: weaponId, targetId: tg.unitId }),
            )
          : null;
      return [tg.unitId, rangeNote(system, weapon, tg.distance, cannotSucceed(p))];
    }),
  );
  const hopeless = cannotSucceed(preview);

  return (
    <div className="panel attack">
      <div className="row spread">
        <strong>
          {unit.name}: {def.name}
        </strong>
        <button onClick={() => setDraft(null)}>{t("Cancel")}</button>
      </div>
      <div className="row wrap">
        {armed && (
          <select
            value={weaponId ?? ""}
            onChange={(e) => setDraft({ ...draft, weaponId: e.target.value || undefined })}
          >
            {options.map(({ w, o }) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {o?.cost ? ` (${o.cost})` : ""}
                {o && !o.ok ? `: ${o.why}` : ""}
              </option>
            ))}
          </select>
        )}
        <span>{t("at")}</span>
        <select
          value={draft.targetId ?? ""}
          onChange={(e) => setDraft({ ...draft, targetId: e.target.value || undefined, picking: false })}
        >
          <option value="">{t("Target…")}</option>
          {targets.map((tg) => (
            <option key={tg.unitId} value={tg.unitId}>
              {game.units[tg.unitId]?.name} ({fmt(tg.distance, system)}
              {tg.ok ? "" : `, ${t("not visible")}`}
              {notes[tg.unitId] ? `, ${notes[tg.unitId]}` : ""})
            </option>
          ))}
        </select>
        <button
          className={draft.picking ? "on" : ""}
          onClick={() => setDraft({ ...draft, picking: !draft.picking })}
        >
          {draft.picking ? t("Click a target on the table…") : t("Pick on table")}
        </button>
      </div>
      {preview && (
        <ul className="plan">
          {findProcedure(system, def.procedure).steps.map((step) => {
            const text = describePlan(preview.plans[step.id]);
            return text ? (
              <li key={step.id}>
                <span className="label">{label(step.id)}</span> {text}
                {preview.fired[step.id]?.length ? (
                  <span className="muted"> ({preview.fired[step.id]!.join(", ")})</span>
                ) : null}
              </li>
            ) : null;
          })}
        </ul>
      )}
      {option && !option.ok && <p className="warn">{option.why}</p>}
      {option?.ok && hopeless && draft.targetId && (
        <p className="warn">
          {t("{reason}: no roll can succeed.", {
            reason: (notes[draft.targetId] ?? t("can't hit")).replace(/^./, (c) => c.toUpperCase()),
          })}
        </p>
      )}
      {option?.payment.some((p) => p.indices) && (
        <PoolPicker owner={unit.owner} pick={pick} hover={[]} onPick={setPick} />
      )}
      <button
        className={hopeless ? "" : "primary"}
        disabled={!option?.ok}
        onClick={() => {
          dispatch(
            {
              type: "action/take",
              unitId: unit.id,
              action: def.id,
              weapon: weaponId,
              targetId: draft.targetId,
              ...dice,
            },
            unit.owner,
          );
          setDraft(null);
        }}
      >
        {def.name}
        {hopeless ? ` ${t("anyway")}` : ""}
        {option?.faces?.length ? ` (${usesFaces(option.faces)})` : option?.cost ? ` (${option.cost})` : ""}
      </button>
      <p className="muted small">
        {t('Distances in {units} ({scale}" each).', {
          units: unitName(system) === '"' ? t("inches") : unitName(system),
          scale,
        })}
      </p>
    </div>
  );
}

function safePreview(game: GameState, procedure: string, roles: ReturnType<typeof procedureRoles>) {
  try {
    return previewRun(procedureEnv(game), procedure, roles);
  } catch {
    return null;
  }
}

/** "pinInfantry" → "Pin infantry", "resolve_flanked" → "Resolve flanked". */
function label(id: string): string {
  const words = id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describePlan(plan: StepPlan | undefined): string | null {
  if (!plan) return null;
  if (plan.kind === "pool") return t("{count} dice", { count: plan.count });
  if (plan.kind === "damage") return t("{amount} each", { amount: plan.amount });
  if (plan.kind !== "test") return null;
  if (plan.skip) return t("skipped");
  const keep =
    plan.keep && plan.dicePerInput > 1
      ? ` ${plan.keep === "highest" ? t("keep highest") : t("keep lowest")}`
      : "";
  const dice = `${plan.dicePerInput > 1 ? `${plan.dicePerInput}×` : ""}${plan.sumOf > 1 ? plan.sumOf : ""}d${plan.sides}${keep}`;
  if (plan.target === null)
    return plan.passOn === "failures"
      ? t("no save")
      : plan.passOn === "inputPlusFailures"
        ? t("{dice}: every test fails", { dice })
        : t("{dice}: can't succeed", { dice });
  // A target of 0 means each die is judged against the roll it answers (opposed saves).
  const vs =
    plan.target === 0
      ? t("vs each hit roll")
      : plan.compare === "atLeast"
        ? `${plan.target}+`
        : t("{target} or less", { target: plan.target });
  return `${dice} ${vs}${plan.modifier ? ` (${plan.modifier > 0 ? "+" : ""}${plan.modifier})` : ""}`;
}

/** The procedure being rolled: every step's dice, the open window, and what happened. */
export function ProcedurePanel() {
  const game = useGame();
  const { dispatch, role, scrub } = useStore();
  const proc = game.procedure;
  if (!proc) return null;
  const system = systemOf(game);
  const steps = findProcedure(system, proc.run.procedure).steps;
  const run = proc.run;
  const live = scrub === null && role !== "spectator";
  const next = run.done ? null : steps[run.next];
  const target = proc.targetId ? game.units[proc.targetId] : undefined;
  const defender = target?.owner;
  // Rolls go through the attacker; the defender answers windows on their side.
  const roller = next && next.kind === "test" && next.roller === "defender" ? defender : proc.by;
  // In a lesson the computer rolls and answers for its own side.
  const botRolls = computerPlays(game, roller);
  const botAnswers = computerPlays(game, defender);
  const botActs = computerPlays(game, proc.by);
  const notes = run.outcomes.filter((o) => o.kind === "note" || o.kind === "reminder");
  const actor = game.units[proc.unitId];
  const weapon = proc.weapon ? actor?.sheet?.weapons[proc.weapon] : undefined;
  const distance =
    proc.targetId && actor
      ? actionTargets(game, actor.id, proc.action).find((t) => t.unitId === proc.targetId)?.distance
      : undefined;
  // A step that couldn't succeed says why, e.g. "out of range", rather than a bare "0 of 3".
  const whyNone = (r: StepRecord) =>
    r.plan.kind === "test" && r.plan.target === null && r.plan.passOn === "failures"
      ? t("no save possible")
      : r.plan.kind === "test" && r.plan.target === null && r.plan.passOn === "inputPlusFailures"
        ? everyTestFails(r.id, target, actor, game)
        : r.plan.kind === "test" && r.plan.target === null
          ? ((distance !== undefined ? rangeNote(system, weapon, distance, true) : null) ??
            t("can't succeed"))
          : undefined;
  const loss = lossText(game, run.outcomes);
  const statuses = [
    ...new Set(
      run.outcomes.flatMap((o) =>
        o.kind === "status" && o.value && !o.status.startsWith("box")
          ? [system.statuses?.find((s) => s.id === o.status)?.name ?? o.status]
          : [],
      ),
    ),
  ];

  return (
    <div className="panel attack">
      <strong>{proc.title}</strong>
      {run.records
        .filter((r) => r.dice?.length || r.rolls?.length || r.damage?.length || r.kind === "pool")
        .map((r, i) => (
          <RecordRow key={i} record={r} why={whyNone(r)} />
        ))}
      {run.pending && !botAnswers && (
        <div className="stage">
          <span className="label">{label(run.pending.step)}</span>
          <span className="row wrap">
            {run.pending.options.map((o) => (
              <button
                key={o.id}
                disabled={!live}
                onClick={() => dispatch({ type: "procedure/respond", answer: o.id }, defender)}
              >
                {o.label}
              </button>
            ))}
            <button
              disabled={!live}
              onClick={() => dispatch({ type: "procedure/respond", answer: "pass" }, defender)}
            >
              {t("Pass")}
            </button>
          </span>
        </div>
      )}
      {run.done && (
        <p>
          <strong>
            {loss === "destroyed" ? t("Unit destroyed") : loss.replace(/^./, (c) => c.toUpperCase())}
            {statuses.length ? ` · ${statuses.join(", ")}` : ""}
          </strong>
        </p>
      )}
      {notes.length > 0 && (
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i}>{"text" in n ? n.text : ""}</li>
          ))}
        </ul>
      )}
      {live && next && (botRolls || (run.pending && botAnswers)) && (
        <p className="muted">{t("The computer is rolling…")}</p>
      )}
      {live && !(botActs && (botRolls || run.done)) && (
        <div className="row">
          {next && !run.pending && !botRolls && (
            <button className="primary" onClick={() => dispatch({ type: "procedure/roll" }, roller)}>
              {t("Roll {step}", { step: label(next.id).toLowerCase() })}
            </button>
          )}
          {!botActs && (
            <button onClick={() => dispatch({ type: "procedure/clear" }, proc.by)}>
              {run.done ? t("Done") : t("Cancel")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RecordRow({ record: r, why }: { record: StepRecord; why?: string }) {
  const kept = r.dice ?? [];
  return (
    <div className="stage">
      <span className="label">{label(r.id)}</span>
      <span className="dice">
        {r.kind === "pool" && <span className="muted">{t("{count} dice", { count: r.out })}</span>}
        {kept.map((d, i) => (
          <span
            key={i}
            className={`die ${d.success ? (d.critical ? "crit" : "ok") : "fail"}`}
            title={d.dice && d.dice.length > 1 ? t("rolled {dice}", { dice: d.dice.join(", ") }) : undefined}
          >
            {d.value}
          </span>
        ))}
        {r.damage?.map((d, i) => (
          <span key={`d${i}`} className={`die ${d.destroyed ? "crit" : "ok"}`}>
            {d.lost}
          </span>
        ))}
      </span>
      {r.dice && (
        <span className="result">
          {r.plan.kind === "test" && r.plan.passOn === "failures"
            ? t("{successes} of {count} saved", { successes: r.successes ?? 0, count: r.in })
            : t("{successes} of {count} succeed", { successes: r.successes ?? 0, count: r.in })}
          {why ? <span className="warn">: {why}</span> : null}
        </span>
      )}
    </div>
  );
}

/** While an action waits on a reaction: who is deciding, and for them, the units that can react. */
export function ReactionPrompt() {
  const game = useGame();
  const { dispatch, select, scrub } = useStore();
  const canControl = useCanControl();
  const pending = game.pending;
  if (!pending || scrub !== null) return null;
  const trigger = pending.trigger;
  const actor = game.units[trigger.unitId];
  const target = trigger.targetId ? game.units[trigger.targetId] : undefined;
  const system = systemOf(game);
  const action = system.actions.find((a) => a.id === trigger.action)?.name ?? trigger.action;
  const who = seatName(game, pending.seat);
  const reactor = pending.reactor ? game.units[pending.reactor] : undefined;
  const deciding = Object.values(game.players).find((p) => p.seat === pending.seat);
  const mine = deciding ? canControl(deciding.id) : false;
  const reactors = Object.values(game.units).flatMap((u) => {
    if (game.players[u.owner]?.seat !== pending.seat) return [];
    const o = unitActions(game, u.id).find((x) => x.def.reactTo && x.ok);
    return o ? [{ unit: u, option: o }] : [];
  });
  const actorName = actor?.name ?? t("A unit");
  const what = target
    ? t("{unit}: {action} at {target}", { unit: actorName, action, target: target.name })
    : `${actorName}: ${action}`;

  return (
    <div className="panel reaction">
      {reactor ? (
        <p>
          <strong>{reactor.name}</strong> {t("is reacting to {what}.", { what })}{" "}
          {mine ? t("Take its action, then finish the reaction.") : t("Waiting on {name}.", { name: who })}
        </p>
      ) : mine ? (
        <>
          <p>
            <strong>{who}</strong>, {t("react to {what}?", { what })}
          </p>
          <div className="row wrap">
            {reactors.map(({ unit, option }) => (
              <button
                key={unit.id}
                className="primary"
                onClick={() => {
                  dispatch({ type: "action/take", unitId: unit.id, action: option.def.id }, unit.owner);
                  select(unit.id);
                }}
              >
                {unit.name}
                {option.cost ? ` (${option.cost})` : ""}
              </button>
            ))}
            <button onClick={() => dispatch({ type: "reaction/pass" }, deciding?.id)}>
              {t("Don't react")}
            </button>
          </div>
        </>
      ) : (
        <p>
          {what}. {t("Waiting on {name} to decide whether to react.", { name: who })}
        </p>
      )}
      {reactor && mine && (
        <button onClick={() => dispatch({ type: "reaction/pass" }, deciding?.id)}>
          {t("Finish reaction")}
        </button>
      )}
    </div>
  );
}
