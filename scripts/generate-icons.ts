/**
 * Draws the app icon: 痛 ("pain") in the app's brush style, from its KanjiVG strokes, and
 * renders the PNG sizes browsers need for installation. Run with `npm run icons:generate`
 * after `npx playwright install chromium`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { strokeOutlinePath, VIEW_SIZE } from '../src/components/brush';
import { resample } from '../src/recognition/geometry';
import { ReferenceStrokes, type ReferenceStrokeData } from '../src/recognition/reference-data';

const BACKGROUND = '#141414';
const PAPER = '#f5f0e5';
const INK = '#1d1c19';
const ACCENT = '#e87861';

function iconSvg(data: ReferenceStrokeData, padding: number): string {
  const strokes = new ReferenceStrokes(data).strokesFor('k-75db') ?? [];
  const paths = strokes
    .map((stroke) =>
      strokeOutlinePath(
        resample(stroke, 28).map(({ x, y }) => ({ x, y, p: 1 })),
        true,
      ),
    )
    .map((d, index) => `<path d="${d}" fill="${index === 0 ? ACCENT : INK}"/>`)
    .join('');
  const tile = VIEW_SIZE - 2 * padding;
  const glyphScale = (tile * 0.84) / VIEW_SIZE;
  const offset = padding + (tile - VIEW_SIZE * glyphScale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(VIEW_SIZE)} ${String(VIEW_SIZE)}">
<rect width="${String(VIEW_SIZE)}" height="${String(VIEW_SIZE)}" fill="${BACKGROUND}"/>
<rect x="${String(padding)}" y="${String(padding)}" width="${String(tile)}" height="${String(tile)}" rx="${String(tile * 0.12)}" fill="${PAPER}"/>
<g transform="translate(${offset.toFixed(1)} ${offset.toFixed(1)}) scale(${glyphScale.toFixed(4)})">${paths}</g>
</svg>
`;
}

async function main(): Promise<void> {
  const data = JSON.parse(
    await readFile(resolve('src/data/strokes.generated.json'), 'utf8'),
  ) as ReferenceStrokeData;
  const standard = iconSvg(data, 60);
  // Maskable icons are cropped to a circle by some launchers; keep the glyph in the middle.
  const maskable = iconSvg(data, 150);
  await writeFile(resolve('public/icons/icon.svg'), standard);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const renders: [string, string, number][] = [
      ['icon-192.png', standard, 192],
      ['icon-512.png', standard, 512],
      ['icon-maskable-512.png', maskable, 512],
      ['apple-touch-icon.png', standard, 180],
    ];
    for (const [name, svg, size] of renders) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<style>html,body{margin:0}svg{display:block;width:${String(size)}px;height:${String(size)}px}</style>${svg}`,
      );
      await page.screenshot({ path: resolve('public/icons', name), omitBackground: false });
    }
  } finally {
    await browser.close();
  }
  console.log('Wrote public/icons.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
