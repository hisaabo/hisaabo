/**
 * ttl-cache.ts — bounded in-process TTL/LRU cache with tag index and a
 * "no-resurrection" read-through (`getOrLoad`).
 *
 * No-resurrection algorithm (memory bounded by concurrent loads, no per-key
 * generation map):
 *  1. Each cache owns a monotonic `seq`. Every invalidation (delete,
 *     deleteByTag, deleteWhere, clear) does `seq++`.
 *  2. `getOrLoad` records `startSeq = seq` and registers the load in `active`
 *     (and in `inflight` for coalescing by key).
 *  3. An invalidation, while at least one load is active, appends a record
 *     `{seq, kind, key|tag|pred}` to `log` and DETACHES every matching (or, for
 *     unknowable tag/predicate matches, every possibly-matching) load from
 *     `inflight`, so callers arriving after the invalidation start a fresh load.
 *  4. When a load resolves it is stored only if no log record with
 *     `seq > startSeq` matches its key / tags / value. The (possibly stale)
 *     value is still returned to the callers that began before the change.
 *  5. Log records with `seq <= min(startSeq of active loads)` are pruned after
 *     every load completion; with no active load the log is empty.
 *
 * Degraded mode (global): the effective TTL is clamped to `degradedTtlMs`
 * (default 5s) at READ time too, so entries stored before the switch shrink.
 */

export interface CacheOptions {
  name: string;
  max: number;
  ttlMs: number;
  /** TTL clamp while the cache bus is unhealthy. Default 5000. */
  degradedTtlMs?: number;
}

export interface SetMeta {
  tags?: readonly string[];
  ttlMs?: number;
}

export interface GetOrLoadOptions<V> {
  /** Per-entry TTL override. */
  ttlMs?: number;
  /** Tags known before the load starts. */
  tags?: readonly string[];
  /** Tags derived from the loaded value (checked against invalidations too). */
  tagsOf?: (value: V) => readonly string[];
}

export interface CacheStats {
  name: string;
  size: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  invalidations: number;
  rejectedStale: number;
}

interface Entry<V> {
  value: V;
  storedAt: number;
  ttlMs: number;
  tags: readonly string[];
}

type LogRecord<V> =
  | { seq: number; kind: "key"; key: string }
  | { seq: number; kind: "tag"; tag: string }
  | { seq: number; kind: "where"; pred: (key: string, value: V | undefined) => boolean }
  | { seq: number; kind: "all" };

type LogBody<V> = LogRecord<V> extends infer R ? (R extends unknown ? Omit<R, "seq"> : never) : never;

interface Load<V> {
  key: string;
  startSeq: number;
  tags: readonly string[];
  hasTagsOf: boolean;
  promise: Promise<V | undefined>;
}

const DEFAULT_DEGRADED_TTL_MS = 5000;

// ── Global registry + degraded flag ────────────────────────────────────────────

export interface RegisteredCache {
  readonly name: string;
  clear(): void;
  /** clear() plus counter reset. Defaults to clear() if absent. */
  reset?(): void;
  stats(): CacheStats;
}

const registry = new Map<string, RegisteredCache>();
let degraded = false;

export function registerCache(c: RegisteredCache): void {
  registry.set(c.name, c);
}

export function unregisterCache(name: string): void {
  registry.delete(name);
}

/** Empty every registered cache (counters kept). Used for "invalidate all". */
export function clearAllCaches(): void {
  for (const c of registry.values()) c.clear();
}

/** Empty every registered cache and reset counters. Tests + listener (re)connect. */
export function resetAllCaches(): void {
  for (const c of registry.values()) (c.reset ?? c.clear).call(c);
}

export function allCacheStats(): Record<string, CacheStats> {
  const out: Record<string, CacheStats> = {};
  for (const [name, c] of registry) out[name] = c.stats();
  return out;
}

export function setDegraded(on: boolean): void {
  degraded = on;
}

export function isDegraded(): boolean {
  return degraded;
}

// ── Cache ──────────────────────────────────────────────────────────────────────

export class TtlCache<V> implements RegisteredCache {
  readonly name: string;
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly degradedTtlMs: number;

  private entries = new Map<string, Entry<V>>(); // insertion order = LRU order
  private tagIndex = new Map<string, Set<string>>();

  private seq = 0;
  private log: LogRecord<V>[] = [];
  private active = new Set<Load<V>>();
  private inflight = new Map<string, Load<V>>();

  private c = { hits: 0, misses: 0, sets: 0, evictions: 0, invalidations: 0, rejectedStale: 0 };

  constructor(opts: CacheOptions) {
    if (!(opts.max >= 1)) throw new Error("TtlCache max must be >= 1");
    this.name = opts.name;
    this.max = opts.max;
    this.ttlMs = opts.ttlMs;
    this.degradedTtlMs = opts.degradedTtlMs ?? DEFAULT_DEGRADED_TTL_MS;
    registerCache(this);
  }

  get size(): number {
    return this.entries.size;
  }

  private effectiveTtl(entryTtl: number): number {
    return degraded ? Math.min(entryTtl, this.degradedTtlMs) : entryTtl;
  }

