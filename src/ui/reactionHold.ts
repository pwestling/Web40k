import { create } from "zustand";
import { useStore } from "../store";

/** This screen's hold on its own next step while the other player may react (#80): the window it's for. */
const useReactionHold = create<{ opened: number | null; held: boolean }>(() => ({
  opened: null,
  held: false,
}));

/** Hold this screen's next step for `ms`, for the window opened at `opened` (once per window). */
export function startReactionHold(opened: number, ms: number): void {
  if (useReactionHold.getState().opened === opened) return;
  useReactionHold.setState({ opened, held: ms > 0 });
  if (ms > 0)
    setTimeout(() => {
      if (useReactionHold.getState().opened === opened) useReactionHold.setState({ held: false });
    }, ms);
}

/** Stop waiting ("Go on"). */
export function releaseReactionHold(): void {
  useReactionHold.setState({ held: false });
}

/** Whether this screen should hold its next step (Roll, ▶) while the other player may react. */
export function useReactionHeld(): boolean {
  const { opened, held } = useReactionHold();
  const open = useStore((s) => s.game.reaction?.opened ?? null);
  return held && opened !== null && opened === open;
}
