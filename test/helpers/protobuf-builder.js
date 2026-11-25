'use strict';

/**
 * Tiny protobuf writer used to build raw messages in tests.
 */

/** Encodes a non-negative integer as a protobuf varint. */
function varint(value) {
    const bytes = [];
    let v = BigInt(value);
    do {
        let byte = Number(v & 0x7fn);
        v >>= 7n;
        if (v > 0n) byte |= 0x80;
        bytes.push(byte);
    } while (v > 0n);
    return Buffer.from(bytes);
}

const tag = (field, wire) => varint((field << 3) | wire);
const bytesField = (field, payload) => Buffer.concat([tag(field, 2), varint(payload.length), payload]);
const varintField = (field, value) => Buffer.concat([tag(field, 0), varint(value)]);

module.exports = { varint, tag, bytesField, varintField };
