'use strict';

/**
 * Video -> animated WebP sticker (512x512, transparent padding, under 500 KB).
 *
 * The output size is dominated by one trade-off: frames per second versus
 * per-frame quality. Measurements on real clips show that the size of a WebP
 * animation grows linearly with its frame count, and that the cost of a single
 * frame barely depends on the frame rate. That makes the final size predictable
 * from a tiny sample:
 *
 *   1. Cut a short sample (three 1-second windows spread across the clip).
 *   2. Encode the sample once per quality level, in parallel, and measure the
 *      average bytes per frame for each quality.
 *   3. Pick the highest frame rate that still leaves a decent quality inside the
 *      size budget (see {@link planEncoding}), capped by `maxFrames` so long
 *      stickers do not stutter on phones.
 *   4. Encode the full clip once; if it is still too heavy, step down quality
 *      or frame rate and try again.
 *
 * Short clips (<= 6 s) are first tried with a single high quality encode,
 * which is almost always under the limit.
 */

const fs = require('node:fs');
const os = require('node:os');
const { runFfmpeg } = require('./ffmpeg');
const { parseWebp } = require('./webp');

const STICKER_SIZE = 512;
const SHORT_CLIP_SECONDS = 6;
const DIRECT_ENCODE = Object.freeze({ fps: 15, quality: 50 });

/** Frame rates considered for long clips, best first. */
const FPS_LADDER = Object.freeze([15, 12, 10, 8, 6, 5]);
/** libwebp quality levels (0-100) sampled for long clips, best first. */
const QUALITY_LADDER = Object.freeze([75, 60, 45, 30, 20, 12, 6, 2]);
/**
 * Minimum acceptable quality, relaxed in order. The planner first looks for the
 * highest fps that fits with quality >= 30, then >= 12, then anything.
 */
const QUALITY_FLOORS = Object.freeze([30, 12, 0]);

/**
 * libwebp effort (0-6). Level 4 produces files within ~2 % of level 6 while
 * being about 15x faster on animated output, so it is used for every encode.
 */
const COMPRESSION_LEVEL = 4;

/** Fraction of the 500 KB limit targeted by the prediction (leaves room for estimation error). */
const BUDGET_RATIO = 0.9;
const MAX_FULL_ENCODES = 4;
const SAMPLE = Object.freeze({ windows: 3, windowSeconds: 1, fps: 10 });

/**
 * FFmpeg filter chain: resample to `fps`, fit inside 512x512 keeping the aspect
 * ratio and centre the picture on a transparent 512x512 canvas.
 *
 * @param {number} fps
 * @returns {string}
 */
