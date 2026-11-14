import type { KanjiEntry, ProductionPrompt, PromptHint, TeachingNote } from './types';

export class PromptTargetLeakError extends Error {
  constructor(kanjiId: string) {
    super(`Prompt content leaks the target glyph for ${kanjiId}.`);
    this.name = 'PromptTargetLeakError';
  }
}

function assertTargetHidden(entry: KanjiEntry, values: readonly string[]): void {
  if (values.some((value) => value.includes(entry.literal))) {
    throw new PromptTargetLeakError(entry.id);
  }
}

export function buildPrompt(entry: KanjiEntry, teachingNote?: TeachingNote): ProductionPrompt {
  const meaningCue =
    teachingNote?.promptOverride?.meaningCue ?? entry.meanings.slice(0, 3).join(', ');
  if (meaningCue.length === 0) {
    throw new Error(`Catalog entry ${entry.id} has no meaning cue.`);
  }

  const readingCues = teachingNote?.promptOverride?.readingCues ?? [
    ...entry.kunReadings,
    ...entry.onReadings,
  ];
  if (readingCues.length === 0) {
    throw new Error(`Catalog entry ${entry.id} has no reading cues.`);
  }

  const hints: PromptHint[] = [];
  if (teachingNote?.mnemonicHint !== undefined) {
    hints.push({ key: 'mnemonic', text: teachingNote.mnemonicHint });
  }
  if (teachingNote?.componentHint !== undefined) {
    hints.push({ key: 'component', text: teachingNote.componentHint });
  }
  hints.push({
    key: 'stroke-count',
    text: `Stroke count: ${String(entry.strokeCount)}`,
  });

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
