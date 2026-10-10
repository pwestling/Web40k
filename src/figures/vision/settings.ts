import { create } from "zustand";
import type { ProviderId } from "./types";

/**
 * The player's vision key and model. Kept in this browser's localStorage only:
 * never in game state, never sent to peers or our relay, only to the provider.
 */
interface VisionSettings {
  provider: ProviderId;
  /** API keys by provider. */
  keys: Partial<Record<ProviderId, string>>;
  /** Model names by provider, when the player changed them. */
  models: Partial<Record<ProviderId, string>>;
}

const DEFAULT_MODEL: Record<ProviderId, string> = { openai: "gpt-5" };

const STORAGE = "open-battle:vision";

function read(): VisionSettings {
  const empty: VisionSettings = { provider: "openai", keys: {}, models: {} };
  try {
    const v = localStorage.getItem(STORAGE);
    return v ? { ...empty, ...(JSON.parse(v) as Partial<VisionSettings>) } : empty;
  } catch {
    return empty;
  }
}

function write(s: VisionSettings): void {
  try {
    if (!Object.values(s.keys).some(Boolean) && !Object.values(s.models).some(Boolean))
      localStorage.removeItem(STORAGE);
    else localStorage.setItem(STORAGE, JSON.stringify(s));
  } catch {
    // Private windows may refuse; the key then lasts until the page closes.
  }
}

interface Store extends VisionSettings {
  setKey(key: string): void;
  setModel(model: string): void;
  forget(): void;
}

export const useVision = create<Store>((set, get) => {
  const save = (patch: Partial<VisionSettings>) => {
    set(patch);
    const { provider, keys, models } = get();
    write({ provider, keys, models });
  };
  return {
    ...read(),
    setKey: (key) => save({ keys: { ...get().keys, [get().provider]: key.trim() || undefined } }),
    setModel: (model) => save({ models: { ...get().models, [get().provider]: model.trim() || undefined } }),
    forget: () => save({ keys: { ...get().keys, [get().provider]: undefined } }),
  };
});

/** The model to ask, for the chosen provider. */
export const modelOf = (s: VisionSettings) => s.models[s.provider] || DEFAULT_MODEL[s.provider];
