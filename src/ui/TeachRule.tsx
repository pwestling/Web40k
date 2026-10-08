import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AbilityAuto, ArmyStratagem } from "../core";
import type { GameSystem } from "../core/content/schema";
import { schedule } from "../core/content/turn";
import { t } from "../i18n";
import { gameText } from "../i18n";
import { teach, teachingOf, type TeachWhat, type Teaching } from "../systems/wh40k/teach";
import { describeAuto } from "./autoText";
import { RulesText } from "./RulesText";

/**
 * "Teach it this rule" (#53): the player builds a rule the app only reminds
 * them of, from When, Who and What. It writes the same rule data as the
 * recognizer's "Automate this?" (#38), so it runs, shows and saves the same way.
 */

/** A stratagem's own settings, beside the rule it runs on the unit it targets. */
export type StratagemSettings = Pick<
  ArmyStratagem,
  "name" | "cp" | "side" | "phases" | "once" | "targetKeywords"
>;

const FRESH: Teaching = { when: { kind: "attacks" }, who: { kind: "self" }, what: [] };

const WHAT_KINDS: { kind: TeachWhat["kind"]; label: () => string; fresh: TeachWhat }[] = [
  { kind: "reroll", label: () => t("Re-roll"), fresh: { kind: "reroll", roll: "hit", which: "ones" } },
  { kind: "modify", label: () => t("+1 or −1 to its rolls"), fresh: { kind: "modify", roll: "hit", by: 1 } },
  {
    kind: "against",
    label: () => t("+1 or −1 to attacks against it"),
    fresh: { kind: "against", roll: "hit", by: -1 },
  },
  { kind: "save", label: () => t("+1 to its saves"), fresh: { kind: "save", by: 1 } },
  { kind: "invuln", label: () => t("Invulnerable save"), fresh: { kind: "invuln", x: 4 } },
  { kind: "fnp", label: () => t("Feel No Pain"), fresh: { kind: "fnp", x: 5 } },
  { kind: "stat", label: () => t("+X to a weapon stat"), fresh: { kind: "stat", stat: "A", by: 1 } },
  { kind: "gain", label: () => t("Gain CP"), fresh: { kind: "gain", amount: 1 } },
  { kind: "heal", label: () => t("Heal wounds"), fresh: { kind: "heal", amount: "D3" } },
];
const AT_PHASE = new Set<TeachWhat["kind"]>(["gain", "heal"]);

const rollLabel = (r: string) =>
  r === "hit" ? t("Hit rolls") : r === "wound" ? t("Wound rolls") : t("Damage rolls");

