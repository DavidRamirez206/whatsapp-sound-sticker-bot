'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectWarnings } = require('../../src/media/validate');

const goodWebp = { width: 512, height: 512, animated: true, frames: 60, durationMs: 6000, duration: 6 };
const goodAudio = { codec: 'opus', sampleRate: 48000, channels: 1, startTime: 0, duration: 6, meanDb: -20, peakDb: -3, decodeErrors: [] };
const base = { webp: goodWebp, webpBytes: 300 * 1024, audio: goodAudio, expectedDuration: 6, maxBytes: 500 * 1024 };

test('a correct sticker/audio pair has no warnings', () => {
    assert.deepEqual(collectWarnings(base), []);
});

test('flags invalid or out-of-spec stickers', () => {
    assert.match(collectWarnings({ ...base, webp: null }).join(), /not a valid WebP/);
    assert.match(collectWarnings({ ...base, webp: { ...goodWebp, animated: false, frames: 1 } }).join(), /not animated.*only 1 frame/);
    assert.match(collectWarnings({ ...base, webp: { ...goodWebp, width: 400 } }).join(), /400x512/);
    assert.match(collectWarnings({ ...base, webpBytes: 600 * 1024 }).join(), /600 KB/);
});

test('flags audio problems', () => {
    assert.match(collectWarnings({ ...base, audio: { ...goodAudio, codec: 'aac' } }).join(), /expected opus/);
    assert.match(collectWarnings({ ...base, audio: { ...goodAudio, startTime: 0.5 } }).join(), /does not start at 0/);
    assert.match(collectWarnings({ ...base, audio: { ...goodAudio, peakDb: -Infinity } }).join(), /silent/);
    assert.match(collectWarnings({ ...base, audio: { ...goodAudio, decodeErrors: ['corrupt packet'] } }).join(), /corrupt packet/);
});

test('flags length mismatches between animation, audio and request', () => {
    const warnings = collectWarnings({ ...base, audio: { ...goodAudio, duration: 8 } }).join();
    assert.match(warnings, /audio lasts 8.0s, expected 6.0s/);
    assert.match(warnings, /lengths differ/);
});
