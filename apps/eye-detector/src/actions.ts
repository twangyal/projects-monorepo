import type { Target } from './decision';

/** Restrict control to visible, enabled demo buttons. Never act on external pages. */
export class BrowserActions {
  constructor(private root: HTMLElement) {}

  targets(): Target[] {
    const bounds = this.root.getBoundingClientRect();
    return [...this.root.querySelectorAll<HTMLButtonElement>('button[data-gaze]')].flatMap(button => {
      const r = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      if (button.disabled || style.visibility === 'hidden' || style.display === 'none' || button.closest('[inert]')) return [];
      const x = Math.max(0, r.left, bounds.left);
      const y = Math.max(0, r.top, bounds.top);
      const width = Math.min(innerWidth, r.right, bounds.right) - x;
      const height = Math.min(innerHeight, r.bottom, bounds.bottom) - y;
      if (width <= 0 || height <= 0) return [];
      // A floating confirmation surface or another overlay must not hide a target.
      const topmost = document.elementFromPoint(x + width / 2, y + height / 2);
      if (!topmost || !button.contains(topmost)) return [];
      return [{ id: button.dataset.gaze!, label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? 'Control',
        rect: { x, y, width, height } }];
    });
  }

  confirm(id: string): boolean {
    if (!this.targets().some(target => target.id === id)) return false;
    const button = [...this.root.querySelectorAll<HTMLButtonElement>('button[data-gaze]')]
      .find(element => element.dataset.gaze === id);
    if (!button) return false;
    button.click();
    return true;
  }
}
