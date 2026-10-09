import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, t, tn } from "../i18n";
import { displayName } from "../i18n/names";
import { useCampaigns } from "../campaign/store";
import { safeFileName, saveJson } from "../ui/files";
import { systemTitle } from "../ui/systemLabels";
import { useLadder, useRankedResults } from "../ranked/store";
import { PROVISIONAL, rankedSystems, type Rating } from "../ranked/ratings";
import { cardFile, importCardFile, keyTag, myKey, useCard } from "./card";
import { closePlayer, openLadder, openPlayerCard, usePlayerOpen } from "./open";

/**
 * The player card and the ladder (#65). The card: the name and colours a
 * player goes by, their ratings, their games from the campaign books, and the
 * identity file that carries it all to another device. The ladder: one game
 * system's ratings, worked out on this device from results both players signed.
 */
export function PlayerDialog() {
  const view = usePlayerOpen((s) => s.view);
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePlayer();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [view]);
  if (!view) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={closePlayer}>
      <div
        className="panel modal player-card"
        role="dialog"
        aria-label={view === "card" ? t("Your player card") : t("Ladder")}
        onClick={(e) => e.stopPropagation()}
      >
        {view === "card" ? <CardView /> : <LadderView />}
      </div>
    </div>,
    document.body,
  );
}

function Head({ title, other }: { title: string; other: { label: string; run: () => void } }) {
  return (
    <div className="row spread">
      <h2>{title}</h2>
      <span className="row">
        <button className="small" onClick={other.run}>
          {other.label}
        </button>
        <button className="quiet" title={t("Close")} aria-label={t("Close")} onClick={closePlayer}>
          ✕
        </button>
      </span>
    </div>
  );
}

const record = (r: Rating) => t("{w}–{l}–{d}", { w: r.wins, l: r.losses, d: r.draws });

