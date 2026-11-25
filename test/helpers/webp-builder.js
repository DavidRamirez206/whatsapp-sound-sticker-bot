'use strict';

/**
 * Builds minimal WebP containers in memory so the parser can be tested
 * without real image data.
 */

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/**
 * @param {{ width: number, height: number, animated?: boolean, frameDurations?: number[] }} options
 * @returns {Buffer}
 */
function buildWebp({ width, height, animated = true, frameDurations = [] }) {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = animated ? 0x02 : 0;
    vp8x.writeUIntLE(width - 1, 4, 3);
    vp8x.writeUIntLE(height - 1, 7, 3);

    const frames = frameDurations.map((duration) => {
        const anmf = Buffer.alloc(16);
        anmf.writeUIntLE(width - 1, 6, 3);
        anmf.writeUIntLE(height - 1, 9, 3);
        anmf.writeUIntLE(duration, 12, 3);
        return chunk('ANMF', anmf);
    });

    const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunk('VP8X', vp8x), ...frames]);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(body.length, 4);
    return Buffer.concat([riff, body]);
}

module.exports = { buildWebp };
