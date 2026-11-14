export type DraftSaveOperation<T> = () => Promise<T>;

export class DraftSaveQueue {
  readonly #pending = new Map<string, Promise<unknown>>();

  enqueue<T>(sessionId: string, operation: DraftSaveOperation<T>): Promise<T> {
    const previous = this.#pending.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    this.#pending.set(sessionId, result);
    return result;
  }

  async flush(sessionId: string): Promise<void> {
    // Wait for completion without replaying a failure to unrelated later commands.
    await this.#pending.get(sessionId)?.catch(() => undefined);
  }

  async flushAll(): Promise<void> {
    await Promise.all(this.#pending.values());
  }
}
