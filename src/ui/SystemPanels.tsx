import { UnitWarnings } from "./TableWarnings";
import { playerShape } from "./sides";
import { useState, type ReactNode } from "react";
import {
  cantPlace,
  currentSlot,
  placeablePool,
  placedKey,
  placeWindow,
  readCharacteristics,
  seatName,
  systemOf,
  unitActions,
  unitView,
  weaponSlots,
  type ActionOption,
  type CharacteristicDef,
} from "../core/content";
import { modelHeight, type Ability, type Unit } from "../core";
import { useCanControl, useStore } from "../store";
import { aliveModels, moveAllowance, unitMoved } from "../systems/wh40k/rules";
import { plainActivations } from "../core/content/turn";
import { useGame } from "./hooks";
import { eyeView, rotateUnit } from "./UnitCard";
import { useCharged } from "../render/charges";
import { formatList, formatNumber, t, tn, gameText } from "../i18n";
import { lengthText } from "./distance";

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

/** "uses a 4 and a 6": the dice-pool faces an action pays with. */
export const usesFaces = (faces: (string | number)[]) =>
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
  // The system's own way to write it: 4+, 5" (PX print and play).
  if (c.format && text === undefined) return value === 0 ? "–" : c.format.replace("{v}", String(value));
  return String(value);
}

