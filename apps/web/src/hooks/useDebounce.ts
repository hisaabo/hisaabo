import { useState, useEffect } from "react";
import { holdBusy } from "@/lib/busy-marker";

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    // In sync: nothing pending (also covers a value that changes back to the
    // committed one — the earlier timer was cleared by the cleanup below).
    if (Object.is(value, debouncedValue)) return;
    // The page is busy from the moment the input changes until the debounced
    // value has been committed (this effect's cleanup runs in the commit that
    // applies it, before the consumers' effects start their queries), so
    // `html[data-busy]` covers the quiet period before the search request exists.
    const release = holdBusy();
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [value, delay, debouncedValue]);
  return debouncedValue;
}
