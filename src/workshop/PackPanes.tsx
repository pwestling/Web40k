import { useEffect, useMemo, useState } from "react";
import type { AbilityAuto } from "../core";
import { systemOf } from "../core/content/turn";
import { t, tn } from "../i18n";
import { readFactionPack } from "../packages/faction";
import { useLibrary } from "../packages/library";
import { fingerprint, sha256 } from "../packages/manifest";
import { useShelf } from "../packages/shelf";
import { useStore } from "../store";
import { systemModule } from "../systems";
import { describeAuto } from "../ui/autoText";
import { saveFile } from "../ui/files";
import { TeachRule, type StratagemSettings } from "../ui/TeachRule";
import { fileName, manifestOf, type Draft } from "./drafts";
import {
  checkNames,
  draftPack,
  namesWithPack,
  packRule,
  pullTaught,
  putEntry,
  rosterNames,
  ruleFrom,
  stratagemFrom,
  writeFaction,
  type NameCheck,
  type NameKind,
  type NameProblem,
  type RosterName,
} from "./packDraft";
import { packArmies, startPackTable } from "./packTable";

/**
 * The pack workshop (#79): a faction pack draft's own panes. Army picks one
 * of the player's armies and lists its names, each with a builder (Teach
 * it's window) that writes the rule into the draft; the test table plays the
 * army with the pack on; Export downloads the file with its SHA-256.
 */

/** The armies the draft can be built against, the one picked, and the draft's pack checked against it. */
function usePackArmy(draft: Draft) {
  const shelf = useShelf((s) => s.armies);
  useEffect(() => void useShelf.getState().load(), []);
  const m = manifestOf(draft.source);
  const systems = typeof m === "string" ? "" : m.systems.join(" ");
  const armies = useMemo(() => packArmies(shelf, systems.split(" ").filter(Boolean)), [shelf, systems]);
  const army = armies.find((a) => a.key === draft.army) ?? armies[0] ?? null;
  const pack = useMemo(() => draftPack(draft.source), [draft.source]);
  const system = army ? systemOf({ system: army.system }) : null;
  const profiles = army ? (systemModule(army.system).profileGroups ?? []) : [];
  const check = useMemo(
    () =>
      army && system && typeof pack !== "string"
        ? checkNames(draft.source, pack, army.roster, system, profiles)
        : null,
    // profiles follow the army
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [army, system, pack, draft.source],
  );
  return { armies, army, system, pack, check, profiles };
}

/** Why a name in the pack plays nothing in this army, in a line. */
function problemText(p: NameProblem, army: string): string {
  switch (p.why) {
    case "no-unit":
      return t("{name}: no unit in {army} has it.", { name: p.name, army });
    case "not-army-rule":
      return t("{name}: {army} has no rule by that name.", { name: p.name, army });
    case "faction":
      return t("{name}: a rule for another faction than {army}'s.", { name: p.name, army });
    case "detachment":
      return t("Detachment {name}: {army} isn't in it, so nothing in it applies.", { name: p.name, army });
    case "twice":
      return t("{name} is in the pack twice: keep one.", { name: p.name });
  }
}

