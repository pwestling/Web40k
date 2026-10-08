import { create } from "zustand";
import type { Recording } from "./clip";

interface ShareState {
  open: boolean;
  /** What is being made now, said in the panel (or on the recording pill). */
  busy: string | null;
  recording: Recording | null;
  error: string | null;
}

/** Share the battle's panel (#46), apart from it so the stats sheet and replay bar can open it cheaply. */
export const useShare = create<ShareState>(() => ({ open: false, busy: null, recording: null, error: null }));

/** Open Share: over everything, so the stats sheet closes first (UX 336). */
export function openShare(): void {
  useShare.setState({ open: true, error: null });
}
