'use strict';

/**
 * Health reporting for supervisors such as Docker.
 *
 * While the bot runs it rewrites a small JSON file with the connection state
 * every few seconds. `scripts/healthcheck.js` reads that file and decides
 * whether the bot is healthy: a file that stops being refreshed means the
 * process is frozen, and a connection that is stopped or offline for too long
 * means a person has to look at the logs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { log } = require('./logger');
const { describeError } = require('./retry');

const DEFAULTS = Object.freeze({
    intervalMs: 15_000,
    /** A report older than this means the process stopped refreshing it. */
    staleMs: 90_000,
    /** Offline longer than this (after having connected once) is unhealthy. */
    maxOfflineMs: 15 * 60_000
});

/**
 * @typedef {object} HealthReport
 * @property {'open' | 'connecting' | 'stopped'} state
 * @property {number} since Epoch ms when the current state began.
 * @property {boolean} everOpened Whether the bot has been linked at least once since start-up.
 * @property {number} updatedAt Epoch ms of the last refresh.
 */

/**
 * Writes `report` to `file` atomically (temporary file + rename), so a reader
 * never sees a half-written file.
 *
 * @param {string} file
 * @param {HealthReport} report
 */
function writeReport(file, report) {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(report));
    fs.renameSync(temporary, file);
}

/**
 * Refreshes the health file periodically until `stop` is called.
 *
 * @param {object} options
 * @param {string} options.file
 * @param {() => { state: HealthReport['state'], since: number, everOpened: boolean }} options.getStatus
 * @param {number} [options.intervalMs]
 * @param {() => number} [options.now]
 * @returns {{ stop: () => void, refresh: () => void }}
 */
function startHealthReporter({ file, getStatus, intervalMs = DEFAULTS.intervalMs, now = Date.now }) {
    let failing = false;
    const refresh = () => {
        try {
            writeReport(file, { ...getStatus(), updatedAt: now() });
            failing = false;
        } catch (error) {
            if (!failing) log('ERR', `could not write the health file ${file}: ${describeError(error)}`);
            failing = true;
        }
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    timer.unref();
    return {
        refresh,
        stop() {
            clearInterval(timer);
            fs.rmSync(file, { force: true });
        }
    };
}

/**
 * Decides whether a health report describes a working bot. Pure function.
 *
 * Waiting for the first login (QR code not scanned yet) counts as healthy, so
 * a fresh container is not flagged while someone is linking it.
 *
 * @param {HealthReport | null} report
 * @param {number} nowMs
 * @param {{ staleMs?: number, maxOfflineMs?: number }} [limits]
 * @returns {{ healthy: boolean, reason: string }}
 */
function evaluateHealth(report, nowMs, { staleMs = DEFAULTS.staleMs, maxOfflineMs = DEFAULTS.maxOfflineMs } = {}) {
    if (!report || typeof report.updatedAt !== 'number') return { healthy: false, reason: 'no health report found' };
    if (nowMs - report.updatedAt > staleMs) {
        return { healthy: false, reason: `the bot stopped responding ${Math.round((nowMs - report.updatedAt) / 1000)}s ago` };
    }
    if (report.state === 'open') return { healthy: true, reason: 'connected to WhatsApp' };
    if (report.state === 'stopped') return { healthy: false, reason: 'the connection was stopped and needs attention; see the logs' };
    if (!report.everOpened) return { healthy: true, reason: 'waiting for the WhatsApp login (scan the QR code in the logs)' };

    const offlineMs = nowMs - report.since;
    if (offlineMs > maxOfflineMs) return { healthy: false, reason: `offline for ${Math.round(offlineMs / 60_000)} min` };
    return { healthy: true, reason: `reconnecting (offline for ${Math.round(offlineMs / 1000)}s)` };
}

/**
 * Reads and parses a health file.
 *
 * @param {string} file
 * @returns {HealthReport | null} `null` if missing or unreadable.
 */
function readReport(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

module.exports = { startHealthReporter, evaluateHealth, readReport, writeReport };
