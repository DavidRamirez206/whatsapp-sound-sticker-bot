'use strict';

/**
 * End-to-end media pipeline with real FFmpeg: synthetic videos are converted
 * into stickers and audio and checked against WhatsApp's constraints.
 * Skipped automatically when FFmpeg is not installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runFfmpeg, assertFfmpegReady } = require('../../src/media/ffmpeg');
const { probeVideo, inspectAudio } = require('../../src/media/probe');
const { convertToSticker } = require('../../src/media/sticker');
const { extractAudio, computeWaveform } = require('../../src/media/audio');
const { parseWebp } = require('../../src/media/webp');
const { collectWarnings } = require('../../src/media/validate');

const MAX_BYTES = 500 * 1024;
let ffmpegError = null;
let dir;

test.before(async () => {
    try { await assertFfmpegReady(); } catch (error) { ffmpegError = error.message; return; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker-it-'));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

/** Generates a test-pattern video with a sine tone (or no audio). */
async function makeVideo(name, seconds, { audio = true, size = '640x360' } = {}) {
    const file = path.join(dir, name);
    await runFfmpeg([
        '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`,
        ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'aac'] : []),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', file
    ]);
    return file;
}

test('probeVideo reports duration and audio presence', async (t) => {
    if (ffmpegError) return t.skip(ffmpegError);
    const withAudio = await probeVideo(await makeVideo('a.mp4', 2));
    const silent = await probeVideo(await makeVideo('b.mp4', 2, { audio: false }));
    assert.ok(Math.abs(withAudio.duration - 2) < 0.2);
    assert.equal(withAudio.hasAudio, true);
    assert.equal(silent.hasAudio, false);
});

test('a short clip becomes a valid sticker with matching audio', async (t) => {
    if (ffmpegError) return t.skip(ffmpegError);
    const video = await makeVideo('short.mp4', 3);
    const webpPath = path.join(dir, 'short.webp');
    const oggPath = path.join(dir, 'short.ogg');

    const result = await convertToSticker(video, webpPath, 3, { maxBytes: MAX_BYTES, maxFrames: 250 });
    const webp = parseWebp(fs.readFileSync(webpPath));
    await extractAudio(video, oggPath, webp.duration, { kbps: 32, leadMs: 100 });
    const audio = await inspectAudio(oggPath);

    assert.equal(result.strategy, 'direct');
    assert.equal(result.oversized, false);
    assert.deepEqual(collectWarnings({ webp, webpBytes: result.bytes, audio, expectedDuration: webp.duration, maxBytes: MAX_BYTES }), []);
    assert.ok(Math.abs(audio.duration - webp.duration) < 0.05, 'audio and animation must last the same');

    const waveform = await computeWaveform(oggPath);
    assert.equal(waveform.length, 64);
    assert.equal(Math.max(...waveform), 100);
});

test('a long clip is planned under the size limit and the frame cap', async (t) => {
    if (ffmpegError) return t.skip(ffmpegError);
    const video = await makeVideo('long.mp4', 14, { size: '960x540' });
    const webpPath = path.join(dir, 'long.webp');

    const result = await convertToSticker(video, webpPath, 14, { maxBytes: MAX_BYTES, maxFrames: 120 });
    const webp = parseWebp(fs.readFileSync(webpPath));

    assert.equal(result.strategy, 'planned');
    assert.equal(result.oversized, false);
    assert.ok(result.bytes <= MAX_BYTES);
    assert.ok(result.fps * 14 <= 120, `fps ${result.fps} breaks the 120 frame cap`);
    assert.ok(webp.animated);
    assert.ok(Math.abs(webp.duration - 14) < 0.3);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('long.webp.')), [], 'temporary files are removed');
});
