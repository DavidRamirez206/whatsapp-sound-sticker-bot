'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig, parseNumber, parseFlag, MAX_STICKER_BYTES } = require('../../src/config');

test('parseNumber falls back on missing or invalid values and clamps to limits', () => {
    assert.equal(parseNumber(undefined, 7), 7);
    assert.equal(parseNumber('', 7), 7);
    assert.equal(parseNumber('abc', 7), 7);
    assert.equal(parseNumber('12', 7), 12);
    assert.equal(parseNumber('0', 7), 0);
    assert.equal(parseNumber('500', 7, { max: 60 }), 60);
    assert.equal(parseNumber('-3', 7, { min: 1 }), 1);
});

test('parseFlag understands common boolean spellings', () => {
    for (const value of ['1', 'true', 'YES', ' on ']) assert.equal(parseFlag(value, false), true);
    for (const value of ['0', 'false', 'No', 'off']) assert.equal(parseFlag(value, true), false);
    assert.equal(parseFlag(undefined, true), true);
    assert.equal(parseFlag('maybe', false), false);
});

test('loadConfig provides safe defaults', () => {
    const config = loadConfig({}, '/bot');
    assert.equal(config.command, '!a');
    assert.equal(config.maxSeconds, 25);
    assert.equal(config.maxStickerBytes, MAX_STICKER_BYTES);
    assert.equal(config.saveOutputs, false, 'received videos must not be kept on disk by default');
    assert.equal(config.debug, false);
    assert.equal(config.verifyUpload, false);
    assert.equal(config.maxMessageAgeSeconds, 600, 'commands sent during a short outage are still answered');
    assert.equal(config.jobTimeoutMs, 300_000);
    assert.equal(config.ffmpegTimeoutMs, 180_000);
    assert.equal(config.notifyErrors, true, 'failures are reported to the chat by default');
    assert.equal(config.sessionDir, path.resolve('/bot', 'whatsapp_session'));
    assert.ok(Object.isFrozen(config));
});

test('loadConfig reads overrides from the environment', () => {
    const config = loadConfig({
        COMMAND: ' !S ', MAX_SECONDS: '10', AUDIO_LEAD_MS: '0', SAVE_OUTPUTS: '1',
        DEBUG: 'true', PAIRING_NUMBER: '+57 300 123-4567', SESSION_DIR: 'my_session'
    }, '/bot');
    assert.equal(config.command, '!s');
    assert.equal(config.maxSeconds, 10);
    assert.equal(config.audioLeadMs, 0);
    assert.equal(config.saveOutputs, true);
    assert.equal(config.debug, true);
    assert.equal(config.verifyUpload, true, 'debug mode enables upload verification unless disabled');
    assert.equal(config.pairingNumber, '573001234567');
    assert.equal(config.sessionDir, path.resolve('/bot', 'my_session'));
});

test('session lock is on by default and the health file is optional', () => {
    const config = loadConfig({}, '/work');
    assert.equal(config.sessionLock, true);
    assert.equal(config.healthFile, null);
    const custom = loadConfig({ SESSION_LOCK: '0', HEALTH_FILE: 'state/health.json' }, '/work');
    assert.equal(custom.sessionLock, false);
    assert.equal(custom.healthFile, require('node:path').resolve('/work', 'state/health.json'));
});
