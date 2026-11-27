'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireSessionLock, isHeldByAnother, SessionLockedError } = require('../../src/session-lock');

function withDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
    try {
        return fn(path.join(dir, 'whatsapp_session'));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const self = { pid: 10, host: 'a', now: 100_000, staleMs: 60_000, isAlive: () => true };

test('isHeldByAnother: free, own, stale and dead locks do not block', () => {
    assert.equal(isHeldByAnother(null, self), false);
    assert.equal(isHeldByAnother({ pid: 10, host: 'a', updatedAt: 99_000 }, self), false, 'own lock');
    assert.equal(isHeldByAnother({ pid: 11, host: 'b', updatedAt: 10_000 }, self), false, 'stale');
    assert.equal(isHeldByAnother({ pid: 11, host: 'a', updatedAt: 99_000 }, { ...self, isAlive: () => false }), false, 'dead process');
});

test('isHeldByAnother: a fresh lock of another live instance blocks', () => {
    assert.equal(isHeldByAnother({ pid: 11, host: 'a', updatedAt: 99_000 }, self), true);
    assert.equal(isHeldByAnother({ pid: 10, host: 'other-container', updatedAt: 99_000 }, self), true);
});

test('a second instance cannot take the same session', () => withDir((session) => {
    const first = acquireSessionLock(session, { pid: 1, host: 'h1' });
    try {
        assert.throws(() => acquireSessionLock(session, { pid: 2, host: 'h2' }), SessionLockedError);
    } finally {
        first.release();
    }
    const second = acquireSessionLock(session, { pid: 2, host: 'h2' });
    second.release();
    assert.equal(fs.existsSync(second.file), false);
}));

test('a lock left by a crash is taken over once stale', () => withDir((session) => {
    fs.mkdirSync(path.dirname(session), { recursive: true });
    fs.writeFileSync(`${session}.lock`, JSON.stringify({ pid: 1, host: 'gone', updatedAt: Date.now() - 120_000 }));
    const lock = acquireSessionLock(session, { pid: 2, host: 'h2' });
    lock.release();
}));

test('a corrupt lock file does not block start-up', () => withDir((session) => {
    fs.mkdirSync(path.dirname(session), { recursive: true });
    fs.writeFileSync(`${session}.lock`, '{not json');
    acquireSessionLock(session, { pid: 2, host: 'h2' }).release();
}));

test('release does not delete a lock that now belongs to another instance', () => withDir((session) => {
    const lock = acquireSessionLock(session, { pid: 1, host: 'h1' });
    fs.writeFileSync(lock.file, JSON.stringify({ pid: 9, host: 'h9', updatedAt: Date.now() }));
    lock.release();
    assert.equal(fs.existsSync(lock.file), true);
}));
