import { create } from "zustand";

/** Whether the figure library is open, and on which tab. Kept apart so opening it doesn't load it. */
export const useLibraryOpen = create<{ tab: "figures" | "storage" | null }>(() => ({ tab: null }));

export const openLibrary = (tab: "figures" | "storage" = "figures") => useLibraryOpen.setState({ tab });
export const closeLibrary = () => useLibraryOpen.setState({ tab: null });
