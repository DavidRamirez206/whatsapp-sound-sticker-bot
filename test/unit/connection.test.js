'use strict';

/**
 * Regression tests for "the bot looks connected but ignores commands":
 * the connection must always come back after a recoverable failure, must not
 * run two sockets at once, and must stop only when a retry cannot help.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnection, planAfterDisconnect, backoffDelay } = require('../../src/whatsapp/connection');
const { StepTimeoutError } = require('../../src/retry');
const { createFakeBaileys, closeWith, openSocket, waitUntil, sleep } = require('../helpers/fake-baileys');

const config = { command: '!a', sessionDir: 'whatsapp_session', pairingNumber: '' };

test.beforeEach(() => {
    test.mock.method(console, 'log', () => {});
    test.mock.method(console, 'clear', () => {});
});
test.afterEach(() => test.mock.restoreAll());

/** Starts a connection over a fake Baileys and returns both. */
async function start(options = {}) {
    const fake = createFakeBaileys(options);
    const received = [];
    const connection = createConnection({
        config: { ...config, ...options.config },
        onMessages: options.onMessages || ((event) => received.push(event)),
        dependencies: fake.dependencies
    });
    await connection.start();
    return { fake, connection, received };
}

test('planAfterDisconnect stops only on unrecoverable codes', () => {
    for (const code of [401, 403, 411, 440]) assert.equal(planAfterDisconnect(code, 's').action, 'stop', `code ${code}`);
    assert.equal(planAfterDisconnect(515, 's').action, 'reconnect-now');
    for (const code of [408, 428, 500, 503, undefined]) assert.equal(planAfterDisconnect(code, 's').action, 'reconnect', `code ${code}`);
    assert.match(planAfterDisconnect(440, 'x').reason, /running twice/);
});

test('backoffDelay grows exponentially, is capped and jittered', () => {
    const fixed = { baseMs: 1000, maxMs: 60_000, random: () => 0.5 };
    assert.deepEqual([0, 1, 2, 3].map((n) => backoffDelay(n, fixed)), [1000, 2000, 4000, 8000]);
    assert.equal(backoffDelay(30, fixed), 60_000);
    assert.equal(backoffDelay(0, { ...fixed, random: () => 0 }), 800);
    assert.equal(backoffDelay(0, { ...fixed, random: () => 1 }), 1200);
});

test('reconnects after the connection drops', async () => {
    const { fake, connection } = await start();
    try {
        openSocket(fake.sockets[0]);
        assert.equal(connection.isOpen, true);
        closeWith(fake.sockets[0], 428);
        assert.equal(connection.isOpen, false);

        await waitUntil(() => fake.sockets.length === 2);
        assert.equal(fake.sockets[0].ended, true, 'the old socket is closed before the new one starts');
        openSocket(fake.sockets[1]);
        assert.equal(connection.isOpen, true);
        assert.equal(connection.socket, fake.sockets[1]);
    } finally {
        connection.stop();
    }
});

test('keeps retrying when the socket cannot even be created (no internet)', async () => {
    const { fake, connection } = await start({ failAuthTimes: 3 });
    try {
        await waitUntil(() => fake.sockets.length === 1);
        assert.equal(fake.authCalls, 4);
    } finally {
        connection.stop();
    }
});

test('reconnects again and again after repeated drops', async () => {
    const { fake, connection } = await start();
    try {
        for (let i = 0; i < 5; i++) {
            closeWith(fake.sockets[i], 408);
            await waitUntil(() => fake.sockets.length === i + 2);
        }
        openSocket(fake.sockets[5]);
        assert.equal(connection.isOpen, true);
    } finally {
        connection.stop();
    }
});

test('reconnects immediately when WhatsApp asks for a restart', async () => {
    const { fake, connection } = await start();
    try {
        closeWith(fake.sockets[0], 515);
        await waitUntil(() => fake.sockets.length === 2, 50);
    } finally {
        connection.stop();
    }
});

for (const [code, label] of [[401, 'logged out'], [440, 'session opened elsewhere'], [403, 'forbidden']]) {
    test(`does not reconnect and explains why when ${label} (${code})`, async () => {
        const logs = [];
        const { fake, connection } = await start();
        console.log.mock.mockImplementation((line) => logs.push(line));
        try {
            closeWith(fake.sockets[0], code);
            await sleep(80);
            assert.equal(fake.sockets.length, 1, 'no new socket');
            assert.ok(logs.some((line) => /will not reconnect/.test(line)));
            await assert.rejects(connection.waitForOpen(10), /stopped/);
        } finally {
            connection.stop();
        }
    });
}

