import { useEffect, useRef } from 'react';

/**
 * Keys to actions, by `KeyboardEvent.key` (letters in lower case). An undefined action is
 * a shortcut that is not available right now.
 */
export type ShortcutMap = Readonly<Record<string, (() => void) | undefined>>;

const TOGGLE_INPUTS = new Set(['radio', 'checkbox']);

/** Whether a key press belongs to the focused element instead of the page. */
function ownedByTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // Letters and digits are free on a radio button or checkbox; Enter and Space are not.
    return !TOGGLE_INPUTS.has(target.type) || key === 'enter' || key === ' ';
  }
  // Enter already activates a focused button or link.
  return key === 'enter' && target.closest('button, a, summary') !== null;
}

/**
 * Page-wide keyboard shortcuts for desktop practice. Ignored while typing, with modifier
 * keys held, on held-down repeats, and while a modal dialog is open.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (ownedByTarget(event.target, key)) return;
      if (document.querySelector('dialog[open]') !== null) return;
      const action = latest.current[key];
      if (action === undefined) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
