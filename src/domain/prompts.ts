import type { ProductionPrompt, PromptHint, StudyEntry, TeachingNote } from './types';

export class PromptTargetLeakError extends Error {
  constructor(kanjiId: string) {
    super(`Prompt content leaks the target glyph for ${kanjiId}.`);
    this.name = 'PromptTargetLeakError';
  }
}

function assertTargetHidden(entry: StudyEntry, values: readonly string[]): void {
  if (values.some((value) => value.includes(entry.literal))) {
    throw new PromptTargetLeakError(entry.id);
  }
}

/** Whether an entry has anything to prompt with: a meaning or a reading. */
export function hasCue(entry: StudyEntry): boolean {
  return (
    entry.meanings.length +
      entry.kunReadings.length +
      entry.onReadings.length +
      (entry.readings?.length ?? 0) >
    0
  );
}

/**
 * The recall prompt for a character. Dictionary entries always have a meaning and a reading;
 * a custom-deck entry needs only one of the two, so either cue may be empty, but not both.
 */
export function buildPrompt(entry: StudyEntry, teachingNote?: TeachingNote): ProductionPrompt {
  const meaningCue =
    teachingNote?.promptOverride?.meaningCue ?? entry.meanings.slice(0, 3).join(', ');
  const readingCues = teachingNote?.promptOverride?.readingCues ?? [
    ...entry.kunReadings,
    ...entry.onReadings,
    ...(entry.readings ?? []),
  ];
  if (meaningCue.length === 0 && readingCues.length === 0) {
    throw new Error(`Entry ${entry.id} has no meaning or reading cue.`);
  }

  const hints: PromptHint[] = [];
  const mnemonic = teachingNote?.mnemonicHint ?? entry.mnemonic;
  if (mnemonic !== undefined) {
    hints.push({ key: 'mnemonic', text: mnemonic });
  }
  if (teachingNote?.componentHint !== undefined) {
    hints.push({ key: 'component', text: teachingNote.componentHint });
  }
  if (entry.strokeCount !== null) {
    hints.push({
      key: 'stroke-count',
      text: `Stroke count: ${String(entry.strokeCount)}`,
    });
  }

  assertTargetHidden(entry, [meaningCue, ...readingCues, ...hints.map((hint) => hint.text)]);

  const prompt: ProductionPrompt = {
    kanjiId: entry.id,
    meaningCue,
    readingCues: [...readingCues],
    hints: hints.map((hint) => Object.freeze(hint)),
  };
  Object.freeze(prompt.readingCues);
  Object.freeze(prompt.hints);
  return Object.freeze(prompt);
}
