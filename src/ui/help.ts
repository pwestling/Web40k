import { create } from "zustand";

/** The front door's in-game help: the "What can I do now?" hint and the shortcut sheet (?). */
export const useHelp = create<{ hint: boolean; keys: boolean }>(() => ({ hint: false, keys: false }));
