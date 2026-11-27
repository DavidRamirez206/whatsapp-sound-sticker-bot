'use strict';

/**
 * Regression tests for silent failures: every command must end with a sticker,
 * a reply explaining the problem, or a logged skip; a broken or hung job must
 * not block the following ones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, classifyMessage, messageAgeSeconds, createSeenSet, runJob, createBot } = require('../../src/bot');
const { clipDuration } = require('../../src/handlers');
const { UserError } = require('../../src/errors');
const { waitUntil, sleep } = require('../helpers/fake-baileys');

const baseConfig = {
    command: '!a', testCommand: '!t', debug: false, maxMessageAgeSeconds: 600,
    maxParallelJobs: 2, jobTimeoutMs: 1000, notifyErrors: true
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
let nextId = 0;
const videoMessage = ({ caption = '!a', ageSeconds = 1, id = `ID${++nextId}` } = {}) => ({
    key: { id, remoteJid: 'chat@s.whatsapp.net', fromMe: false },
    messageTimestamp: nowSeconds() - ageSeconds,
    message: { videoMessage: { caption, seconds: 5 } }
});

let logs;
test.beforeEach(() => {
    logs = [];
    test.mock.method(console, 'log', (line) => logs.push(String(line)));
});
test.afterEach(() => test.mock.restoreAll());

/** Builds a bot over a fake connection and records replies and handler calls. */
function makeBot({ config = {}, sticker } = {}) {
    let onMessages;
    const replies = [];
    const handled = [];
    const connection = { start: async () => {}, stop: () => {} };
    const bot = createBot({ ...baseConfig, ...config }, {
        connectionFactory: (options) => { onMessages = options.onMessages; return connection; },
        handlers: {
            sticker: sticker || (async (context, message) => { handled.push(message.key.id); }),
            test: async () => {}
        },
        reply: async (conn, chat, text) => { replies.push(text); }
    });
    const deliver = (...messages) => onMessages({ messages, type: 'notify' }, {});
    return { bot, deliver, replies, handled };
}

test('parseCommand recognises the sticker command case-insensitively', () => {
    const command = parseCommand(videoMessage({ caption: '  !A ' }), baseConfig);
    assert.equal(command.kind, 'sticker');
    assert.equal(command.video.seconds, 5);
});

test('parseCommand accepts videos sent as documents with a caption', () => {
    const message = { message: { documentWithCaptionMessage: { message: { videoMessage: { caption: '!a' } } } } };
    assert.equal(parseCommand(message, baseConfig).kind, 'sticker');
});

test('parseCommand ignores other messages', () => {
    assert.equal(parseCommand(videoMessage({ caption: 'hello' }), baseConfig), null);
    assert.equal(parseCommand({ message: { videoMessage: {} } }, baseConfig), null);
    assert.equal(parseCommand({ message: { conversation: '!a' } }, baseConfig), null);
    assert.equal(parseCommand({ message: null }, baseConfig), null);
});

test('the test command only works in debug mode', () => {
    assert.equal(parseCommand(videoMessage({ caption: '!t' }), baseConfig), null);
    assert.equal(parseCommand(videoMessage({ caption: '!t' }), { ...baseConfig, debug: true }).kind, 'test');
});

test('messageAgeSeconds handles numbers, Long values and missing timestamps', () => {
    const now = 1_000_000_000;
    assert.equal(messageAgeSeconds({ messageTimestamp: now / 1000 - 30 }, now), 30);
    assert.equal(messageAgeSeconds({ messageTimestamp: { toNumber: () => now / 1000 - 45 } }, now), 45);
    assert.equal(messageAgeSeconds({}, now), null);
    assert.equal(messageAgeSeconds({ messageTimestamp: 'garbage' }, now), null);
});

test('commands delivered after a short outage are still processed', () => {
    const fiveMinutesLate = videoMessage({ ageSeconds: 300 });
    assert.equal(classifyMessage(fiveMinutesLate, baseConfig).action, 'process');
});

test('very old commands are skipped, not silently dropped', () => {
    const result = classifyMessage(videoMessage({ ageSeconds: 3600 }), baseConfig);
    assert.equal(result.action, 'skip');
    assert.ok(result.ageSeconds >= 3600);
});

