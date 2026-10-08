import { useEffect, useMemo, useState } from "react";
import { deleteStale, getCached, staleCached } from "../assets/cache";
import { MODEL_EXTENSIONS } from "../assets/parse";
import { useAssets } from "../assets/store";
import type { AssetKind } from "../assets/types";
import { useShelf } from "../packages/shelf";
import { useTables } from "../tables/library";
import { download } from "../ui/report";
import { useStore } from "../store";
import { useFigures, type FigureEntry } from "./library";
import { closeLibrary, useLibraryOpen } from "./open";
import { makePack, openPack, packFileName, shortHash, type PackResult } from "./pack";
import { makeThumb, releaseThumbs } from "./thumb";
import { unused, usage, type Usage } from "./usage";

export const mb = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const k = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

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
  }, []);
  if (!tab) return null;
  return (
    <div className="modal-backdrop" onClick={closeLibrary}>
      <div
        className="panel modal figure-library"
        role="dialog"
        aria-label="Figure library"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread">
          <h2>Figure library</h2>
          <button className="quiet" title="Close" aria-label="Close" onClick={closeLibrary}>
            ✕
          </button>
        </div>
        <div className="tabs" role="tablist">
          {(["figures", "storage"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              className={t === tab ? "on" : ""}
              onClick={() => useLibraryOpen.setState({ tab: t })}
            >
              {t === "figures" ? "Figures" : "Storage"}
            </button>
          ))}
        </div>
        {!loaded ? (
          <p className="muted">Reading the library…</p>
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
    for (const file of Array.from(files))
      void useAssets
        .getState()
        .importFile(file, `library:${file.name}`, addAs)
        .then(() => void drawThumbs());
  };
  const pack = async () => {
    setBusy(true);
    try {
      const p = await makePack(packName.trim() || "Figures", forPack);
      download(packFileName(p), p);
      setNote(`Saved ${packFileName(p)}: ${p.figures.length} models, pack ${shortHash(p.hash)}.`);
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
          placeholder="Find a model, tag or unit"
          aria-label="Find a model"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as AssetKind | "")}>
          <option value="">Figures and terrain</option>
          <option value="miniature">Figures</option>
          <option value="terrain">Terrain</option>
        </select>
      </div>
      {tags.length > 0 && (
        <div className="row wrap tag-filter">
          {tags.map((t) => (
            <button
              key={t}
              className={`chip${tag === t ? " on" : ""}`}
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="row wrap">
        <label className="file button">
          Add models…
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
        <select aria-label="Add as" value={addAs} onChange={(e) => setAddAs(e.target.value as AssetKind)}>
          <option value="miniature">as figures</option>
          <option value="terrain">as terrain</option>
        </select>
        <label className="file button">
          Open a pack…
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
          No models yet. Upload a figure onto a unit, add models here, or open a pack from your club.
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
          {shown.length === 0 && <p className="muted small">Nothing matches.</p>}
          <div className="row wrap pack-row">
            <input
              aria-label="Pack name"
              placeholder="Pack name, e.g. our club's Orks"
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
            />
            <button disabled={busy || !forPack.length} onClick={() => void pack()}>
              Make a pack of {forPack.length}{" "}
              {picked.size ? "picked" : shown.length === all.length ? "" : "shown"}{" "}
              {forPack.length === 1 ? "model" : "models"}
            </button>
            {picked.size > 0 && (
              <button className="quiet" onClick={() => setPicked(new Set())}>
                Clear picks
              </button>
            )}
          </div>
          <p className="muted small">
            A pack is one file with the models, their paint, names and tags, to share a collection. Its short
            code is the same on every device that has the same pack.
          </p>
        </>
      )}
    </>
  );
}

function packLine(r: PackResult): string {
  const parts = [
    `${r.name} (pack ${shortHash(r.hash)}): ${r.added} new ${r.added === 1 ? "model" : "models"}`,
    r.already ? `${r.already} already here` : "",
    r.damaged ? `${r.damaged} damaged and left out` : "",
  ].filter(Boolean);
  return `${parts.join(", ")}.${r.changed ? " This pack was changed after it was made: its code won't match the original's." : ""}`;
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
    u?.armies.length ? `Armies: ${u.armies.join(", ")}` : "",
    u?.tables.length ? `Tables: ${u.tables.join(", ")}` : "",
    u?.game ? "In a game" : "",
  ].filter(Boolean);
  return (
    <li className={`figure-card${picked ? " picked" : ""}`}>
      <label className="thumb" title="Pick for a pack">
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
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== entry.name && patch(entry.id, { name: name.trim() })}
        />
        <span className="muted small">
          {entry.kind === "terrain" ? "Terrain" : "Figure"} · {entry.height}" tall · {k(entry.triangles)}{" "}
          triangles · {mb(entry.bytes)}
        </span>
        <input
          className="small"
          aria-label="Tags"
          placeholder="Tags, e.g. orks, painted"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            const next = [
              ...new Set(
                tags
                  .split(",")
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ];
            if (next.join() !== entry.tags.join()) patch(entry.id, { tags: next });
          }}
        />
        {entry.units.length > 0 && (
          <span className="small">Dresses {entry.units.slice(0, 6).join(", ")}</span>
        )}
        <span className="muted small">
          {where.length ? where.join(" · ") : "Not used in a saved army, table or game"}
        </span>
      </div>
      <button
        className="quiet small"
        title="Delete this model from this device"
        onClick={() => {
          const warn = unused(u)
            ? ""
            : " It's still used, and those figures will show plain stand-ins until it comes back.";
          if (confirm(`Delete ${entry.name} from this device?${warn}`)) void remove([entry.id]);
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
  const refresh = () => setTick((t) => t + 1);

  return (
    <>
      {estimate?.quota ? (
        <>
          <p>
            Open Battle is using <strong>{mb(estimate.usage ?? 0)}</strong> of the {mb(estimate.quota)} this
            browser lets it keep.
          </p>
          <meter
            className="storage-meter"
            min={0}
            max={estimate.quota}
            value={estimate.usage ?? 0}
            aria-label="Storage used"
          />
        </>
      ) : (
        <p className="muted">This browser doesn't say how much space it allows.</p>
      )}
      <p className="small">
        Models: {all.length}, {mb(total)} (their meshes, simplified; your original files aren't kept).
      </p>
      {kept === false && (
        <p className="row wrap small">
          <span className="muted">The browser may clear this when space runs low.</span>
          <button className="small" onClick={() => void navigator.storage.persist().then(setKept)}>
            Ask it to keep Open Battle's data
          </button>
        </p>
      )}
      {kept && <p className="muted small">The browser will keep this data until you clear it.</p>}
      <div className="row wrap">
        <button
          disabled={!spare.length}
          onClick={() => {
            if (
              !confirm(
                `Delete ${spare.length} unused ${spare.length === 1 ? "model" : "models"} (${mb(spareBytes)})?`,
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
            ? `Delete ${spare.length} unused ${spare.length === 1 ? "model" : "models"} (${mb(spareBytes)})`
            : "No unused models"}
        </button>
        {stale > 0 && (
          <button className="quiet" onClick={() => void deleteStale().then(refresh)}>
            Clear {stale} outdated {stale === 1 ? "copy" : "copies"}
          </button>
        )}
      </div>
      <p className="muted small">
        Unused means no saved army, saved table or game in progress on this device needs it. Outdated copies
        are from an older version of the app, which makes them again when needed.
      </p>
      <table className="storage-list">
        <tbody>
          {all.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td className="num">{mb(e.bytes)}</td>
              <td className="muted small">{used && unused(used[e.id]) ? "unused" : "in use"}</td>
              <td>
                <button
                  className="quiet small"
                  title="Delete from this device"
                  onClick={() => {
                    if (confirm(`Delete ${e.name} from this device?`))
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
