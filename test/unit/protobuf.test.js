'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readVarint, parseRawFields, findBytesField, findVarint, describeRawFields } = require('../../src/protobuf');
const { varint, tag, bytesField, varintField } = require('../helpers/protobuf-builder');

test('readVarint decodes single and multi-byte values', () => {
    assert.deepEqual(readVarint(Buffer.from([0x01]), 0), [1n, 1]);
    assert.deepEqual(readVarint(Buffer.from([0xac, 0x02]), 0), [300n, 2]);
    assert.deepEqual(readVarint(varint(2n ** 40n), 0), [2n ** 40n, 6]);
    assert.throws(() => readVarint(Buffer.from([0x80]), 0), /end of buffer/);
});

test('parseRawFields splits varint, fixed and length-delimited fields', () => {
    const fixed32 = Buffer.concat([tag(3, 5), Buffer.alloc(4)]);
    const fixed64 = Buffer.concat([tag(4, 1), Buffer.alloc(8)]);
    const message = Buffer.concat([varintField(1, 150), bytesField(2, Buffer.from('hi')), fixed32, fixed64]);
    const fields = parseRawFields(message);

    assert.deepEqual(fields.map((f) => [f.field, f.type]), [[1, 'varint'], [2, 'bytes'], [3, 'fixed32'], [4, 'fixed64']]);
    assert.equal(findVarint(fields, 1), 150);
    assert.equal(findBytesField(fields, 2).payload.toString(), 'hi');
    assert.equal(findVarint(fields, 9), null);
});

test('parseRawFields rejects truncated or invalid input', () => {
    assert.throws(() => parseRawFields(Buffer.concat([tag(2, 2), varint(10), Buffer.from('short')])), /end of buffer/);
    assert.throws(() => parseRawFields(Buffer.from([0x00])), /field number 0/);
    assert.throws(() => parseRawFields(tag(1, 3)), /wire type 3/);
});

test('describeRawFields prints nested messages and hides urls and binary data', () => {
    const inner = Buffer.concat([varintField(5, 12), bytesField(1, Buffer.from('https://mmg.whatsapp.net/secret'))]);
    const message = Buffer.concat([bytesField(26, inner), bytesField(7, Buffer.from('!a')), bytesField(3, Buffer.from([0xff, 0x00, 0xfe]))]);
    const text = describeRawFields(message);

    assert.match(text, /#26 message\(\d+\) \{/);
    assert.match(text, /  #5 varint = 12/);
    assert.match(text, /<hidden url>/);
    assert.doesNotMatch(text, /secret/);
    assert.match(text, /#7 text\(2\) = "!a"/);
    assert.match(text, /#3 bytes\(3\) <hidden>/);
});
