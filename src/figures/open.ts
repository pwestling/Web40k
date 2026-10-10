import { create } from "zustand";

/** Whether the figure library is open, and on which tab. Kept apart so opening it doesn't load it. */
export const useLibraryOpen = create<{
  tab: "figures" | "storage" | null;
  tts?: boolean;
  /** A TTS save to load as it opens ("Open a file…" given one, UX 503). */
  ttsSave?: File;
}>(() => ({
  tab: null,
}));

export const openLibrary = (tab: "figures" | "storage" = "figures") =>
  useLibraryOpen.setState({ tab, tts: false });
/** Straight to "From Tabletop Simulator" (#73: open a TTS save as a game). */
export const openTts = (save?: File) =>
  useLibraryOpen.setState({ tab: "figures", tts: true, ...(save ? { ttsSave: save } : {}) });
export const closeLibrary = () => useLibraryOpen.setState({ tab: null });