export function TeachRule({
  name,
  text,
  auto,
  system,
  stratagem,
  onSave,
  onClose,
}: {
  /** The rule's name, as the heading; a new stratagem names itself in the form. */
  name?: string;
  /** Its words, quoted at the top, so the player builds it with the rule in front of them (UX 388). */
  text?: string;
  /** The rule as it is now, to change it. */
  auto?: AbilityAuto;
  system: GameSystem;
  /** Teaching a stratagem: it runs on the unit it targets, for the phase it's used in. */
  stratagem?: StratagemSettings;
  onSave: (auto: AbilityAuto | null, stratagem?: StratagemSettings) => void;
  onClose: () => void;
}) {
  const [teaching, setTeaching] = useState<Teaching>(() => (auto ? teachingOf(auto) : FRESH));
  const [strat, setStrat] = useState<StratagemSettings | undefined>(stratagem);
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [onClose]);
  const { when, who, what } = teaching;
  const set = (patch: Partial<Teaching>) => setTeaching({ ...teaching, ...patch });
  const setWhat = (i: number, w: TeachWhat | null) =>
    set({ what: w ? what.map((x, j) => (j === i ? w : x)) : what.filter((_, j) => j !== i) });
  const phases = schedule(system).filter((s) => s.kind === "phase");
  const atPhase = when.kind === "phase";
  // A stratagem runs on its target for the phase: no auras, triggers or once per battle of its own.
  const result = what.length
    ? teach(stratagem ? { ...teaching, who: { kind: "self" } } : teaching, system)
    : null;
  const kinds = WHAT_KINDS.filter((k) => AT_PHASE.has(k.kind) === atPhase);
  const named = !strat || !!strat.name.trim();
  // A stratagem can be only its cost and timing, played by hand.
  const ready = named && (!!result || (!!strat && !what.length));

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel modal teach-rule"
        role="dialog"
        aria-label={t("Teach it this rule")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>{name ? t("Teach it: {rule}", { rule: gameText(name) }) : t("Teach a stratagem")}</h2>
          <button className="quiet" title={t("Close (Esc)")} onClick={onClose}>
            ✕
          </button>
        </div>
        {text?.trim() && (
          <details className="teach-quote" open>
            <summary className="small muted">{t("The rule")}</summary>
            <div className="small">
              <RulesText text={text} />
            </div>
          </details>
        )}
        <p className="muted small">
          {t("Pick when it works, who it works on and what it does. The app plays it from then on.")}
        </p>

        {strat && (
          <fieldset>
            <legend>{t("The stratagem")}</legend>
            {!name && (
              <label className="small">
                {t("Name")}{" "}
                <input value={strat.name} onChange={(e) => setStrat({ ...strat, name: e.target.value })} />
              </label>
            )}
            <label className="small">
              {t("Cost")}{" "}
              <input
                type="number"
                min={0}
                max={3}
                value={strat.cp}
                onChange={(e) => setStrat({ ...strat, cp: Math.max(0, Number(e.target.value) || 0) })}
              />{" "}
              {t("CP")}
            </label>
            <label className="small">
              {t("Use it")}{" "}
              <select
                value={strat.once ?? "phase"}
                onChange={(e) => setStrat({ ...strat, once: e.target.value as StratagemSettings["once"] })}
              >
                <option value="phase">{t("once per phase")}</option>
                <option value="turn">{t("once per turn")}</option>
                <option value="battle">{t("once per battle")}</option>
              </select>
            </label>
            <label className="small">
              {t("In")}{" "}
              <select
                value={strat.side}
                onChange={(e) => setStrat({ ...strat, side: e.target.value as StratagemSettings["side"] })}
              >
                <option value="active">{t("your turn")}</option>
                <option value="inactive">{t("your opponent's turn")}</option>
                <option value="either">{t("either player's turn")}</option>
              </select>
            </label>
            <label className="small">
              {t("On which units")}{" "}
              <input
                value={strat.targetKeywords ?? ""}
                placeholder={t("any of yours, or a keyword")}
                size={16}
                onChange={(e) => {
                  const { targetKeywords: _, ...rest } = strat;
                  setStrat(e.target.value ? { ...rest, targetKeywords: e.target.value } : rest);
                }}
              />
            </label>
            <div className="row wrap small" role="group" aria-label={t("Phases")}>
              {phases.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={!!strat.phases?.includes(p.id)}
                    onChange={(e) =>
                      setStrat({
                        ...strat,
                        phases: e.target.checked
                          ? [...(strat.phases ?? []), p.id]
                          : (strat.phases ?? []).filter((x) => x !== p.id),
                      })
                    }
                  />{" "}
                  {gameText(p.name)}
                </label>
              ))}
              {!strat.phases?.length && <span className="muted">{t("(any phase)")}</span>}
            </div>
          </fieldset>
        )}

        {!stratagem && (
          <fieldset>
            <legend>{t("When")}</legend>
            <select
              value={when.kind === "phase" ? `phase:${when.at}` : "attacks"}
              onChange={(e) => {
                const v = e.target.value;
                const now = when.kind === "phase";
                if (v === "attacks") set({ when: { kind: "attacks" }, what: now ? [] : what });
                else
                  set({
                    when: {
                      kind: "phase",
                      phase: when.kind === "phase" ? when.phase : (phases[0]?.id ?? ""),
                      at: v === "phase:end" ? "end" : "start",
                    },
                    what: now ? what : [],
                    who: who.kind === "aura" ? { kind: "self" } : who,
                    oncePerBattle: false,
                  });
              }}
            >
              <option value="attacks">{t("When it attacks or is attacked")}</option>
              <option value="phase:start">{t("At the start of a phase")}</option>
              <option value="phase:end">{t("At the end of a phase")}</option>
            </select>
            {when.kind === "phase" && (
              <>
                <select
                  value={when.phase}
                  onChange={(e) => set({ when: { ...when, phase: e.target.value } })}
                >
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {gameText(p.name)}
                    </option>
                  ))}
                </select>
                <select
                  value={when.anyTurn ? "each" : "yours"}
                  onChange={(e) => {
                    const { anyTurn: _, ...rest } = when;
                    set({ when: e.target.value === "each" ? { ...rest, anyTurn: true } : rest });
                  }}
                >
                  <option value="yours">{t("in your turn")}</option>
                  <option value="each">{t("in each player's turn")}</option>
                </select>
              </>
            )}
          </fieldset>
        )}
        {when.kind === "attacks" && (
          <fieldset>
            <legend>{stratagem ? t("Which attacks") : t("Only")}</legend>
            <select
              value={when.weapon ?? ""}
              onChange={(e) => {
                const { weapon: _, ...rest } = when;
                const v = e.target.value as "ranged" | "melee" | "";
                set({ when: v ? { ...rest, weapon: v } : rest });
              }}
            >
              <option value="">{t("any attacks")}</option>
              <option value="ranged">{t("ranged attacks")}</option>
              <option value="melee">{t("melee attacks")}</option>
            </select>
            <select
              value={when.when ?? ""}
              onChange={(e) => {
                const { when: _, ...rest } = when;
                const v = e.target.value as "charged" | "stationary" | "";
                set({ when: v ? { ...rest, when: v } : rest });
              }}
            >
              <option value="">{t("always")}</option>
              <option value="charged">{t("after it charged")}</option>
              <option value="stationary">{t("if it stayed still")}</option>
            </select>
            <label className="small">
              {t("against")}{" "}
              <input
                value={when.against ?? ""}
                placeholder={t("any unit, or a keyword")}
                size={14}
                onChange={(e) => {
                  const { against: _, ...rest } = when;
                  set({ when: e.target.value ? { ...rest, against: e.target.value } : rest });
                }}
              />
            </label>
          </fieldset>
        )}

        {!stratagem && (
          <fieldset>
            <legend>{t("Who")}</legend>
            <select
              value={who.kind}
              onChange={(e) => {
                const v = e.target.value;
                set({
                  who:
                    v === "aura"
                      ? { kind: "aura", side: "friendly", range: 6 }
                      : v === "leading"
                        ? { kind: "leading" }
                        : { kind: "self" },
                });
              }}
            >
              <option value="self">{t("This unit")}</option>
              <option value="leading">{t("The unit it leads, while leading")}</option>
              {!atPhase && <option value="aura">{t("Units within range")}</option>}
            </select>
            {who.kind === "aura" && (
              <>
                <select
                  value={who.side}
                  onChange={(e) => set({ who: { ...who, side: e.target.value as "friendly" | "enemy" } })}
                >
                  <option value="friendly">{t("friendly")}</option>
                  <option value="enemy">{t("enemy")}</option>
                </select>
                <label className="small">
                  {t("within")}{" "}
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={who.range}
                    onChange={(e) => set({ who: { ...who, range: Number(e.target.value) || 0 } })}
                  />
                  "
                </label>
                <input
                  value={who.keyword ?? ""}
                  placeholder={t("keyword (optional)")}
                  size={12}
                  onChange={(e) => {
                    const { keyword: _, ...rest } = who;
                    set({ who: e.target.value ? { ...rest, keyword: e.target.value } : rest });
                  }}
                />
              </>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend>{t("What")}</legend>
          {what.map((w, i) => (
            <WhatRow key={i} what={w} onChange={(x) => setWhat(i, x)} />
          ))}
          <select
            value=""
            aria-label={t("Add an effect")}
            onChange={(e) => {
              const k = WHAT_KINDS.find((x) => x.kind === e.target.value);
              if (k) set({ what: [...what, k.fresh] });
            }}
          >
            <option value="">{what.length ? t("Add another effect…") : t("Add an effect…")}</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label()}
              </option>
            ))}
          </select>
        </fieldset>

        {!stratagem && !atPhase && (
          <label className="small">
            <input
              type="checkbox"
              checked={!!teaching.oncePerBattle}
              onChange={(e) => set({ oncePerBattle: e.target.checked })}
            />{" "}
            {t("Once per battle: you switch it on from the unit card, for one phase")}
          </label>
        )}

        <p className="small teach-preview" aria-live="polite">
          {result ? (
            <>⚙ {describeAuto(result, system)}</>
          ) : what.length ? (
            <span className="warn">{t("Those don't fit together; check the numbers.")}</span>
          ) : (
            <span className="muted">{t("Add what it does, and the rule shows here.")}</span>
          )}
        </p>
        <div className="row spread">
          {auto ? (
            <button className="quiet small" onClick={() => onSave(null, strat)}>
              {t("Stop automating")}
            </button>
          ) : (
            <span />
          )}
          <button className="primary" disabled={!ready} onClick={() => onSave(result, strat)}>
            {t("Save the rule")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function WhatRow({ what, onChange }: { what: TeachWhat; onChange: (w: TeachWhat | null) => void }) {
  const label = WHAT_KINDS.find((k) => k.kind === what.kind)?.label() ?? "";
  const num = (v: string) => Number(v) || 0;
  const plusMinus = (by: number, set: (by: number) => void) => (
    <select value={by} onChange={(e) => set(num(e.target.value))}>
      <option value={1}>+1</option>
      <option value={-1}>−1</option>
    </select>
  );
  const rolls = (value: string, set: (r: "hit" | "wound") => void) => (
    <select value={value} onChange={(e) => set(e.target.value as "hit" | "wound")}>
      <option value="hit">{t("to hit")}</option>
      <option value="wound">{t("to wound")}</option>
    </select>
  );
  const xPlus = (x: number, set: (x: number) => void) => (
    <select value={x} onChange={(e) => set(num(e.target.value))}>
      {[2, 3, 4, 5, 6].map((n) => (
        <option key={n} value={n}>
          {n}+
        </option>
      ))}
    </select>
  );
  let body: React.ReactNode = null;
  switch (what.kind) {
    case "reroll":
      body = (
        <>
          <select
            value={what.which}
            onChange={(e) => onChange({ ...what, which: e.target.value as "ones" | "failed" })}
          >
            <option value="ones">{t("rolls of 1")}</option>
            <option value="failed">{t("failed rolls")}</option>
          </select>
          <select
            value={what.roll}
            onChange={(e) => onChange({ ...what, roll: e.target.value as "hit" | "wound" | "damage" })}
          >
            {(["hit", "wound", "damage"] as const).map((r) => (
              <option key={r} value={r}>
                {rollLabel(r)}
              </option>
            ))}
          </select>
        </>
      );
      break;
    case "modify":
    case "against":
      body = (
        <>
          {plusMinus(what.by, (by) => onChange({ ...what, by }))}
          {rolls(what.roll, (roll) => onChange({ ...what, roll }))}
        </>
      );
      break;
    case "save":
      body = <span className="muted small">{t("+1 to its saving throws")}</span>;
      break;
    case "invuln":
    case "fnp":
      body = xPlus(what.x, (x) => onChange({ ...what, x }));
      break;
    case "stat":
      body = (
        <>
          <select
            value={what.stat}
            onChange={(e) => onChange({ ...what, stat: e.target.value as "A" | "S" | "AP" | "D" })}
          >
            <option value="A">{t("Attacks")}</option>
            <option value="S">{t("Strength")}</option>
            <option value="AP">{t("AP (improved)")}</option>
            <option value="D">{t("Damage")}</option>
          </select>
          +
          <input
            type="number"
            min={1}
            max={3}
            value={what.by}
            onChange={(e) => onChange({ ...what, by: Math.max(1, num(e.target.value)) })}
          />
        </>
      );
      break;
    case "gain":
      body = (
        <input
          type="number"
          min={1}
          max={3}
          value={what.amount}
          onChange={(e) => onChange({ ...what, amount: Math.max(1, num(e.target.value)) })}
        />
      );
      break;
    case "heal":
      body = (
        <select value={what.amount} onChange={(e) => onChange({ ...what, amount: e.target.value })}>
          {["1", "2", "3", "D3", "D6"].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
      break;
  }
  return (
    <div className="row teach-what">
      <span className="small">{label}</span>
      {body}
      <button
        className="quiet small"
        title={t("Remove")}
        aria-label={t("Remove")}
        onClick={() => onChange(null)}
      >
        ✕
      </button>
    </div>
  );
}
