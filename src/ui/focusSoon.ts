/**
 * Move keyboard focus to the next thing to do once it's on screen (UX 181):
 * a panel that replaces the one holding focus would otherwise drop it to the
 * page, and a keyboard player would have to Tab in from the top again. It
 * waits up to `wait` ms, long enough for the dice tray to show a roll (UX 199).
 */
export function focusSoon(selector: string, wait = 8000): void {
  const until = performance.now() + wait;
  const look = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && !(el as HTMLButtonElement).disabled) el.focus();
    else if (performance.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
