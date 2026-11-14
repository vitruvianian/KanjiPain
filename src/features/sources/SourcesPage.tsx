import { useAppServices } from '../../app/useAppServices';
import { APP_VERSION } from '../../app/version';
import strokesManifest from '../../data/strokes-manifest.json';
import { formatDate } from '../format';

function externalLink(href: string, children: string) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function SourcesPage() {
  const { catalog } = useAppServices();
  const manifest = catalog.manifest;
  const licenseBase = import.meta.env.BASE_URL;

  return (
    <div className="sources-shell">
      <section className="panel" aria-labelledby="sources-title">
        <p className="eyebrow">Attribution and provenance</p>
        <h1 id="sources-title">Sources &amp; licenses</h1>
        <p>
          KanjiPain bundles normalized learning data so practice makes no runtime dictionary
          requests. This page records where that data came from, how it was transformed, and which
          licenses apply.
        </p>
        <p>
          <span className="muted">Application version:</span> <code>{APP_VERSION}</code>
        </p>
      </section>

      <section className="panel" aria-labelledby="kanjidic-title">
        <h2 id="kanjidic-title">KANJIDIC2 and EDRDG</h2>
        <p>
          The kanji catalog is derived from <strong>KANJIDIC2</strong>, maintained by the Electronic
          Dictionary Research and Development Group (EDRDG). Copyright in the source dictionary
          files is held by James William Breen and EDRDG.
        </p>
        <ul className="source-links">
          <li>{externalLink(manifest.source.downloadUrl, 'KANJIDIC2 download')}</li>
          <li>{externalLink(manifest.source.documentationUrl, 'KANJIDIC2 documentation')}</li>
          <li>{externalLink(manifest.source.licenseUrl, 'EDRDG dictionary license')}</li>
          <li>
            <a
              href={`${licenseBase}licenses/kanjidic2-documentation.html`}
              target="_blank"
              rel="noreferrer"
            >
              Bundled KANJIDIC2 documentation copy
            </a>
          </li>
          <li>
            <a
              href={`${licenseBase}licenses/kanjidic2-license.html`}
              target="_blank"
              rel="noreferrer"
            >
              Bundled EDRDG license copy
            </a>
          </li>
        </ul>
        <p>
          KANJIDIC2-derived catalog data is distributed under{' '}
          <strong>{manifest.source.license}</strong>, subject to the full upstream statement. This
          data license is separate from any license for KanjiPain application code, and KanjiPain
          does not claim ownership of the source dictionary material.
        </p>
      </section>

      <section className="panel" aria-labelledby="dataset-title">
        <h2 id="dataset-title">Bundled dataset</h2>
        <dl className="character-facts">
          <div>
            <dt>Entries</dt>
            <dd>{manifest.entryCount.toLocaleString()} Jōyō characters</dd>
          </div>
          <div>
            <dt>Dataset generated</dt>
            <dd>{formatDate(manifest.generatedAt)}</dd>
          </div>
          <div>
            <dt>Source retrieved</dt>
            <dd>{formatDate(manifest.source.retrievedAt)}</dd>
          </div>
          <div>
            <dt>Upstream header date</dt>
            <dd>{manifest.source.upstreamDate ?? 'Not recorded'}</dd>
          </div>
        </dl>

        <dl className="hash-list">
          <div>
            <dt>Dataset version</dt>
            <dd>
              <code className="hash">{manifest.datasetVersion}</code>
            </dd>
          </div>
          <div>
            <dt>Catalog SHA-256</dt>
            <dd>
              <code className="hash">{manifest.catalogSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Teaching notes SHA-256</dt>
            <dd>
              <code className="hash">{manifest.teachingNotesSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Source input SHA-256</dt>
            <dd>
              <code className="hash">{manifest.source.inputSha256}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="transformation-title">
        <h2 id="transformation-title">Transformation notice</h2>
        <p>
          The generated catalog is a transformed extract, not a copy of the whole dictionary. It
          selects entries whose KANJIDIC2 grade is 1–6 or 8 (the Jōyō set) and rejects any result
          other than exactly 2,136 unique literals.
        </p>
        <p>
          Each retained entry keeps its literal, grade, first stroke count, frequency rank (when
          present), English meanings without a language attribute or marked <code>en</code>, and
          Japanese <code>ja_on</code>/<code>ja_kun</code> readings. Reading punctuation such as{' '}
          <span lang="ja">た.べる</span> is preserved and explained on character pages. Name
          readings, non-Japanese readings, dictionary indexes, and search codes are excluded.
        </p>
        <p className="muted">
          Stable IDs are derived from Unicode code points (<span lang="ja">湖</span> →{' '}
          <code>k-6e56</code>). Curriculum order is deterministic: grade, frequency rank, then code
          point. A data refresh does not rename IDs or reset user progress.
        </p>
      </section>

      <section className="panel" aria-labelledby="kanjivg-title">
        <h2 id="kanjivg-title">KanjiVG stroke data</h2>
        <p>
          Drawings are checked against stroke shapes, order and direction derived from{' '}
          <strong>KanjiVG</strong>, copyright © 2009–2013 Ulrich Apel. The bundled data is a
          transformed extract: each of the {strokesManifest.strokeTotal.toLocaleString()} strokes of
          the catalog&apos;s characters is reduced to a simplified line. For custom decks, the same
          extract covers all {strokesManifest.shards.entryCount.toLocaleString()} characters in the
          KanjiVG release. It is distributed under <strong>{strokesManifest.source.license}</strong>
          .
        </p>
        <ul className="source-links">
          <li>{externalLink(strokesManifest.source.projectUrl, 'KanjiVG project')}</li>
          <li>
            {externalLink(
              strokesManifest.source.downloadUrl,
              `KanjiVG release ${strokesManifest.source.release}`,
            )}
          </li>
          <li>{externalLink(strokesManifest.source.licenseUrl, 'CC BY-SA 3.0 license')}</li>
          <li>
            <a href={`${licenseBase}licenses/kanjivg-license.txt`} target="_blank" rel="noreferrer">
              Bundled KanjiVG license notice
            </a>
          </li>
        </ul>
        <dl className="hash-list">
          <div>
            <dt>Stroke data SHA-256</dt>
            <dd>
              <code className="hash">{strokesManifest.strokesSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Source input SHA-256</dt>
            <dd>
              <code className="hash">{strokesManifest.source.inputSha256}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="font-title">
        <h2 id="font-title">Japanese type</h2>
        <p>
          Japanese text is rendered with <strong>Noto Sans JP</strong>, bundled through the{' '}
          <code>@fontsource/noto-sans-jp</code> package. The font software is licensed under the SIL
          Open Font License 1.1.
        </p>
        <ul className="source-links">
          <li>
            <a
              href={`${licenseBase}licenses/noto-sans-jp-license.txt`}
              target="_blank"
              rel="noreferrer"
            >
              Bundled Noto Sans JP license
            </a>
          </li>
        </ul>
        <p lang="ja" className="japanese-sample">
          漢字を書いて覚える
        </p>
      </section>

      <section className="panel" aria-labelledby="maintenance-title">
        <h2 id="maintenance-title">Data maintenance</h2>
        <p>
          Maintainers check for KANJIDIC2 updates at least monthly and before each release, and
          review the current upstream license before distributing refreshed data. Updates change
          static content; they never silently reset local progress.
        </p>
        <p className="muted">
          The repository&apos;s <code>DATA_SOURCES.md</code> records the fetch, import, validation,
          review, and release steps. Ordinary installs and tests use the committed catalog and never
          download the dictionary.
        </p>
      </section>
    </div>
  );
}
