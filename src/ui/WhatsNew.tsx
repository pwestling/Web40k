import { useState } from "react";
import { APP_BUILD } from "../version";
import { t } from "../i18n";

const KEY = "open-battle:seen-version";
const CHANGELOG = "https://github.com/pwestling/Web40k/blob/main/CHANGELOG.md";

/** This release's highlights, newest first; CHANGELOG.md has the whole list. */
const NEWS = (): { version: string; items: string[] }[] => [
  {
    version: "0.1.0",
    items: [
      t("Rift Lanterns, our own skirmish game: play now, nothing to import."),
      t("Four games built in, each with a demo and a guided first game against the computer."),
      t("Play online 1v1 or 2v2, with table talk and voice, or watch a game as it streams."),
      t("Table companion: play on your real table with real models, and roll your own dice."),
      t("Play by mail, chess clocks, event nights and a shared campaign book."),
      t("Replays with notes, What if branches and review rooms for going over a game together."),
      t("Your own armies, figures, terrain and rules packages, and a workshop to write a whole game in."),
      t("German and French, keyboard play, colour-blind sides and a screen-reader announcer."),
      t("Install it and play offline."),
    ],
  },
];

const version = APP_BUILD.split("+")[0]!;

function seen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** On the start page: what this version brought, marked until it has been opened once. */
export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState(() => seen() !== version);
  const show = () => {
    setOpen(true);
    setFresh(false);
    try {
      localStorage.setItem(KEY, version);
    } catch {
      // Private windows: it just stays marked.
    }
  };
  const news = NEWS();
  return (
    <>
      <button className="link whats-new" onClick={show}>
        {t("What's new in {version}", { version })}
        {fresh && <span className="dot" aria-label={t("not read yet")} />}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="panel modal whats-new-list"
            role="dialog"
            aria-label={t("What's new")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row spread">
              <h2>{t("What's new")}</h2>
              <button className="quiet" title={t("Close")} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            {news.map((n) => (
              <section key={n.version}>
                <h3>{t("Version {version}", { version: n.version })}</h3>
                <ul>
                  {n.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </section>
            ))}
            <a href={CHANGELOG} target="_blank" rel="noreferrer">
              {t("The full list of changes")}
            </a>
          </div>
        </div>
      )}
    </>
  );
}