/** Under the editor: the pack's names that match nothing in the army, each with its line. Saving still works. */
export function PackProblems({ draft, onLine }: { draft: Draft; onLine: (line: number) => void }) {
  const { army, check } = usePackArmy(draft);
  if (!army || !check?.problems.length) return null;
  return (
    <ul className="workshop-problems pack-problems" aria-label={t("Names that don't match")}>
      {check.problems.map((p, i) => (
        <li key={`${p.where}/${p.name}/${i}`}>
          ⚠ {problemText(p, army.name)}{" "}
          {p.line !== null && (
            <button className="quiet small" onClick={() => onLine(p.line!)}>
              {t("line {line}", { line: p.line })}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const KIND_LABEL: Record<NameKind, () => string> = {
  ability: () => t("Unit abilities"),
  enhancement: () => t("Enhancements"),
  army: () => t("Army rules"),
  detachment: () => t("Detachment rules"),
  stratagem: () => t("Stratagems"),
};

const statusText = (n: RosterName, mine: boolean) =>
  mine
    ? t("in this pack")
    : n.status === "manual"
      ? t("by hand")
      : n.status === "taught"
        ? t("taught")
        : n.status === "pack"
          ? t("another pack")
          : t("read by the app");

/**
 * The army a pack is built against (#79): pick one, see its names and how
 * each plays, build a rule for a name with Teach it's window (written into
 * the draft as data), pull the army's taught rules in at once, and what the
 * pack doesn't cover yet.
 */
export function PackArmyPane({
  draft,
  onEdit,
  onPick,
}: {
  draft: Draft;
  onEdit: (source: string) => void;
  onPick: (key: string) => void;
}) {
  const { armies, army, system, pack, check, profiles } = usePackArmy(draft);
  const [building, setBuilding] = useState<RosterName | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const names = useMemo(
    () => (army && system ? rosterNames(army.roster, system, profiles) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [army, system],
  );
  /** The draft's rules on the army, to show and change what the pack does with a name. */
  const played = useMemo(() => {
    if (!army || !system || typeof pack === "string") return new Map<string, AbilityAuto | null>();
    return new Map(
      namesWithPack(army.roster, pack, system, profiles).flatMap((n) => {
        const rule = packRule(n);
        return rule ? [[`${n.kind === "stratagem"}/${n.name}`, rule] as const] : [];
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [army, system, pack]);
  if (typeof pack === "string") return <p className="bad">{pack}</p>;
  if (!army || !system)
    return (
      <p>
        {t(
          "No army for this pack's game yet. Import a list in a game and save it to your shelf, or open an army file: it shows up here.",
        )}
      </p>
    );
  const taught = names.filter((n) => n.status === "taught").length;
  const inPack = (n: RosterName) => played.has(`${n.kind === "stratagem"}/${n.name}`);
  const write = (next: typeof pack) => onEdit(writeFaction(draft.source, next));
  const save = (n: RosterName, auto: AbilityAuto | null, settings?: StratagemSettings) => {
    const entry =
      n.kind === "stratagem"
        ? stratagemFrom(
            { ...(settings ?? n.stratagem!), name: n.name, notYet: n.stratagem?.notYet, targetsUnit: true },
            auto,
            system,
          )
        : ruleFrom(n.name, auto, system);
    write(putEntry(pack, n.kind, entry, army.roster.army?.detachment));
    setBuilding(null);
    setNote(t("{name} is in the pack now. Save to play it on the test table.", { name: n.name }));
  };
  const kinds = (["ability", "enhancement", "army", "detachment", "stratagem"] as const).filter((k) =>
    names.some((n) => n.kind === k),
  );

  return (
    <div className="workshop-pack">
      <label>
        {t("Build it against")}
        <select value={army.key} onChange={(e) => onPick(e.target.value)}>
          {armies.map((a) => (
            <option key={a.key} value={a.key}>
              {a.shelf ? a.name : t("{army} (sample army)", { army: a.name })}
            </option>
          ))}
        </select>
      </label>
      {check && <Coverage check={check} total={names.length} />}
      {taught > 0 && (
        <p>
          <button
            onClick={() => {
              const r = pullTaught(pack, army.roster, system);
              write(r.pack);
              setNote(
                tn(r.count, "{n} taught rule is in the pack now.", "{n} taught rules are in the pack now."),
              );
            }}
          >
            {tn(
              taught,
              "Put the {n} rule you taught in the pack",
              "Put the {n} rules you taught in the pack",
            )}
          </button>
        </p>
      )}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {kinds.map((k) => (
        <section key={k}>
          <h3>{KIND_LABEL[k]()}</h3>
          <ul className="pack-names">
            {names
              .filter((n) => n.kind === k)
              .map((n) => {
                const mine = inPack(n);
                const auto = played.get(`${n.kind === "stratagem"}/${n.name}`) ?? null;
                return (
                  <li key={n.name} className={`pack-name ${mine ? "ok" : n.status}`}>
                    <span>
                      <strong>{n.name}</strong> <span className="muted small">{statusText(n, mine)}</span>
                      {n.units.length > 0 && <span className="muted small"> · {n.units.join(", ")}</span>}
                      {auto && <span className="small"> · ⚙ {describeAuto(auto, system)}</span>}
                    </span>
                    <button className="small" onClick={() => setBuilding(n)}>
                      {mine ? t("Change") : t("Build")}
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      {check && check.uncovered.length > 0 && (
        <details>
          <summary>
            {tn(check.uncovered.length, "{n} name not covered yet", "{n} names not covered yet")}
          </summary>
          <p className="hint">{check.uncovered.map((n) => n.name).join(", ")}</p>
        </details>
      )}
      {building && (
        <TeachRule
          name={building.name}
          text={building.text}
          auto={played.get(`${building.kind === "stratagem"}/${building.name}`) ?? undefined}
          system={system}
          stratagem={
            building.stratagem && {
              name: building.name,
              cp: building.stratagem.cp,
              side: building.stratagem.side,
              ...(building.stratagem.phases ? { phases: building.stratagem.phases } : {}),
              ...(building.stratagem.once ? { once: building.stratagem.once } : {}),
              ...(building.stratagem.targetKeywords
                ? { targetKeywords: building.stratagem.targetKeywords }
                : {}),
            }
          }
          onSave={(auto, settings) => save(building, auto, settings)}
          onClose={() => setBuilding(null)}
        />
      )}
    </div>
  );
}

/** "9 of 14 names: 6 by this pack, 2 it adds", in a line. */
function Coverage({ check, total }: { check: NameCheck; total: number }) {
  return (
    <p className="hint">
      {tn(
        total,
        "The pack plays {matched} of this army's {n} name.",
        "The pack plays {matched} of this army's {n} names.",
        {
          matched: check.matched,
        },
      )}
      {check.added.length > 0 &&
        ` ${tn(check.added.length, "It adds {n} rule the list doesn't carry.", "It adds {n} rules the list doesn't carry.")}`}
    </p>
  );
}

/** Save the draft, then start a test game of the picked army with the pack on it. */
export function PackTableButton({ draft, save }: { draft: Draft; save: () => Promise<string | null> }) {
  const playing = useStore((s) => s.session !== null);
  const { army } = usePackArmy(draft);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (!army) return;
    const hash = await save();
    const pkg = hash ? useLibrary.getState().packages[hash] : undefined;
    const read = pkg ? readFactionPack(pkg.source) : null;
    if (!pkg || !read || "error" in read) return;
    setBusy(true);
    await startPackTable(army, pkg, read);
    setBusy(false);
  };
  return (
    <button
      onClick={() => void start()}
      disabled={busy || !army}
      title={army ? t("Play {army} with the pack on it", { army: army.name }) : undefined}
    >
      {busy ? t("Setting up…") : playing ? t("Restart the test table") : t("Test table")}
    </button>
  );
}

/** Download the pack, with its SHA-256: players load it from wherever the author hosts it. */
export function PackExportPane({ draft }: { draft: Draft }) {
  const [hash, setHash] = useState<string | null>(null);
  const m = manifestOf(draft.source);
  useEffect(() => {
    let on = true;
    void sha256(new TextEncoder().encode(draft.source)).then((h) => on && setHash(h));
    return () => {
      on = false;
    };
  }, [draft.source]);
  if (typeof m === "string") return <p>{m}</p>;
  return (
    <div className="workshop-export">
      <p>
        {t("{name} {version}", { name: m.name, version: m.version })}
        {hash && (
          <>
            {" · "}
            <code title={hash}>{fingerprint(hash)}</code>
          </>
        )}
      </p>
      {hash && (
        <p className="small">
          {/* i18n-ignore */}
          SHA-256 <code className="pack-hash">{hash}</code>
        </p>
      )}
      <button
        className="primary"
        onClick={() => saveFile(new Blob([draft.source], { type: "text/javascript" }), fileName(m))}
      >
        {t("Download the pack")}
      </button>
      <p className="hint">
        {t(
          "Host the file anywhere that lets other sites read it, and share its link. Players paste the link in the army import (Faction packs); the app pins the link to this SHA-256 and asks again if the file changes. Publish only your own words: names, and what the rules do.",
        )}
      </p>
    </div>
  );
}
