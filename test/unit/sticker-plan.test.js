'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    planEncoding, lighterSetting, higherQualityThatFits, sampleWindows, mapWithConcurrency, stickerFilter,
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

test('when quality 12 does not fit, keeps the lowest frame rate with the best quality that fits', () => {
    const bytesPerFrame = { 75: 20000, 60: 15000, 45: 12000, 30: 9000, 20: 7000, 12: 6000, 6: 4500, 2: 4000 };
    const plan = planEncoding({ duration: 20, bytesPerFrame, budgetBytes: budget, maxFrames: 1000 });
    assert.equal(plan.fps, 5);
    assert.equal(plan.quality, 6, 'q6 at 5 fps fits, so it must not drop to q2 or raise the frame rate');
    assert.equal(plan.fitsBudget, true);
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

test('higherQualityThatFits proposes the next quality only when its scaled size fits', () => {
    const bytesPerFrame = { 75: 9000, 60: 8000, 45: 7000, 30: 6000, 20: 5000, 12: 4000, 6: 4860, 2: 4180 };
    assert.equal(higherQualityThatFits({ quality: 2, bytes: 429 * 1024 }, bytesPerFrame, 500 * 1024), 6);
    assert.equal(higherQualityThatFits({ quality: 2, bytes: 490 * 1024 }, bytesPerFrame, 500 * 1024), null);
    assert.equal(higherQualityThatFits({ quality: 75, bytes: 100 }, bytesPerFrame, 500 * 1024), null, 'nothing above the top quality');
    assert.equal(higherQualityThatFits({ quality: 2, bytes: 100 }, { 2: 1000 }, 500 * 1024), null, 'needs a measurement for the higher quality');
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
