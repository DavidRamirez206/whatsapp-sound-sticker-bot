'use strict';

/**
 * Bounded in-memory cache with per-entry expiry.
 *
 * Entries disappear after `ttlMs` and, when `maxEntries` is reached, the oldest
 * entry is evicted first. Besides `get`/`set`/`del` it exposes `flushAll`, so it
 * also satisfies Baileys' `CacheStore` interface.
 *
 * @template T
 * @param {{ maxEntries: number, ttlMs: number, now?: () => number }} options
 */
function createTtlCache({ maxEntries, ttlMs, now = Date.now }) {
    /** @type {Map<string, { value: T, expiresAt: number }>} */
    const entries = new Map();

    /** @param {string} key */
    const get = (key) => {
        const entry = entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= now()) {
            entries.delete(key);
            return undefined;
        }
        return entry.value;
    };

    return {
        get,
        /**
         * @param {string} key
         * @param {T} value
         */
        set(key, value) {
            entries.delete(key);
            entries.set(key, { value, expiresAt: now() + ttlMs });
            while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
            return true;
        },
        /** @param {string} key */
        has(key) {
            return get(key) !== undefined;
        },
        /** @param {string} key */
        del(key) {
            return entries.delete(key);
        },
        flushAll() {
            entries.clear();
        },
        get size() {
            return entries.size;
        }
    };
}

module.exports = { createTtlCache };
