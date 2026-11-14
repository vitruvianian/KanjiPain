import catalogInput from '../data/kanji.generated.json';
import manifestInput from '../data/catalog-manifest.json';
import teachingNotesInput from '../data/teaching-notes.json';
import { kanjiIdFromLiteral } from '../domain/ids';
import { catalogManifestSchema, kanjiEntrySchema, teachingNotesSchema } from '../domain/schemas';
import type { CatalogManifest, KanjiEntry, KanjiId, TeachingNotes } from '../domain/types';

const JOYO_COUNT = 2_136;

export interface CatalogRepository {
  readonly all: readonly KanjiEntry[];
  readonly orderedIds: readonly KanjiId[];
  readonly manifest: CatalogManifest;
  readonly teachingNotes: Readonly<TeachingNotes>;
  byId(id: KanjiId): KanjiEntry | undefined;
}

export function createCatalogRepository(
  rawCatalog: unknown,
  rawManifest: unknown,
  rawTeachingNotes: unknown = {},
): CatalogRepository {
  const parsedCatalog = kanjiEntrySchema.array().length(JOYO_COUNT).parse(rawCatalog);
  const manifest = catalogManifestSchema.parse(rawManifest);
  const parsedTeachingNotes = teachingNotesSchema.parse(rawTeachingNotes);
  const entries = parsedCatalog.map((entry, index): KanjiEntry => {
    if (entry.curriculumOrder !== index) {
      throw new Error(`Catalog order is not contiguous at ${entry.id}.`);
    }
    if (entry.id !== kanjiIdFromLiteral(entry.literal)) {
      throw new Error(`Catalog ID does not match literal for ${entry.id}.`);
    }

    return Object.freeze({
      ...entry,
      meanings: Object.freeze([...entry.meanings]),
      onReadings: Object.freeze([...entry.onReadings]),
      kunReadings: Object.freeze([...entry.kunReadings]),
    });
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  if (byId.size !== JOYO_COUNT) {
    throw new Error('Catalog contains duplicate IDs.');
  }
  if (manifest.entryCount !== entries.length) {
    throw new Error('Catalog count does not match its manifest.');
  }

  const all = Object.freeze(entries);
  const orderedIds = Object.freeze(entries.map((entry) => entry.id));
  const frozenManifest = Object.freeze({
    ...manifest,
    source: Object.freeze({ ...manifest.source }),
  });
  const teachingNotes = Object.freeze(
    Object.fromEntries(
      Object.entries(parsedTeachingNotes).map(([id, note]) => [
        id,
        Object.freeze({
          ...note,
          ...(note.promptOverride === undefined
            ? {}
            : {
                promptOverride: Object.freeze({
                  ...note.promptOverride,
                  readingCues: Object.freeze([...note.promptOverride.readingCues]),
                }),
              }),
        }),
      ]),
    ) as TeachingNotes,
  );

  return Object.freeze({
    all,
    orderedIds,
    manifest: frozenManifest,
    teachingNotes,
    byId: (id: KanjiId) => byId.get(id),
  });
}

export function loadBundledCatalog(): CatalogRepository {
  return createCatalogRepository(catalogInput, manifestInput, teachingNotesInput);
}
