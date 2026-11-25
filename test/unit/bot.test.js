'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, isFresh, createSeenSet } = require('../../src/bot');
const { clipDuration } = require('../../src/handlers');

const config = { command: '!a', testCommand: '!t', debug: false };
const videoWith = (caption) => ({ key: { id: '1' }, message: { videoMessage: { caption, seconds: 5 } } });

test('parseCommand recognises the sticker command case-insensitively', () => {
    const command = parseCommand(videoWith('  !A '), config);
    assert.equal(command.kind, 'sticker');
    assert.equal(command.video.seconds, 5);
});

test('parseCommand accepts videos sent as documents with a caption', () => {
    const message = { message: { documentWithCaptionMessage: { message: { videoMessage: { caption: '!a' } } } } };
    assert.equal(parseCommand(message, config).kind, 'sticker');
});

test('parseCommand ignores other messages', () => {
    assert.equal(parseCommand(videoWith('hello'), config), null);
    assert.equal(parseCommand(videoWith(undefined), config), null);
    assert.equal(parseCommand({ message: { conversation: '!a' } }, config), null);
    assert.equal(parseCommand({ message: null }, config), null);
});

test('the test command only works in debug mode', () => {
    assert.equal(parseCommand(videoWith('!t'), config), null);
    assert.equal(parseCommand(videoWith('!t'), { ...config, debug: true }).kind, 'test');
});

test('isFresh discards replayed history', () => {
    const now = 1_000_000_000;
    assert.equal(isFresh({ messageTimestamp: now / 1000 - 30 }, 120, now), true);
    assert.equal(isFresh({ messageTimestamp: now / 1000 - 300 }, 120, now), false);
    assert.equal(isFresh({}, 120, now), false);
});

test('createSeenSet detects duplicates and forgets the oldest ids', () => {
    const seen = createSeenSet(2);
    assert.equal(seen.add('a'), true);
    assert.equal(seen.add('a'), false);
    seen.add('b');
    seen.add('c');
    assert.equal(seen.add('a'), true, '"a" was evicted and counts as new again');
});

test('clipDuration uses the real length capped at the maximum', () => {
    assert.equal(clipDuration(8.4, 9, 25), 8.4);
    assert.equal(clipDuration(120, 120, 25), 25);
    assert.equal(clipDuration(null, 7, 25), 7);
    assert.equal(clipDuration(null, undefined, 25), 25);
});
