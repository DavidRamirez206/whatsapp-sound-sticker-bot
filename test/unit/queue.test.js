'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../../src/queue');

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};

test('never runs more jobs than the limit and keeps FIFO order', async () => {
    const queue = createQueue(2);
    const started = [];
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let maxActive = 0;

    const results = gates.map((gate, index) => queue.run(async () => {
        started.push(index);
        maxActive = Math.max(maxActive, queue.active);
        await gate.promise;
        return index;
    }));

    await new Promise(setImmediate);
    assert.deepEqual(started, [0, 1]);
    assert.equal(queue.pending, 2);

    gates[0].resolve();
    await results[0];
    await new Promise(setImmediate);
    assert.deepEqual(started, [0, 1, 2]);

    gates.forEach((gate) => gate.resolve());
    assert.deepEqual(await Promise.all(results), [0, 1, 2, 3]);
    assert.equal(maxActive, 2);
    assert.equal(queue.active, 0);
});

test('a failing job rejects its own promise and frees its slot', async () => {
    const queue = createQueue(1);
    const failing = queue.run(async () => { throw new Error('boom'); });
    const next = queue.run(async () => 'next');
    await assert.rejects(failing, /boom/);
    assert.equal(await next, 'next');
});

test('onQueued reports how many jobs are waiting', async () => {
    const reports = [];
    const queue = createQueue(1, { onQueued: (pending) => reports.push(pending) });
    const gate = deferred();
    const jobs = [queue.run(() => gate.promise), queue.run(async () => {}), queue.run(async () => {})];
    assert.deepEqual(reports, [1, 2]);
    gate.resolve();
    await Promise.all(jobs);
});
