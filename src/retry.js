'use strict';

/**
 * Helpers to run a named pipeline step, time it, bound it with a timeout and
 * retry it when the failure is transient: network errors, a WhatsApp connection
 * that dropped in the middle of an operation, or a step that took too long.
 */

const { log } = require('./logger');

const NETWORK_ERROR = new RegExp([
    'fetch failed', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH',
    'EPIPE', 'UND_ERR', 'socket', 'timed out', 'Connection Closed', 'Connection Terminated', 'not connected'
].join('|'), 'i');

/** Boom status codes Baileys uses for a lost connection or an unavailable service. */
const TRANSIENT_STATUS = new Set([408, 428, 503]);

/** Raised when a step exceeds its time limit. Considered transient. */
class StepTimeoutError extends Error {
    /**
     * @param {string} name
     * @param {number} ms
     */
    constructor(name, ms) {
        super(`${name} timed out after ${Math.round(ms / 1000)}s`);
        this.name = 'StepTimeoutError';
        this.code = 'ETIMEDOUT';
    }
}

/**
 * Node's `fetch` wraps the real network error inside `error.cause`.
 * This returns that inner reason (code, name and message) as one string.
 *
 * @param {unknown} error
 * @returns {string} Empty string when there is no cause.
 */
function errorCause(error) {
    const cause = error && /** @type {any} */ (error).cause;
    if (!cause) return '';
    return [cause.code, cause.name !== 'Error' ? cause.name : '', cause.message].filter(Boolean).join(' ');
}

/**
 * @param {unknown} error
 * @returns {string} Error message plus its cause, if any.
 */
function describeError(error) {
    const cause = errorCause(error);
    const message = error instanceof Error ? error.message : String(error);
    return cause ? `${message} | cause: ${cause}` : message;
}

/**
 * @param {unknown} error
 * @returns {boolean} Whether the failure looks transient (network related).
 */
function isNetworkError(error) {
    const status = error && /** @type {any} */ (error).output && /** @type {any} */ (error).output.statusCode;
    return TRANSIENT_STATUS.has(status) || NETWORK_ERROR.test(describeError(error));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rejects with {@link StepTimeoutError} if `promise` does not settle within `ms`.
 * The underlying operation is not cancelled (most library calls cannot be), but
 * the caller stops waiting for it, so one hung request cannot block the bot.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms `0` or less disables the limit.
 * @param {string} name Used in the error message.
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, name) {
    if (!(ms > 0)) return promise;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(name, ms)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs `fn`, logs its duration and retries it with a linear back-off when it
 * fails with a transient error (see {@link isNetworkError}) or times out. Any
 * other error is rethrown immediately. The thrown error gets a `step` property
 * with the step name so the caller can report where the pipeline broke.
 *
 * @template T
 * @param {string} name Human readable step name.
 * @param {() => Promise<T>} fn Work to run.
 * @param {object} [options]
 * @param {number} [options.retries] Extra attempts after the first one.
 * @param {number} [options.delayMs] Base back-off; attempt n waits `delayMs * n`.
 * @param {number} [options.timeoutMs] Time limit per attempt, `0` for none.
 * @param {(ms: number) => Promise<void>} [options.sleep] Injectable for tests.
 * @returns {Promise<T>}
 */
async function runStep(name, fn, { retries = 0, delayMs = 1500, timeoutMs = 0, sleep = wait } = {}) {
    for (let attempt = 0; ; attempt++) {
        const startedAt = Date.now();
        try {
            const result = await withTimeout(Promise.resolve().then(fn), timeoutMs, name);
            log('STEP', `${name} ok (${Date.now() - startedAt}ms)`);
            return result;
        } catch (error) {
            log('ERR', `${name} failed (attempt ${attempt + 1}/${retries + 1}): ${describeError(error)}`);
            if (!isNetworkError(error) || attempt >= retries) {
                if (error && typeof error === 'object') /** @type {any} */ (error).step = name;
                throw error;
            }
            await sleep(delayMs * (attempt + 1));
        }
    }
}

module.exports = { StepTimeoutError, errorCause, describeError, isNetworkError, withTimeout, runStep };
