import { create } from "zustand";

/** An event's page, or the form to run one (#67), open or not. Kept apart so opening it is what loads it. */
export const useEventOpen = create<{ id: string | null; running: boolean }>(() => ({
  id: null,
  running: false,
}));

export const openEvent = (id: string) => useEventOpen.setState({ id, running: false });
export const runAnEvent = () => useEventOpen.setState({ id: null, running: true });
export const closeEvent = () => useEventOpen.setState({ id: null, running: false });

/** This device organises an event: it runs it (src/events/store.ts) while the app is open. */
export const useRunsEvents = create<{ on: boolean }>(() => {
  try {
    return {
      on: (JSON.parse(localStorage.getItem("open-battle:events-mine") ?? "[]") as unknown[]).length > 0,
    };
  } catch {
    return { on: false };
  }
});
