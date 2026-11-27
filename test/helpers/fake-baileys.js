'use strict';

/**
 * Fake Baileys socket factory for connection tests. Each created socket has a
 * real EventEmitter as `ev`, so tests can emit `connection.update` and
 * `messages.upsert` exactly like the library does.
 */

const { EventEmitter } = require('node:events');

/**
 * @param {{ failAuthTimes?: number }} [options] Number of initial socket creations that fail.
 */
function createFakeBaileys({ failAuthTimes = 0 } = {}) {
    const sockets = [];
    let authCalls = 0;

    return {
        sockets,
        get authCalls() { return authCalls; },
        dependencies: {
            makeWASocket(options) {
                const socket = {
                    options,
                    ev: new EventEmitter(),
                    ended: false,
                    end() { this.ended = true; },
                    async requestPairingCode() { return 'ABCD1234'; }
                };
                sockets.push(socket);
                return socket;
            },
            async useMultiFileAuthState() {
                authCalls++;
                if (authCalls <= failAuthTimes) throw new Error('getaddrinfo ENOTFOUND web.whatsapp.com');
                return { state: { creds: {}, keys: {} }, saveCreds: async () => {} };
            },
            async fetchLatestBaileysVersion() { return { version: [2, 3000, 1] }; },
            makeCacheableSignalKeyStore: (keys) => keys,
            backoff: { baseMs: 5, maxMs: 20 },
            watchdogIntervalMs: 25
        }
    };
}

/** Emits a close event with the given Boom status code. */
function closeWith(socket, statusCode) {
    socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });
}

/** Emits an open event. */
function openSocket(socket) {
    socket.ev.emit('connection.update', { connection: 'open' });
}

/**
 * Polls `condition` until it is true or `timeoutMs` passes.
 *
 * @param {() => boolean} condition
 * @param {number} [timeoutMs]
 */
async function waitUntil(condition, timeoutMs = 2000) {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeoutMs) throw new Error('condition not met in time');
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { createFakeBaileys, closeWith, openSocket, waitUntil, sleep };
