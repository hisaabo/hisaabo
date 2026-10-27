import { useEffect } from "react";
import { ApiError } from "../api";

/** Send the operator back to sign-in when a poll reports the ops session ended. */
export function useUnauthorized(error: Error | null, onUnauthorized: () => void) {
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) onUnauthorized();
  }, [error, onUnauthorized]);
}
