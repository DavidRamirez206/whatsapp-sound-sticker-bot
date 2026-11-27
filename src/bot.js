'use strict';

/**
 * Message routing and job execution.
 *
 * Every command that reaches the bot ends in exactly one visible outcome:
 *
 * - processed: the sticker is sent;
 * - failed: the reason is logged and a short explanation is sent to the chat;
 * - skipped: the command was older than `MAX_MESSAGE_AGE_SECONDS` (for example it
 *   was sent while the bot was offline for a long time); this is logged and the
 *   chat is asked to send it again.
 *
 * Nothing is dropped silently, and one broken message or job can never stop
 * the bot from handling the next ones.
 */

const { normalizeMessageContent } = require('@whiskeysockets/baileys');
const { log, formatKb } = require('./logger');
const { describeError, withTimeout } = require('./retry');
const { createQueue } = require('./queue');
const { UserError, userMessageFor } = require('./errors');
const { handleStickerCommand, handleTestCommand } = require('./handlers');
const { analyzeIncomingSticker } = require('./whatsapp/inspect');
const { createConnection } = require('./whatsapp/connection');
const { sendText } = require('./whatsapp/send');

/** How many processed message ids are remembered to ignore duplicates. */
const SEEN_IDS_LIMIT = 1000;

/**
 * Returns the video payload of a message. WhatsApp wraps the real content in
 * other messages in common situations: chats with disappearing messages
 * (`ephemeralMessage`), view-once media, albums (`associatedChildMessage`) and
 * videos sent as documents; all of them are unwrapped here.
 *
 * @param {any} content `message.message`
 */
function videoOf(content) {
    return normalizeMessageContent(content)?.videoMessage || null;
}

/**
 * Decides whether a message is a bot command: a video whose caption starts with
 * the command word (`!a`, `!A`, `!a whatever`). Pure function.
 *
 * @param {any} message Incoming `WAMessage`.
 * @param {{ command: string, testCommand: string, debug: boolean }} config
 * @returns {{ kind: 'sticker' | 'test', video: any } | null}
 */
function parseCommand(message, config) {
    if (!message || !message.message) return null;
    const video = videoOf(message.message);
    const firstWord = video?.caption?.trim().split(/\s+/)[0].toLowerCase();
    if (!video || !firstWord) return null;
    if (firstWord === config.command) return { kind: 'sticker', video };
    if (config.debug && firstWord === config.testCommand) return { kind: 'test', video };
    return null;
}

/**
 * Seconds since the message was sent, or `null` when it carries no usable
 * timestamp. Accepts numbers and protobuf `Long` values.
 *
 * @param {any} message
 * @param {number} [nowMs]
 * @returns {number | null}
 */
function messageAgeSeconds(message, nowMs = Date.now()) {
    const raw = message && message.messageTimestamp;
    const seconds = raw && typeof raw === 'object' && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return nowMs / 1000 - seconds;
}

/**
 * @typedef {{ action: 'ignore' }
 *   | { action: 'skip', command: { kind: string, video: any }, ageSeconds: number }
 *   | { action: 'process', command: { kind: 'sticker' | 'test', video: any } }} Classification
 */

/**
 * Classifies an incoming message. Pure function.
 *
 * Messages without a usable timestamp, or dated in the future because of clock
 * differences, are processed: answering late is better than staying silent.
 *
 * @param {any} message
 * @param {{ command: string, testCommand: string, debug: boolean, maxMessageAgeSeconds: number }} config
 * @param {number} [nowMs]
 * @returns {Classification}
 */
function classifyMessage(message, config, nowMs = Date.now()) {
    const command = parseCommand(message, config);
    if (!command) return { action: 'ignore' };
    const ageSeconds = messageAgeSeconds(message, nowMs);
    if (ageSeconds !== null && ageSeconds > config.maxMessageAgeSeconds) return { action: 'skip', command, ageSeconds };
    return { action: 'process', command };
}

/**
 * Remembers ids in insertion order, forgetting the oldest beyond `limit`.
 *
 * @param {number} limit
 */
function createSeenSet(limit) {
    const ids = new Set();
    return {
        /** @returns {boolean} `true` the first time an id is seen. */
        add(id) {
            if (ids.has(id)) return false;
            ids.add(id);
            if (ids.size > limit) ids.delete(ids.values().next().value);
            return true;
        }
    };
}

