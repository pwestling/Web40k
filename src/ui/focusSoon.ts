/**
 * Move keyboard focus to the next thing to do once it's on screen (UX 181):
 * a panel that replaces the one holding focus would otherwise drop it to the
 * page, and a keyboard player would have to Tab in from the top again.
 */
export function focusSoon(selector: string, tries = 20): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && !(el as HTMLButtonElement).disabled) el.focus();
    else if (tries > 0) focusSoon(selector, tries - 1);
  });
}
