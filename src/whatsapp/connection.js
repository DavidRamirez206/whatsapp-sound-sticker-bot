'use strict';

/**
 * Resilient WhatsApp connection.
 *
 * Owns the Baileys socket and keeps it alive for the whole life of the process:
 *
 * - Reconnects after every recoverable disconnect with exponential back-off and
 *   jitter, and keeps trying forever; a failure while creating the socket (no
 *   internet, DNS) is retried the same way instead of leaving the bot deaf.
 * - Stops only on disconnects that a retry cannot fix (logged out, session
 *   opened by another instance, account forbidden) and says what to do.
 * - Ignores events from sockets that were already replaced, so a late event
 *   from an old socket can never start a second, competing connection.
 * - A watchdog restarts the connection if it stays down without a pending
 *   reconnection, as a safety net for missed `close` events.
 * - Message-retry counters and recently sent messages live outside the socket,
 *   so WhatsApp's "resend this message" requests still work after a reconnection.
 * - {@link waitForOpen} lets long jobs fetch the current socket right before
 *   each network operation instead of holding on to one that may have died.
 */

const pino = require('pino');
const qrcode = require('qrcode-terminal');
const baileys = require('@whiskeysockets/baileys');
const { log } = require('../logger');
const { describeError, StepTimeoutError } = require('../retry');
const { createTtlCache } = require('../ttl-cache');

const BACKOFF = Object.freeze({ baseMs: 1000, maxMs: 60_000 });
const WATCHDOG_INTERVAL_MS = 60_000;
/** Disconnected for longer than this triggers a warning on every watchdog tick. */
const LONG_OUTAGE_MS = 5 * 60_000;

/**
 * @typedef {object} DisconnectPlan
 * @property {'reconnect' | 'reconnect-now' | 'stop'} action
 * @property {string} reason Human readable explanation for the log.
 */

/**
 * Decides what to do after the socket closed. Pure function.
 *
 * @param {number | undefined} statusCode Boom status code from `lastDisconnect.error`.
 * @param {string} sessionDir Shown in the instructions for unrecoverable cases.
 * @returns {DisconnectPlan}
 */
function planAfterDisconnect(statusCode, sessionDir) {
    const { DisconnectReason } = baileys;
    switch (statusCode) {
    case DisconnectReason.loggedOut:
        return { action: 'stop', reason: `logged out from the phone. Delete "${sessionDir}" and start the bot again to link it.` };
    case DisconnectReason.connectionReplaced:
        return { action: 'stop', reason: 'this session was opened somewhere else (is the bot running twice with the same session folder?). ' +
            'Close the other instance and start this one again.' };
    case DisconnectReason.forbidden:
        return { action: 'stop', reason: 'WhatsApp refused the account (it may be restricted or banned).' };
    case DisconnectReason.multideviceMismatch:
        return { action: 'stop', reason: `the linked-device session is no longer valid. Delete "${sessionDir}" and link again.` };
    case DisconnectReason.restartRequired:
        return { action: 'reconnect-now', reason: 'restart requested by WhatsApp (normal right after linking)' };
    case DisconnectReason.badSession:
        return { action: 'reconnect', reason: `session error; if this keeps happening delete "${sessionDir}" and link again` };
    default:
        return { action: 'reconnect', reason: statusCode ? `code ${statusCode}` : 'network error' };
    }
}

/**
 * Exponential back-off with ±20 % jitter, capped at `maxMs`. Pure given `random`.
 *
 * @param {number} attempt 0 for the first retry.
 * @param {{ baseMs?: number, maxMs?: number, random?: () => number }} [options]
 * @returns {number} Milliseconds to wait.
 */
function backoffDelay(attempt, { baseMs = BACKOFF.baseMs, maxMs = BACKOFF.maxMs, random = Math.random } = {}) {
    const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
    return Math.round(exponential * (0.8 + 0.4 * random()));
}

/**
 * @param {object} options
 * @param {ReturnType<typeof import('../config').loadConfig>} options.config
 * @param {(event: { messages: any[], type: string }, sock: any) => void} options.onMessages
 *        Called for every `messages.upsert` of the live socket. Exceptions are caught and logged.
 * @param {object} [options.dependencies] Baileys functions and timings, replaceable in tests.
 */
