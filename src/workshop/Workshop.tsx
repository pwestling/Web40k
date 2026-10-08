import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { sides } from "../core";
import { t, tn } from "../i18n";
import { fingerprint } from "../packages/manifest";
import { useLibrary } from "../packages/library";
import { useSandbox } from "../sandbox/runtime";
import { useStore } from "../store";
import { gameModule } from "../systems";
import { deploySamples } from "../teach/setup";
import { quiet } from "../render/showcase";
import { refOf } from "../ui/Packages";
import { buildLog } from "../ui/gameLog";
import { openWarnings, useWarnings } from "../ui/TableWarnings";
import { APP_BUILD } from "../version";
import sdk from "../sdk/index.ts?raw";
import skirmish from "../../examples/workshop/skirmish.js?raw";
import ranked from "../../examples/workshop/ranked.js?raw";
import activations from "../../examples/workshop/activations.js?raw";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import {
  fileName,
  GALLERY,
  GALLERY_EDIT,
  loadDrafts,
  manifestOf,
  newDraft,
  prText,
  problems,
  storeDrafts,
  type Draft,
} from "./drafts";
import { closeWorkshop, useWorkshopOpen } from "./open";
import { checkDraft, soakDraft, type SoakResult } from "./soak";
import { checkAll, problemLine, type CheckStep, type Verdict } from "./check";
import { CTX, KEYS, VIEW } from "./completions";
import type { Completion } from "@codemirror/autocomplete";
import type { Loaded } from "../sandbox/protocol";

/** A link field's hint: a URL scheme, the same in every language. */
const URL_HINT = "https://"; // i18n-ignore

/** CodeMirror is most of this screen's weight: it loads after the workshop's frame is up. */
const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));

const TEMPLATES = [
  {
    id: "skirmish",
    source: skirmish,
    name: () => t("Skirmish"),
    what: () => t("Model by model: move, then fight."),
  },
  {
    id: "ranked",
    source: ranked,
    name: () => t("Ranked"),
    what: () => t("Regiment blocks that wheel and clash."),
  },
  {
    id: "activations",
    source: activations,
    name: () => t("Alternating activations"),
    what: () => t("Players take turns activating one unit each."),
  },
  {
    id: "rift-lanterns",
    source: riftLanterns,
    name: () => "Rift Lanterns",
    what: () => t("A finished game of ours to take apart: four warbands, three missions."),
  },
];

/**
 * The module workshop (#41): write a game system in the browser. Drafts are
 * kept in this browser; saving puts the draft in the package library
 * (trusted, as the player's own) and, with a test table running, reloads it
 * into the sandbox there. The soak bot plays it in a sandbox of its own.
 */
