import { create } from "zustand";

/** Whether the figure library is open, and on which tab. Kept apart so opening it doesn't load it. */
export const useLibraryOpen = create<{ tab: "figures" | "storage" | null; tts?: boolean }>(() => ({
  tab: null,
}));

export const openLibrary = (tab: "figures" | "storage" = "figures") =>
  useLibraryOpen.setState({ tab, tts: false });
/** Straight to "From Tabletop Simulator" (#73: open a TTS save as a game). */
export const openTts = () => useLibraryOpen.setState({ tab: "figures", tts: true });
export const closeLibrary = () => useLibraryOpen.setState({ tab: null });
