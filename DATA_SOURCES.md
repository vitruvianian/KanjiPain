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