export function Workshop() {
  const [{ drafts, current }, setAll] = useState(loadDrafts);
  const draft = drafts.find((d) => d.id === current) ?? null;
  const folded = useWorkshopOpen((s) => s.folded);
  const link = useWorkshopOpen((s) => s.link);
  const playing = useStore((s) => s.session !== null);
  const [pane, setPane] = useState<"table" | "soak" | "export" | "sdk">("table");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  /** Where the last problem is in the draft, marked in the editor. */
  const [mark, setMark] = useState<number | null>(null);
  /** The Check's verdict (#43), or its steps so far while it runs. */
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checking, setChecking] = useState<CheckStep[] | null>(null);
  const check = async () => {
    if (!draft || checking) return;
    setVerdict(null);
    setChecking([]);
    const v = await checkAll(draft.source, setChecking);
    setChecking(null);
    setVerdict(v);
    setMark(v.steps.find((s) => s.ok === false)?.line ?? null);
  };
  const update = (next: Draft[], cur: string | null) => {
    storeDrafts(next, cur);
    setAll({ drafts: next, current: cur });
  };
  const add = (source: string) => {
    const d = newDraft(source);
    update([...drafts, d], d.id);
  };
  const edit = (source: string) => {
    if (!draft) return;
    if (mark !== null) setMark(null);
    update(
      drafts.map((d) => (d.id === draft.id ? { ...d, source, updated: Date.now() } : d)),
      draft.id,
    );
  };
  const remove = () => {
    if (!draft || !confirm(t("Delete this draft? This can't be undone."))) return;
    const rest = drafts.filter((d) => d.id !== draft.id);
    update(rest, rest.at(-1)?.id ?? null);
  };

  // A module from a link (?workshop=<url>, the gallery): opened as a new draft, not run.
  useEffect(() => {
    if (!link) return;
    useWorkshopOpen.setState({ link: null });
    void fromLink(link).then(
      (source) => {
        add(source);
        setNote({
          text: t("Opened from {url}. Read it before you test it: saving runs its code in the sandbox.", {
            url: link,
          }),
          bad: false,
        });
      },
      (e: Error) => setNote({ text: e.message, bad: true }),
    );
    // Once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  const bad = (text: string, line: number | null = null) => {
    setNote({ text, bad: true });
    setMark(line);
  };

  /**
   * Save the draft to the package library; the hash, or null if it couldn't
   * be. It's checked first (UX 307-308): parsed for syntax errors, then loaded
   * in a sandbox the way the test table would, so a broken draft never
   * reaches the table and says where it broke.
   */
  const save = async (): Promise<string | null> => {
    if (!draft) return null;
    const source = draft.source;
    const issues = problems(source);
    if (issues.length) {
      bad(issues[0]!);
      return null;
    }
    const { syntaxError } = await import("./syntax");
    const syntax = syntaxError(source);
    if (syntax) {
      bad(t("Not saved: the code doesn't parse at line {line}, column {column}.", syntax), syntax.line);
      return null;
    }
    let loaded: Loaded;
    try {
      loaded = await checkDraft(source);
    } catch (e) {
      bad(t("Not saved: your rules didn't load: {why}", { why: e instanceof Error ? e.message : String(e) }));
      return null;
    }
    const failed = loaded.errors[0]?.error;
    if (failed) {
      bad(t("Not saved: your rules didn't load: {why}", { why: failed }), problemLine(source, failed));
      return null;
    }
    setMark(null);
    const lib = useLibrary.getState();
    const r = await lib.add(new TextEncoder().encode(source), { own: true });
    if (!r.ok) {
      bad(r.error);
      return null;
    }
    lib.trust(r.pkg.hash, true);
    // The last save of this draft goes: the library keeps the newest, not every save.
    if (draft.saved && draft.saved !== r.pkg.hash && lib.packages[draft.saved]?.own)
      removeWhenUnused(draft.saved);
    update(
      drafts.map((d) => (d.id === draft.id ? { ...d, saved: r.pkg.hash } : d)),
      draft.id,
    );
    const setup = setupOf(loaded);
    rememberSetup(setup);
    const system = r.pkg.manifest.systems[0]!;
    const game = useStore.getState().game;
    if (useStore.getState().session && game.packages?.system?.id === system) {
      if (game.packages.packages.some((p) => p.hash === r.pkg.hash)) {
        setNote({ text: t("Saved. Nothing changed for the test table."), bad: false });
        return r.pkg.hash;
      }
      reload(r.pkg.hash);
      const why = await settled();
      if (why)
        bad(
          t("Saved, but your rules didn't load on the test table: {why}", { why }),
          problemLine(source, why),
        );
      else
        setNote({
          text:
            setups.table !== null && setup !== setups.table
              ? t(
                  "Saved and reloaded. The sample armies, missions or table changed: restart the test table to play with them.",
                )
              : t("Saved and reloaded onto the test table."),
          bad: false,
        });
    } else setNote({ text: t("Saved."), bad: false });
    return r.pkg.hash;
  };

  if (folded && playing)
    return (
      <button className="workshop-tab" onClick={() => useWorkshopOpen.setState({ folded: false })}>
        {t("Workshop")}
      </button>
    );

  const manifest = draft ? manifestOf(draft.source) : null;
  return (
    <section
      className={`workshop${playing ? " over-table" : ""}`}
      role={playing ? "complementary" : "dialog"}
      aria-label={t("Module workshop")}
    >
      <header className="workshop-head">
        <h2>{t("Module workshop")}</h2>
        {drafts.length > 0 && (
          <select
            aria-label={t("Draft")}
            value={current ?? ""}
            onChange={(e) => update(drafts, e.target.value)}
          >
            {drafts.map((d) => {
              const m = manifestOf(d.source);
              return (
                <option key={d.id} value={d.id}>
                  {typeof m === "string" ? t("Untitled draft") : `${m.name} ${m.version}`}
                </option>
              );
            })}
          </select>
        )}
        <span className="spacer" />
        {playing && (
          <button
            onClick={() => useWorkshopOpen.setState({ folded: true })}
            title={t("Fold the workshop to the side")}
          >
            ⇥ {t("Table")}
          </button>
        )}
        <button onClick={closeWorkshop} aria-label={t("Close the workshop")}>
          ✕
        </button>
      </header>
      {!draft ? (
        <Start onPick={add} />
      ) : (
        <div className="workshop-body">
          <div className="workshop-code">
            <div className="workshop-tools">
              <button className="primary" onClick={() => void save()} title={t("Save (Ctrl+S)")}>
                {t("Save")}
              </button>
              <TestTableButton save={save} />
              <button
                onClick={() => void check()}
                disabled={!!checking}
                title={t("Check the types, load it, and let a bot play two rounds")}
              >
                {checking ? t("Checking…") : t("Check")}
              </button>
              <span className="spacer" />
              <button onClick={() => update(drafts, null)}>{t("New draft")}</button>
              <button onClick={remove}>{t("Delete")}</button>
            </div>
            {note && (
              <p className={`workshop-note${note.bad ? " bad" : ""}`} role={note.bad ? "alert" : "status"}>
                {note.text}
              </p>
            )}
            {(checking || verdict) && (
              <CheckVerdict
                steps={checking ?? verdict!.steps}
                verdict={checking ? null : verdict}
                stale={!!verdict && verdict.source !== draft.source}
                onClose={() => setVerdict(null)}
              />
            )}
            <Problems draft={draft} />
            <Suspense fallback={<div className="workshop-editor">{t("Loading the editor…")}</div>}>
              <Editor
                doc={draft.source}
                onChange={edit}
                onSave={() => void save()}
                label={t("The package's code")}
                mark={mark}
              />
            </Suspense>
          </div>
          <aside className="workshop-side">
            <div className="tabs" role="tablist">
              {(
                [
                  ["table", t("Test table")],
                  ["soak", t("Soak bot")],
                  ["export", t("Export")],
                  ["sdk", t("SDK")],
                ] as const
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={pane === id} onClick={() => setPane(id)}>
                  {label}
                </button>
              ))}
            </div>
            {pane === "table" && <TablePane />}
            {pane === "soak" && <SoakPane draft={draft} />}
            {pane === "export" && typeof manifest !== "string" && manifest && <ExportPane draft={draft} />}
            {pane === "export" && typeof manifest === "string" && <p>{manifest}</p>}
            {pane === "sdk" && <SdkPane />}
          </aside>
        </div>
      )}
    </section>
  );
}

