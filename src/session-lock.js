'use strict';

/**
 * Single-instance guard for a WhatsApp session folder.
 *
 * Two processes using the same session (two containers, or a container and the
 * executable) keep disconnecting each other ("connection replaced") and can
 * corrupt the credentials. The first instance creates `<session>.lock` next to
 * the session folder and refreshes it periodically; any other instance refuses
 * to start while that lock is fresh.
 *
 * A lock left behind by a crash does not block forever: it is considered stale
 * once it stops being refreshed for `staleMs`, or immediately when it belongs to
 * a process on this same machine that no longer exists.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = Object.freeze({ refreshMs: 20_000, staleMs: 60_000 });

/** Raised when another live instance holds the lock. */
class SessionLockedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SessionLockedError';
    }
}

/**
 * @param {number} pid
 * @returns {boolean} Whether a process with that id exists on this machine.
 */
function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

/**
 * @typedef {{ pid: number, host: string, updatedAt: number }} LockInfo
 */

/**
 * Decides whether an existing lock still belongs to a running instance. Pure
 * given its inputs.
 *
 * @param {LockInfo | null} lock Current lock file contents.
 * @param {{ pid: number, host: string, now: number, staleMs: number, isAlive: (pid: number) => boolean }} self
 * @returns {boolean}
 */
function isHeldByAnother(lock, { pid, host, now, staleMs, isAlive }) {
    if (!lock || typeof lock.updatedAt !== 'number') return false;
    if (lock.host === host && lock.pid === pid) return false;
    if (now - lock.updatedAt > staleMs) return false;
    if (lock.host === host && !isAlive(lock.pid)) return false;
    return true;
}

/**
 * Takes the lock for `sessionDir` or throws {@link SessionLockedError}.
 *
 * @param {string} sessionDir
 * @param {object} [options]
 * @param {number} [options.refreshMs]
 * @param {number} [options.staleMs]
 * @param {() => number} [options.now]
 * @param {number} [options.pid]
 * @param {string} [options.host]
 * @param {(pid: number) => boolean} [options.isAlive]
 * @returns {{ file: string, release: () => void }}
 */
function acquireSessionLock(sessionDir, {
    refreshMs = DEFAULTS.refreshMs,
    staleMs = DEFAULTS.staleMs,
    now = Date.now,
    pid = process.pid,
    host = os.hostname(),
    isAlive = processExists
} = {}) {
    const file = `${path.resolve(sessionDir)}.lock`;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    let current = null;
    try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* missing or unreadable: free */ }

    if (isHeldByAnother(current, { pid, host, now: now(), staleMs, isAlive })) {
        const ageSeconds = Math.round((now() - current.updatedAt) / 1000);
        throw new SessionLockedError(`The WhatsApp session "${sessionDir}" is already in use by another instance ` +
            `(process ${current.pid} on "${current.host}", active ${ageSeconds}s ago). Close it first: two instances ` +
            'with the same session disconnect each other. If no other instance is running, wait ' +
            `${Math.round(staleMs / 1000)}s and try again.`);
    }

    const write = () => fs.writeFileSync(file, JSON.stringify({ pid, host, updatedAt: now() }));
    write();
    const timer = setInterval(() => {
        try { write(); } catch { /* retried on the next tick */ }
    }, refreshMs);
    timer.unref();

    return {
        file,
        release() {
            clearInterval(timer);
            try {
                const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (lock.pid === pid && lock.host === host) fs.rmSync(file, { force: true });
            } catch { /* already gone */ }
        }
    };
}

module.exports = { SessionLockedError, acquireSessionLock, isHeldByAnother };
