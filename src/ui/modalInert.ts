/**
 * While a modal is open (anything on a `.modal-backdrop`), the page behind it
 * is inert: no focus, no clicks, and out of the accessibility tree, so a
 * screen reader hears one "Undo", the dialog's (UX 472). Every element beside
 * the path from the topmost backdrop up to <body> gets `inert`; live regions
 * stay, so announcements still come through. The dialogs inside are marked
 * aria-modal. What this set inert is put back when the modal closes.
 */

const SKIP = "script, style, [aria-live]";

/** The elements to make inert behind `top`: the siblings of each element on its way up to <body>. */
function behind(top: Element): Element[] {
  const out: Element[] = [];
  for (let node: Element | null = top; node && node !== document.body; node = node.parentElement) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from<Element>(parent.children))
      if (sib !== node && !sib.matches(SKIP) && !sib.hasAttribute("inert")) out.push(sib);
  }
  return out;
}

/** Watch the page for modals for as long as it lives. */
export function watchModals(): void {
  let mine = new Set<Element>();
  let queued = false;
  const update = () => {
    queued = false;
    const all = document.querySelectorAll(".modal-backdrop");
    const top = all[all.length - 1];
    if (top)
      for (const d of Array.from(top.querySelectorAll('[role="dialog"], [role="alertdialog"]')))
        if (!d.hasAttribute("aria-modal")) d.setAttribute("aria-modal", "true");
    // Ours from last time count as not inert, so they stay inert without a flicker.
    for (const el of mine) el.removeAttribute("inert");
    const next = new Set(top ? behind(top) : []);
    for (const el of next) el.setAttribute("inert", "");
    mine = next;
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(update);
  }).observe(document.body, { childList: true, subtree: true });
}
