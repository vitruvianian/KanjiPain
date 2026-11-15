import manifestInput from '../data/catalog-manifest.json';
import { kanjiIdFromLiteral } from '../domain/ids';
import { catalogManifestSchema, kanjiEntrySchema, teachingNotesSchema } from '../domain/schemas';
import type {
  CatalogManifest,
  KanjiEntry,
  KanjiId,
  TeachingNote,
  TeachingNotes,
} from '../domain/types';

const JOYO_COUNT = 2_136;
const NO_LOOKALIKES: readonly KanjiId[] = Object.freeze([]);

export interface CatalogRepository {
  readonly all: readonly KanjiEntry[];
  readonly orderedIds: readonly KanjiId[];
  readonly manifest: CatalogManifest;
  readonly teachingNotes: Readonly<TeachingNotes>;
  byId(id: KanjiId): KanjiEntry | undefined;
  /** Characters whose shapes are easily confused with this one, closest first. */
  lookalikes(id: KanjiId): readonly KanjiId[];
}

export interface CatalogOptions {
  /**
   * Skips schema validation of every entry. The build already validates the bundled files
   * and checks their SHA-256 against the manifest, so startup only checks their structure.
   */
  readonly trusted?: boolean;
  /** Generated component hints by character, used where no teaching note gives one. */
  readonly componentHints?: Readonly<Record<string, string>>;
  /** Generated look-alike characters by character. */
  readonly lookalikes?: Readonly<Record<string, readonly string[]>>;
}

function freezeNote(note: TeachingNote): TeachingNote {
  return Object.freeze({
    ...note,
    ...(note.promptOverride === undefined
      ? {}
      : {
          promptOverride: Object.freeze({
            ...note.promptOverride,
            readingCues: Object.freeze([...note.promptOverride.readingCues]) as string[],
          }),
        }),
  });
}

export function createCatalogRepository(
  rawCatalog: unknown,
  rawManifest: unknown,
  rawTeachingNotes: unknown = {},
  options: CatalogOptions = {},
): CatalogRepository {
  const parsedCatalog = options.trusted
    ? (rawCatalog as KanjiEntry[])
    : kanjiEntrySchema.array().length(JOYO_COUNT).parse(rawCatalog);
  const manifest = catalogManifestSchema.parse(rawManifest);
  const parsedTeachingNotes = options.trusted
    ? (rawTeachingNotes as TeachingNotes)
    : teachingNotesSchema.parse(rawTeachingNotes);
  if (!Array.isArray(parsedCatalog) || parsedCatalog.length !== JOYO_COUNT) {
    throw new Error('Catalog does not contain the 2,136 Jōyō kanji.');
  }
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

  // A reviewed component hint in the teaching notes wins over the generated one.
  const notes: Record<string, TeachingNote> = {};
  for (const [id, hint] of Object.entries(options.componentHints ?? {})) {
    if (byId.has(id)) {
      notes[id] = {
        componentHint: hint,
        source: 'KanjiVG component grouping',
        reviewer: 'generated',
      };
    }
  }
  for (const [id, note] of Object.entries(parsedTeachingNotes) as [string, TeachingNote][]) {
    const generated = notes[id]?.componentHint;
    notes[id] = {
      ...note,
      ...(note.componentHint === undefined && generated !== undefined
        ? { componentHint: generated }
        : {}),
    };
  }
  const teachingNotes = Object.freeze(
    Object.fromEntries(Object.entries(notes).map(([id, note]) => [id, freezeNote(note)])),
  ) as TeachingNotes;

  const lookalikes = new Map(
    Object.entries(options.lookalikes ?? {}).map(([id, others]) => [
      id,
      Object.freeze(others.filter((other) => byId.has(other))),
    ]),
  );

  return Object.freeze({
    all,
    orderedIds,
    manifest: frozenManifest,
    teachingNotes,
    byId: (id: KanjiId) => byId.get(id),
    lookalikes: (id: KanjiId) => lookalikes.get(id) ?? NO_LOOKALIKES,
  });
}

/**
 * Loads the bundled catalog as its own chunk, so the app shell can render before the
 * 2,136 entries arrive.
 */
export async function loadBundledCatalog(): Promise<CatalogRepository> {
  const bundle = await import('../data/catalog-bundle');
  return createCatalogRepository(bundle.catalog, manifestInput, bundle.teachingNotes, {
    trusted: true,
    componentHints: bundle.componentHints,
    lookalikes: bundle.lookalikes,
  });
}