function CardView() {
  const { name, colors, key } = useCard();
  const results = useRankedResults();
  const books = useCampaigns((s) => s.books);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void myKey();
    void useCampaigns.getState().load();
  }, []);
  // Ratings in every system this key has played ranked.
  const systems = useMemo(
    () => rankedSystems(Object.values(results).filter((r) => r.result.players.some((p) => p.key === key))),
    [results, key],
  );
  // Games from the campaign books with this name on a side.
  const games = useMemo(() => {
    const me = name.trim().toLowerCase();
    if (!me) return [];
    return Object.values(books)
      .flatMap((b) => b.games.map((g) => ({ g, book: b.name })))
      .filter(({ g }) => g.sides.some((s) => s.players.some((p) => p.trim().toLowerCase() === me)))
      .sort((a, b) => b.g.at - a.g.at)
      .slice(0, 8);
  }, [books, name]);
  const exportFile = async () => {
    saveJson(safeFileName(name || "player", "player", ".player.json"), await cardFile());
    setNote(t("Saved. Keep it private: whoever has this file plays as you."));
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const ok = await importCardFile(JSON.parse(await file.text()));
      setNote(ok ? t("This device now plays as you.") : t("That isn't a player card file."));
    } catch {
      setNote(t("That isn't a player card file."));
    }
  };
  return (
    <>
      <Head title={t("Your player card")} other={{ label: t("Ladder"), run: () => openLadder() }} />
      <div
        className="card-face"
        style={{ borderColor: colors[0], boxShadow: `inset 0 0 0 3px ${colors[1]}` }}
      >
        <label>
          {t("Name")}{" "}
          <input
            value={name}
            maxLength={32}
            placeholder={t("Your name")}
            onChange={(e) => useCard.setState({ name: e.target.value })}
          />
        </label>
        <div className="row">
          <label>
            {t("Colour")}{" "}
            <input
              type="color"
              value={colors[0]}
              onChange={(e) => useCard.setState({ colors: [e.target.value, colors[1]] })}
            />
          </label>
          <label>
            {t("Trim")}{" "}
            <input
              type="color"
              value={colors[1]}
              onChange={(e) => useCard.setState({ colors: [colors[0], e.target.value] })}
            />
          </label>
          {key && (
            <span className="muted small" title={t("Your key: what your ranked results are signed with")}>
              {t("Key {tag}", { tag: keyTag(key) })}
            </span>
          )}
        </div>
      </div>
      <h3>{t("Ranked")}</h3>
      {systems.length ? (
        <ul className="plain">
          {systems.map((s) => (
            <MyRating key={s} system={s} me={key} />
          ))}
        </ul>
      ) : (
        <p className="muted small">
          {t(
            "No ranked games yet. Tick Ranked when you post a table on Open tables; a game counts once you both sign the result.",
          )}
        </p>
      )}
      <h3>{t("Games")}</h3>
      {games.length ? (
        <ul className="plain small">
          {games.map(({ g, book }) => {
            const mine = g.sides.findIndex((s) =>
              s.players.some((p) => p.trim().toLowerCase() === name.trim().toLowerCase()),
            );
            const outcome = g.winner === null ? t("draw") : g.winner === mine ? t("won") : t("lost");
            return (
              <li key={`${book}:${g.id}`}>
                {t("{game} · {outcome} {score} · {book} · {date}", {
                  game: systemTitle(g.system),
                  outcome,
                  score: g.sides.map((s) => s.vp).join("–"),
                  book,
                  date: formatDate(g.at),
                })}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">{t("Games played for a campaign book under this name show here.")}</p>
      )}
      <h3>{t("Another device")}</h3>
      <p className="muted small">
        {t(
          "Your player card file carries your key, so your rating follows you. Keep it private: whoever has it plays as you.",
        )}
      </p>
      <div className="row wrap">
        <button onClick={() => void exportFile()}>{t("Save player card file")}</button>
        <label className="button file">
          {t("Use a player card file…")}
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </>
  );
}

function MyRating({ system, me }: { system: string; me: string | null }) {
  const rows = useLadder(system);
  const i = rows.findIndex((r) => r.key === me);
  const r = rows[i];
  if (!r) return null;
  return (
    <li>
      <button className="link" onClick={() => openLadder(system)}>
        {systemTitle(system)}
      </button>{" "}
      {tn(
        r.games,
        "{rating} · #{place} of {of} · {n} game ({record})",
        "{rating} · #{place} of {of} · {n} games ({record})",
        {
          rating: r.rating,
          place: i + 1,
          of: rows.length,
          record: record(r),
        },
      )}
    </li>
  );
}

function LadderView() {
  const asked = usePlayerOpen((s) => s.system);
  const results = useRankedResults();
  const key = useCard((s) => s.key);
  const systems = useMemo(() => rankedSystems(Object.values(results)), [results]);
  const [system, setSystem] = useState(asked ?? "");
  const shown = system || systems[0] || "";
  const rows = useLadder(shown);
  useEffect(() => void myKey(), []);
  return (
    <>
      <Head title={t("Ladder")} other={{ label: t("Your player card"), run: openPlayerCard }} />
      <p className="muted small">
        {t(
          "Worked out on this device from ranked results both players signed. Each pair counts at most three games a day.",
        )}
      </p>
      {systems.length > 1 && (
        <label>
          {t("Game")}{" "}
          <select value={shown} onChange={(e) => setSystem(e.target.value)}>
            {systems.map((s) => (
              <option key={s} value={s}>
                {systemTitle(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      {rows.length ? (
        <table className="ladder">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("Player")}</th>
              <th>{t("Rating")}</th>
              <th>{t("Games")}</th>
              <th>{t("W–L–D")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={r.key === key ? "me" : undefined}>
                <td>{i + 1}</td>
                <td>
                  {displayName(r.name)} <span className="muted small">{keyTag(r.key)}</span>
                </td>
                <td>
                  {r.rating}
                  {r.games < PROVISIONAL ? "?" : ""}
                </td>
                <td>{r.games}</td>
                <td>{record(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{t("No ranked results yet.")}</p>
      )}
    </>
  );
}
