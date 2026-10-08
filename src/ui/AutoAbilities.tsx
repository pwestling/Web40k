import { useMemo, useState } from "react";
import type { Ability, AbilityAuto, Unit } from "../core";
import { describesWeaponKeyword, isAutomated, isWeaponRule } from "../core/content/player";
import type { GameSystem } from "../core/content/schema";
import { systemOf } from "../core/content/turn";
import { describeAuto } from "./autoText";
import { t, tn } from "../i18n";
import { useStore } from "../store";
import { systemModule } from "../systems";
import {
  ARMY_RULE,
  DETACHMENT_RULE,
  ENHANCEMENTS,
  parseStratagemText,
  type ImportedRoster,
} from "../systems/wh40k/roster";
import { recognizeArmyRule, recognizeStratagem } from "../systems/wh40k/recognize";

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
  /** Abilities the players play themselves: neither run by the app nor read from their text. */
  const reminders: string[] = [];
  roster.units.forEach((u, unit) => {
    const seen = new Set<string>();
    const asUnit = { sheet: u.sheet } as Unit;
    for (const a of u.sheet.abilities) {
      // Enhancements and the detachment's rule count with the detachment (ArmyAutomation).
      if (
        seen.has(a.name) ||
        a.group === ENHANCEMENTS ||
        a.group === DETACHMENT_RULE ||
        a.group === ARMY_RULE
      )
        continue;
      if (describesWeaponKeyword(system, asUnit, a)) continue;
      seen.add(a.name);
      total++;
      if (a.auto) proposals.push({ unit, ability: a, auto: a.auto });
      if (isAutomated(system, a)) {
        automated++;
        continue;
      }
      const auto = recognize(a, system);
      if (auto) proposals.push({ unit, ability: a, auto });
      else if (!reminders.includes(a.name)) reminders.push(a.name);
    }
  });
  return { automated, total, proposals, reminders };
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
  if (!read) return null;
  return (
    <>
      {roster.army && <ArmyAutomation roster={roster} setRoster={setRoster} system={system} />}
      <AddStratagem roster={roster} setRoster={setRoster} />
      {read.total > 0 && <Coverage read={read} roster={roster} setRoster={setRoster} system={system} />}
    </>
  );
}

/** Rosters rarely list stratagems: the player pastes their detachment's own, one at a time (#51). */
function AddStratagem({
  roster,
  setRoster,
}: {
  roster: ImportedRoster;
  setRoster: (r: ImportedRoster) => void;
}) {
  const game = useStore((s) => s.game);
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  if (!roster.army && !roster.units.length) return null;
  const add = () => {
    const army = roster.army ?? { rules: [], stratagems: [] };
    const s = parseStratagemText(
      text,
      army.stratagems.map((x) => x.id),
    );
    if (!s) return setWhy(t("Paste its name, then its When, Target and Effect."));
    const auto = s.targetsUnit ? recognizeStratagem(s.effect ?? s.text, systemOf(game)) : null;
    setRoster({ ...roster, army: { ...army, stratagems: [...army.stratagems, auto ? { ...s, auto } : s] } });
    setText("");
    setWhy("");
  };
  return (
    // Open when the list brought none: the usual case for a real export (UX 371).
    <details className="auto-abilities" open={!roster.army?.stratagems.length}>
      <summary>{t("Add a stratagem")}</summary>
      <p className="muted small">
        {t(
          "Lists don't carry stratagems. Paste one from your book: its name on the first line, then When, Target and Effect. It stays on your device and the table's.",
        )}
      </p>
      <textarea
        rows={5}
        value={text}
        aria-label={t("Stratagem text")}
        placeholder={t("Name (1CP)\nWHEN: …\nTARGET: …\nEFFECT: …")}
        onChange={(e) => setText(e.target.value)}
      />
      {why && <p className="small warn">{why}</p>}
      <button className="small" disabled={!text.trim()} onClick={add}>
        {t("Add")}
      </button>
    </details>
  );
}

/** One of the detachment's rules: an army rule, a unit's enhancement or a stratagem. */
interface ArmyItem {
  key: string;
  label: string;
  /** Already run by the app (confirmed, or a core rule it knows). */
  done: boolean;
  /** The player confirmed what the recognizer read. */
  on: boolean;
  /** What the recognizer read, to confirm; none when it stays a reminder. */
  auto: AbilityAuto | null;
  set: (r: ImportedRoster, on: boolean) => ImportedRoster;
}

