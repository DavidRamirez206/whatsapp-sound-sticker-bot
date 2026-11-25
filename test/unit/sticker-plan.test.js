'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    planEncoding, lighterSetting, sampleWindows, mapWithConcurrency, stickerFilter,
    QUALITY_LADDER, FPS_LADDER
} = require('../../src/media/sticker');

/** Per-frame cost table where every quality costs `base * quality / 100` bytes (minimum 1 KB). */
const costTable = (base) => Object.fromEntries(QUALITY_LADDER.map((q) => [q, Math.max(1024, (base * q) / 100)]));
const budget = 0.9 * 500 * 1024;

test('light content keeps the full frame rate and a high quality', () => {
    const plan = planEncoding({ duration: 20, bytesPerFrame: costTable(1500), budgetBytes: budget, maxFrames: 1000 });
    assert.equal(plan.fps, 15);
    assert.equal(plan.quality, 75);
    assert.equal(plan.fitsBudget, true);
    assert.ok(plan.predictedBytes <= budget);
});

test('heavy content lowers the frame rate before dropping quality under 30', () => {
    const plan = planEncoding({ duration: 20, bytesPerFrame: costTable(10000), budgetBytes: budget, maxFrames: 1000 });
    assert.ok(plan.quality >= 30, `quality ${plan.quality} should stay >= 30`);
    assert.ok(plan.fps < 15);
    assert.ok(plan.predictedBytes <= budget);
});

test('maxFrames caps the frame rate of long clips', () => {
    const plan = planEncoding({ duration: 25, bytesPerFrame: costTable(100), budgetBytes: budget, maxFrames: 250 });
    assert.equal(plan.fps, 10);
    assert.ok(plan.fps * 25 <= 250);
});

test('falls back to the lightest setting and flags it when nothing fits', () => {
    const plan = planEncoding({ duration: 25, bytesPerFrame: costTable(10_000_000), budgetBytes: budget, maxFrames: 250 });
    assert.equal(plan.fitsBudget, false);
    assert.equal(plan.fps, FPS_LADDER[FPS_LADDER.length - 1]);
    assert.equal(plan.quality, QUALITY_LADDER[QUALITY_LADDER.length - 1]);
});

test('uses the lowest frame rate when even it exceeds maxFrames', () => {
    const plan = planEncoding({ duration: 25, bytesPerFrame: costTable(100), budgetBytes: budget, maxFrames: 30 });
    assert.equal(plan.fps, 5);
});

test('lighterSetting lowers quality first, then frame rate, then squeezes quality', () => {
    assert.deepEqual(lighterSetting({ fps: 10, quality: 45 }), { fps: 10, quality: 30 });
    assert.deepEqual(lighterSetting({ fps: 10, quality: 12 }), { fps: 8, quality: 12 });
    assert.deepEqual(lighterSetting({ fps: 5, quality: 12 }), { fps: 5, quality: 6 });
    assert.deepEqual(lighterSetting({ fps: 15, quality: 50 }), { fps: 15, quality: 45 });
    assert.equal(lighterSetting({ fps: 5, quality: 2 }), null);
});

test('sampleWindows spreads windows across the clip and samples short clips whole', () => {
    assert.deepEqual(sampleWindows(2.5), [{ start: 0, end: 2.5 }]);
    const windows = sampleWindows(21);
    assert.equal(windows.length, 3);
    for (const { start, end } of windows) {
        assert.ok(start >= 0 && end <= 21);
        assert.equal(Number((end - start).toFixed(6)), 1);
    }
    assert.ok(windows[0].start < 5 && windows[2].end > 16);
});

test('mapWithConcurrency preserves order and respects the limit', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (value) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, value));
        active--;
        return value * 10;
    });
    assert.deepEqual(result, [50, 10, 30, 20, 40]);
    assert.equal(peak, 2);
});

test('stickerFilter fits the video in a transparent 512x512 canvas', () => {
    const filter = stickerFilter(12);
    assert.match(filter, /^fps=12,/);
    assert.match(filter, /scale=512:512:force_original_aspect_ratio=decrease/);
    assert.match(filter, /pad=512:512:\(ow-iw\)\/2:\(oh-ih\)\/2:color=0x00000000/);
});
