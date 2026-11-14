import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  useActiveDeck,
  useAppServices,
  useDeck,
  useDeckEntries,
  useSessions,
} from '../../app/useAppServices';
import { Button } from '../../components/Button';
import {
  MAX_DECK_ENTRIES,
  MAX_DECK_IMPORT_BYTES,
  parseDeckFile,
  parsePastedCharacters,
  type ParsedDeckImport,
} from '../../domain/deck-import';
import { STANDARD_DECK_ID, type DeckEntryRecord, type DeckOrder } from '../../domain/types';
import type { DeckImportPreview } from '../../services/deck-service';
import { ImportPreviewTable } from './ImportPreviewTable';

const ENTRY_PAGE_SIZE = 100;

const ORDER_LABELS: Readonly<Record<DeckOrder, string>> = {
  imported: 'In the order added',
  'stroke-count': 'Fewest strokes first',
  shuffled: 'Shuffled',
};

function splitList(text: string): string[] {
  return text.split(/[;；]/u);
}

function download(fileName: string, mimeType: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}

function EntryEditor({
  entry,
  busy,
  onSave,
  onCancel,
}: {
  readonly entry: DeckEntryRecord;
  readonly busy: boolean;
  readonly onSave: (patch: {
    meanings: string[];
    readingCues: string[];
    note: string;
    mnemonic: string;
  }) => void;
  readonly onCancel: () => void;
}) {
  const [meanings, setMeanings] = useState(entry.meanings.join('; '));
  const [readings, setReadings] = useState(entry.readingCues.join('; '));
  const [note, setNote] = useState(entry.note ?? '');
  const [mnemonic, setMnemonic] = useState(entry.mnemonic ?? '');

  return (
    <form
      className="entry-editor"
      aria-label={`Edit ${entry.literal}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          meanings: splitList(meanings),
          readingCues: splitList(readings),
          note,
          mnemonic,
        });
      }}
    >
      <label className="field">
        <span>Meanings (separate with ;)</span>
        <input
          type="text"
          value={meanings}
          onChange={(event) => {
            setMeanings(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>Readings (separate with ;)</span>
        <input
          type="text"
          lang="ja"
          value={readings}
          onChange={(event) => {
            setReadings(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>Note (shown with the answer)</span>
        <input
          type="text"
          value={note}
          onChange={(event) => {
            setNote(event.currentTarget.value);
          }}
        />
      </label>
      <label className="field">
        <span>Mnemonic (offered as a hint)</span>
        <input
          type="text"
          value={mnemonic}
          onChange={(event) => {
            setMnemonic(event.currentTarget.value);
          }}
        />
      </label>
      <div className="button-row">
        <Button type="submit" variant="primary" disabled={busy}>
          Save entry
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StandardDeckPanel() {
  return (
    <section className="panel">
      <h1>Standard deck</h1>
      <p>
        The Standard deck holds the 2,136 Jōyō kanji with their dictionary meanings and readings. It
        cannot be renamed, edited or deleted.
      </p>
      <p>
        To change it, copy it to a new deck from the <Link to="/decks">Decks</Link> page and edit
        the copy. Browse its characters in the <Link to="/collection">Collection</Link>.
      </p>
    </section>
  );
}

export function DeckPage() {
  const { id = '' } = useParams();
  const { decks: deckService } = useAppServices();
  const deck = useDeck(id);
  const entries = useDeckEntries(id);
  const active = useActiveDeck();
  const sessions = useSessions('active');
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [preview, setPreview] = useState<DeckImportPreview | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [page, setPage] = useState(1);

  if (id === STANDARD_DECK_ID) {
    return <StandardDeckPanel />;
  }
  if (
    deck === undefined ||
    entries === undefined ||
    active === undefined ||
    sessions === undefined
  ) {
    return (
      <section className="panel" aria-busy="true">
        <h1>Deck</h1>
        <p role="status">Loading the deck…</p>
      </section>
    );
  }
  if (deck === null) {
    return (
      <section className="panel">
        <h1>Deck not found</h1>
        <p>This deck does not exist in this browser. It may have been deleted.</p>
        <Link to="/decks">Return to your decks</Link>
      </section>
    );
  }

  const inUse = sessions.some((session) => session.deckId === deck.id);
  const isActive = active.deck.id === deck.id;
  const unrecognized = entries.filter((entry) => entry.strokeStatus === 'unrecognized').length;
  const withoutCue = entries.filter(
    (entry) => entry.meanings.length + entry.readingCues.length === 0,
  ).length;
  const totalPages = Math.max(1, Math.ceil(entries.length / ENTRY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = entries.slice((currentPage - 1) * ENTRY_PAGE_SIZE, currentPage * ENTRY_PAGE_SIZE);
  const locked = busy || inUse;

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const previewImport = (parse: () => ParsedDeckImport | Promise<ParsedDeckImport>) =>
    run(async () => {
      setPreview(null);
      const parsed = await parse();
      const next = await deckService.previewImport(deck.id, parsed);
      if (next.rows.length === 0 && next.rejected.length === 0) {
        throw new Error('No characters were found to import.');
      }
      setPreview(next);
      return null;
    });

  return (
    <div className="decks-shell">
      <p className="breadcrumb">
        <Link to="/decks">Decks</Link> / {deck.name}
      </p>

      <section className="panel" aria-labelledby="deck-title">
        <p className="eyebrow">Custom deck{isActive ? ' · active' : ''}</p>
        <h1 id="deck-title">{deck.name}</h1>
        <p>
          {entries.length.toLocaleString('en')} {entries.length === 1 ? 'character' : 'characters'}.
          New characters are introduced: {ORDER_LABELS[deck.order].toLowerCase()}.
        </p>
        {unrecognized === 0 ? null : (
          <p className="deck-warning">
            {String(unrecognized)} {unrecognized === 1 ? 'character' : 'characters'} without stroke
            data: no stroke-order guide and no automatic check. You grade those yourself.
          </p>
        )}
        {withoutCue === 0 ? null : (
          <p className="deck-warning">
            {String(withoutCue)} {withoutCue === 1 ? 'character needs' : 'characters need'} a
            meaning or reading. Practice skips {withoutCue === 1 ? 'it' : 'them'} until then,
            because a prompt cannot show the character itself.
          </p>
        )}
        {inUse ? (
          <div className="banner banner--notice">
            <p>
              A practice session is using this deck, so it cannot be changed or deleted right now.{' '}
              <Link to="/practice">Resume the session</Link> and finish it first.
            </p>
          </div>
        ) : null}
        {error === null ? null : (
          <div className="banner banner--error" role="alert">
            <p>{error}</p>
          </div>
        )}
        {notice === null ? null : (
          <div className="banner banner--notice" role="status">
            <p>{notice}</p>
          </div>
        )}

        <div className="button-row">
          {isActive ? (
            <Link className="button button--primary" to="/">
              Practise in the Dojo
            </Link>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await deckService.setActiveDeck(deck.id);
                  return 'This is now the active deck. Sessions and the Dojo use it.';
                });
              }}
            >
              Use this deck
            </Button>
          )}
          <Link className="button button--secondary" to="/collection">
            Browse in the Collection
          </Link>
        </div>
      </section>

      <section className="panel" aria-labelledby="deck-add-title">
        <h2 id="deck-add-title">Add characters</h2>
        <p className="muted">
          Stroke order is added automatically for the roughly 6,700 characters KanjiVG covers. A
          deck holds up to {MAX_DECK_ENTRIES.toLocaleString('en')} characters, one per entry.
        </p>
        <label className="field">
          <span>Paste characters</span>
          <textarea
            lang="ja"
            rows={3}
            value={pasted}
            placeholder="猫犬鳥 — or one per line"
            disabled={locked}
            onChange={(event) => {
              setPasted(event.currentTarget.value);
            }}
          />
        </label>
        <div className="button-row">
          <Button
            disabled={locked || pasted.trim() === ''}
            onClick={() => {
              void previewImport(() => parsePastedCharacters(pasted));
            }}
          >
            Preview pasted characters
          </Button>
        </div>
        <label className="field file-field">
          <span>Or choose a CSV, TSV or deck JSON file</span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
            disabled={locked}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file === undefined) return;
              void previewImport(async () => {
                if (file.size > MAX_DECK_IMPORT_BYTES) {
                  throw new Error('That file is larger than 5 MiB and cannot be imported.');
                }
                return parseDeckFile(file.name, await file.text());
              });
            }}
          />
        </label>
        <p className="muted">
          Tables need a header row with a <code>kanji</code> column, and optionally{' '}
          <code>meanings</code>, <code>readings</code>, <code>note</code> and <code>mnemonic</code>.
          Separate several meanings or readings with <code>;</code>.
        </p>

        {preview === null ? null : (
          <ImportPreviewTable
            preview={preview}
            busy={busy}
            onCancel={() => {
              setPreview(null);
            }}
            onConfirm={() => {
              void run(async () => {
                const result = await deckService.commitImport(preview);
                setPreview(null);
                setPasted('');
                return `Import saved: ${String(result.added)} added, ${String(result.merged)} merged.`;
              });
            }}
          />
        )}
      </section>

      <section className="panel" aria-labelledby="deck-entries-title">
        <h2 id="deck-entries-title">Characters</h2>
        {entries.length === 0 ? (
          <p>This deck is empty. Add characters above to practise with it.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="deck-table">
                <caption className="visually-hidden">Characters in this deck</caption>
                <thead>
                  <tr>
                    <th scope="col">Character</th>
                    <th scope="col">Meanings</th>
                    <th scope="col">Readings</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => {
                    const needsCue = entry.meanings.length + entry.readingCues.length === 0;
                    return (
                      <tr
                        key={entry.id}
                        className={entry.strokeStatus === 'unrecognized' ? 'row--warning' : ''}
                      >
                        <th scope="row" lang="ja" className="deck-table__literal">
                          <Link to={`/kanji/${entry.kanjiId}`}>{entry.literal}</Link>
                        </th>
                        {editingId === entry.id ? (
                          <td colSpan={4}>
                            <EntryEditor
                              entry={entry}
                              busy={busy}
                              onCancel={() => {
                                setEditingId(null);
                              }}
                              onSave={(patch) => {
                                void run(async () => {
                                  await deckService.updateEntry(deck.id, entry.kanjiId, patch);
                                  setEditingId(null);
                                  return `Saved ${entry.literal}.`;
                                });
                              }}
                            />
                          </td>
                        ) : (
                          <>
                            <td>{entry.meanings.join('; ') || '—'}</td>
                            <td lang="ja">{entry.readingCues.join('・') || '—'}</td>
                            <td>
                              {entry.strokeStatus === 'unrecognized' ? (
                                <span className="deck-warning">Not recognized</span>
                              ) : (
                                `${String(entry.strokeCount)} ${entry.strokeCount === 1 ? 'stroke' : 'strokes'}`
                              )}
                              {needsCue ? (
                                <span className="deck-warning"> · Needs a meaning or reading</span>
                              ) : null}
                            </td>
                            <td>
                              <div className="button-row">
                                <Button
                                  disabled={locked}
                                  aria-label={`Edit ${entry.literal}`}
                                  onClick={() => {
                                    setEditingId(entry.id);
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  disabled={locked}
                                  aria-label={`Remove ${entry.literal}`}
                                  onClick={() => {
                                    void run(async () => {
                                      await deckService.removeEntry(deck.id, entry.kanjiId);
                                      return `Removed ${entry.literal} from the deck. Its progress is kept.`;
                                    });
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages === 1 ? null : (
              <nav className="pagination" aria-label="Deck pages">
                <Button
                  disabled={currentPage <= 1}
                  onClick={() => {
                    setPage(currentPage - 1);
                  }}
                >
                  Previous page
                </Button>
                <p>
                  Page {String(currentPage)} of {String(totalPages)}
                </p>
                <Button
                  disabled={currentPage >= totalPages}
                  onClick={() => {
                    setPage(currentPage + 1);
                  }}
                >
                  Next page
                </Button>
              </nav>
            )}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="deck-settings-title">
        <h2 id="deck-settings-title">Deck settings</h2>
        <form
          className="deck-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await deckService.updateDeck(deck.id, { name: name ?? deck.name });
              setName(null);
              return 'Deck renamed.';
            });
          }}
        >
          <label className="field">
            <span>Deck name</span>
            <input
              type="text"
              value={name ?? deck.name}
              maxLength={80}
              disabled={locked}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          </label>
          <Button type="submit" disabled={locked || name === null || name.trim() === deck.name}>
            Rename
          </Button>
        </form>
        <label className="field">
          <span>Order for introducing new characters</span>
          <select
            value={deck.order}
            disabled={locked}
            onChange={(event) => {
              const order = event.currentTarget.value as DeckOrder;
              void run(async () => {
                await deckService.updateDeck(deck.id, { order });
                return 'Order saved. It applies from the next session.';
              });
            }}
          >
            {(Object.keys(ORDER_LABELS) as DeckOrder[]).map((order) => (
              <option key={order} value={order}>
                {ORDER_LABELS[order]}
              </option>
            ))}
          </select>
        </label>

        <h3>Share</h3>
        <p className="muted">
          An exported deck holds the characters and your text for them, never your progress. Anyone
          can import the file into a deck of their own.
        </p>
        <div className="button-row">
          {(['json', 'csv'] as const).map((format) => (
            <Button
              key={format}
              disabled={busy || entries.length === 0}
              onClick={() => {
                void run(async () => {
                  const file = await deckService.exportDeck(deck.id, format);
                  download(file.fileName, file.mimeType, file.text);
                  return `Deck exported as ${format.toUpperCase()}.`;
                });
              }}
            >
              Export as {format.toUpperCase()}
            </Button>
          ))}
          {unrecognized === 0 ? null : (
            <Button
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const changed = await deckService.recheckStrokes(deck.id);
                  return changed === 0
                    ? 'Checked again: no new stroke data for these characters.'
                    : `Stroke data found for ${String(changed)} ${changed === 1 ? 'character' : 'characters'}.`;
                });
              }}
            >
              Check stroke data again
            </Button>
          )}
        </div>

        <h3>Delete</h3>
        <p className="muted">
          Deleting removes the deck and your text for its characters. Cards, schedules and history
          are kept, because progress belongs to the character.
        </p>
        {confirmingDelete ? (
          <div className="banner banner--error" role="alertdialog" aria-label="Confirm deletion">
            <p>
              Delete <strong>{deck.name}</strong> and its {String(entries.length)}{' '}
              {entries.length === 1 ? 'entry' : 'entries'}? This cannot be undone.
            </p>
            <div className="button-row">
              <Button
                variant="primary"
                disabled={locked}
                onClick={() => {
                  void run(async () => {
                    await deckService.deleteDeck(deck.id);
                    await navigate('/decks');
                    return null;
                  });
                }}
              >
                Yes, delete this deck
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                Keep the deck
              </Button>
            </div>
          </div>
        ) : (
          <Button
            disabled={locked}
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Delete deck…
          </Button>
        )}
      </section>
    </div>
  );
}
