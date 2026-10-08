import { useEffect, useMemo, useState } from "react";
import { deleteStale, getCached, staleCached } from "../assets/cache";
import { MODEL_EXTENSIONS } from "../assets/types";
import { useAssets } from "../assets/store";
import type { AssetKind } from "../assets/types";
import { useShelf } from "../packages/shelf";
import { useTables } from "../tables/library";
import { saveJson } from "../ui/files";
import { formatNumber, t, tn } from "../i18n";
import { useStore } from "../store";
import { useFigures, type FigureEntry } from "./library";
import { closeLibrary, useLibraryOpen } from "./open";
import { makePack, openPack, packFileName, shortHash, type PackResult } from "./pack";
import { makeThumb, releaseThumbs } from "./thumb";
import { unused, usage, type Usage } from "./usage";

const mb = (bytes: number) =>
  bytes >= 1e9
    ? `${tenths(bytes / 1e9)} GB`
    : bytes >= 1e6
      ? `${tenths(bytes / 1e6)} MB`
      : `${formatNumber(Math.max(1, Math.round(bytes / 1e3)))} KB`;
const tenths = (n: number) => formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const k = (n: number) =>
  n >= 1e6 ? `${tenths(n / 1e6)}M` : n >= 1000 ? `${formatNumber(Math.round(n / 1000))}k` : formatNumber(n);

/** Thumbnails are drawn one at a time, the first time the library shows a model. */
let drawing = false;
async function drawThumbs(): Promise<void> {
  if (drawing) return;
  drawing = true;
  try {
    for (;;) {
      const next = Object.values(useFigures.getState().entries).find((e) => !e.thumb);
      if (!next) break;
      const asset = useAssets.getState().assets[next.id] ?? (await getCached(next.id));
      // A model that can't be drawn gets an empty picture, so it isn't tried again.
      const thumb = (asset && (await makeThumb(asset))) || "none";
      useFigures.getState().patch(next.id, { thumb });
    }
  } finally {
    drawing = false;
    releaseThumbs();
  }
}

function useUsage(): Record<string, Usage> | null {
  const shelf = useShelf((s) => s.loaded && s.armies);
  const tables = useTables((s) => s.loaded && s.tables);
  const game = useStore((s) => s.game);
  return useMemo(() => (shelf && tables && game ? usage() : null), [shelf, tables, game]);
}

/**
 * The figure library (#33): every figure and terrain model on this device,
 * with what it dresses and where it's used; packs to share a collection; and
 * the storage it all takes.
 */
