/**
 * Shared error handler for CLI commands.
 *
 * Extracts the repeated try-catch pattern from 100+ command files into a
 * single function. All tRPC error codes are handled with actionable messages
 * and appropriate exit codes.
 */

import { HisaaboApiError } from "./client.js";
import { fatalError, EXIT } from "./output.js";
import { getConfig } from "./config.js";

/**
 * Handle any error thrown during a CLI command. Recognizes HisaaboApiError
 * subtypes and exits with the correct code and message.
 *
 * Usage:
 *   try {
 *     await doStuff();
 *   } catch (e) {
 *     handleApiError(e);
 *   }
 */
export function handleApiError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;

    if (err.code === "unauthorized") {
      fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    } else if (err.code === "forbidden") {
      fatalError(err.message, EXIT.FORBIDDEN);
    } else if (err.code === "not_found") {
      fatalError(err.resource, EXIT.NOT_FOUND);
    } else if (err.code === "validation_failed") {
      fatalError(e.message, EXIT.VALIDATION);
    } else if (err.code === "rate_limited") {
      fatalError(err.message, EXIT.RATE_LIMITED);
    } else if (err.code === "network_error") {
      const cfg = getConfig();
      const url = cfg.apiUrl ?? "unknown";
      fatalError(
        `Cannot reach ${url}\n` +
        `  Is the server running? Check: curl ${url}/health\n` +
        `  Wrong URL? Run: hisaabo login`,
        EXIT.NETWORK,
      );
    } else {
      fatalError(e.message, EXIT.GENERAL);
    }
  }

  fatalError(String(e instanceof Error ? e.message : e), EXIT.GENERAL);
}