/** No draft open: a template, or a module from a link. */
function Start({ onPick }: { onPick: (source: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="workshop-start">
      <p>
        {t(
          "Write a whole game as one JavaScript file: its rules as data, with code where data won't do. Start from a template; the test table plays it as you go.",
        )}
      </p>
      <div className="workshop-templates">
        {TEMPLATES.map((tpl) => (
          <button key={tpl.id} className="workshop-template" onClick={() => onPick(tpl.source)}>
            <strong>{tpl.name()}</strong>
            <span>{tpl.what()}</span>
          </button>
        ))}
      </div>
      <form
        className="workshop-link"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          fromLink(url).then(onPick, (err: Error) => setError(err.message));
        }}
      >
        <label>
          {t("Open from a link")}
          <input
            type="url"
            value={url}
            placeholder={URL_HINT}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </label>
        <button type="submit">{t("Open")}</button>
        {error && <p className="error">{error}</p>}
      </form>
      <p>
        <a href={GALLERY} target="_blank" rel="noreferrer">
          {t("Community modules")}
        </a>
        {" · "}
        <a href={`${GALLERY.replace("community-modules", "packages")}`} target="_blank" rel="noreferrer">
          {t("How packages work")}
        </a>
      </p>
    </div>
  );
}

/** Fetch a module's text from a URL (it isn't run here). */
async function fromLink(url: string): Promise<string> {
  // A GitHub page link means the raw file.
  const raw = url.replace(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
    "https://raw.githubusercontent.com/$1/",
  );
  let res: Response;
  try {
    res = await fetch(raw);
  } catch {
    throw new Error(t("Couldn't fetch that link (it may not allow other sites to read it)."));
  }
  if (!res.ok) throw new Error(t("That link answered {status}.", { status: res.status }));
  const text = await res.text();
  if (text.length > 1024 * 1024) throw new Error(t("That's too big for a module."));
  const m = manifestOf(text);
  if (typeof m === "string") throw new Error(t("That isn't a rules package: {why}", { why: m }));
  return text;
}

