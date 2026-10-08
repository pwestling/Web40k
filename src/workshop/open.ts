import { create } from "zustand";

/**
 * Whether the module workshop (#41) is open, kept apart so the front door
 * doesn't load it. Over a test table it folds to a tab at the side.
 * `link` is a module to open from a URL (?workshop=<url>, the gallery's links).
 */
export const useWorkshopOpen = create<{ open: boolean; folded: boolean; link: string | null }>(() => {
  const link = new URLSearchParams(location.search).get("workshop");
  return { open: link !== null, folded: false, link: link && /^https:\/\//.test(link) ? link : null };
});

export const openWorkshop = () => useWorkshopOpen.setState({ open: true, folded: false });
export const closeWorkshop = () => useWorkshopOpen.setState({ open: false, link: null });
