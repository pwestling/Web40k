import { commitTo } from "../core/sharedDice";

/** This device's secret seeds for shared dice (core/sharedDice.ts), by commitment. */
const KEY = "open-battle:shared-dice:";
const secrets = new Map<string, string>();

export function newSeed(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A secret seed this device committed to (kept for a reload of the same tab). */
export function sharedSecret(commit: string): string | undefined {
  if (secrets.has(commit)) return secrets.get(commit);
  try {
    const kept = sessionStorage.getItem(KEY + commit);
    if (kept) secrets.set(commit, kept);
    return kept ?? undefined;
  } catch {
    return undefined;
  }
}

export function keepSecret(seed: string): string {
  const commit = commitTo(seed);
  secrets.set(commit, seed);
  try {
    sessionStorage.setItem(KEY + commit, seed);
  } catch {
    // A private window: the seed lives as long as the page.
  }
  return commit;
}
