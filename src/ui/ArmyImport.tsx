import { useState } from "react";
import type { BaseShape, PlayerId } from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { parseRosterFile, type ImportedRoster } from "../systems/wh40k/roster";
import { sampleRoster } from "../systems/wh40k/sample";
import { useStore } from "../store";

/** Common base sizes, so a player can fix a guessed base in one click. */
const BASES: { label: string; base: BaseShape }[] = [
  ...[25, 28, 32, 40, 50, 60, 80, 90, 100, 130, 160].map((d) => ({
    label: `${d}mm round`,
    base: { shape: "round", diameterMm: d } as BaseShape,
  })),
  ...[
    [60, 35],
    [75, 42],
    [90, 52],
    [105, 70],
    [120, 92],
    [170, 105],
  ].map(([w, d]) => ({
    label: `${w}×${d}mm oval`,
    base: { shape: "oval", widthMm: w!, depthMm: d! } as BaseShape,
  })),
  ...[
    [70, 105],
    [90, 150],
    [110, 180],
  ].map(([w, d]) => ({
    label: `${w}×${d}mm hull`,
    base: { shape: "rect", widthMm: w!, depthMm: d! } as BaseShape,
  })),
];

const baseKey = (b: BaseShape) => JSON.stringify(b);

/**
 * Load a roster file (BattleScribe / New Recruit .ros, .rosz or .json) or a
 * sample army, check the guessed bases, then deploy it for a player.
 */
export function ArmyImport({ players }: { players: { id: PlayerId; name: string; seat?: number }[] }) {
  const { game, dispatch } = useStore();
  const [roster, setRoster] = useState<ImportedRoster | null>(null);
  const [owner, setOwner] = useState<PlayerId>(players[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    setBusy(true);
    try {
      setRoster(await parseRosterFile(file.name, new Uint8Array(await file.arrayBuffer())));
    } finally {
      setBusy(false);
    }
  };

  const deploy = () => {
    if (!roster) return;
    const prefix = `${owner}-${crypto.randomUUID().slice(0, 6)}`;
    for (const intent of spawnIntents(game, owner, roster.units, prefix, roster.name))
      dispatch(intent, owner);
    setRoster(null);
  };

  const ownerSeat = players.find((p) => p.id === owner)?.seat ?? 0;

  return (
    <div className="import">
      {players.length > 1 && (
        <label>
          Army for{" "}
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <label className="file button">
          {busy ? "Reading…" : "Import army list"}
          <input
            type="file"
            accept=".ros,.rosz,.json,.xml"
            onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
          />
        </label>
        <button onClick={() => setRoster(sampleRoster(ownerSeat === 1 ? 1 : 0))}>Sample army</button>
      </div>
      {roster && (
        <div className="modal-backdrop">
          <div className="panel modal">
            <h2>
              {roster.name} {roster.points ? <span className="muted">({roster.points} pts)</span> : null}
            </h2>
            {roster.warnings.map((w) => (
              <p key={w} className="warn">
                {w}
              </p>
            ))}
            <table className="import-units">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Models</th>
                  <th>Base</th>
                </tr>
              </thead>
              <tbody>
                {roster.units.map((u, i) => (
                  <tr key={i}>
                    <td>{u.name}</td>
                    <td>{u.models.length}</td>
                    <td>
                      <select
                        value={baseKey(u.base)}
                        onChange={(e) => {
                          const units = roster.units.slice();
                          units[i] = { ...u, base: JSON.parse(e.target.value) as BaseShape };
                          setRoster({ ...roster, units });
                        }}
                      >
                        {!BASES.some((b) => baseKey(b.base) === baseKey(u.base)) && (
                          <option value={baseKey(u.base)}>{JSON.stringify(u.base)}</option>
                        )}
                        {BASES.map((b) => (
                          <option key={b.label} value={baseKey(b.base)}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              Bases are a guess from keywords and wounds; check them against your models.
            </p>
            <div className="row">
              <button className="primary" disabled={!roster.units.length} onClick={deploy}>
                Deploy for {players.find((p) => p.id === owner)?.name}
              </button>
              <button onClick={() => setRoster(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