/** @param {number} seconds */
const formatAge = (seconds) => (seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)}s`);

/**
 * Sends `text` to the chat of `message`; failures are logged, never thrown.
 *
 * @param {(connection: any, chat: string, text: string, quoted?: any) => Promise<any>} reply
 */
async function tellChat(reply, connection, message, text) {
    try {
        await reply(connection, message.key.remoteJid, text, message);
    } catch (error) {
        log('ERR', `could not send a message to ${message.key.remoteJid}: ${describeError(error)}`);
    }
}

/**
 * Runs one command handler with a time limit and turns any failure into a log
 * line and, when allowed, a reply. Never throws.
 *
 * @param {object} context
 * @param {any} context.connection
 * @param {ReturnType<typeof import('./config').loadConfig>} context.config
 * @param {(connection: any, chat: string, text: string, quoted?: any) => Promise<any>} [context.reply]
 * @param {(context: any, message: any, video: any) => Promise<void>} handler
 * @param {any} message
 * @param {{ kind: string, video: any }} command
 * @returns {Promise<'done' | 'rejected' | 'failed'>}
 */
async function runJob({ connection, config, reply = sendText }, handler, message, command) {
    const id = message.key.id;
    try {
        await withTimeout(Promise.resolve().then(() => handler({ connection, config }, message, command.video)),
            config.jobTimeoutMs, `${command.kind} job ${id}`);
        return 'done';
    } catch (error) {
        if (error instanceof UserError) {
            log('OUT', `rejected ${id}: ${error.message}`);
            await tellChat(reply, connection, message, error.message);
            return 'rejected';
        }
        log('ERR', `failed processing ${id} at step "${error && error.step ? error.step : '?'}": ${describeError(error)}` +
            `${error && error.stack ? `\n${error.stack}` : ''}`);
        if (config.notifyErrors) await tellChat(reply, connection, message, userMessageFor(error));
        return 'failed';
    }
}

/**
 * Wires the connection, the queue and the handlers together.
 *
 * @param {ReturnType<typeof import('./config').loadConfig>} config
 * @param {object} [dependencies] Injectable for tests.
 * @param {typeof createConnection} [dependencies.connectionFactory]
 * @param {{ sticker: Function, test: Function }} [dependencies.handlers]
 * @param {typeof sendText} [dependencies.reply]
 */
function createBot(config, {
    connectionFactory = createConnection,
    handlers = { sticker: handleStickerCommand, test: handleTestCommand },
    reply = sendText
} = {}) {
    const queue = createQueue(config.maxParallelJobs, {
        onQueued: (pending) => log('QUEUE', `waiting (${pending} pending)`)
    });
    const seen = createSeenSet(SEEN_IDS_LIMIT);
    /** @type {Promise<string>[]} */
    const jobs = [];

    /**
     * Logs recent videos that arrive without the command, so a wrong or missing
     * caption is visible in the console instead of looking like a deaf bot.
     *
     * @param {any} message
     */
    function logIgnoredVideo(message) {
        if (!videoOf(message.message)) return;
        const age = messageAgeSeconds(message);
        if (age !== null && age > config.maxMessageAgeSeconds) return;
        log('IN', `video without the ${config.command} caption ignored | chat=${message.key.remoteJid}`);
    }

    /**
     * Handles one incoming message. Errors stay inside this message.
     *
     * @param {any} message
     * @param {any} sock Socket that delivered it (used by debug tooling only).
     */
    function handleMessage(message, sock) {
        if (!message || !message.message || !message.key) return;

        const sticker = message.message.stickerMessage;
        if (config.debug && sticker && sticker.fileSha256 && sock) {
            analyzeIncomingSticker(sock, message, sticker)
                .catch((error) => log('ERR', `analysing incoming sticker: ${describeError(error)}`));
        }

        const result = classifyMessage(message, config);
        if (result.action === 'ignore') {
            logIgnoredVideo(message);
            return;
        }
        if (!seen.add(message.key.id)) return;

        const sender = message.key.fromMe ? 'me' : (message.key.participant || message.key.remoteJid);
        if (result.action === 'skip') {
            log('SKIP', `${result.command.kind} command ${message.key.id} from ${sender} ignored: sent ` +
                `${formatAge(result.ageSeconds)} ago (limit ${formatAge(config.maxMessageAgeSeconds)})`);
            if (config.notifyErrors) {
                jobs.push(tellChat(reply, connection, message,
                    'I was offline when you sent this video. Please send it again.').then(() => 'skipped'));
            }
            return;
        }

        const { command } = result;
        const { video } = command;
        log('IN', `${command.kind} command | chat=${message.key.remoteJid} | from=${sender} | ` +
            `video=${video.seconds ?? '?'}s ${formatKb(Number(video.fileLength || 0))} ${video.width ?? '?'}x${video.height ?? '?'}`);

        const handler = command.kind === 'test' ? handlers.test : handlers.sticker;
        jobs.push(queue.run(() => runJob({ connection, config, reply }, handler, message, command)));
        if (jobs.length > 100) jobs.splice(0, jobs.length - 100);
    }

    const connection = connectionFactory({
        config,
        onMessages: ({ messages }, sock) => {
            for (const message of messages || []) {
                try {
                    handleMessage(message, sock);
                } catch (error) {
                    log('ERR', `could not handle message ${message?.key?.id ?? '?'}: ${describeError(error)}`);
                }
            }
        }
    });

    return {
        connection,
        queue,
        start: () => connection.start(),
        stop: () => connection.stop(),
        /** Waits for every job started so far (used by tests and shutdown). */
        settle: () => Promise.all(jobs)
    };
}

/**
 * Connects to WhatsApp and starts handling messages.
 *
 * @param {ReturnType<typeof import('./config').loadConfig>} config
 */
async function startBot(config) {
    const bot = createBot(config);
    log('CONFIG', `command ${config.command} | max ${config.maxSeconds}s | max frames ${config.maxFrames} | ` +
        `audio ${config.audioKbps} kbps | lead ${config.audioLeadMs}ms | commands up to ${formatAge(config.maxMessageAgeSeconds)} old | ` +
        `job limit ${config.jobTimeoutMs / 1000}s | save files ${config.saveOutputs ? `yes (${config.outputsDir})` : 'no'} | ` +
        `debug ${config.debug ? 'yes' : 'no'}`);
    if (config.debug) log('CONFIG', `debug: ${config.testCommand} sends audio test variants; incoming sound stickers are analysed.`);
    await bot.start();
    return bot;
}

module.exports = {
    startBot, createBot, runJob, classifyMessage, messageAgeSeconds, parseCommand, createSeenSet, videoOf
};
