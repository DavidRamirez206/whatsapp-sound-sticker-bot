'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UserError, userMessageFor } = require('../../src/errors');
const { StepTimeoutError } = require('../../src/retry');

test('request problems are shown to the person as written', () => {
    assert.equal(userMessageFor(new UserError('That video has no audio.')), 'That video has no audio.');
});

test('timeouts, network problems and bugs get distinct explanations without internals', () => {
    assert.match(userMessageFor(new StepTimeoutError('convert', 1000)), /took too long/);
    assert.match(userMessageFor(new Error('fetch failed')), /connection problem/);
    const bug = userMessageFor(new TypeError("Cannot read properties of undefined (reading 'url')"));
    assert.match(bug, /could not make that sticker/);
    assert.doesNotMatch(bug, /undefined/);
});
