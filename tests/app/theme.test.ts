import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
} from '../../src/app/theme';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.head.innerHTML = '';
});

describe('theme preference', () => {
  it('defaults to the system theme and saves an override', () => {
    expect(readThemePreference()).toBe('system');
    saveThemePreference('dark');
    expect(readThemePreference()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    saveThemePreference('system');
    expect(readThemePreference()).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('updates the browser theme colour', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#141414">';
    applyThemePreference('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#f7f4ee',
    );
  });

  it('still applies the theme when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    saveThemePreference('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(readThemePreference()).toBe('system');
  });
});