  private lookup(key: string): Entry<V> | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (Date.now() - e.storedAt >= this.effectiveTtl(e.ttlMs)) {
      this.removeEntry(key, e);
      return undefined;
    }
    // LRU touch
    this.entries.delete(key);
    this.entries.set(key, e);
    return e;
  }

  get(key: string): V | undefined {
    const e = this.lookup(key);
    if (e) {
      this.c.hits++;
      return e.value;
    }
    this.c.misses++;
    return undefined;
  }

  set(key: string, value: V, meta?: SetMeta): void {
    const existing = this.entries.get(key);
    if (existing) this.removeEntry(key, existing);
    while (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.removeEntry(oldest, this.entries.get(oldest)!);
      this.c.evictions++;
    }
    const tags = meta?.tags ? [...new Set(meta.tags)] : [];
    this.entries.set(key, { value, storedAt: Date.now(), ttlMs: meta?.ttlMs ?? this.ttlMs, tags });
    for (const t of tags) {
      let s = this.tagIndex.get(t);
      if (!s) this.tagIndex.set(t, (s = new Set()));
      s.add(key);
    }
    this.c.sets++;
  }

  private removeEntry(key: string, e: Entry<V>): void {
    this.entries.delete(key);
    for (const t of e.tags) {
      const s = this.tagIndex.get(t);
      if (!s) continue;
      s.delete(key);
      if (s.size === 0) this.tagIndex.delete(t);
    }
  }

  // ── invalidation ─────────────────────────────────────────────────────────────

  private record(rec: LogBody<V>, detach: (l: Load<V>) => boolean): void {
    this.seq++;
    this.c.invalidations++;
    if (this.active.size === 0) return;
    this.log.push({ ...rec, seq: this.seq } as LogRecord<V>);
    for (const [k, l] of this.inflight) if (detach(l)) this.inflight.delete(k);
  }

  delete(key: string): void {
    const e = this.entries.get(key);
    if (e) this.removeEntry(key, e);
    this.record({ kind: "key", key }, (l) => l.key === key);
  }

  deleteByTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    let n = 0;
    if (keys) {
      for (const k of keys) {
        const e = this.entries.get(k);
        if (e) {
          this.removeEntry(k, e);
          n++;
        }
      }
    }
    // Loads whose tags are only known after resolve are detached conservatively.
    this.record({ kind: "tag", tag }, (l) => l.hasTagsOf || l.tags.includes(tag));
    return n;
  }

  deleteWhere(pred: (key: string, value: V) => boolean): number {
    let n = 0;
    for (const [k, e] of this.entries) {
      if (pred(k, e.value)) {
        this.removeEntry(k, e);
        n++;
      }
    }
    this.record(
      { kind: "where", pred: pred as (key: string, value: V | undefined) => boolean },
      () => true, // value unknown until resolve: detach conservatively
    );
    return n;
  }

  /** Drop all entries (counters kept). Also discards overlapping loads. */
  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.record({ kind: "all" }, () => true);
  }

  /** clear() plus counter reset. */
  reset(): void {
    this.clear();
    this.c = { hits: 0, misses: 0, sets: 0, evictions: 0, invalidations: 0, rejectedStale: 0 };
  }

  // ── read-through ─────────────────────────────────────────────────────────────

  getOrLoad(
    key: string,
    loader: () => Promise<V | undefined>,
    opts: GetOrLoadOptions<V> = {},
  ): Promise<V | undefined> {
    const e = this.lookup(key);
    if (e) {
      this.c.hits++;
      return Promise.resolve(e.value);
    }
    this.c.misses++;

    const joined = this.inflight.get(key);
    if (joined) return joined.promise;

    const load: Load<V> = {
      key,
      startSeq: this.seq,
      tags: opts.tags ?? [],
      hasTagsOf: !!opts.tagsOf,
      promise: undefined as unknown as Promise<V | undefined>,
    };
    this.active.add(load);
    this.inflight.set(key, load);

    load.promise = (async () => {
      try {
        const value = await loader();
        if (value !== undefined) {
          if (this.overlappedInvalidation(load, value, opts)) this.c.rejectedStale++;
          else this.set(key, value, { ttlMs: opts.ttlMs, tags: [...load.tags, ...(opts.tagsOf?.(value) ?? [])] });
        }
        return value;
      } finally {
        this.active.delete(load);
        if (this.inflight.get(key) === load) this.inflight.delete(key);
        this.pruneLog();
      }
    })();
    return load.promise;
  }

  private overlappedInvalidation(load: Load<V>, value: V, opts: GetOrLoadOptions<V>): boolean {
    if (this.seq === load.startSeq) return false;
    const tags = [...load.tags, ...(opts.tagsOf?.(value) ?? [])];
    for (const r of this.log) {
      if (r.seq <= load.startSeq) continue;
      switch (r.kind) {
        case "all":
          return true;
        case "key":
          if (r.key === load.key) return true;
          break;
        case "tag":
          if (tags.includes(r.tag)) return true;
          break;
        case "where":
          try {
            if (r.pred(load.key, value)) return true;
          } catch {
            return true; // cannot evaluate => fail closed
          }
          break;
      }
    }
    return false;
  }

  private pruneLog(): void {
    if (this.active.size === 0) {
      this.log = [];
      return;
    }
    let min = Infinity;
    for (const l of this.active) if (l.startSeq < min) min = l.startSeq;
    if (this.log.length && this.log[0]!.seq <= min) this.log = this.log.filter((r) => r.seq > min);
  }

  /** Test/diagnostic: size of the invalidation log (bounded by concurrent loads). */
  _logSize(): number {
    return this.log.length;
  }

  stats(): CacheStats {
    return { name: this.name, size: this.entries.size, ...this.c };
  }
}