function armyItems(roster: ImportedRoster, system: GameSystem): ArmyItem[] {
  const army = roster.army!;
  const items: ArmyItem[] = [];
  army.rules.forEach((rule, i) => {
    // Weapon keywords the detachment's rule mentions come along as rules; they aren't its own.
    if (isWeaponRule(system, rule)) return;
    items.push({
      key: `rule/${i}`,
      label: rule.name,
      done: isAutomated(system, rule),
      on: !!rule.auto,
      auto: rule.auto ?? recognizeArmyRule(rule, system),
      set: (r, on) => {
        const rules = r.army!.rules.map((a, j) => {
          if (j !== i) return a;
          const { auto: _, ...rest } = a;
          const auto = a.auto ?? recognizeArmyRule(a, system);
          return on && auto ? { ...rest, auto } : rest;
        });
        return { ...r, army: { ...r.army!, rules } };
      },
    });
  });
  roster.units.forEach((u, ui) => {
    u.sheet.abilities.forEach((a, ai) => {
      if (a.group !== ENHANCEMENTS) return;
      items.push({
        key: `enh/${ui}/${ai}`,
        label: `${u.name}: ${a.name}`,
        done: isAutomated(system, a),
        on: !!a.auto,
        auto: a.auto ?? recognizeArmyRule(a, system),
        set: (r, on) => {
          const units = r.units.map((x, j) => {
            if (j !== ui) return x;
            const abilities = x.sheet.abilities.map((b, k) => {
              if (k !== ai) return b;
              const { auto: _, ...rest } = b;
              const auto = b.auto ?? recognizeArmyRule(b, system);
              return on && auto ? { ...rest, auto } : rest;
            });
            return { ...x, sheet: { ...x.sheet, abilities } };
          });
          return { ...r, units };
        },
      });
    });
  });
  army.stratagems.forEach((st, i) => {
    const read = st.targetsUnit ? recognizeStratagem(st.effect ?? st.text, system) : null;
    items.push({
      key: `strat/${i}`,
      label: t("{name} ({cp} CP)", { name: st.name, cp: st.cp }),
      done: !!st.auto,
      on: !!st.auto,
      auto: st.auto ?? read,
      set: (r, on) => {
        const stratagems = r.army!.stratagems.map((x, j) => {
          if (j !== i) return x;
          const { auto: _, ...rest } = x;
          const auto = x.auto ?? read;
          return on && auto ? { ...rest, auto } : rest;
        });
        return { ...r, army: { ...r.army!, stratagems } };
      },
    });
  });
  return items;
}

/** On the army import: "Detachment Ember Vigil: 3 of 7 rules automated", with what else the app could run (#49). */
function ArmyAutomation({
  roster,
  setRoster,
  system,
}: {
  roster: ImportedRoster;
  setRoster: (r: ImportedRoster) => void;
  system: GameSystem;
}) {
  const items = armyItems(roster, system);
  const done = items.filter((i) => i.done).length;
  const proposals = items.filter((i) => i.auto);
  const reminders = items.filter((i) => !i.done && !i.auto).map((i) => i.label);
  const army = roster.army!;
  const name = army.detachment ?? army.faction ?? t("Your army");
  if (!items.length) return null;
  return (
    <div className="auto-abilities">
      <p className="small">
        <strong>
          {tn(
            items.length,
            "Detachment {name}: {done} of {n} rule automated",
            "Detachment {name}: {done} of {n} rules automated",
            {
              name,
              done,
            },
          )}
        </strong>
        {army.stratagems.length === 0 && (
          <span className="muted"> · {t("No stratagems in this list: add your detachment's below.")}</span>
        )}
        {army.stratagems.length > 0 && (
          <span className="muted">
            {" "}
            ·{" "}
            {tn(
              army.stratagems.length,
              "{n} stratagem in your play panel",
              "{n} stratagems in your play panel",
            )}
          </span>
        )}
      </p>
      {proposals.length > 0 && (
        <ul className="auto-list">
          {proposals.map((p) => (
            <li key={p.key}>
              <label>
                <input
                  type="checkbox"
                  checked={p.on}
                  onChange={(e) => setRoster(p.set(roster, e.target.checked))}
                />{" "}
                <strong>{p.label}</strong> <span className="muted">{t("Automate this?")}</span>
              </label>
              <div className="small">{describeAuto(p.auto!, system)}</div>
            </li>
          ))}
        </ul>
      )}
      {proposals.filter((p) => !p.on).length > 1 && (
        <button
          className="small"
          onClick={() => setRoster(proposals.filter((p) => !p.on).reduce((r, p) => p.set(r, true), roster))}
        >
          {t("Automate all suggested")}
        </button>
      )}
      {reminders.length > 0 && (
        <p className="muted small">
          {tn(
            reminders.length,
            "{names}: the app reminds you of it; play it yourself.",
            "{names}: the app reminds you of these; play them yourself.",
            { names: reminders.join(", ") },
          )}
        </p>
      )}
    </div>
  );
}

function Coverage({
  read,
  roster,
  setRoster,
  system,
}: {
  read: ReturnType<typeof readRoster>;
  roster: ImportedRoster;
  setRoster: (r: ImportedRoster) => void;
  system: GameSystem;
}) {
  // Open while proposals wait for an answer (UX 291).
  const [fold, setFold] = useState(() => read.proposals.some((p) => !p.ability.auto));
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
        <details open={fold} onToggle={(e) => setFold(e.currentTarget.open)}>
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
      {read.reminders.length > 0 && (
        <p className="muted small">
          {tn(
            read.reminders.length,
            "{names}: the app reminds you of it; play it yourself.",
            "{names}: the app reminds you of these; play them yourself.",
            { names: read.reminders.join(", ") },
          )}
        </p>
      )}
    </div>
  );
}

/** Is this ability one the unit can use right now (once per battle, not used yet)? */
function oncePerBattleReady(unit: Unit, a: Ability): boolean {
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
