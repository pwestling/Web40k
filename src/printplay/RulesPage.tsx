import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import riftBook from "../../games/rift-lanterns/rulebook.json";
import { figureImage } from "./figures";
import { deployDepth, mapSvg, statText, textBlocks, type RulebookDoc } from "./rulebook";

/**
 * A game's rules page (#47): its rulebook (made from the module, see
 * rulebook.ts) laid out to read, with each unit's stand-in figure drawn as
 * the table draws it, the starter table's map, and Print and play. The
 * rules are the game's own words, in English (the module's language).
 */

export const RIFT_RULEBOOK = riftBook as RulebookDoc;

/** `**bold**` in the rulebook's words. */
export function rich(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((bit, i) => (i % 2 ? <strong key={i}>{bit}</strong> : bit));
}

function Words({ text }: { text: string }) {
  return (
    <>
      {textBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{rich(b.text)}</p>
        ) : b.kind === "ol" ? (
          <ol key={i}>
            {b.items.map((x, j) => (
              <li key={j}>{rich(x)}</li>
            ))}
          </ol>
        ) : (
          <ul key={i}>
            {b.items.map((x, j) => (
              <li key={j}>{rich(x)}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

/** A figure's picture, drawn once the page is up (WebGL is quick, but not free). */
function Figure({ unit, color }: { unit: RulebookDoc["armies"][number]["units"][number]; color: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setSrc(figureImage(unit, color, { px: 80 }));
      } catch {
        // No WebGL: the card does without its picture.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [unit, color]);
  return src ? <img className="figure" src={src} alt="" /> : <span className="figure" />;
}

export interface PlayChoice {
  label: string;
  primary?: boolean;
  run: () => void;
}

export default function RulesPage({
  doc = RIFT_RULEBOOK,
  onClose,
  play = [],
}: {
  doc?: RulebookDoc;
  onClose: () => void;
  /** Ways to start a game, at the end of the page and in its header (UX 360). */
  play?: PlayChoice[];
}) {
  const [printing, setPrinting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inkSaver, setInkSaver] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const map = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(mapSvg(doc, { scale: 24 }))}`,
    [doc],
  );
  const stats = doc.characteristics;
  const print = (paper: "a4" | "letter") => {
    setBusy(true);
    setPrinting(t("Making the PDF…"));
    void import("./printPlay")
      .then(({ printAndPlay }) => printAndPlay(doc, paper, { inkSaver, progress: setPrinting }))
      .then(() => setPrinting(t("Saved. Print it at 100% (actual size), not fit to page.")))
      .catch((e: unknown) => setPrinting(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  // Escape closes it, wherever the focus is (UX 360); the page takes focus so keys reach it.
  useEffect(() => {
    page.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [onClose]);
  const choose = (c: PlayChoice) => {
    onClose();
    c.run();
  };
  // On the page itself, not inside whatever opened it (the lobby's game cards style their words).
  return createPortal(
    <div
      className="rules-page"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      ref={page}
      aria-label={t("{game}: the rules", { game: doc.name })}
    >
      <div className="rules-sheet">
        <header>
          <div>
            <h1>{doc.name}</h1>
            <p className="muted small">
              {t("Version {version}", { version: doc.version })}
              {doc.licence ? ` · ${doc.licence}` : ""}
            </p>
          </div>
          <button className="close" title={t("Close")} aria-label={t("Close")} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="print-row">
          <button className="primary" disabled={busy} onClick={() => print("a4")}>
            {t("Print and play (A4 PDF)")}
          </button>
          <button disabled={busy} onClick={() => print("letter")}>
            {t("US Letter")}
          </button>
          <label className="small">
            <input type="checkbox" checked={inkSaver} onChange={(e) => setInkSaver(e.target.checked)} />{" "}
            {t("Ink saver (outlines)")}
          </label>
          <span className="muted small" role="status">
            {printing ??
              t("Rules sheet, a card per unit, tokens, a quick reference and cut-out figures, at true size.")}
          </span>
        </div>
        <p className="intro">{rich(doc.intro)}</p>
        {/* The table first: what the game looks like before how it plays (PX). */}
        <img className="map hero" src={map} alt={t("The starter table, from above")} />

        {doc.sections.map((s) => (
          <section key={s.id}>
            <h2>{s.title}</h2>
            <Words text={s.text} />
          </section>
        ))}

        <section>
          {/* The game's own word for its armies (Rulebook.words), in its own language like the rest. i18n-ignore */}
          <h2>{doc.words ? `The ${doc.words.armies}` : t("The warbands")}</h2>
          {doc.armies.map((a) => (
            <div key={a.name} className="warband" style={{ borderColor: a.color }}>
              <h3 style={{ color: a.color }}>{a.name}</h3>
              <p>
                {a.about ? <span className="muted">{a.about} </span> : null}
                <strong>{a.rule.name}.</strong> {a.rule.text}
              </p>
              <div className="units">
                {a.units.map((u) => (
                  <div key={u.name} className="unit">
                    <Figure unit={u} color={a.color} />
                    <div>
                      <strong>{u.name}</strong>{" "}
                      <span className="muted small">
                        {u.role ?? `× ${u.count}`} · {t("{points} pts", { points: u.points })}
                      </span>
                      {u.abilities?.length ? (
                        <span className="muted small"> · {u.abilities.map((r) => r.name).join(", ")}</span>
                      ) : null}
                      <table className="stats">
                        <thead>
                          <tr>
                            {stats.map((c) => (
                              <th key={c.id} title={c.name}>
                                {c.id}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {stats.map((c) => (
                              <td key={c.id}>{statText(doc, c.id, u.stats[c.id])}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* The short headers spelled out; those that are words already need no key (PX). */}
          <p className="muted small">
            {stats
              .filter((c) => c.id !== c.name)
              .map((c, i) => (
                <Fragment key={c.id}>
                  {i > 0 && " · "}
                  <strong>{c.id}</strong> {c.name}
                </Fragment>
              ))}
          </p>
        </section>

        <section>
          <h2>{t("Missions")}</h2>
          <p>
            {t(
              'Both players deploy in a strip {depth}" deep along their long edge of a {width}" x {height}" table.',
              {
                depth: deployDepth(doc),
                width: doc.table.width,
                height: doc.table.depth,
              },
            )}
          </p>
          <ul>
            {doc.missions.map((m) => (
              <li key={m.id}>
                <strong>{m.name}.</strong> {m.summary}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>{t("The starter table")}</h2>
          <img className="map" src={map} alt={t("The starter table, from above")} />
          <ul>
            {doc.terrain.map((x) => (
              <li key={x.id}>
                <strong>{x.name}</strong>: {x.does}.
              </li>
            ))}
          </ul>
        </section>

        {doc.quickRef.length > 0 && (
          <section className="quickref">
            <h2>{t("Quick reference")}</h2>
            <ul>
              {doc.quickRef.map((q, i) => (
                <li key={i}>{rich(q)}</li>
              ))}
            </ul>
          </section>
        )}

        {play.length > 0 && (
          <div className="play-row">
            {play.map((c) => (
              <button key={c.label} className={c.primary ? "primary" : ""} onClick={() => choose(c)}>
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
