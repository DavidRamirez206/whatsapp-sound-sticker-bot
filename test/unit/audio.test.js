'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waveformFromPcm } = require('../../src/media/audio');

/** @param {number[]} samples */
const pcm = (samples) => {
    const buffer = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => buffer.writeInt16LE(s, i * 2));
    return buffer;
};

test('waveformFromPcm returns 64 bars scaled so the loudest is 100', () => {
    const samples = Array.from({ length: 6400 }, (_, i) => (i < 3200 ? 1000 : -4000));
    const bars = waveformFromPcm(pcm(samples));
    assert.equal(bars.length, 64);
    assert.equal(bars[0], 25);
    assert.equal(bars[63], 100);
});

test('waveformFromPcm handles silence and empty input', () => {
    assert.deepEqual([...waveformFromPcm(pcm(new Array(640).fill(0)))], new Array(64).fill(0));
    assert.deepEqual([...waveformFromPcm(Buffer.alloc(0))], new Array(64).fill(0));
});

test('waveformFromPcm supports clips shorter than the number of bars', () => {
    const bars = waveformFromPcm(pcm([100, 200]), 4);
    assert.deepEqual([...bars], [50, 100, 0, 0]);
});
