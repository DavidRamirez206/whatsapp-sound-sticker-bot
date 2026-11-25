'use strict';

/**
 * Builds a standalone executable from `dist/bot.cjs` using Node's Single
 * Executable Applications feature: the bundle is serialised into a blob and
 * injected into a copy of the running `node` binary.
 *
 * Output: `dist/sound-sticker-bot` (Linux/macOS) or `dist/sound-sticker-bot.exe` (Windows).
 * Run it with the same Node version you want to ship (the CI uses Node 24).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inject } = require('postject');

const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const dist = path.join(__dirname, '..', 'dist');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

async function build() {
    const bundle = path.join(dist, 'bot.cjs');
    if (!fs.existsSync(bundle)) throw new Error('dist/bot.cjs not found, run "npm run bundle" first');

    const blob = path.join(dist, 'sea-prep.blob');
    const configFile = path.join(dist, 'sea-config.json');
    fs.writeFileSync(configFile, JSON.stringify({
        main: bundle,
        output: blob,
        disableExperimentalSEAWarning: true,
        useCodeCache: false
    }, null, 2));
    execFileSync(process.execPath, ['--experimental-sea-config', configFile], { stdio: 'inherit' });

    const executable = path.join(dist, isWindows ? 'sound-sticker-bot.exe' : 'sound-sticker-bot');
    fs.copyFileSync(process.execPath, executable);
    if (isMac) execFileSync('codesign', ['--remove-signature', executable]);

    await inject(executable, 'NODE_SEA_BLOB', fs.readFileSync(blob), {
        sentinelFuse: SENTINEL_FUSE,
        ...(isMac ? { machoSegmentName: 'NODE_SEA' } : {})
    });

    if (isMac) execFileSync('codesign', ['--sign', '-', executable]);
    if (!isWindows) fs.chmodSync(executable, 0o755);
    fs.rmSync(blob, { force: true });
    fs.rmSync(configFile, { force: true });
    console.log(`Executable written to ${path.relative(process.cwd(), executable)}`);
}

build().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
