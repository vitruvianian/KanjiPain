import type {
  PullRequest,
  PushRequest,
  RemoteRecord,
  RemoteStore,
  SyncCollection,
} from './remote-store';

interface StoredRecord extends RemoteRecord {
  readonly generation: string;
  readonly deviceId: string;
}

/**
 * A cloud copy held in memory, behaving like the real one. Tests share one instance between
 * several databases to stand in for several devices on one account.
 */
export class MemoryRemoteStore implements RemoteStore {
  #generation: string | null = null;
  #seq = 0;
  readonly #records = new Map<string, StoredRecord>();

  getGeneration(): Promise<string | null> {
    return Promise.resolve(this.#generation);
  }

  ensureGeneration(candidate: string): Promise<string> {
    this.#generation ??= candidate;
    return Promise.resolve(this.#generation);
  }

  reset(generation: string): Promise<void> {
    this.#generation = generation;
    for (const [key, record] of this.#records) {
      if (record.generation !== generation) {
        this.#records.delete(key);
      }
    }
    return Promise.resolve();
  }

  pull({ generation, afterSeq, excludeDeviceId, limit }: PullRequest): Promise<RemoteRecord[]> {
    const records = [...this.#records.values()]
      .filter(
        (record) =>
          record.generation === generation &&
          record.seq > afterSeq &&
          record.deviceId !== excludeDeviceId,
      )
      .sort((left, right) => left.seq - right.seq)
      .slice(0, limit)
      // A real server hands back parsed JSON, never the caller's own objects.
      .map(({ collection, id, data, deleted, seq }) => ({
        collection,
        id,
        data: JSON.parse(JSON.stringify(data)) as unknown,
        deleted,
        seq,
      }));
    return Promise.resolve(records);
  }

  push({ generation, deviceId, records }: PushRequest): Promise<void> {
    for (const record of records) {
      this.#seq += 1;
      this.#records.set(`${generation}/${record.collection}/${record.id}`, {
        ...record,
        data: JSON.parse(JSON.stringify(record.data)) as unknown,
        generation,
        deviceId,
        seq: this.#seq,
      });
    }
    return Promise.resolve();
  }

  deleteAll(): Promise<void> {
    this.#generation = null;
    this.#records.clear();
    return Promise.resolve();
  }

  /** For tests: how many live records of one kind the current generation holds. */
  count(collection: SyncCollection): number {
    return [...this.#records.values()].filter(
      (record) =>
        record.generation === this.#generation &&
        record.collection === collection &&
        !record.deleted,
    ).length;
  }
}