test('ignores events from sockets that were already replaced', async () => {
    const { fake, connection, received } = await start();
    try {
        closeWith(fake.sockets[0], 428);
        await waitUntil(() => fake.sockets.length === 2);
        const [old, current] = fake.sockets;

        old.ev.emit('messages.upsert', { messages: [{ id: 'old' }], type: 'notify' });
        current.ev.emit('messages.upsert', { messages: [{ id: 'new' }], type: 'notify' });
        assert.deepEqual(received.map((e) => e.messages[0].id), ['new']);

        closeWith(old, 428);
        await sleep(60);
        assert.equal(fake.sockets.length, 2, 'a late close from the old socket must not start a third one');
    } finally {
        connection.stop();
    }
});

test('deliveries say whether they belong to the first session after start-up', async () => {
    const seen = [];
    const { fake, connection } = await start({ onMessages: (event, sock, meta) => seen.push(meta.firstSession) });
    try {
        fake.sockets[0].ev.emit('messages.upsert', { messages: [], type: 'append' });
        openSocket(fake.sockets[0]);
        fake.sockets[0].ev.emit('messages.upsert', { messages: [], type: 'append' });
        closeWith(fake.sockets[0], 428);
        await waitUntil(() => fake.sockets.length === 2);
        openSocket(fake.sockets[1]);
        fake.sockets[1].ev.emit('messages.upsert', { messages: [], type: 'append' });
        assert.deepEqual(seen, [true, true, false]);
    } finally {
        connection.stop();
    }
});

test('status reports connecting, open and stopped', async () => {
    const { fake, connection } = await start();
    assert.equal(connection.status.state, 'connecting');
    assert.equal(connection.status.everOpened, false);
    openSocket(fake.sockets[0]);
    assert.equal(connection.status.state, 'open');
    assert.equal(connection.status.everOpened, true);
    connection.stop();
    assert.equal(connection.status.state, 'stopped');
});

test('a throwing message handler does not break later deliveries', async () => {
    let calls = 0;
    const { fake, connection } = await start({
        onMessages: () => { calls++; if (calls === 1) throw new Error('bad message'); }
    });
    try {
        fake.sockets[0].ev.emit('messages.upsert', { messages: [], type: 'notify' });
        fake.sockets[0].ev.emit('messages.upsert', { messages: [], type: 'notify' });
        assert.equal(calls, 2);
    } finally {
        connection.stop();
    }
});

test('waitForOpen resolves with the new socket after a reconnection', async () => {
    const { fake, connection } = await start();
    try {
        openSocket(fake.sockets[0]);
        closeWith(fake.sockets[0], 428);
        const pending = connection.waitForOpen(1000);
        await waitUntil(() => fake.sockets.length === 2);
        openSocket(fake.sockets[1]);
        assert.equal(await pending, fake.sockets[1]);
        assert.equal(await connection.waitForOpen(10), fake.sockets[1], 'resolves at once while open');
    } finally {
        connection.stop();
    }
});

test('waitForOpen fails with a timeout while offline instead of hanging', async () => {
    const { connection } = await start();
    try {
        await assert.rejects(connection.waitForOpen(20), StepTimeoutError);
    } finally {
        connection.stop();
    }
});

test('resend support survives reconnections', async () => {
    const { fake, connection } = await start();
    try {
        connection.rememberSent('MSG1', { stickerMessage: { isAnimated: true } });
        closeWith(fake.sockets[0], 428);
        await waitUntil(() => fake.sockets.length === 2);

        const [first, second] = fake.sockets;
        assert.equal(first.options.msgRetryCounterCache, second.options.msgRetryCounterCache, 'retry counters are shared');
        assert.deepEqual(await second.options.getMessage({ id: 'MSG1' }), { stickerMessage: { isAnimated: true } });
        assert.equal(await second.options.getMessage({ id: 'unknown' }), undefined);
        assert.equal(second.options.markOnlineOnConnect, false, 'the phone keeps receiving notifications');
    } finally {
        connection.stop();
    }
});

test('uses a pairing code instead of the QR code when a number is configured', async () => {
    const logs = [];
    const { fake, connection } = await start({ config: { pairingNumber: '573001234567' } });
    console.log.mock.mockImplementation((line) => logs.push(line));
    try {
        fake.sockets[0].ev.emit('connection.update', { qr: 'qr-data' });
        await waitUntil(() => logs.some((line) => /Pairing code: ABCD1234/.test(line)));
    } finally {
        connection.stop();
    }
});
