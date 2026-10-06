import { getDeployStore, getStore } from '@netlify/blobs';
import type { KV } from './cache';

const STORE = 'isithot-cache';

/**
 * Netlify Blobs as a KV. Production shares one global store; previews and branch deploys use
 * a deploy-scoped store so test data never mixes with production data.
 */
export function createBlobsKV(production: boolean): KV {
  const store = production ? getStore(STORE) : getDeployStore(STORE);
  return {
    async get<T>(key: string): Promise<T | null> {
      return ((await store.get(key, { type: 'json' })) as T | null) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      await store.setJSON(key, value);
    },
  };
}
