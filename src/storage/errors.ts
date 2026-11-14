export type StorageErrorCode =
  | 'unavailable'
  | 'quota-exceeded'
  | 'operation-failed'
  | 'invalid-persisted-data'
  | 'stale-revision';

export abstract class StorageError extends Error {
  abstract readonly code: StorageErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class StorageUnavailableError extends StorageError {
  readonly code = 'unavailable' as const;

  constructor(operation: string, cause?: unknown) {
    super(`Browser storage is unavailable while ${operation}.`, { cause });
  }
}

export class StorageQuotaError extends StorageError {
  readonly code = 'quota-exceeded' as const;

  constructor(operation: string, cause?: unknown) {
    super(`Browser storage is full while ${operation}.`, { cause });
  }
}

export class StorageOperationError extends StorageError {
  readonly code = 'operation-failed' as const;

  constructor(operation: string, cause?: unknown) {
    super(`Browser storage failed while ${operation}.`, { cause });
  }
}

export class InvalidPersistedDataError extends StorageError {
  readonly code = 'invalid-persisted-data' as const;

  constructor(recordType: string, cause?: unknown) {
    super(`Saved ${recordType} data is invalid.`, { cause });
  }
}

export class StaleRevisionError extends StorageError {
  readonly code = 'stale-revision' as const;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number, cause?: unknown) {
    super('This data changed in another tab.', { cause });
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

const unavailableErrorNames = new Set([
  'DatabaseClosedError',
  'InvalidStateError',
  'NotFoundError',
  'NotSupportedError',
  'OpenFailedError',
  'SecurityError',
]);

const quotaErrorNames = new Set(['QuotaExceededError']);

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

export function mapStorageError(
  error: unknown,
  operation: string,
): StorageUnavailableError | StorageQuotaError | StorageOperationError | StorageError {
  if (error instanceof StorageError) {
    return error;
  }

  const name = errorName(error);
  if (name !== undefined && quotaErrorNames.has(name)) {
    return new StorageQuotaError(operation, error);
  }
  if (name !== undefined && unavailableErrorNames.has(name)) {
    return new StorageUnavailableError(operation, error);
  }
  return new StorageOperationError(operation, error);
}
