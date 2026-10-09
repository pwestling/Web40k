import { create } from "zustand";

/** The player card or the ladder (#65), open or not. Kept apart so opening it is what loads it. */
export const usePlayerOpen = create<{ view: "card" | "ladder" | null; system?: string }>(() => ({
  view: null,
}));

export const openPlayerCard = () => usePlayerOpen.setState({ view: "card" });
export const openLadder = (system?: string) => usePlayerOpen.setState({ view: "ladder", system });
export const closePlayer = () => usePlayerOpen.setState({ view: null });