function stickerFilter(fps) {
    return `fps=${fps},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,` +
        `format=rgba,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
}

/**
 * Encodes `input` (first `duration` seconds) as an animated, looping WebP.
 *
 * @param {string} input
 * @param {string} output
 * @param {{ fps: number, quality: number, duration?: number }} params
 * @returns {Promise<number>} Output size in bytes.
 */
async function encodeWebp(input, output, { fps, quality, duration }) {
    await runFfmpeg([
        ...(duration ? ['-t', duration.toFixed(3)] : []), '-i', input,
        '-an', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', String(quality),
        '-compression_level', String(COMPRESSION_LEVEL),
        '-vf', stickerFilter(fps), '-loop', '0', output
    ]);
    return fs.statSync(output).size;
}

/**
 * Evenly spread, non-trivial sample windows. Clips shorter than the total
 * sample length are sampled whole.
 *
 * @param {number} duration Clip length in seconds.
 * @param {number} [count]
 * @param {number} [windowSeconds]
 * @returns {{ start: number, end: number }[]}
 */
function sampleWindows(duration, count = SAMPLE.windows, windowSeconds = SAMPLE.windowSeconds) {
    if (duration <= count * windowSeconds) return [{ start: 0, end: duration }];
    return Array.from({ length: count }, (_, i) => {
        const start = ((duration - windowSeconds) * (i + 0.5)) / count;
        return { start, end: start + windowSeconds };
    });
}

/**
 * Runs `fn` over `items` with at most `limit` promises in flight.
 *
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>} Results in input order.
 */
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
}

/**
 * Measures the average WebP cost of one frame at every quality of
 * {@link QUALITY_LADDER}, using a short lossless sample of the clip.
 *
 * @param {string} input
 * @param {string} output Final sticker path (temporary files are created next to it).
 * @param {number} duration
 * @returns {Promise<Record<number, number>>} quality -> bytes per frame
 */
async function measureBytesPerFrame(input, output, duration) {
    const sample = `${output}.sample.mkv`;
    const windows = sampleWindows(duration)
        .map(({ start, end }) => `between(t,${start.toFixed(3)},${end.toFixed(3)})`).join('+');
    try {
        await runFfmpeg([
            '-t', duration.toFixed(3), '-i', input, '-an',
            '-vf', `fps=${SAMPLE.fps},select='${windows}',setpts=N/(${SAMPLE.fps}*TB),` +
                `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease`,
            '-c:v', 'ffv1', sample
        ]);

        const limit = Math.max(1, os.availableParallelism ? os.availableParallelism() : os.cpus().length);
        const measurements = await mapWithConcurrency(QUALITY_LADDER, limit, async (quality) => {
            const file = `${output}.q${quality}.webp`;
            try {
                const bytes = await encodeWebp(sample, file, { fps: SAMPLE.fps, quality });
                const info = parseWebp(fs.readFileSync(file));
                return [quality, bytes / Math.max(1, info ? info.frames : 1)];
            } finally {
                fs.rmSync(file, { force: true });
            }
        });
        return Object.fromEntries(measurements);
    } finally {
        fs.rmSync(sample, { force: true });
    }
}

/**
 * @typedef {object} EncodingPlan
 * @property {number} fps
 * @property {number} quality
 * @property {number} predictedBytes
 * @property {boolean} fitsBudget Whether the prediction is under the budget.
 */

/**
 * Chooses frame rate and quality for a clip from measured per-frame costs.
 *
 * Frame rates allowed by `maxFrames` are tried from highest to lowest, first
 * requiring quality >= 30, then >= 12, then anything (see {@link QUALITY_FLOORS}).
 * The first combination whose predicted size fits the budget wins; within a
 * frame rate the highest fitting quality is used. Pure function.
 *
 * @param {object} input
 * @param {number} input.duration Clip length in seconds.
 * @param {Record<number, number>} input.bytesPerFrame quality -> average bytes per frame.
 * @param {number} input.budgetBytes Target size.
 * @param {number} input.maxFrames Upper bound for `fps * duration`.
 * @returns {EncodingPlan}
 */
function planEncoding({ duration, bytesPerFrame, budgetBytes, maxFrames }) {
    const allowedFps = FPS_LADDER.filter((fps) => fps * duration <= maxFrames);
    const fpsOptions = allowedFps.length ? allowedFps : [FPS_LADDER[FPS_LADDER.length - 1]];
    const qualities = QUALITY_LADDER.filter((q) => Number.isFinite(bytesPerFrame[q]));
    const predict = (fps, quality) => Math.round(bytesPerFrame[quality] * fps * duration);

    for (const floor of QUALITY_FLOORS) {
        for (const fps of fpsOptions) {
            for (const quality of qualities) {
                if (quality < floor) break;
                const predictedBytes = predict(fps, quality);
                if (predictedBytes <= budgetBytes) return { fps, quality, predictedBytes, fitsBudget: true };
            }
        }
    }

    const fps = fpsOptions[fpsOptions.length - 1];
    const quality = qualities[qualities.length - 1] ?? QUALITY_LADDER[QUALITY_LADDER.length - 1];
    return { fps, quality, predictedBytes: predict(fps, quality), fitsBudget: false };
}

/**
 * Next, lighter setting to try after an encode came out too big: lower the
 * quality while it is still above 12, then lower the frame rate, then squeeze
 * the quality to the bottom. Returns `null` when nothing lighter is left.
 *
 * @param {{ fps: number, quality: number }} current
 * @returns {{ fps: number, quality: number } | null}
 */
function lighterSetting({ fps, quality }) {
    const lowerQuality = QUALITY_LADDER.find((q) => q < quality);
    const lowerFps = FPS_LADDER.find((f) => f < fps);
    if (lowerQuality !== undefined && quality > 12) return { fps, quality: lowerQuality };
    if (lowerFps !== undefined) return { fps: lowerFps, quality };
    if (lowerQuality !== undefined) return { fps, quality: lowerQuality };
    return null;
}

/**
 * @typedef {object} StickerResult
 * @property {number} fps
 * @property {number} quality
 * @property {number} bytes
 * @property {number} encodes Number of full-length encodes performed.
 * @property {'direct' | 'planned'} strategy
 * @property {boolean} oversized True if even the lightest attempt exceeds `maxBytes`.
 */

/**
 * Converts the first `duration` seconds of `input` into a WhatsApp animated sticker.
 *
 * @param {string} input Source video.
 * @param {string} output Destination `.webp`.
 * @param {number} duration Seconds to keep.
 * @param {{ maxBytes: number, maxFrames: number }} limits
 * @returns {Promise<StickerResult>}
 */
async function convertToSticker(input, output, duration, { maxBytes, maxFrames }) {
    let encodes = 0;

    if (duration <= SHORT_CLIP_SECONDS && DIRECT_ENCODE.fps * duration <= maxFrames) {
        encodes++;
        const bytes = await encodeWebp(input, output, { ...DIRECT_ENCODE, duration });
        if (bytes <= maxBytes) return { ...DIRECT_ENCODE, bytes, encodes, strategy: 'direct', oversized: false };
    }

    const bytesPerFrame = await measureBytesPerFrame(input, output, duration);
    /** @type {{ fps: number, quality: number } | null} */
    let setting = planEncoding({ duration, bytesPerFrame, budgetBytes: maxBytes * BUDGET_RATIO, maxFrames });
    let last = { fps: setting.fps, quality: setting.quality, bytes: Infinity };

    while (setting && encodes < MAX_FULL_ENCODES + 1) {
        encodes++;
        const bytes = await encodeWebp(input, output, { ...setting, duration });
        last = { fps: setting.fps, quality: setting.quality, bytes };
        if (bytes <= maxBytes) return { ...last, encodes, strategy: 'planned', oversized: false };
        setting = lighterSetting(setting);
    }
    return { ...last, encodes, strategy: 'planned', oversized: true };
}

module.exports = {
    STICKER_SIZE, FPS_LADDER, QUALITY_LADDER, QUALITY_FLOORS, COMPRESSION_LEVEL,
    stickerFilter, encodeWebp, sampleWindows, mapWithConcurrency,
    measureBytesPerFrame, planEncoding, lighterSetting, convertToSticker
};
