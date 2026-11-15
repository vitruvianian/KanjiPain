/**
 * The colour theme. `system` follows the operating system; `light` and `dark` override it.
 * The choice is a per-device convenience kept in localStorage, not part of saved progress,
 * and index.html applies it before the first paint.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'kanjipain-theme';

const THEME_COLORS = { light: '#f7f4ee', dark: '#141414' } as const;

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersLight(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
  const effective =
    preference === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : preference;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[effective]);
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the theme still
    // applies for this visit.
  }
  applyThemePreference(preference);
}
