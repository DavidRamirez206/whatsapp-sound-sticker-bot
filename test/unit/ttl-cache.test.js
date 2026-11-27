'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTtlCache } = require('../../src/ttl-cache');

test('stores values until they expire', () => {
    let now = 0;
    const cache = createTtlCache({ maxEntries: 10, ttlMs: 100, now: () => now });
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.has('a'), true);
    now = 100;
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.has('a'), false);
});

test('evicts the oldest entry when full', () => {
    const cache = createTtlCache({ maxEntries: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    assert.equal(cache.get('b'), undefined, '"b" is now the oldest');
    assert.equal(cache.get('a'), 3);
    assert.equal(cache.size, 2);
});

test('supports del and flushAll (Baileys CacheStore interface)', () => {
    const cache = createTtlCache({ maxEntries: 5, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.del('a'), true);
    assert.equal(cache.get('a'), undefined);
    cache.flushAll();
    assert.equal(cache.size, 0);
});