/** Imported abilities, under the headings the importer gave them (or one list). */
function AbilityList({ abilities, spent }: { abilities: Ability[]; spent?: (name: string) => boolean }) {
  if (!abilities.length) return null;
  const groups = new Map<string, Ability[]>();
  for (const a of abilities) {
    const g = a.group ?? t("Abilities");
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  // Spent items show on the card face, not only inside their fold (UX 322).
  const used = abilities.filter((a) => spent?.(a.name)).map((a) => a.name);
  return (
    <>
      {used.length > 0 && <p className="small muted">{t("Spent: {items}", { items: used.join(", ") })}</p>}
      {[...groups].map(([group, list]) => (
        <details key={group} className="abilities">
          <summary>
            {group} ({list.length})
          </summary>
          {list.map((a) => (
            <p key={a.name} className="small">
              <strong>{a.name}.</strong> {a.text}
              {spent?.(a.name) ? <em> {t("(spent)")}</em> : null}
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
  // A game of plain activations (Rift Lanterns) moves on the unit's Move, with no move action to set it (UX 334).
  const allowance =
    typeof unit.status?.allowance === "number"
      ? unit.status.allowance
      : plainActivations(game)
        ? moveAllowance(game, unit)
        : null;
  const moved = unitMoved(alive);
  // At a real table (the companion) the board's positions mean nothing: no distances or sight here.
  const companion = !!game.settings.companion;
  const plain = plainActivations(game);
  const statuses = (system.statuses ?? []).filter((s) => view.statuses.includes(s.id));
  const flags = view.flags.filter(
    (f) =>
      !statuses.some((s) => s.id === f) &&
      !/^(acting|activated|actionsTaken|actionBudget|allowance|reacting|moves|arrived|box\d+|used\.|spent\.|ok\.)/.test(
        f,
      ),
  );
  const chars = system.characteristics.filter((c) => c.of === "model" && c.type !== "text");
  const texts = system.characteristics.filter((c) => c.of === "model" && c.type === "text");
  const weapons = Object.values(unit.sheet?.weapons ?? {});
  // An optional column no weapon fills (FSD's system line, which defaults to the card order) stays out.
  const weaponChars = system.characteristics.filter(
    (c) =>
      c.of === "weapon" && (c.id !== "line" || weapons.some((w) => rosterText(c, w.chars) !== undefined)),
  );
  const first = alive[0] ?? all[0];
  const raw = readCharacteristics(system, "model", first?.profile?.chars);
  // A charge that struck home this round stays on the card with its distance (PX-3c).
  const charged = useCharged(unit.id);
  const chargedText =
    charged !== null ? t("Charged {distance}", { distance: lengthText(system, charged) }) : null;

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
      {statuses
        .filter((s) => s.hint)
        .map((s) => (
          <p key={`hint-${s.id}`} className="warn small">
            {gameText(s.hint!)}
          </p>
        ))}
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
            // A spell on the unit (rank-and-flank magic) or a prepared action's token (FSD):
            // by name, and a player ends it by hand when it's used or lost.
            f.startsWith("spell:") || f.startsWith("prepared.") ? (
              <button
                key={f}
                className="chip on"
                disabled={!mine}
                title={
                  f.startsWith("spell:")
                    ? t("Click to end this spell")
                    : t("Click when the token is used or lost")
                }
                onClick={() =>
                  dispatch({ type: "unit/status", id: unit.id, key: f, value: null }, unit.owner)
                }
              >
                {f.startsWith("spell:")
                  ? f.slice(6)
                  : t("{weapon} prepared", { weapon: unit.sheet?.weapons[f.slice(9)]?.name ?? f.slice(9) })}
              </button>
            ) : (
              <span key={f} className="chip on">
                {f === "reserves"
                  ? t("In reserve")
                  : f === "interacting"
                    ? t("Interacting")
                    : f === "charged" && chargedText
                      ? chargedText
                      : f}
              </span>
            ),
          )}
          {chargedText && !statuses.some((s) => s.id === "charged") && !flags.includes("charged") && (
            <span className="chip on charged">{chargedText}</span>
          )}
        </div>
      )}
      {companion && plain && mine && game.turn.round > 0 && <MovedOnTable unit={unit} />}
      {allowance !== null && !companion && (
        <p className={moved > allowance + 0.05 ? "warn" : "muted"}>
          {t("Moved {distance} of {allowance} this round.", {
            distance: lengthText(system, moved),
            allowance: lengthText(system, allowance),
          })}
        </p>
      )}
      <UnitWarnings unitId={unit.id} skip={allowance !== null ? ["moveDistance", "wheelDistance"] : []} />

      {!companion && (
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
      )}

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
                    {mine && <PrepareButton unit={unit} weaponId={w.id} />}
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
      <AbilityList
        abilities={unit.sheet?.abilities ?? []}
        spent={(name) => !!unit.status?.[`spent.${name}`]}
      />
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
  const starters = options.filter((o) => o.def.activates !== undefined && !o.def.reactTo);
  const starter = starters.find((o) => o.why !== "Not allowed now") ?? starters[0];
  // Preparing is per weapon: its button sits on the weapon's row.
  const shown = options.filter(
    (o) =>
      !o.def.prepares &&
      (!o.def.reactTo || o.ok) &&
      // Of the ways to start an activation, only those this unit could use (Deploy for reserves).
      !(activations && !acting && o.def.activates !== undefined && !o.def.reactTo && o !== starter) &&
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
      {/* Out of actions: end the activation here, not only from the top bar (UX 265). */}
      {acting &&
        !reacting &&
        Number(status.actionsTaken ?? 0) >= Number(status.actionBudget ?? 0) &&
        !game.pending && (
          <div className="row">
            <button
              className="primary"
              title={t("End this activation; the other player goes next")}
              onClick={() => {
                setDraft(null);
                dispatch({ type: "turn/endActivation" }, unit.owner);
              }}
            >
              {t("End activation")}
            </button>
          </div>
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
            {gameText(o.def.name)}
            {/* It asks which units to command first: "Activate…" says a choice comes (UX 295). */}
            {o.commands && o.commands.count > 0 && o.commands.candidates.length > 0 ? "…" : ""}
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
              {gameText(commandOption.def.name)}
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

/** Prepare a weapon's prepared action (FSD), while the unit is acting. */
function PrepareButton({ unit, weaponId }: { unit: Unit; weaponId: string }) {
  const game = useGame();
  const { dispatch } = useStore();
  if (!unit.status?.acting) return null;
  const o = unitActions(game, unit.id, { weapon: weaponId }).find((x) => x.def.prepares);
  // Once used this round, or while its token is down, there's nothing to press (UX 294).
  if (!o || o.why === "Not for this weapon" || o.why === "Weapon already used this round") return null;
  if (unit.status?.[`prepared.${weaponId}`]) return null;
  return (
    <div className="actions">
      <button
        className={`small ${o.ok ? "primary" : ""}`}
        disabled={!o.ok}
        title={o.why ?? t("Put a token on it: its effects last while the token stays")}
        onClick={() =>
          dispatch({ type: "action/take", unitId: unit.id, action: o.def.id, weapon: weaponId }, unit.owner)
        }
      >
        {gameText(o.def.name)}
        {o.faces?.length ? <span className="cost"> · {usesFaces(o.faces)}</span> : null}
      </button>
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
        <span title={t("Placed on its AD slots: spent when it's used")}>
          {t("On card:")}{" "}
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
          {t("Place:")}{" "}
          {fits.map(({ f, i }) => (
            <button
              key={f}
              className="die"
              title={t("Put a {face} from your Ready dice on this card", { face: String(f) })}
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
          {t("Discard")}
        </button>
      )}
    </div>
  );
}

/** The owner's dice pool as buttons: pick one to pay with it; `hover` highlights the dice a button would use. */
export function PoolPicker({
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

/**
 * At a real table, a unit whose go is only a move: the move happened on the
 * table, so its player says so here and the other side goes next.
 */
function MovedOnTable({ unit }: { unit: Unit }) {
  const game = useGame();
  const dispatch = useStore((s) => s.dispatch);
  if (game.players[unit.owner]?.seat !== game.turn.activeSeat || game.script) return null;
  if (unit.status?.activated && !unit.status.acting)
    return <p className="muted small">{t("Has had its go this round.")}</p>;
  if (Object.values(game.units).some((u) => u.status?.acting && u.id !== unit.id)) return null;
  return (
    <button
      title={t("It moved on the table and does nothing else: its go is over")}
      onClick={() => dispatch({ type: "turn/endActivation", unit: unit.id }, unit.owner)}
    >
      {t("Moved only: end its go")}
    </button>
  );
}