test('clock differences and missing timestamps never hide a command', () => {
    assert.equal(classifyMessage(videoMessage({ ageSeconds: -600 }), baseConfig).action, 'process', 'timestamp in the future');
    const noTimestamp = { ...videoMessage(), messageTimestamp: undefined };
    assert.equal(classifyMessage(noTimestamp, baseConfig).action, 'process');
    assert.equal(classifyMessage(videoMessage({ caption: 'hi' }), baseConfig).action, 'ignore');
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

test('runJob reports success', async () => {
    const replies = [];
    const result = await runJob({ connection: {}, config: baseConfig, reply: async (c, chat, text) => replies.push(text) },
        async () => {}, videoMessage(), { kind: 'sticker', video: {} });
    assert.equal(result, 'done');
    assert.deepEqual(replies, []);
});

test('runJob logs a failure and tells the chat', async () => {
    const replies = [];
    const result = await runJob({ connection: {}, config: baseConfig, reply: async (c, chat, text) => replies.push(text) },
        async () => { throw Object.assign(new Error('ffmpeg exploded'), { step: 'convert (ffmpeg)' }); },
        videoMessage(), { kind: 'sticker', video: {} });
    assert.equal(result, 'failed');
    assert.equal(replies.length, 1);
    assert.match(replies[0], /could not make that sticker/);
    assert.ok(logs.some((line) => /convert \(ffmpeg\).*ffmpeg exploded/.test(line)), 'the real cause is in the log');
});

test('runJob always explains request problems, even with NOTIFY_ERRORS=0', async () => {
    const replies = [];
    const result = await runJob(
        { connection: {}, config: { ...baseConfig, notifyErrors: false }, reply: async (c, chat, text) => replies.push(text) },
        async () => { throw new UserError('That video has no audio.'); }, videoMessage(), { kind: 'sticker', video: {} });
    assert.equal(result, 'rejected');
    assert.deepEqual(replies, ['That video has no audio.']);
});

test('runJob stops waiting for a hung job and reports it', async () => {
    const replies = [];
    const startedAt = Date.now();
    const result = await runJob(
        { connection: {}, config: { ...baseConfig, jobTimeoutMs: 30 }, reply: async (c, chat, text) => replies.push(text) },
        () => new Promise(() => {}), videoMessage(), { kind: 'sticker', video: {} });
    assert.equal(result, 'failed');
    assert.ok(Date.now() - startedAt < 500);
    assert.match(replies[0], /took too long/);
});

test('runJob never throws, even if the error reply cannot be sent', async () => {
    const result = await runJob(
        { connection: {}, config: baseConfig, reply: async () => { throw new Error('Connection Closed'); } },
        async () => { throw new Error('boom'); }, videoMessage(), { kind: 'sticker', video: {} });
    assert.equal(result, 'failed');
    assert.ok(logs.some((line) => /could not send a message/.test(line)));
});

test('a command is processed once even if WhatsApp delivers it twice', async () => {
    const { bot, deliver, handled } = makeBot();
    const message = videoMessage();
    deliver(message);
    deliver(message);
    await bot.settle();
    assert.deepEqual(handled, [message.key.id]);
});

test('an old command is logged and the chat is asked to send it again', async () => {
    const { bot, deliver, handled, replies } = makeBot();
    deliver(videoMessage({ ageSeconds: 7200 }));
    await bot.settle();
    assert.deepEqual(handled, []);
    assert.match(replies[0], /offline/);
    assert.ok(logs.some((line) => /\[SKIP\]/.test(line)));
});

test('a failing job does not stop the next commands', async () => {
    let calls = 0;
    const { bot, deliver, replies } = makeBot({
        sticker: async () => { calls++; if (calls === 1) throw new Error('first one breaks'); }
    });
    deliver(videoMessage());
    deliver(videoMessage());
    await bot.settle();
    assert.equal(calls, 2);
    assert.equal(replies.length, 1, 'only the failed one gets an error reply');
});

test('hung jobs free their queue slot so later commands still run', async () => {
    const done = [];
    const { bot, deliver } = makeBot({
        config: { maxParallelJobs: 1, jobTimeoutMs: 30 },
        sticker: async (context, message) => {
            if (message.key.id === 'hang') return new Promise(() => {});
            done.push(message.key.id);
        }
    });
    deliver(videoMessage({ id: 'hang' }), videoMessage({ id: 'after' }));
    await waitUntil(() => done.includes('after'), 1000);
    await bot.settle();
});

test('malformed messages are ignored without breaking the batch', async () => {
    const { bot, deliver, handled } = makeBot();
    const good = videoMessage();
    deliver(null, { message: {} }, { key: { id: 'x' }, message: { videoMessage: null } }, good);
    await bot.settle();
    await sleep(5);
    assert.deepEqual(handled, [good.key.id]);
});