/** The Check's one verdict, and a line for each part of it. */
function CheckVerdict({
  steps,
  verdict,
  stale,
  onClose,
}: {
  steps: CheckStep[];
  verdict: Verdict | null;
  stale: boolean;
  onClose: () => void;
}) {
  const head = !verdict
    ? t("Checking: types, loading, then a short bot game…")
    : verdict.ok
      ? t("Ready to share: nothing wrong found.")
      : t("Not ready yet: {first}", { first: verdict.steps.find((s) => s.ok === false)?.text ?? "" });
  return (
    <div
      className={`workshop-check${verdict ? (verdict.ok ? " ok" : " bad") : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="row spread">
        <strong>
          {verdict ? (verdict.ok ? "✓ " : "✗ ") : ""}
          {head}
        </strong>
        {verdict && (
          <button className="quiet" onClick={onClose} title={t("Hide")}>
            ✕
          </button>
        )}
      </div>
      {stale && <p className="muted small">{t("The draft has changed since: check again.")}</p>}
      <ul>
        {steps.map((s) => (
          <li key={s.id} className={s.ok === null ? "skip" : s.ok ? "ok" : "bad"}>
            {s.ok === null ? "–" : s.ok ? "✓" : "✗"} {s.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What's wrong with the draft now, and what the sandbox said when it last loaded it. */
function Problems({ draft }: { draft: Draft }) {
  const issues = useMemo(() => problems(draft.source), [draft.source]);
  const error = useSandbox((s) => s.error);
  const playing = useStore((s) => s.session !== null);
  const all = [...issues, ...(playing && error ? [error] : [])];
  if (!all.length) return null;
  return (
    <ul className="workshop-problems" aria-label={t("Problems")}>
      {all.map((p) => (
        <li key={p}>⚠ {p}</li>
      ))}
    </ul>
  );
}

/**
 * Take an old save out of the library once the game no longer names it: while
 * it does, its sandbox is still answering (taking it away mid-call would drop
 * the very game/packages that switches to the new save).
 */
function removeWhenUnused(hash: string) {
  const named = () => useStore.getState().game.packages?.packages.some((p) => p.hash === hash) ?? false;
  if (!named()) return useLibrary.getState().remove(hash);
  const off = useStore.subscribe(() => {
    if (named()) return;
    off();
    useLibrary.getState().remove(hash);
  });
}

/**
 * What a draft's game sets up (sample armies, missions, the table), to tell
 * when a save changes it: a running test table keeps what it started with.
 */
function setupOf(loaded: Loaded): string {
  const app = loaded.packages[0]?.provides?.app;
  return JSON.stringify(app ? [app.samples, app.armies, app.missions, app.layout] : null);
}
/** The setup the test table was started with, and the last save's. */
const setups = { table: null as string | null, last: null as string | null };
const rememberSetup = (setup: string) => void (setups.last = setup);
const tableStarted = () => void (setups.table = setups.last);

/** Once the test table's sandbox has restarted with a new save: why its rules aren't running, or null. */
function settled(): Promise<string | null> {
  return new Promise((resolve) => {
    let started = useSandbox.getState().status === "starting";
    const done = (why: string | null) => {
      off();
      clearTimeout(timer);
      resolve(why);
    };
    const off = useSandbox.subscribe((s) => {
      if (s.status === "starting") started = true;
      else if (started) done(s.status === "on" ? s.error : (s.error ?? t("the rules stopped")));
    });
    const timer = setTimeout(() => done(null), 10_000);
  });
}

/** Dispatch the saved package onto the running test table: the sandbox restarts with it. */
function reload(hash: string) {
  const pkg = useLibrary.getState().packages[hash];
  if (!pkg) return;
  useStore.getState().dispatch({
    type: "game/packages",
    app: APP_BUILD,
    system: { id: pkg.manifest.systems[0]!, builtIn: false },
    packages: [refOf(pkg)],
  });
}

/** Start a hotseat game of the draft with both sample armies down and the battle started. */
function TestTableButton({ save }: { save: () => Promise<string | null> }) {
  const playing = useStore((s) => s.session !== null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    const hash = await save();
    tableStarted();
    const pkg = hash ? useLibrary.getState().packages[hash] : undefined;
    if (!pkg) return;
    setBusy(true);
    const s = useStore.getState();
    if (s.session) {
      s.session.leave();
      useStore.setState({ session: null, role: null, scrub: null, selected: null, draft: null });
    }
    const system = pkg.manifest.systems[0]!;
    useStore.getState().start({
      role: "host",
      mode: "hotseat",
      name: localStorage.getItem("open-battle:name") ?? "",
      system,
    });
    reload(pkg.hash);
    let tries = 0;
    const go = () => {
      const { game, dispatch } = useStore.getState();
      const box = useSandbox.getState();
      if (box.status === "stopped") return setBusy(false);
      if (box.status !== "on" || !gameModule(system) || game.system !== system || sides(game).length < 2) {
        if (tries++ < 200) setTimeout(go, 50);
        else setBusy(false);
        return;
      }
      quiet.initial = useStore.getState().record.initial;
      deploySamples(() => useStore.getState().game, dispatch, crypto.randomUUID().slice(0, 6));
      useStore.getState().dispatch({ type: "turn/next" });
      setBusy(false);
    };
    go();
  };
  return (
    <button onClick={() => void start()} disabled={busy}>
      {busy ? t("Setting up…") : playing ? t("Restart the test table") : t("Test table")}
    </button>
  );
}

/** The test table: the sandbox's state, the table's warnings and the latest dice and log lines. */
function TablePane() {
  const playing = useStore((s) => s.session !== null);
  const status = useSandbox((s) => s.status);
  const error = useSandbox((s) => s.error);
  const record = useStore((s) => s.record);
  const warnings = useWarnings();
  const log = useMemo(
    () =>
      playing
        ? buildLog(record)
            .filter((l) => l.kind === "line" && !l.undone)
            .slice(-12)
            .reverse()
        : [],
    [playing, record],
  );
  if (!playing)
    return (
      <p>
        {t(
          "Test table starts a game of your draft on this screen with each side's sample army. Every save reloads it there.",
        )}
      </p>
    );
  return (
    <div className="workshop-table">
      <p className={error && status !== "starting" ? "bad" : undefined}>
        {status === "on" && !error
          ? t("Your rules are running.")
          : status === "starting"
            ? t("Starting your rules…")
            : t("Your rules aren't running.")}
        {error && status !== "starting" && <> {error}</>}
      </p>
      <p>
        <button onClick={openWarnings}>
          {tn(warnings.length, "{n} table warning", "{n} table warnings", { n: warnings.length })}
        </button>
      </p>
      <h3>{t("Dice and log")}</h3>
      <ol className="workshop-log">
        {log.map((l) => (
          <li key={l.key}>{l.kind === "line" ? l.text : ""}</li>
        ))}
      </ol>
    </div>
  );
}

/** The soak bot plays the draft, in a sandbox of its own. */
function SoakPane({ draft }: { draft: Draft }) {
  const [results, setResults] = useState<SoakResult[]>([]);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setResults([]);
    await soakDraft(draft.source, [1, 2, 3], (r) => setResults((rs) => [...rs, r]));
    setRunning(false);
  };
  return (
    <div className="workshop-soak">
      <p>
        {t(
          "The soak bot plays whole games of your draft with random legal moves, over pretend peers, and checks every table stays the same and nothing throws.",
        )}
      </p>
      <button onClick={() => void run()} disabled={running || problems(draft.source).length > 0}>
        {running ? t("Playing…") : t("Play 3 bot games")}
      </button>
      <ul>
        {results.map((r) => (
          <li key={r.seed} className={r.ok ? "ok" : "bad"}>
            {r.ok
              ? r.finished
                ? t("Game {seed}: fine, played to the end in {steps} moves.", {
                    seed: r.seed,
                    steps: r.steps,
                  })
                : t("Game {seed}: fine for {steps} moves, stopped in round {round}.", {
                    seed: r.seed,
                    steps: r.steps,
                    round: r.round,
                  })
              : t("Game {seed} went wrong: {why}", { seed: r.seed, why: r.failures[0] ?? "" })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Download the package, copy a gallery pull request's text, or open the gallery page to edit. */
function ExportPane({ draft }: { draft: Draft }) {
  const [hash, setHash] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const m = manifestOf(draft.source);
  useEffect(() => {
    let on = true;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(draft.source)).then((d) => {
      if (on)
        setHash(
          Array.from(new Uint8Array(d))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        );
    });
    return () => {
      on = false;
    };
  }, [draft.source]);
  if (typeof m === "string") return <p>{m}</p>;
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([draft.source], { type: "text/javascript" }));
    a.download = fileName(m);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
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
      <button className="primary" onClick={download}>
        {t("Download the package")}
      </button>
      <p className="hint">
        {t(
          "Players load the file in Rules packages; peers check they have the same bytes by this fingerprint.",
        )}
      </p>
      <h3>{t("Share it in the gallery")}</h3>
      <p className="hint">
        {t(
          "To host it: make a gist at gist.github.com, paste the file in, save, and copy its Raw link. A file in a GitHub repository works too (its Raw button).",
        )}
      </p>
      <label>
        {t("Where the file is hosted (a raw link)")}
        <input type="url" value={url} placeholder={URL_HINT} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <button
        disabled={!hash}
        onClick={() =>
          void navigator.clipboard.writeText(prText(m, hash!, url)).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
        }
      >
        {copied ? t("Copied") : t("Copy the pull request text")}
      </button>{" "}
      <a href={GALLERY_EDIT} target="_blank" rel="noreferrer">
        {t("Edit the gallery on GitHub")}
      </a>
    </div>
  );
}

/**
 * What a package can use (UX 313): the commands, the game view and the keys
 * of a module, readably, with the SDK's full types folded below.
 */
function SdkPane() {
  const section = (title: string, items: Completion[]) => (
    <>
      <h3>{title}</h3>
      <dl className="workshop-ref">
        {items.map((c) => (
          <div key={c.label}>
            <dt>
              <code>
                {c.label}
                {c.detail && c.detail !== "snippet" ? ` ${c.detail}` : ""}
              </code>
            </dt>
            <dd>{typeof c.info === "string" ? c.info : ""}</dd>
          </div>
        ))}
      </dl>
    </>
  );
  return (
    <div className="workshop-sdk">
      <p>{t("Everything a package can use. In the editor, type ctx. or view. for suggestions.")}</p>
      {section(t("Commands a rule yields (ctx.)"), CTX)}
      {section(t("The game as it stands (view.)"), VIEW)}
      {section(t("Keys and snippets"), KEYS)}
      <p>
        <a href={`${GALLERY.replace("community-modules", "packages")}`} target="_blank" rel="noreferrer">
          {t("How packages work")}
        </a>
      </p>
      <details>
        <summary>{t("The full types")}</summary>
        <pre>{sdk}</pre>
      </details>
    </div>
  );
}
