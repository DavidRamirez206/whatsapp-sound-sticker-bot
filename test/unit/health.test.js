'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluateHealth, readReport, startHealthReporter } = require('../../src/health');

const NOW = 1_000_000_000;
const report = (overrides) => ({ state: 'open', since: NOW - 5000, everOpened: true, updatedAt: NOW - 1000, ...overrides });

test('a connected bot with a fresh report is healthy', () => {
    assert.equal(evaluateHealth(report(), NOW).healthy, true);
});

test('a missing report is unhealthy', () => {
    assert.equal(evaluateHealth(null, NOW).healthy, false);
});

test('a report that stopped being refreshed means a frozen process', () => {
    const result = evaluateHealth(report({ updatedAt: NOW - 120_000 }), NOW);
    assert.equal(result.healthy, false);
    assert.match(result.reason, /stopped responding/);
});

test('a stopped connection (logged out, replaced) is unhealthy', () => {
    assert.equal(evaluateHealth(report({ state: 'stopped' }), NOW).healthy, false);
});

test('waiting for the first login is healthy so a new container can be linked', () => {
    const result = evaluateHealth(report({ state: 'connecting', everOpened: false, since: NOW - 3_600_000 }), NOW);
    assert.equal(result.healthy, true);
    assert.match(result.reason, /QR/);
});

test('a short reconnection is healthy, a long outage is not', () => {
    assert.equal(evaluateHealth(report({ state: 'connecting', since: NOW - 60_000 }), NOW).healthy, true);
    assert.equal(evaluateHealth(report({ state: 'connecting', since: NOW - 20 * 60_000 }), NOW).healthy, false);
});

test('the reporter writes the status and removes the file on stop', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
    const file = path.join(dir, 'nested', 'health.json');
    try {
        const reporter = startHealthReporter({ file, getStatus: () => ({ state: 'open', since: 1, everOpened: true }), now: () => 42 });
        assert.deepEqual(readReport(file), { state: 'open', since: 1, everOpened: true, updatedAt: 42 });
        reporter.stop();
        assert.equal(fs.existsSync(file), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a failing status getter does not throw out of the reporter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
    try {
        const reporter = startHealthReporter({ file: path.join(dir, 'h.json'), getStatus: () => { throw new Error('boom'); } });
        reporter.refresh();
        reporter.stop();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
