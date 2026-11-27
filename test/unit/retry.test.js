'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runStep, isNetworkError, errorCause, describeError, withTimeout, StepTimeoutError } = require('../../src/retry');

const noSleep = async () => {};
const networkError = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT', name: 'Error', message: 'timeout' } });

test.beforeEach(() => test.mock.method(console, 'log', () => {}));
test.afterEach(() => test.mock.restoreAll());

test('errorCause and describeError expose the nested network reason', () => {
    const error = networkError();
    assert.equal(errorCause(error), 'ETIMEDOUT timeout');
    assert.equal(describeError(error), 'fetch failed | cause: ETIMEDOUT timeout');
    assert.equal(errorCause(new Error('plain')), '');
});

test('isNetworkError recognises transient failures only', () => {
    assert.equal(isNetworkError(networkError()), true);
    assert.equal(isNetworkError(new Error('read ECONNRESET')), true);
    assert.equal(isNetworkError(new Error('Invalid data found when processing input')), false);
});

test('runStep returns the result of a successful step', async () => {
    assert.equal(await runStep('ok', async () => 42), 42);
});

test('runStep retries network errors and succeeds', async () => {
    let calls = 0;
    const result = await runStep('flaky', async () => {
        calls++;
        if (calls < 3) throw networkError();
        return 'done';
    }, { retries: 2, sleep: noSleep });
    assert.equal(result, 'done');
    assert.equal(calls, 3);
});

test('runStep does not retry other errors and tags them with the step name', async () => {
    let calls = 0;
    await assert.rejects(
        runStep('convert', async () => { calls++; throw new Error('bad input'); }, { retries: 3, sleep: noSleep }),
        (error) => error.step === 'convert' && error.message === 'bad input'
    );
    assert.equal(calls, 1);
});

test('runStep gives up after the configured retries', async () => {
    let calls = 0;
    await assert.rejects(runStep('upload', async () => { calls++; throw networkError(); }, { retries: 1, sleep: noSleep }));
    assert.equal(calls, 2);
});

test('withTimeout rejects a promise that never settles', async () => {
    await assert.rejects(withTimeout(new Promise(() => {}), 20, 'upload'), (error) =>
        error instanceof StepTimeoutError && /upload timed out/.test(error.message));
    assert.equal(await withTimeout(Promise.resolve(7), 20, 'x'), 7);
    assert.equal(await withTimeout(Promise.resolve(8), 0, 'x'), 8, '0 disables the limit');
});

test('runStep retries a step that timed out', async () => {
    let calls = 0;
    const result = await runStep('download', () => {
        calls++;
        return calls === 1 ? new Promise(() => {}) : Promise.resolve('ok');
    }, { retries: 1, timeoutMs: 20, sleep: noSleep });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
});

test('a dropped WhatsApp connection counts as a transient error', () => {
    assert.equal(isNetworkError(new Error('Connection Closed')), true);
    assert.equal(isNetworkError(Object.assign(new Error('x'), { output: { statusCode: 428 } })), true);
    assert.equal(isNetworkError(new StepTimeoutError('x', 10)), true);
});
