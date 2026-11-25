'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWebp } = require('../../src/media/webp');
const { buildWebp } = require('../helpers/webp-builder');

test('parseWebp reads canvas, animation flag, frames and total duration', () => {
    const info = parseWebp(buildWebp({ width: 512, height: 512, frameDurations: [100, 100, 67] }));
    assert.deepEqual(info, { width: 512, height: 512, animated: true, frames: 3, durationMs: 267, duration: 0.267 });
});

test('parseWebp reports static images', () => {
    const info = parseWebp(buildWebp({ width: 300, height: 200, animated: false }));
    assert.equal(info.animated, false);
    assert.equal(info.frames, 0);
    assert.equal(info.width, 300);
    assert.equal(info.height, 200);
});

test('parseWebp rejects buffers that are not WebP', () => {
    assert.equal(parseWebp(Buffer.from('not a webp file')), null);
    assert.equal(parseWebp(Buffer.alloc(4)), null);
    assert.equal(parseWebp(null), null);
});

test('parseWebp tolerates a truncated trailing chunk', () => {
    const full = buildWebp({ width: 512, height: 512, frameDurations: [50, 50] });
    const info = parseWebp(full.subarray(0, full.length - 10));
    assert.equal(info.frames, 1);
});