function createConnection({ config, onMessages, dependencies = {} }) {
    const {
        makeWASocket = baileys.default,
        useMultiFileAuthState = baileys.useMultiFileAuthState,
        fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore,
        backoff = BACKOFF,
        watchdogIntervalMs = WATCHDOG_INTERVAL_MS
    } = dependencies;
    const silentLogger = pino({ level: 'silent' });
    const retryCounters = createTtlCache({ maxEntries: 5000, ttlMs: 60 * 60_000 });
    const sentMessages = createTtlCache({ maxEntries: 500, ttlMs: 60 * 60_000 });

    let sock = null;
    let generation = 0;
    let open = false;
    let everOpened = false;
    /** A socket exists and has not reported `close` yet (it may still be logging in). */
    let socketAlive = false;
    let connecting = false;
    let stopped = false;
    let attempts = 0;
    let reconnectTimer = null;
    let watchdog = null;
    let downSince = Date.now();
    /** @type {Array<{ resolve: (sock: any) => void, timer: NodeJS.Timeout }>} */
    let waiters = [];

    const markOpen = (socket) => {
        open = true;
        attempts = 0;
        const ready = waiters;
        waiters = [];
        for (const waiter of ready) {
            clearTimeout(waiter.timer);
            waiter.resolve(socket);
        }
    };

    const scheduleReconnect = (delayMs) => {
        if (stopped || reconnectTimer) return;
        log('CONNECTION', `reconnecting in ${(delayMs / 1000).toFixed(1)}s...`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delayMs);
    };

    const retryLater = () => scheduleReconnect(backoffDelay(attempts++, backoff));

    const endSocket = (socket) => {
        try { socket.end(undefined); } catch { /* already closed */ }
    };

    async function onConnectionUpdate(socketGeneration, socket, update, pairing) {
        if (socketGeneration !== generation) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr && config.pairingNumber && !pairing.requested) {
            pairing.requested = true;
            try {
                const code = await socket.requestPairingCode(config.pairingNumber);
                log('LOGIN', `Pairing code: ${code}`);
                log('LOGIN', 'WhatsApp > Linked devices > Link a device > Link with phone number instead, then type the code.');
            } catch (error) {
                log('ERR', `could not request a pairing code: ${describeError(error)}`);
            }
        } else if (qr && !config.pairingNumber) {
            console.clear();
            console.log('Scan this QR code with WhatsApp (Settings > Linked devices > Link a device):');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            const downForMs = Date.now() - downSince;
            const outage = everOpened && downForMs > 5000 ? ` (was offline ${Math.round(downForMs / 1000)}s)` : '';
            everOpened = true;
            markOpen(socket);
            log('CONNECTION', `linked${outage}. ` +
                `Send a video with the caption ${config.command} to get a sticker with sound.`);
        } else if (connection === 'close') {
            if (open) downSince = Date.now();
            open = false;
            socketAlive = false;
            if (stopped) return;
            const status = lastDisconnect?.error?.output?.statusCode;
            const plan = planAfterDisconnect(status, config.sessionDir);
            log('CONNECTION', `closed: ${plan.reason}`);
            if (plan.action === 'stop') {
                stop();
                log('CONNECTION', 'the bot will not reconnect on its own. Fix the problem above and start it again.');
            } else if (plan.action === 'reconnect-now') {
                scheduleReconnect(0);
            } else {
                retryLater();
            }
        }
    }

    async function connect() {
        if (stopped || connecting) return;
        connecting = true;
        const socketGeneration = ++generation;
        if (sock) endSocket(sock);
        try {
            const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
            const { version, error } = await fetchLatestBaileysVersion();
            if (error) log('CONNECTION', 'could not check the latest WhatsApp Web version; using the bundled one');
            if (socketGeneration !== generation || stopped) return;

            const socket = makeWASocket({
                version,
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
                logger: silentLogger,
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                markOnlineOnConnect: false,
                msgRetryCounterCache: retryCounters,
                getMessage: async (key) => sentMessages.get(key.id)
            });
            sock = socket;
            socketAlive = true;
            const pairing = { requested: false };

            socket.ev.on('creds.update', () => {
                Promise.resolve().then(saveCreds)
                    .catch((saveError) => log('ERR', `could not save the session: ${describeError(saveError)}`));
            });
            socket.ev.on('connection.update', (update) => {
                onConnectionUpdate(socketGeneration, socket, update, pairing)
                    .catch((updateError) => log('ERR', `connection update failed: ${describeError(updateError)}`));
            });
            socket.ev.on('messages.upsert', (event) => {
                if (socketGeneration !== generation) return;
                try {
                    onMessages(event, socket);
                } catch (handlerError) {
                    log('ERR', `message handler failed: ${describeError(handlerError)}`);
                }
            });
        } catch (error) {
            log('ERR', `could not start the WhatsApp connection: ${describeError(error)}`);
            retryLater();
        } finally {
            connecting = false;
        }
    }

    function tickWatchdog() {
        if (stopped || open) return;
        const downForMs = Date.now() - downSince;
        if (everOpened && downForMs > LONG_OUTAGE_MS) {
            log('CONNECTION', `still offline after ${Math.round(downForMs / 60_000)} min; commands are delivered when it comes back`);
        }
        if (!socketAlive && !reconnectTimer && !connecting) {
            log('CONNECTION', 'watchdog: no connection and no reconnection pending, restarting it');
            connect();
        }
    }

    /**
     * Stops reconnecting and closes the socket. Pending `waitForOpen` calls time out.
     */
    function stop() {
        stopped = true;
        open = false;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        clearInterval(watchdog);
        if (sock) endSocket(sock);
    }

    return {
        /** Opens the first connection and starts the watchdog. */
        async start() {
            watchdog = setInterval(tickWatchdog, watchdogIntervalMs);
            await connect();
        },
        stop,
        /** @returns {boolean} */
        get isOpen() { return open; },
        /** @returns {any} The current socket, possibly not connected. */
        get socket() { return sock; },

        /**
         * Resolves with the live socket as soon as the connection is open.
         *
         * @param {number} [timeoutMs]
         * @returns {Promise<any>}
         */
        waitForOpen(timeoutMs = 60_000) {
            if (open && sock) return Promise.resolve(sock);
            if (stopped) return Promise.reject(new Error('the WhatsApp connection was stopped'));
            return new Promise((resolve, reject) => {
                const waiter = {
                    resolve,
                    timer: setTimeout(() => {
                        waiters = waiters.filter((w) => w !== waiter);
                        reject(new StepTimeoutError('waiting for the WhatsApp connection', timeoutMs));
                    }, timeoutMs)
                };
                waiters.push(waiter);
            });
        },

        /**
         * Keeps a sent message so it can be encrypted again if a recipient asks for it.
         *
         * @param {string | null | undefined} id Message id.
         * @param {any} message `proto.IMessage`
         */
        rememberSent(id, message) {
            if (id && message) sentMessages.set(id, message);
        }
    };
}

module.exports = { createConnection, planAfterDisconnect, backoffDelay };
