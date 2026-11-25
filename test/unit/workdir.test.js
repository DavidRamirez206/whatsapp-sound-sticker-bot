'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkDir, pruneOldFolders } = require('../../src/workdir');

test('temporary work dirs are deleted on cleanup', () => {
    const work = createWorkDir({ saveOutputs: false, outputsDir: '', keepOutputs: 1 });
    assert.equal(work.persistent, false);
    assert.ok(fs.existsSync(work.dir));
    work.cleanup();
    assert.equal(fs.existsSync(work.dir), false);
});

test('saved outputs persist and only the newest folders are kept', () => {
    const outputsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outputs-test-'));
    try {
        for (const name of ['2026-01-01', '2026-01-02', '2026-01-03']) fs.mkdirSync(path.join(outputsDir, name));
        const work = createWorkDir({ saveOutputs: true, outputsDir, keepOutputs: 2 });
        work.cleanup();
        assert.equal(work.persistent, true);
        assert.ok(fs.existsSync(work.dir));
        assert.deepEqual(fs.readdirSync(outputsDir).sort(), ['2026-01-03', path.basename(work.dir)].sort());

        pruneOldFolders(outputsDir, 1);
        assert.deepEqual(fs.readdirSync(outputsDir), [path.basename(work.dir)]);
    } finally {
        fs.rmSync(outputsDir, { recursive: true, force: true });
    }
});
