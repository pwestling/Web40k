import { useMemo } from "react";
import type { Ability, AbilityAuto, Unit } from "../core";
import { describesWeaponKeyword, isAutomated } from "../core/content/player";
import type { GameSystem } from "../core/content/schema";
import { systemOf } from "../core/content/turn";
import { describeAuto } from "./autoText";
import { t, tn } from "../i18n";
import { useStore } from "../store";
import { systemModule } from "../systems";
import type { ImportedRoster } from "../systems/wh40k/roster";

/**
 * Abilities that play themselves (#38): the rule read from an ability's text,
 * in the reader's language; the import's proposals and coverage line; and
 * the unit card's switches. The text itself stays the player's.
 */

interface Proposal {
  unit: number;
  ability: Ability;
  auto: AbilityAuto;
}

/** Proposals and the coverage line for an army about to be deployed. */
function readRoster(
  roster: ImportedRoster,
  system: GameSystem,
  recognize: NonNullable<ReturnType<typeof systemModule>["recognizeAbility"]>,
) {
  let automated = 0;
  let total = 0;
  const proposals: Proposal[] = [];
  roster.units.forEach((u, unit) => {
    const seen = new Set<string>();
    const asUnit = { sheet: u.sheet } as Unit;
    for (const a of u.sheet.abilities) {
      if (seen.has(a.name) || describesWeaponKeyword(system, asUnit, a)) continue;
      seen.add(a.name);
      total++;
      if (a.auto) proposals.push({ unit, ability: a, auto: a.auto });
      if (isAutomated(system, a)) {
        automated++;
        continue;
      }
      const auto = recognize(a, system);
      if (auto) proposals.push({ unit, ability: a, auto });
    }
  });
  return { automated, total, proposals };
}

/** On the army import: "23 of 41 abilities automated", and what else the app could run. */
export function ImportAutomation({
  roster,
  setRoster,
}: {
  roster: ImportedRoster;
  setRoster: (r: ImportedRoster) => void;
}) {
  const game = useStore((s) => s.game);
  const system = systemOf(game);
  const recognize = systemModule(game.system).recognizeAbility;
  const read = useMemo(
    () => (recognize ? readRoster(roster, system, recognize) : null),
    [roster, system, recognize],
  );
  if (!read || !read.total) return null;
  const set = (picks: Proposal[], on: boolean) => {
    const units = roster.units.map((u, i) => {
      const mine = picks.filter((p) => p.unit === i);
      if (!mine.length) return u;
      return {
        ...u,
        sheet: {
          ...u.sheet,
          abilities: u.sheet.abilities.map((a) => {
            const p = mine.find((x) => x.ability.name === a.name);
            if (!p) return a;
            const { auto: _, ...rest } = a;
            return on ? { ...rest, auto: p.auto } : rest;
          }),
        },
      };
    });
    setRoster({ ...roster, units });
  };
  // Confirmed ones stay listed, so a tick can be taken back.
  const open = read.proposals;
  const waiting = open.filter((p) => !p.ability.auto);
  return (
    <div className="auto-abilities">
      <p className="small">
        <strong>
          {tn(read.total, "{done} of {n} ability automated", "{done} of {n} abilities automated", {
            done: read.automated,
          })}
        </strong>
        {waiting.length > 0 && (
          <span className="muted">
            {" "}
            ·{" "}
            {tn(waiting.length, "{n} more can be, if you confirm it", "{n} more can be, if you confirm them")}
          </span>
        )}
      </p>
      {open.length > 0 && (
        <details>
          <summary>{t("Abilities the app can play for you")}</summary>
          <p className="muted small">
            {t(
              "Read from your list's text. Check each rule against the ability before you tick it; the rest stay reminders.",
            )}
          </p>
          <ul className="auto-list">
            {open.map((p) => (
              <li key={`${p.unit}/${p.ability.name}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      !!roster.units[p.unit]?.sheet.abilities.find((a) => a.name === p.ability.name)?.auto
                    }
                    onChange={(e) => set([p], e.target.checked)}
                  />{" "}
                  <strong>
                    {roster.units[p.unit]?.name}: {p.ability.name}
                  </strong>{" "}
                  <span className="muted">{t("Automate this?")}</span>
                </label>
                <div className="small">{describeAuto(p.auto, system)}</div>
              </li>
            ))}
          </ul>
          {waiting.length > 1 && (
            <button className="small" onClick={() => set(waiting, true)}>
              {t("Automate all suggested")}
            </button>
          )}
        </details>
      )}
    </div>
  );
}

/** Is this ability one the unit can use right now (once per battle, not used yet)? */
export function oncePerBattleReady(unit: Unit, a: Ability): boolean {
  return !!a.auto?.oncePerBattle && !unit.status?.[`autoUsed.${a.name}`];
}

/** One line in the unit card's abilities: its text, and what the app runs for it. */
export function AbilityLine({ unit, ability, mine }: { unit: Unit; ability: Ability; mine: boolean }) {
  const game = useStore((s) => s.game);
  const dispatch = useStore((s) => s.dispatch);
  const system = systemOf(game);
  const recognize = systemModule(game.system).recognizeAbility;
  const proposal = useMemo(
    () => (!ability.auto && recognize && !isAutomated(system, ability) ? recognize(ability, system) : null),
    [ability, recognize, system],
  );
  const automate = (auto: AbilityAuto | null) =>
    dispatch({ type: "unit/automate", id: unit.id, ability: ability.name, auto }, unit.owner);
  return (
    <div className="ability-line">
      <p>
        <strong>{ability.name}.</strong> {ability.text}
      </p>
      {ability.auto && (
        <p className="small auto-on">
          ⚙ {t("Automated:")} {describeAuto(ability.auto, system)}
          {mine && (
            <>
              {" "}
              <button className="quiet small" onClick={() => automate(null)}>
                {t("Stop automating")}
              </button>
            </>
          )}
        </p>
      )}
      {proposal && mine && (
        <p className="small muted">
          {describeAuto(proposal, system)}{" "}
          <button className="small" onClick={() => automate(proposal)}>
            {t("Automate this?")}
          </button>
        </p>
      )}
    </div>
  );
}

/** "Use Fury" buttons for once-per-battle abilities the app runs, and which are on now. */
export function OncePerBattle({ unit, mine }: { unit: Unit; mine: boolean }) {
  const dispatch = useStore((s) => s.dispatch);
  const once = (unit.sheet?.abilities ?? []).filter((a) => a.auto?.oncePerBattle);
  const seen = new Set<string>();
  const list = once.filter((a) => !seen.has(a.name) && seen.add(a.name));
  if (!list.length) return null;
  const use = (a: Ability) => {
    dispatch({ type: "unit/status", id: unit.id, key: `auto.${a.name}`, value: true }, unit.owner);
    dispatch({ type: "unit/status", id: unit.id, key: `autoUsed.${a.name}`, value: true }, unit.owner);
  };
  return (
    <div className="row wrap">
      {list.map((a) =>
        unit.status?.[`auto.${a.name}`] ? (
          <span key={a.name} className="tag small">
            {t("{ability}: on until the end of the phase", { ability: a.name })}
          </span>
        ) : oncePerBattleReady(unit, a) ? (
          mine && (
            <button
              key={a.name}
              title={t("Once per battle; it lasts until the end of the phase")}
              onClick={() => use(a)}
            >
              {t("Use {ability}", { ability: a.name })}
            </button>
          )
        ) : (
          <span key={a.name} className="muted small">
            {t("{ability} used", { ability: a.name })}
          </span>
        ),
      )}
    </div>
  );
}