export function FigureLibrary() {
  const tab = useLibraryOpen((s) => s.tab);
  const loaded = useFigures((s) => s.loaded);
  useEffect(() => {
    void useFigures.getState().load().then(drawThumbs);
    void useShelf.getState().load();
    void useTables.getState().load();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeLibrary();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  if (!tab) return null;
  return (
    <div className="modal-backdrop" onClick={closeLibrary}>
      <div
        className="panel modal figure-library"
        role="dialog"
        aria-label={t("Figure library")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>{t("Figure library")}</h2>
          <button className="quiet" title={t("Close")} aria-label={t("Close")} onClick={closeLibrary}>
            ✕
          </button>
        </div>
        <div className="tabs" role="tablist">
          {(["figures", "storage"] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === tab}
              className={id === tab ? "on" : ""}
              onClick={() => useLibraryOpen.setState({ tab: id })}
            >
              {id === "figures" ? t("Figures") : t("Storage")}
            </button>
          ))}
        </div>
        {!loaded ? (
          <p className="muted">{t("Reading the library…")}</p>
        ) : tab === "figures" ? (
          <Figures />
        ) : (
          <Storage />
        )}
      </div>
    </div>
  );
}

function Figures() {
  const entries = useFigures((s) => s.entries);
  const status = useAssets((s) => s.status);
  const used = useUsage();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "">("");
  const [tag, setTag] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addAs, setAddAs] = useState<AssetKind>("miniature");
  const [packName, setPackName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = Object.values(entries).sort((a, b) => a.name.localeCompare(b.name));
  const tags = [...new Set(all.flatMap((e) => e.tags))].sort();
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (e) =>
      (!kind || e.kind === kind) &&
      (!tag || e.tags.includes(tag)) &&
      (!q || [e.name, ...e.tags, ...e.units].some((s) => s.toLowerCase().includes(q))),
  );
  const forPack = picked.size ? all.filter((e) => picked.has(e.id)) : shown;
  const adding = Object.entries(status).filter(([key]) => key.startsWith("library:"));

  const add = (files: FileList) => {
    for (const file of Array.from(files)) {
      const before = useFigures.getState().entries;
      void useAssets
        .getState()
        .importFile(file, `library:${file.name}`, addAs)
        .then((asset) => {
          // The same file twice is one model: say so rather than adding nothing quietly (UX 243).
          const same = asset && before[asset.id];
          if (same)
            setNote(
              t("{file} is the same model as {name}, already in your library.", {
                file: file.name,
                name: same.name,
              }),
            );
          void drawThumbs();
        });
    }
  };
  const pack = async () => {
    setBusy(true);
    try {
      const p = await makePack(packName.trim() || t("Figures"), forPack);
      saveJson(packFileName(p), p);
      setNote(
        tn(
          p.figures.length,
          "Saved {file}: {n} model, pack {code}.",
          "Saved {file}: {n} models, pack {code}.",
          {
            file: packFileName(p),
            code: shortHash(p.hash),
          },
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const open = async (file: File) => {
    setBusy(true);
    try {
      const r = await openPack(await file.text());
      setNote(typeof r === "string" ? r : packLine(r));
      void drawThumbs();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row wrap">
        <input
          type="search"
          placeholder={t("Find a model, tag or unit")}
          aria-label={t("Find a model")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t("Kind")}
          value={kind}
          onChange={(e) => setKind(e.target.value as AssetKind | "")}
        >
          <option value="">{t("Figures and terrain")}</option>
          <option value="miniature">{t("Figures")}</option>
          <option value="terrain">{t("Terrain")}</option>
        </select>
      </div>
      {tags.length > 0 && (
        <div className="row wrap tag-filter">
          {tags.map((tg) => (
            <button
              key={tg}
              className={`chip${tag === tg ? " on" : ""}`}
              aria-pressed={tag === tg}
              onClick={() => setTag(tag === tg ? null : tg)}
            >
              {tg}
            </button>
          ))}
        </div>
      )}
      <div className="row wrap">
        <label className="file button">
          {t("Add models…")}
          <input
            type="file"
            multiple
            accept={MODEL_EXTENSIONS.join(",")}
            onChange={(e) => {
              if (e.target.files) add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <select
          aria-label={t("Add as")}
          value={addAs}
          onChange={(e) => setAddAs(e.target.value as AssetKind)}
        >
          <option value="miniature">{t("as figures")}</option>
          <option value="terrain">{t("as terrain")}</option>
        </select>
        <label className="file button">
          {t("Open a pack…")}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void open(f);
            }}
          />
        </label>
      </div>
      {adding.map(([key, text]) => (
        <p key={key} className="muted small">
          {text}
        </p>
      ))}
      {note && <p className="small">{note}</p>}

      {all.length === 0 ? (
        <p className="muted">
          {t("No models yet. Upload a figure onto a unit, add models here, or open a pack from your club.")}
        </p>
      ) : (
        <>
          <ul className="figure-grid">
            {shown.map((e) => (
              <FigureCard
                key={e.id}
                entry={e}
                usage={used?.[e.id]}
                picked={picked.has(e.id)}
                onPick={(on) => {
                  const next = new Set(picked);
                  if (on) next.add(e.id);
                  else next.delete(e.id);
                  setPicked(next);
                }}
              />
            ))}
          </ul>
          {shown.length === 0 && <p className="muted small">{t("Nothing matches.")}</p>}
          <div className="row wrap pack-row">
            <input
              aria-label={t("Pack name")}
              placeholder={t("Pack name, e.g. our club's Orks")}
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
            />
            <button disabled={busy || !forPack.length} onClick={() => void pack()}>
              {picked.size
                ? tn(forPack.length, "Make a pack of {n} picked model", "Make a pack of {n} picked models")
                : shown.length === all.length
                  ? tn(forPack.length, "Make a pack of {n} model", "Make a pack of {n} models")
                  : tn(forPack.length, "Make a pack of {n} shown model", "Make a pack of {n} shown models")}
            </button>
            {picked.size > 0 && (
              <button className="quiet" onClick={() => setPicked(new Set())}>
                {t("Clear picks")}
              </button>
            )}
          </div>
          <p className="muted small">
            {t(
              "A pack is one file with the models, their paint, names and tags, to share a collection. Its short code is the same on every device that has the same pack.",
            )}
          </p>
        </>
      )}
    </>
  );
}

function packLine(r: PackResult): string {
  const parts = [
    tn(r.added, "{name} (pack {code}): {n} new model", "{name} (pack {code}): {n} new models", {
      name: r.name,
      code: shortHash(r.hash),
    }),
    r.already ? tn(r.already, "{n} already here", "{n} already here") : "",
    r.damaged ? tn(r.damaged, "{n} damaged and left out", "{n} damaged and left out") : "",
  ].filter(Boolean);
  const line = `${parts.join(", ")}.`;
  return r.changed
    ? `${line} ${t("This pack was changed after it was made: its code won't match the original's.")}`
    : line;
}

function FigureCard({
  entry,
  usage: u,
  picked,
  onPick,
}: {
  entry: FigureEntry;
  usage: Usage | undefined;
  picked: boolean;
  onPick: (on: boolean) => void;
}) {
  const { patch, remove } = useFigures.getState();
  const [name, setName] = useState(entry.name);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const where = [
    u?.armies.length ? t("Armies: {names}", { names: u.armies.join(", ") }) : "",
    u?.tables.length ? t("Tables: {names}", { names: u.tables.join(", ") }) : "",
    u?.game ? t("In a game") : "",
  ].filter(Boolean);
  return (
    <li className={`figure-card${picked ? " picked" : ""}`}>
      <label className="thumb" title={t("Pick for a pack")}>
        <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} />
        {entry.thumb && entry.thumb !== "none" ? (
          <img src={entry.thumb} alt="" width={96} height={96} />
        ) : (
          <span className="no-thumb" aria-hidden>
            {entry.thumb ? (entry.kind === "terrain" ? "▲" : "♟") : "…"}
          </span>
        )}
      </label>
      <div className="figure-info">
        <input
          className="figure-name"
          aria-label={t("Name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => name.trim() && name !== entry.name && patch(entry.id, { name: name.trim() })}
        />
        <span className="muted small">
          {entry.kind === "terrain" ? t("Terrain") : t("Figure")} ·{" "}
          {t('{height}" tall', { height: entry.height })} ·{" "}
          {t("{count} triangles", { count: k(entry.triangles) })} · {mb(entry.bytes)}
        </span>
        <input
          className="small"
          aria-label={t("Tags")}
          placeholder={t("Tags, e.g. orks, painted")}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            const next = [
              ...new Set(
                tags
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ];
            if (next.join() !== entry.tags.join()) patch(entry.id, { tags: next });
          }}
        />
        {entry.units.length > 0 && (
          <span className="small">
            {/* A figure from a pack knows its units before it is on any table (UX 252). */}
            {where.length
              ? t("Dresses {units}", { units: entry.units.slice(0, 6).join(", ") })
              : t("Will dress {units}", { units: entry.units.slice(0, 6).join(", ") })}
          </span>
        )}
        <span className="muted small">
          {where.length ? where.join(" · ") : t("Not used in a saved army, table or game")}
        </span>
      </div>
      <button
        className="quiet small"
        title={t("Delete this model from this device")}
        onClick={() => {
          const ask = unused(u)
            ? t("Delete {name} from this device?", { name: entry.name })
            : t(
                "Delete {name} from this device? It's still used, and those figures will show plain stand-ins until it comes back.",
                { name: entry.name },
              );
          if (confirm(ask)) void remove([entry.id]);
        }}
      >
        ✕
      </button>
    </li>
  );
}

function Storage() {
  const entries = useFigures((s) => s.entries);
  const used = useUsage();
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [kept, setKept] = useState<boolean | null>(null);
  const [stale, setStale] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void navigator.storage?.estimate?.().then((e) => live && setEstimate(e));
    void navigator.storage?.persisted?.().then((p) => live && setKept(p));
    void staleCached().then((s) => live && setStale(s.length));
    return () => void (live = false);
  }, [tick, entries]);

  const all = Object.values(entries).sort((a, b) => b.bytes - a.bytes);
  const total = all.reduce((n, e) => n + e.bytes, 0);
  const spare = used ? all.filter((e) => unused(used[e.id])) : [];
  const spareBytes = spare.reduce((n, e) => n + e.bytes, 0);
  const refresh = () => setTick((n) => n + 1);

  return (
    <>
      {estimate?.quota ? (
        <>
          <UsingLine used={mb(estimate.usage ?? 0)} quota={mb(estimate.quota)} />
          <meter
            // i18n-ignore: a class name
            className="storage-meter"
            min={0}
            max={estimate.quota}
            value={estimate.usage ?? 0}
            aria-label={t("Storage used")}
          />
        </>
      ) : (
        <p className="muted">{t("This browser doesn't say how much space it allows.")}</p>
      )}
      <p className="small">
        {t("Models: {count}, {size} (their meshes, simplified; your original files aren't kept).", {
          count: all.length,
          size: mb(total),
        })}
      </p>
      {kept === false && (
        <p className="row wrap small">
          <span className="muted">{t("The browser may clear this when space runs low.")}</span>
          <button className="small" onClick={() => void navigator.storage.persist().then(setKept)}>
            {t("Ask it to keep Open Battle's data")}
          </button>
        </p>
      )}
      {kept && <p className="muted small">{t("The browser will keep this data until you clear it.")}</p>}
      <div className="row wrap">
        <button
          disabled={!spare.length}
          onClick={() => {
            if (
              !confirm(
                tn(spare.length, "Delete {n} unused model ({size})?", "Delete {n} unused models ({size})?", {
                  size: mb(spareBytes),
                }),
              )
            )
              return;
            void useFigures
              .getState()
              .remove(spare.map((e) => e.id))
              .then(refresh);
          }}
        >
          {spare.length
            ? tn(spare.length, "Delete {n} unused model ({size})", "Delete {n} unused models ({size})", {
                size: mb(spareBytes),
              })
            : t("No unused models")}
        </button>
        {stale > 0 && (
          <button className="quiet" onClick={() => void deleteStale().then(refresh)}>
            {tn(stale, "Clear {n} outdated copy", "Clear {n} outdated copies")}
          </button>
        )}
      </div>
      <p className="muted small">
        {t(
          "Unused means no saved army, saved table or game in progress on this device needs it. Outdated copies are from an older version of the app, which makes them again when needed.",
        )}
      </p>
      <table className="storage-list">
        <tbody>
          {all.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td className="num">{mb(e.bytes)}</td>
              <td className="muted small">{used && unused(used[e.id]) ? t("unused") : t("in use")}</td>
              <td>
                <button
                  className="quiet small"
                  title={t("Delete from this device")}
                  onClick={() => {
                    if (confirm(t("Delete {name} from this device?", { name: e.name })))
                      void useFigures.getState().remove([e.id]).then(refresh);
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** "Open Battle is using **12.3 MB** of the 2.1 GB this browser lets it keep.", the amount in bold. */
function UsingLine({ used, quota }: { used: string; quota: string }) {
  const [before, after] = t("Open Battle is using {used} of the {quota} this browser lets it keep.", {
    quota,
  }).split("{used}");
  return (
    <p>
      {before}
      <strong>{used}</strong>
      {after}
    </p>
  );
}
