/** Bounded negative cache: remembers keys known to be absent for a short TTL. */
export class NegativeCache {
  private entries = new Map<string, number>();

  constructor(private maxSize = 5000, private ttlMs = 30_000) {}

  has(key: string, now = Date.now()): boolean {
    const exp = this.entries.get(key);
    if (exp === undefined) return false;
    if (now >= exp) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  add(key: string, now = Date.now()): void {
    if (this.entries.size >= this.maxSize) {
      // Drop expired entries first, then the oldest insertion.
      for (const [k, exp] of this.entries) if (now >= exp) this.entries.delete(k);
      if (this.entries.size >= this.maxSize) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, now + this.ttlMs);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
