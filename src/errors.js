'use strict';

/**
 * Error types and the short explanations sent back to the chat when a
 * command fails, so the person never waits for a sticker that will not come.
 */

const { StepTimeoutError, isNetworkError } = require('./retry');

/**
 * A problem with the request itself (e.g. a video without audio). Its message
 * is written for the person who sent the command and is shown to them as is.
 */
class UserError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'UserError';
    }
}

/**
 * Text sent to the chat for a failed command. Internal details stay in the
 * console log; the chat only gets an actionable sentence. Pure function.
 *
 * @param {unknown} error
 * @returns {string}
 */
function userMessageFor(error) {
    if (error instanceof UserError) return error.message;
    if (error instanceof StepTimeoutError) {
        return 'Sorry, that took too long and was cancelled. Try again, or with a shorter video.';
    }
    if (isNetworkError(error)) {
        return 'Sorry, there was a connection problem with WhatsApp. Please send the video again in a minute.';
    }
    return 'Sorry, I could not make that sticker. Please try again with another video.';
}

module.exports = { UserError, userMessageFor };
