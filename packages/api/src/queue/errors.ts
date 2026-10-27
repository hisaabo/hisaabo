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
