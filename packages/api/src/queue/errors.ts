/**
 * Job error classes. The class decides whether a failed attempt is retried:
 * PermanentError (and envelope/payload parse failures) end the job at once,
 * everything else — RetryableError or an unknown error — is retried until the
 * job's retry budget is spent.
 */

export class RetryableError extends Error {
  override name = "RetryableError";
}

export class PermanentError extends Error {
  override name = "PermanentError";
}

export function isPermanent(err: unknown): boolean {
  return err instanceof PermanentError;
}

/**
 * The job queue cannot be used: the `pgboss` schema is not installed (the
 * migration step could not create it, see packages/db/src/migrate.ts) or the
 * queue database is unreachable. Raised by the API's sender instance so callers
 * can degrade; it never crashes the process.
 */
export class QueueUnavailableError extends Error {
  override name = "QueueUnavailableError";
  constructor(cause: unknown) {
    super(
      "The background job queue is not available (pgboss schema missing or database unreachable). " +
        "Check the migration logs for 'job queue schema NOT installed'.",
      { cause },
    );
  }
}
