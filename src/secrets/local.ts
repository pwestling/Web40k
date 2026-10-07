import { create } from "zustand";
import { commitmentOf } from "../core/secrets";

/**
 * This device's secrets: commitment → value and salt. They never leave the
 * device until their owner reveals one; the game only holds commitments
 * (core/secrets.ts). Kept in localStorage, so a reload or rejoin can still
 * reveal what was committed.
 */
interface Kept {
  value: unknown;
  salt: string;
}

const STORAGE = "open-battle:secrets";

function read(): Record<string, Kept> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as Record<string, Kept>;
  } catch {
    return {};
  }
}

export const useLocalSecrets = create<{ kept: Record<string, Kept> }>(() => ({ kept: read() }));

/** Keep a value secret here and return the commitment to put on the table. */
export function keepSecret(value: unknown): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const commitment = commitmentOf(value, salt);
  const kept = { ...useLocalSecrets.getState().kept, [commitment]: { value, salt } };
  useLocalSecrets.setState({ kept });
  try {
    localStorage.setItem(STORAGE, JSON.stringify(kept));
  } catch {
    // Private mode: the secret lives as long as the tab.
  }
  return commitment;
}

/** The value and salt behind a commitment, if this device made it. */
export function localSecret(commitment: string): Kept | undefined {
  return useLocalSecrets.getState().kept[commitment];
}
