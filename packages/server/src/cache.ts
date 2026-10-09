/**
 * A tiny key-value cache interface. Production uses a per-instance memory cache in front of
 * Netlify Blobs; tests and local development use memory only. Cache failures never fail a
 * request.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export class MemoryKV implements KV {
  private readonly entries = new Map<string, unknown>();

  constructor(private readonly maxEntries = 1000) {}

  async get<T>(key: string): Promise<T | null> {
    if (!this.entries.has(key)) return null;
    const value = this.entries.get(key) as T;
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Reads through a fast local cache to a shared one. */
export class TieredKV implements KV {
  constructor(
    private readonly near: KV,
    private readonly far: KV,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const local = await this.near.get<T>(key);
    if (local !== null) return local;
    const shared = await this.far.get<T>(key);
    if (shared !== null) await this.near.set(key, shared);
    return shared;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await Promise.all([this.near.set(key, value), this.far.set(key, value)]);
  }
}

/**
 * How long a read from the shared cache may take before it counts as a miss, ms. Reads come
 * before any upstream request, and the Netlify Blobs client retries a failed read up to five
 * times, 5 s apart, which on its own could outlast the function's time limit.
 */
export const CACHE_READ_TIMEOUT_MS = 1500;

/** Wraps a KV so errors and slow reads are logged and treated as misses. */
export class SafeKV implements KV {
  constructor(
    private readonly inner: KV,
    private readonly onError: (err: unknown) => void = () => {},
    private readonly readTimeoutMs = CACHE_READ_TIMEOUT_MS,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`read of ${key} timed out after ${this.readTimeoutMs}ms`)),
        this.readTimeoutMs,
      );
    });
    try {
      return await Promise.race([this.inner.get<T>(key), slow]);
    } catch (err) {
      this.onError(err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.inner.set(key, value);
    } catch (err) {
      this.onError(err);
    }
  }
}

/** A value with the time it was stored, for freshness checks. */
export interface Stamped<T> {
  storedAt: number;
  value: T;
}
