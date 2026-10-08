/** Whether this device is pointed at with a finger, so instructions say "tap" rather than "click" (UX 275). */
export function touch(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}
