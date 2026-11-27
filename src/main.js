'use strict';

/**
 * Application bootstrap: configuration, environment checks, protocol patches,
 * process-level error handling and bot start-up.
 */

const dns = require('node:dns');
const { proto } = require('@whiskeysockets/baileys');
const { loadEnvFile, loadConfig } = require('./config');
const { log, silenceSignalSessionDumps } = require('./logger');
const { describeError } = require('./retry');
const { assertFfmpegReady, setProcessTimeout } = require('./media/ffmpeg');
const { installStickerAudioPatch } = require('./sticker-audio-patch');
const { installDecodeInspector } = require('./whatsapp/inspect');
const { startBot } = require('./bot');
const { startHealthReporter } = require('./health');
const { acquireSessionLock } = require('./session-lock');

/**
 * Last line of defence. Errors that escape every handler are logged with their
 * stack instead of being lost. Rejections are not fatal: the connection manager
 * and the job runner own their own recovery, so the process keeps serving. A
 * burst of uncaught exceptions means the state is no longer trustworthy, so the
 * process exits with an error code (a supervisor such as systemd restarts it).
 */
function installProcessHandlers() {
    process.on('unhandledRejection', (reason) => {
        log('ERR', `unhandled promise rejection: ${describeError(reason)}${reason && reason.stack ? `\n${reason.stack}` : ''}`);
    });

    const recentCrashes = [];
    process.on('uncaughtException', (error) => {
        log('ERR', `uncaught exception: ${describeError(error)}${error && error.stack ? `\n${error.stack}` : ''}`);
        const now = Date.now();
        recentCrashes.push(now);
        while (recentCrashes.length && now - recentCrashes[0] > 60_000) recentCrashes.shift();
        if (recentCrashes.length >= 5) {
            log('ERR', '5 uncaught exceptions in one minute; exiting so the bot can be restarted cleanly');
            process.exit(1);
        }
    });
}

/**
 * Closes the WhatsApp connection on Ctrl+C or a service stop (including
 * `docker stop`), so the session files are not left half-written.
 *
 * @param {{ stop: () => void }} bot
 * @param {Array<() => void>} cleanups Run after the bot stops (health file, session lock).
 */
function installShutdown(bot, cleanups) {
    let closing = false;
    const shutdown = (signal) => {
        if (closing) return;
        closing = true;
        log('STOP', `${signal} received, closing the connection`);
        try { bot.stop(); } catch (error) { log('ERR', `while stopping: ${describeError(error)}`); }
        for (const cleanup of cleanups) {
            try { cleanup(); } catch (error) { log('ERR', `while cleaning up: ${describeError(error)}`); }
        }
        setTimeout(() => process.exit(0), 500).unref();
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
    // Many home networks advertise IPv6 without routing it; media downloads then
    // fail with "fetch failed / ETIMEDOUT". Preferring IPv4 avoids that.
    dns.setDefaultResultOrder('ipv4first');

    loadEnvFile();
    const config = loadConfig();

    silenceSignalSessionDumps();
    installProcessHandlers();
    setProcessTimeout(config.ffmpegTimeoutMs);
    log('START', await assertFfmpegReady());

    installStickerAudioPatch(proto);
    if (config.debug) installDecodeInspector(proto, config.command);

    const cleanups = [];
    if (config.sessionLock) cleanups.push(acquireSessionLock(config.sessionDir).release);

    const bot = await startBot(config);
    if (config.healthFile) {
        const reporter = startHealthReporter({ file: config.healthFile, getStatus: () => bot.connection.status });
        cleanups.unshift(reporter.stop);
    }
    installShutdown(bot, cleanups);
}

module.exports = { main };
