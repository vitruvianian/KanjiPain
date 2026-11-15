import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { serviceWorkerSource, woff2Only } from '../../vite-plugins';

describe('build plugins', () => {
  it('drops WOFF fallbacks from fontsource stylesheets only', () => {
    const plugin = woff2Only();
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const css =
      "src: url(./files/a-400.woff2) format('woff2'), url(./files/a-400.woff) format('woff');";
    expect(transform(css, '/node_modules/@fontsource/noto-sans-jp/400.css')?.code).toBe(
      "src: url(./files/a-400.woff2) format('woff2');",
    );
    expect(transform(css, '/src/styles/global.css')).toBeNull();
  });

  it('writes a service worker that precaches the given files under a versioned cache', () => {
    const source = serviceWorkerSource('kanjipain-app-abc', ['./', 'assets/index-1.js']);
    expect(source).toContain('const CACHE = "kanjipain-app-abc";');
    expect(source).toContain('const PRECACHE = ["./","assets/index-1.js"];');
    // Valid JavaScript.
    expect(() => new Script(source)).not.toThrow();
  });
});
