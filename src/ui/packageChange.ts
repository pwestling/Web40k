// Here, not in gameLog.ts, so the lobby's package picker doesn't bring the whole game log to the front door.

/** "Old World Factions 1.2 → 1.3, + Overwatch macros 0.1, − Old House Rules 2.0". */
export function describePackageChange(
  from: { id: string; name: string; version: string; hash: string }[],
  to: { id: string; name: string; version: string; hash: string }[],
): string {
  const parts: string[] = [];
  for (const p of to) {
    const old = from.find((o) => o.id === p.id);
    if (!old) parts.push(`+ ${p.name} ${p.version}`);
    else if (old.hash !== p.hash) parts.push(`${p.name} ${old.version} → ${p.version}`);
  }
  for (const o of from) if (!to.some((p) => p.id === o.id)) parts.push(`− ${o.name} ${o.version}`);
  return parts.join(", ");
}
