/** A phone-width screen, where panels become bottom sheets (UX 17). Matches the CSS breakpoint. */
export const narrow = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches;
