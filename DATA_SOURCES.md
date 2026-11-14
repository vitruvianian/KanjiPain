# KanjiPain Data Sources

KanjiPain bundles normalized learning data so ordinary installs, tests, and builds make no dictionary network requests.

## KANJIDIC2

The kanji catalog is derived from **KANJIDIC2**, maintained by the Electronic Dictionary Research and Development Group (EDRDG). Copyright in the source dictionary files is held by James William Breen and EDRDG.

- Download: <https://www.edrdg.org/kanjidic/kanjidic2.xml.gz>
- Project documentation: <https://www.edrdg.org/wiki/KANJIDIC_Project.html>
- General dictionary license: <https://www.edrdg.org/edrdg/licence.html>
- License: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0), subject to the full upstream statement
- Bundled documentation copy: [`public/licenses/kanjidic2-documentation.html`](./public/licenses/kanjidic2-documentation.html)
- Bundled license copy: [`public/licenses/kanjidic2-license.html`](./public/licenses/kanjidic2-license.html)

The generated catalog is a transformed extract. It selects entries whose KANJIDIC2 grade is 1–6 or 8, retains the literal, first stroke count, frequency rank, English meanings, and Japanese on/kun readings, and assigns a deterministic curriculum order. Dictionary indexes, search codes, name readings, and non-Japanese readings are not distributed in the generated catalog.

The resulting KANJIDIC2-derived data remains under CC BY-SA 4.0. This data license does not by itself set a license for KanjiPain application code. KanjiPain does not claim ownership of the source dictionary material.

Current source hashes, retrieval time, upstream header date, generated catalog hash, and dataset version are recorded in [`src/data/catalog-manifest.json`](./src/data/catalog-manifest.json).

## KanjiVG

Reference strokes for checking drawn characters are derived from **KanjiVG**, copyright © 2009–2013 Ulrich Apel.

- Project: <https://kanjivg.tagaini.net>
- Release used: recorded in [`src/data/strokes-manifest.json`](./src/data/strokes-manifest.json), with the download URL and input SHA-256
- License: Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)
- Bundled notice: [`public/licenses/kanjivg-license.txt`](./public/licenses/kanjivg-license.txt)

[`src/data/strokes.generated.json`](./src/data/strokes.generated.json) is a transformed extract: for each catalog character, every stroke path is flattened to a line, simplified, and stored on a 0–255 grid in stroke order. The same transformation is applied to every character in the KanjiVG release (about 6,700) and written to [`src/data/stroke-shards/`](./src/data/stroke-shards/) as 64 files keyed by code point modulo 64, so custom decks get stroke order for characters outside the catalog and load only the files they need. Component groupings and stroke-type labels are not distributed. The adapted data remains under CC BY-SA 3.0.

KanjiVG and KANJIDIC2 disagree on the stroke count of nine characters that have two accepted written forms (for example 賭). They are listed under `strokeCountDifferences` in the strokes manifest. `data:validate` fails on any difference not listed there, so a new one must be reviewed before release. For these characters the checker does not judge a drawing made with the catalog's stroke count.

To refresh the stroke data, update `KANJIVG_RELEASE` and the download URL in `scripts/kanjivg-pipeline.ts`, then:

```sh
npm run strokes:fetch
npm run strokes:import
npm run data:validate
npm run checker:selftest
```

`strokes:fetch` downloads into ignored `data/raw/`; `strokes:import` never downloads. Review the manifest diff and the self-test report (it takes a few minutes): correct drawings should stay at 100% accepted, and the wrongly accepted list should stay short. Re-run `strokes:import` whenever the kanji catalog changes, since the stroke file must cover exactly the catalog's characters. `strokes:import` also rewrites the shard files and records their count and hash under `shards` in the strokes manifest; custom-deck entries pick up new stroke data the next time the app starts.

## Noto Sans JP

The interface bundles Noto Sans JP through the `@fontsource/noto-sans-jp` package. The font software is licensed under the SIL Open Font License 1.1.

- Bundled license: [`public/licenses/noto-sans-jp-license.txt`](./public/licenses/noto-sans-jp-license.txt)

## Updating dictionary data

Check for KANJIDIC2 updates at least monthly and before each release. Review the current upstream license before distributing refreshed data.

1. Use Node.js 24 and install locked dependencies with `npm ci`.
2. Run `npm run data:fetch`. This explicitly downloads the gzip file into ignored `data/raw/`, writes it atomically, and records response metadata and SHA-256.
3. Run `npm run data:import`. To use an already downloaded file, run `npm run data:import -- path/to/kanjidic2.xml.gz` instead. Importing never downloads data.
4. Run `npm run data:validate`. The command must report exactly 2,136 unique Jōyō entries.
5. Review the generated catalog and manifest diff: changed literals, meanings/readings, grades, frequency/curriculum order, retrieval/upstream dates, input and output SHA-256 hashes, and dataset version. Also review changes to `teaching-notes.json`; notes require documented sources and a reviewer. Stable IDs must continue to derive from Unicode code points (`湖` → `k-6e56`); a data refresh must not rename IDs, delete IndexedDB, or reset user progress. Active sessions pin their dataset version; do not bypass compatibility checks.
6. Refresh the bundled upstream documentation and license copies if those pages changed.
7. If the dataset changed, run `npm run e2e:fixtures` to regenerate the valid browser-test backups. Review their diffs, too. Tests use these fixtures through the public import UI, not as production learning data.
8. Run the full project checks below. Verify Sources & licenses displays the new manifest and that all bundled license links work. Retain the reviewed generated assets and license copies together in the release; raw inputs remain ignored.

```sh
npm run data:fetch
npm run data:import
npm run data:validate
npm run e2e:fixtures
npm run check
npm run build
npm run test:e2e
```

`data:fetch` is the only dictionary-network step. Builds never fetch data. Local-file import also accepts an adjacent `*.metadata.json` from the fetch command; keep that metadata with the gzip for reproducible provenance. Without it, import records file modification time as retrieval time and leaves the upstream header date unset. The generated timestamp may change on reimport, but identical catalog and teaching-note bytes produce the same dataset version.

If validation reports a count other than 2,136, stop the release; do not weaken the gate or add synthetic entries. Keep the last validated generated assets. Check the downloaded gzip/metadata hashes, upstream grade data and source format, and inspect affected entries. Update the parser only when justified by source documentation, add a regression test, and record the decision. Re-run import and all checks before replacing the last good dataset. Do not discard unrelated local edits when recovering generated files.
